/**
 * API mount point — turns the router into an HTTP handler.
 *
 * Owns the cross-cutting concerns: CORS-free same-origin JSON, rate limiting,
 * request bodies, authentication, error mapping and request logging. Route
 * handlers stay focused on their own job.
 */
import { readJsonBody, statusForError } from '../http/router.js';
import { toAppError } from '../errors.js';

export function createApiHandler({ router, config, services, rateLimiter, log }) {
  return async function handleApi(req, res, url) {
    const started = Date.now();
    const matched = router.match(req.method, url.pathname);

    if (!matched) {
      return sendJson(res, 404, { ok: false, error: 'Not found', code: 'not_found' });
    }

    const { route, params } = matched;
    const ip = req.ip || req.socket?.remoteAddress || '';
    const context = { req, res, url, params, query: Object.fromEntries(url.searchParams), body: {}, user: null, ip };

    try {
      if (route.options.rateLimit) {
        const verdict = rateLimiter.check(`${route.pattern}:${ip}`, route.options.rateLimit);
        if (!verdict.allowed) {
          res.setHeader('Retry-After', String(verdict.retryAfter));
          return sendJson(res, 429, {
            ok: false,
            error: 'Too many requests. Please slow down and try again.',
            code: 'rate_limited',
            details: { retry_after: verdict.retryAfter }
          });
        }
      }

      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        context.body = await readJsonBody(req);
      }

      context.user = await services.users.fromRequest(req).catch(() => null);

      const result = await route.handler(context);
      const payload = result === undefined ? {} : result;

      // Handlers return `__cookie` to set a session cookie; it is stripped here
      // so it can never be serialised into the response body by accident.
      if (payload && typeof payload.__cookie === 'string') {
        res.setHeader('Set-Cookie', payload.__cookie);
        delete payload.__cookie;
      }

      return sendJson(res, 200, { ok: true, ...payload });
    } catch (error) {
      const appError = toAppError(error);
      // Body-parsing failures carry their own status (400/413) on a plain
      // Error, so look at the original error before the AppError default.
      const status = statusForError(error);
      if (status >= 500) log?.error('api error', { method: req.method, path: url.pathname, error: appError.message });
      else log?.debug('api rejected request', { method: req.method, path: url.pathname, code: appError.code });
      return sendJson(res, status, { ok: false, ...appError.toJSON() });
    } finally {
      log?.debug('api request', { method: req.method, path: url.pathname, ms: Date.now() - started });
    }
  };
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}
