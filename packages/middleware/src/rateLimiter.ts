/**
 * @package @satvaaah/middleware
 * rateLimiter.ts — Redis-backed rate limiter factory
 *
 * CRITICAL RULES:
 *   - FAIL-OPEN if Redis is unavailable (never fail-closed — would bring down entire API).
 *   - Uses Redis INCR + EXPIRE pattern (atomic window).
 *   - Returns 429 with retry_after (seconds) from Redis TTL.
 *   - Rate limit windows are sliding-ish (INCR resets on first request of each window).
 *
 * Usage:
 *   // OTP verify: 5 per minute per IP
 *   const otpLimiter = createRateLimiter({
 *     keyFn: (req) => `rl:otp:${req.ip}`,
 *     limit: 5,
 *     windowSec: 60,
 *     errorCode: 'OTP_RATE_LIMIT',
 *     errorMsg: 'Too many OTP attempts. Please wait before trying again.',
 *   });
 *   router.post('/auth/firebase/verify', otpLimiter, handler);
 *
 *   // Search: 60 per minute per user
 *   const searchLimiter = createRateLimiter({
 *     keyFn: (req) => `rl:search:${req.user?.userId ?? req.ip}`,
 *     limit: 60,
 *     windowSec: 60,
 *     errorCode: 'SEARCH_RATE_LIMIT',
 *     errorMsg: 'Search rate limit exceeded.',
 *   });
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { Redis } from 'ioredis';
import { RateLimitError } from '@satvaaah/errors';
import { logger } from '@satvaaah/logger';

// ─────────────────────────────────────────────────────────────────────────────
// REDIS CLIENT SINGLETON (lazy, shared across all rate limiters)
// ─────────────────────────────────────────────────────────────────────────────

let _redisClient: Redis | null = null;
let _redisUnavailable = false;
let _redisRetryAt = 0;
const REDIS_RETRY_INTERVAL_MS = 30_000; // re-attempt connection every 30s

function getRedisClient(): Redis | null {
  // If Redis previously failed, don't hammer it — check retry interval
  if (_redisUnavailable && Date.now() < _redisRetryAt) {
    return null;
  }

  if (_redisClient) return _redisClient;

  const redisUrl = process.env.REDIS_URL ?? 'redis://satvaaah-redis:6379';

  try {
    _redisClient = new Redis(redisUrl, {
      lazyConnect: true,
      retryStrategy: (times) => {
        // Give up reconnecting after 3 attempts in a connection cycle
        // FAIL-OPEN: app continues without rate limiting
        if (times >= 3) return null;
        return Math.min(times * 200, 2000);
      },
      maxRetriesPerRequest: 1, // fail fast per command
      enableOfflineQueue: false,
    });

    _redisClient.on('error', (err) => {
      logger.warn('Rate limiter Redis error — rate limiting disabled (fail-open)', {
        error_message: err.message,
      });
      _redisUnavailable = true;
      _redisRetryAt = Date.now() + REDIS_RETRY_INTERVAL_MS;
      _redisClient = null;
    });

    _redisClient.on('connect', () => {
      logger.info('Rate limiter Redis connected');
      _redisUnavailable = false;
    });

    return _redisClient;
  } catch (err) {
    logger.warn('Rate limiter Redis instantiation failed — fail-open', {
      error_message: (err as Error).message,
    });
    _redisUnavailable = true;
    _redisRetryAt = Date.now() + REDIS_RETRY_INTERVAL_MS;
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimiterOptions {
  /**
   * Function that returns the Redis key for this request.
   * Keep keys short and deterministic.
   * E.g.: (req) => `rl:search:${req.user?.userId ?? req.ip}`
   */
  keyFn: (req: Request) => string;

  /** Maximum requests allowed in the window */
  limit: number;

  /** Window size in seconds */
  windowSec: number;

  /** Error code returned in the 429 response */
  errorCode: string;

  /** User-facing message in the 429 response */
  errorMsg: string;

  /**
   * If true, rate limit is bypassed for admin users (role === 'admin').
   * Defaults to true.
   */
  skipAdmin?: boolean;
}

export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const { keyFn, limit, windowSec, errorCode, errorMsg, skipAdmin = true } = options;

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Skip rate limiting for admin users by default
    if (skipAdmin && req.user?.role === 'admin') {
      return next();
    }

    const redis = getRedisClient();

    // FAIL-OPEN: if Redis unavailable, allow request through
    if (!redis) {
      logger.debug('Rate limiter skipped — Redis unavailable (fail-open)', {
        path: req.path,
        method: req.method,
      });
      return next();
    }

    const key = keyFn(req);

    try {
      // Lua script for atomic INCR + conditional EXPIRE
      // Ensures the TTL is only set on the very first request in a window
      const luaScript = `
        local count = redis.call('INCR', KEYS[1])
        if count == 1 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return count
      `;

      const count = await redis.eval(luaScript, 1, key, windowSec.toString()) as number;

      if (count > limit) {
        // Get remaining TTL so client knows when to retry
        const ttl = await redis.ttl(key);
        const retryAfter = ttl > 0 ? ttl : windowSec;

        logger.warn('Rate limit exceeded', {
          key,
          count,
          limit,
          retry_after: retryAfter,
          user_id: req.user?.userId,
          path: req.path,
        });

        return next(new RateLimitError(errorCode, errorMsg, retryAfter));
      }

      // Set standard rate limit headers for observability
      _res.setHeader('X-RateLimit-Limit', limit);
      _res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count));

      next();
    } catch (err) {
      // FAIL-OPEN: if Redis command fails, allow request through
      logger.warn('Rate limiter Redis command failed — fail-open', {
        key,
        error_message: (err as Error).message,
      });
      next();
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-BUILT LIMITERS (commonly reused across services)
// ─────────────────────────────────────────────────────────────────────────────

/** Firebase OTP verify: 5 per minute per IP */
export const authVerifyLimiter = createRateLimiter({
  keyFn: (req) => `rl:auth:verify:${req.ip ?? 'unknown'}`,
  limit: 5,
  windowSec: 60,
  errorCode: 'AUTH_RATE_LIMIT',
  errorMsg: 'Too many authentication attempts. Please wait 60 seconds before trying again.',
  skipAdmin: false,
});

/** Token refresh: 10 per minute per user/IP */
export const tokenRefreshLimiter = createRateLimiter({
  keyFn: (req) => `rl:auth:refresh:${req.user?.userId ?? req.ip}`,
  limit: 10,
  windowSec: 60,
  errorCode: 'REFRESH_RATE_LIMIT',
  errorMsg: 'Too many token refresh attempts.',
  skipAdmin: false,
});

/** Search: 60 per minute per user */
export const searchLimiter = createRateLimiter({
  keyFn: (req) => `rl:search:${req.user?.userId ?? req.ip}`,
  limit: 60,
  windowSec: 60,
  errorCode: 'SEARCH_RATE_LIMIT',
  errorMsg: 'Search rate limit exceeded. Please slow down.',
});

/** Contact event creation: 20 per minute per consumer */
export const contactEventLimiter = createRateLimiter({
  keyFn: (req) => `rl:contact:${req.user?.userId ?? req.ip}`,
  limit: 20,
  windowSec: 60,
  errorCode: 'CONTACT_RATE_LIMIT',
  errorMsg: 'Too many contact requests. Please wait before sending more.',
});

/** Rating submission: 30 per minute per user */
export const ratingLimiter = createRateLimiter({
  keyFn: (req) => `rl:rating:${req.user?.userId ?? req.ip}`,
  limit: 30,
  windowSec: 60,
  errorCode: 'RATING_RATE_LIMIT',
  errorMsg: 'Too many rating submissions. Please slow down.',
});

/** TSaaS API: per client_id, from system_config (100/hour default) */
export const tsaasLimiter = createRateLimiter({
  keyFn: (req) => `rl:tsaas:${req.headers['x-tsaas-api-key']?.toString().slice(0, 12) ?? 'unknown'}`,
  limit: 100,
  windowSec: 3600,
  errorCode: 'TSAAS_RATE_LIMIT',
  errorMsg: 'TSaaS API monthly limit reached. Contact support to increase your quota.',
  skipAdmin: false,
});


// ─────────────────────────────────────────────────────────────────────────────
// COMPATIBILITY WRAPPER — used by services with simplified API
// Services call: rateLimiter({ windowMs, max, keyPrefix, failOpen? })
// This wraps createRateLimiter with the full options.
// ─────────────────────────────────────────────────────────────────────────────

export interface SimpleRateLimiterOptions {
  windowMs: number;       // window in milliseconds
  max: number;            // max requests per window
  keyPrefix: string;      // prefix for Redis key (appended with req.ip or userId)
  failOpen?: boolean;     // always true in our impl — here for API compatibility
}

export function rateLimiter(options: SimpleRateLimiterOptions): RequestHandler {
  const { windowMs, max, keyPrefix } = options;
  const windowSec = Math.ceil(windowMs / 1000);

  return createRateLimiter({
    keyFn: (req) => `${keyPrefix}:${req.user?.userId ?? req.ip ?? 'unknown'}`,
    limit: max,
    windowSec,
    errorCode: 'RATE_LIMIT_EXCEEDED',
    errorMsg: `Too many requests. Please wait ${windowSec} seconds and try again.`,
    skipAdmin: true,
  });
}
