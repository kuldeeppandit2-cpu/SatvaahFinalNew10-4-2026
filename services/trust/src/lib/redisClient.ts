/**
 * lib/redisClient.ts
 * Redis singleton for trust service.
 * Used for: TSaaS API key auth cache (5-min TTL), rate limiting.
 *
 * Fail-open principle (MASTER_CONTEXT rule #16):
 * If Redis is unavailable, functions return null/false gracefully.
 * The service continues working; TSaaS auth falls back to DB lookup.
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from '@satvaaah/logger';

let _clientPromise: Promise<RedisClientType | null> | null = null;

async function getClient(): Promise<RedisClientType | null> {
  if (_clientPromise) return _clientPromise; // singleton — avoids race condition

  const redisUrl = process.env.REDIS_URL ?? 'redis://satvaaah-redis:6379';

  client = createClient({ url: redisUrl }) as RedisClientType;

  client.on('connect', () => {
    isConnected = true;
    logger.info('Redis connected');
  });

  client.on('error', (err) => {
    isConnected = false;
    // Log but do NOT crash — fail-open
    logger.warn('Redis error — trust service continuing without cache');
  });

  client.on('reconnecting', () => {
    logger.info('Redis reconnecting');
  });

  try {
    await client.connect();
  } catch (err) {
    logger.warn('Redis initial connection failed — failing open');
    isConnected = false;
    return null;
  }

  return client;
}

/**
 * GET a value from Redis.
 * Returns null on miss or Redis unavailability (fail-open).
 */
export async function redisGet(key: string): Promise<string | null> {
  try {
    const c = await getClient();
    if (!c || !isConnected) return null;
    return await c.get(key);
  } catch (err) {
    logger.warn('redis.get failed — failing open');
    return null;
  }
}

/**
 * SET a value in Redis with optional TTL in seconds.
 * Silently ignores errors (fail-open).
 */
export async function redisSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  try {
    const c = await getClient();
    if (!c || !isConnected) return;
    if (ttlSeconds !== undefined) {
      await c.set(key, value, { EX: ttlSeconds });
    } else {
      await c.set(key, value);
    }
  } catch (err) {
    logger.warn('redis.set failed — failing open');
  }
}

/**
 * DEL a key from Redis.
 * Used when invalidating TSaaS auth cache (e.g., key disabled by admin).
 */
export async function redisDel(key: string): Promise<void> {
  try {
    const c = await getClient();
    if (!c || !isConnected) return;
    await c.del(key);
  } catch (err) {
    logger.warn('redis.del failed — failing open');
  }
}

// ─── Initialise on module load ────────────────────────────────────────────────
getClient().catch((err) => {
  logger.warn('Redis startup failed — trust service running without cache');
});
