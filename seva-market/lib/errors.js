/**
 * SEVA MARKET INDIA — typed application errors.
 *
 * Every error thrown below the HTTP layer carries an HTTP status and a stable
 * machine-readable `code`, so the API layer never has to guess what went wrong
 * and clients can branch on `code` instead of parsing human text.
 */

export class AppError extends Error {
  constructor(message, { status = 500, code = 'internal_error', details = null, cause = null } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500; // client errors are safe to show; server errors are not
    if (cause) this.cause = cause;
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON() {
    const body = { error: this.expose ? this.message : 'Internal server error', code: this.code };
    if (this.details) body.details = this.details;
    return body;
  }
}

export class ConfigError extends AppError {
  constructor(details) {
    super('Invalid application configuration', { status: 500, code: 'config_invalid', details });
  }
}

export class ValidationError extends AppError {
  constructor(fields, message = 'Validation failed') {
    super(message, { status: 422, code: 'validation_failed', details: { fields } });
    this.fields = fields;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details = null) {
    super(message, { status: 400, code: 'bad_request', details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in to continue', details = null) {
    super(message, { status: 401, code: 'unauthorized', details });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource', details = null) {
    super(message, { status: 403, code: 'forbidden', details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details = null) {
    super(message, { status: 404, code: 'not_found', details });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details = null) {
    super(message, { status: 409, code: 'conflict', details });
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds = 60) {
    super('Too many requests. Please slow down and try again.', {
      status: 429,
      code: 'rate_limited',
      details: { retry_after: retryAfterSeconds }
    });
  }
}

export class UnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', details = null) {
    super(message, { status: 503, code: 'unavailable', details });
  }
}

/** Normalise anything caught at a boundary into an AppError. */
export function toAppError(value) {
  if (value instanceof AppError) return value;
  const message = value instanceof Error ? value.message : String(value);
  return new AppError(message, { status: 500, code: 'internal_error', cause: value });
}
