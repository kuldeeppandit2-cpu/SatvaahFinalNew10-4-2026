/**
 * @package @satvaaah/middleware
 * errorHandler.ts — global Express error handler
 *
 * RULES:
 *   - Maps ALL errors to: { success: false, error: { code, message } }
 *   - NEVER exposes stack traces in production (NODE_ENV === 'production')
 *   - RateLimitError adds retry_after to the response body
 *   - ValidationError with fields adds field-level detail
 *   - Unknown/non-operational errors become generic 500s (no internal details)
 *   - Always logs the error with correlation_id
 *
 * Must be registered LAST in the Express middleware chain:
 *   app.use(errorHandler);
 */

import { Request, Response, NextFunction } from 'express';
import {
  AppError,
  RateLimitError,
  ValidationError,
  isAppError,
  isOperationalError,
} from '@satvaaah/errors';
import { logger } from '@satvaaah/logger';

const isProduction = process.env.NODE_ENV === 'production';

// ─────────────────────────────────────────────────────────────────────────────
// ERROR HANDLER MIDDLEWARE — must have 4 params for Express to recognise it
// ─────────────────────────────────────────────────────────────────────────────

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction, // eslint-disable-line @typescript-eslint/no-unused-vars
): void {
  // ── Determine HTTP status ──────────────────────────────────────────────────

  let httpStatus = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let retryAfter: number | undefined;
  let fields: Record<string, string> | undefined;

  if (isAppError(err)) {
    httpStatus = err.httpStatus;
    code = err.code;

    // Only expose the message for operational (expected) errors
    // For programmer errors (isOperational=false) in production, use generic message
    if (isOperationalError(err) || !isProduction) {
      message = err.message;
    }

    if (err instanceof RateLimitError) {
      retryAfter = err.retryAfter;
    }

    if (err instanceof ValidationError && err.fields) {
      fields = err.fields;
    }
  } else if (err instanceof Error) {
    // Unknown JS error (not an AppError)
    if (!isProduction) {
      message = err.message;
    }
    logger.error('Unhandled non-AppError', {
      error: err,
      path: req.path,
      method: req.method,
    });
  }

  // ── Log ──────────────────────────────────────────────────────────────────

  const logMeta = {
    http_status: httpStatus,
    error_code: code,
    path: req.path,
    method: req.method,
    user_id: req.user?.userId,
    correlation_id: req.correlationId,
  };

  if (httpStatus >= 500) {
    logger.error(`Error ${code}: ${message}`, { error: err, ...logMeta });
  } else if (httpStatus >= 400) {
    logger.warn(`Client error ${code}: ${message}`, logMeta);
  }

  // ── Build response body ────────────────────────────────────────────────────

  if (retryAfter !== undefined) {
    // 429 — rate limit response (success: false for consistency)
    res.status(429).json({
      success: false,
      error: {
        code,
        message,
        retry_after: retryAfter,
      },
    });
    return;
  }

  const body: {
    success: false;
    error: {
      code: string;
      message: string;
      fields?: Record<string, string>;
      stack?: string;
    };
  } = {
    success: false,
    error: { code, message },
  };

  if (fields) {
    body.error.fields = fields;
  }

  // Include stack trace in non-production for easier debugging
  if (!isProduction && err instanceof Error && err.stack) {
    body.error.stack = err.stack;
  }

  res.status(httpStatus).json(body);
}

// ─────────────────────────────────────────────────────────────────────────────
// 404 FALLTHROUGH HANDLER — register just before errorHandler
// ─────────────────────────────────────────────────────────────────────────────

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError(
      'ROUTE_NOT_FOUND',
      `Route ${req.method} ${req.path} does not exist`,
      404,
    ),
  );
}
