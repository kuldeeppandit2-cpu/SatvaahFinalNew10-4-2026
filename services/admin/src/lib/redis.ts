/**
 * services/admin/src/lib/redis.ts
 * Redis client for admin service — used to invalidate taxonomy cache.
 * Uses ioredis (same as all other services in the monorepo).
 * Critical Rule #16: Fails open — errors are non-fatal.
 */
import Redis from 'ioredis';
import { logger } from '@satvaaah/logger';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redisClient = new Redis(redisUrl, {
  lazyConnect: true,
  enableOfflineQueue: false,  // fail fast — cache bust is best-effort
  maxRetriesPerRequest: 1,
});

redisClient.on('error', (err: Error) => {
  // Non-fatal — taxonomy cache bust is best-effort. Search still works without it.
  logger.warn(`Admin redis error: ${err.message}`);
});
