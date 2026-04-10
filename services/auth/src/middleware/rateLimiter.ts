/**
 * OTP Rate Limiter for POST /auth/firebase/verify
 *
 * Limit: 5 attempts per phone number per 10 minutes.
 * Key strategy: decode Firebase JWT (WITHOUT verifying signature — safe because
 * we only use the phone for rate-limiting, full verification happens in authService)
 * Falls back to IP-based limiting if phone cannot be extracted.
 *
 * CRITICAL RULE #16: FAIL-OPEN on Redis unavailability.
 * If Redis is down, the rate limiter allows the request through.
 */

import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { safeRedisIncr } from '../redis';
import { logger } from '@satvaaah/logger';

const OTP_WINDOW_SECONDS = 10 * 60; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

/**
 * Extract phone number from Firebase ID token WITHOUT verifying the signature.
 * Used only for rate limiting — never for authentication decisions.
 * Actual security verification happens in Firebase Admin SDK in authService.ts.
 */
function extractPhoneFromToken(token: string): string | null {
  try {
    const decoded = jwt.decode(token) as Record<string, unknown> | null;
    if (decoded && typeof decoded.phone_number === 'string') {
      return decoded.phone_number;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Normalise a phone number to E.164 for consistent keying.
 * e.g. "+919876543210" → "919876543210" (strip leading +)
 */
function normalisePhone(phone: string): string {
  return phone.replace(/^\+/, '').replace(/\D/g, '');
}

/**
 * OTP rate limiter middleware.
 * Attaches `req.rateLimitKey` so authService can cross-reference on success.
 */
export async function otpRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { firebaseIdToken } = req.body ?? {};
  const correlationId = req.headers['x-correlation-id'] as string | undefined;

  let rateLimitKey: string;

  if (typeof firebaseIdToken === 'string' && firebaseIdToken.length > 0) {
    const phone = extractPhoneFromToken(firebaseIdToken);
    if (phone) {
      rateLimitKey = `otp_rl:${normalisePhone(phone)}`;
    } else {
      // Fallback to IP — token present but phone unreadable
      const ip = req.ip || req.socket?.remoteAddress || 'unknown';
      rateLimitKey = `otp_rl_ip:${ip}`;
    }
  } else {
    // No token at all — rate limit by IP to prevent probe enumeration
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    rateLimitKey = `otp_rl_ip:${ip}`;
  }

  // CRITICAL RULE #16: safeRedisIncr returns null if Redis is down → fail-open
  const currentCount = await safeRedisIncr(rateLimitKey, OTP_WINDOW_SECONDS);

  if (currentCount === null) {
    // Redis unavailable — fail-open, allow request
    logger.warn('OTP rate limiter: Redis unavailable — fail-open', { correlationId });
    next();
    return;
  }

  if (currentCount > OTP_MAX_ATTEMPTS) {
    logger.warn('OTP rate limit exceeded', {
      key: rateLimitKey.startsWith('otp_rl:') ? '[phone-redacted]' : rateLimitKey,
      count: currentCount,
      correlationId,
    });

    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many authentication attempts. Try again in ${OTP_WINDOW_SECONDS / 60} minutes.`,
      },
    });
    return;
  }

  // Attach remaining attempts header (helpful for clients)
  res.setHeader('X-RateLimit-Limit', OTP_MAX_ATTEMPTS);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, OTP_MAX_ATTEMPTS - currentCount));

  next();
}
