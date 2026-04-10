/**
 * @package @satvaaah/middleware
 * requireAuth.ts — RS256 JWT verification middleware
 *
 * CRITICAL RULES:
 *   - RS256 asymmetric ONLY. Never HS256.
 *   - JTI blocklist checked in Redis on every request (P11 fix).
 *     Fail-open: if Redis unavailable, request proceeds (Rule #16).
 *   - Attaches req.user: { userId, mode, subscriptionTier, phoneVerified }
 *   - Never logs raw tokens — only first 8 chars for debugging.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import {
  TokenMissingError,
  TokenInvalidError,
  TokenExpiredError,
  TokenRevokedError,
} from '@satvaaah/errors';
import { JwtPayload, UserMode, SubscriptionTier } from '@satvaaah/types';
import { logger } from '@satvaaah/logger';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export interface AuthenticatedUser {
  userId:           string;
  mode:             UserMode;
  subscriptionTier: SubscriptionTier;
  phoneVerified:    boolean;
  role?:            'admin';
}

// ─── Public key cache ────────────────────────────────────────────────────────
let _cachedPublicKey: string | null = null;

function getPublicKey(): string {
  if (_cachedPublicKey) return _cachedPublicKey;
  const key = process.env.JWT_PUBLIC_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error('JWT_PUBLIC_KEY environment variable is missing.');
  }
  _cachedPublicKey = key.replace(/\\n/g, '\n');
  return _cachedPublicKey;
}

// ─── Redis singleton for JTI blocklist (fail-open on unavailability) ─────────
let _redis: Redis | null = null;
let _redisConnected = false;

function getRedis(): Redis | null {
  if (_redis && _redisConnected) return _redis;
  const url = process.env.REDIS_URL ?? 'redis://satvaaah-redis:6379';
  try {
    _redis = new Redis(url, {
      lazyConnect:        false,
      enableOfflineQueue: false,
      connectTimeout:     2_000,
      commandTimeout:     1_000,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 2) { _redisConnected = false; return null; }
        return times * 200;
      },
    });
    _redis.on('connect', () => { _redisConnected = true; });
    _redis.on('ready',   () => { _redisConnected = true; });
    _redis.on('error',   () => { _redisConnected = false; });
    _redis.on('close',   () => { _redisConnected = false; });
  } catch {
    _redis = null;
    _redisConnected = false;
  }
  return _redis && _redisConnected ? _redis : null;
}

// ─── JTI blocklist check (P11 fix) ───────────────────────────────────────────
// Returns true if token is revoked (blocklisted). Fail-open: returns false
// if Redis is unavailable so legitimate users are never locked out.
async function isJtiBlocklisted(jti: string): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) return false;                       // fail-open per Rule #16
    const result = await redis.get(`jti_blocklist:${jti}`);
    return result !== null;                         // key present → revoked
  } catch {
    return false;                                   // fail-open
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new TokenMissingError());
  }

  const rawToken = authHeader.slice(7);

  let publicKey: string;
  try {
    publicKey = getPublicKey();
  } catch (err) {
    logger.error(`JWT public key not configured: ${(err as Error).message}`);
    return next(err);
  }

  let payload: any;
  try {
    payload = jwt.verify(rawToken, publicKey, {
      algorithms: ['RS256'],   // NEVER HS256
    });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return next(new TokenExpiredError());
    if (err instanceof jwt.JsonWebTokenError) {
      logger.warn(`JWT verification failed: ${err.message} prefix=${rawToken.slice(0, 8)}`);
      return next(new TokenInvalidError());
    }
    return next(err);
  }

  // ── P11 fix: Check JTI blocklist (logout revocation) ─────────────────────
  if (payload.jti) {
    const revoked = await isJtiBlocklisted(payload.jti);
    if (revoked) {
      logger.warn(`Revoked JTI attempted: jti=${payload.jti} sub=${payload.sub}`);
      return next(new TokenRevokedError());
    }
  }

  req.user = {
    userId:           payload.sub,
    mode:             payload.mode,
    subscriptionTier: payload.subscription_tier,
    phoneVerified:    payload.phone_verified,
    role:             payload.role,
  };

  logger.debug(`JWT verified: userId=${payload.sub} mode=${payload.mode}`);
  next();
}
