import { Router, Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { asyncHandler } from '@satvaaah/middleware';
import { logger } from '@satvaaah/logger';
import { prisma } from '@satvaaah/db';
import { redisGet, redisSet } from '../lib/redisClient';
import { TsaasController } from '../controllers/trust.controller';

const router = Router();
const ctrl = new TsaasController();

// ─── TSaaS API Key Cache TTL ──────────────────────────────────────────────────
// Valid keys cached in Redis for 5 minutes to avoid bcrypt on every request
const TSAAS_KEY_CACHE_TTL = 300; // seconds

interface TsaasClientCache {
  clientId: string;
  monthlyLimit: number;
  callsUsed: number;
  isActive: boolean;
  requiresProviderConsent: boolean;
}

// ─── TSaaS Authentication Middleware ─────────────────────────────────────────
/**
 * Validates X-TSaaS-API-Key header against tsaas_api_keys table.
 * Strategy:
 *   1. Check Redis cache: `tsaas:auth:{sha256(rawKey)}` → client data
 *   2. On miss: load all active rows, bcrypt.compare each, cache on match
 *   3. Enforce monthly limit (calls_used < monthly_limit)
 *
 * Attaches req.tsaasClient to the request on success.
 */
async function requireTsaasApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rawKey = req.headers['x-tsaas-api-key'] as string | undefined;

  if (!rawKey) {
    res.status(401).json({
      success: false,
      error: { code: 'TSAAS_AUTH_REQUIRED', message: 'X-TSaaS-API-Key header is required' },
    });
    return;
  }

  try {
    // ── 1. Redis cache lookup ──────────────────────────────────────────────
    const sha256Key = createHash('sha256').update(rawKey).digest('hex');
    const cacheKey = `tsaas:auth:${sha256Key}`;

    const cached = await redisGet(cacheKey);
    if (cached) {
      const client: TsaasClientCache = JSON.parse(cached);
      if (!client.is_active) {
        res.status(403).json({
          success: false,
          error: { code: 'TSAAS_KEY_DISABLED', message: 'API key is disabled' },
        });
        return;
      }
      // Re-read live callsUsed from DB — cached value is stale (race condition)
      // callsUsed increments on every request; 5-min cache would allow burst over quota
      const live = await prisma.tsaasApiKey.findUnique({
        where: { client_id: client.client_id },
        select: { calls_used: true, monthly_limit: true },
      });
      const liveUsed = live?.calls_used ?? client.calls_used;
      if (liveUsed >= client.monthly_limit) {
        res.status(429).json({
          success: false,
          error: { code: 'TSAAS_QUOTA_EXCEEDED', message: 'Monthly API quota exceeded' },
        });
        return;
      }
      (req as any).tsaasClient = { ...client, calls_used: liveUsed };
      next();
      return;
    }

    // ── 2. DB lookup — bcrypt compare against all active keys ──────────────
    // TSaaS clients are O(10s) so this is acceptable on cache miss
    const activeKeys = await prisma.tsaasApiKey.findMany({
      where: { is_active: true },
      select: { client_id: true, hashed_key: true, monthly_limit: true, calls_used: true, is_active: true, requires_provider_consent: true },
    });

    let matchedClient: TsaasClientCache | null = null;
    for (const row of activeKeys) {
      const match = await bcrypt.compare(rawKey, row.hashed_key);
      if (match) {
        matchedClient = {
          client_id: row.client_id,
          monthly_limit: row.monthly_limit,
          calls_used: row.calls_used,
          is_active: row.is_active,
          requires_provider_consent: row.requires_provider_consent,
        };
        break;
      }
    }

    if (!matchedClient) {
      logger.warn(`TSaaS: invalid API key presented correlationId=${(req as any).correlationId}`);
      res.status(401).json({
        success: false,
        error: { code: 'TSAAS_INVALID_KEY', message: 'Invalid API key' },
      });
      return;
    }

    // ── 3. Cache valid key for 5 minutes ──────────────────────────────────
    await redisSet(cacheKey, JSON.stringify(matchedClient), TSAAS_KEY_CACHE_TTL);

    if (matchedClient.calls_used >= matchedClient.monthly_limit) {
      res.status(429).json({
        success: false,
        error: { code: 'TSAAS_QUOTA_EXCEEDED', message: 'Monthly API quota exceeded' },
      });
      return;
    }

    (req as any).tsaasClient = matchedClient;
    next();
  } catch (err) {
    logger.error(`TSaaS auth error correlationId=${(req as any).correlationId}: ${(err as Error).message}`);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Authentication failed' },
    });
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/v2/tsaas/trust/lookup?phone=
 * Look up trust score by provider phone number.
 * IMPORTANT: Defined BEFORE /:providerId so "lookup" does not match as a UUID.
 * Checks consent_records for data_sharing_tsaas before returning data.
 */
router.get(
  '/trust/lookup',
  requireTsaasApiKey,
  asyncHandler(ctrl.lookupByPhone.bind(ctrl)),
);

/**
 * GET /api/v2/tsaas/trust/:providerId
 * Fetch provider trust score by UUID.
 * Checks consent_records for data_sharing_tsaas before returning data.
 */
router.get(
  '/trust/:providerId',
  requireTsaasApiKey,
  asyncHandler(ctrl.getTrustByProviderId.bind(ctrl)),
);

export default router;
