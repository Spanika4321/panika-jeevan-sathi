'use strict';
/**
 * SEVA MARKET INDIA — minimal path router.
 *
 * Supports `/api/v1/locations/:id` style patterns and compiles each one to a
 * RegExp once at registration. No dependency, no surprises: routes are
 * matched in registration order and the first match wins.
 */

class Router {
  constructor() {
    this.routes = [];
  }

  /**
   * @param {string} method HTTP method, uppercase.
   * @param {string} pattern e.g. '/api/v1/providers/:slug'
   * @param {(ctx: object) => any} handler
   */
  add(method, pattern, handler) {
    const keys = [];
    const source = pattern
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');

    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      regex: new RegExp(`^${source}/?$`),
      keys,
      handler,
    });
    return this;
  }

  get(pattern, handler) { return this.add('GET', pattern, handler); }
  post(pattern, handler) { return this.add('POST', pattern, handler); }
  put(pattern, handler) { return this.add('PUT', pattern, handler); }
  delete(pattern, handler) { return this.add('DELETE', pattern, handler); }

  /**
   * @returns {{handler: Function, params: object}|null}
   */
  match(method, pathname) {
    const wanted = String(method).toUpperCase();
    let pathExists = false;

    for (const route of this.routes) {
      const found = route.regex.exec(pathname);
      if (!found) continue;
      pathExists = true;
      if (route.method !== wanted) continue;
      const params = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(found[index + 1]);
      });
      return { handler: route.handler, params, pattern: route.pattern };
    }
    // Distinguish "no such path" from "wrong method" so the app can 405.
    return pathExists ? { handler: null, params: {}, methodMismatch: true } : null;
  }

  /** Route table, used by tests to assert the public API surface. */
  describe() {
    return this.routes.map((route) => `${route.method} ${route.pattern}`);
  }

  /**
   * Every method registered for a path, for an accurate 405 `Allow` header.
   * HEAD is reported alongside GET because HEAD is served by the GET handler.
   */
  allowedMethods(pathname) {
    const methods = new Set();
    for (const route of this.routes) {
      if (route.regex.test(pathname)) methods.add(route.method);
    }
    if (methods.has('GET')) methods.add('HEAD');
    return [...methods].sort();
  }
}

module.exports = { Router };
