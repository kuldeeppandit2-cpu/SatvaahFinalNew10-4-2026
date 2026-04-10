// services/search/src/lib/redisClient.ts
//
// Redis singleton for the search service.
// Primary use: 24-hour category grid cache (GET /api/v1/categories).
// Fails open — if Redis is unreachable, callers fall through to the DB.

import { createClient, RedisClientType } from 'redis';
import { logger } from '@satvaaah/logger';

// Promise-based singleton — prevents race condition where concurrent requests
// each create their own connection before _connected is set to true
let _clientPromise: Promise<RedisClientType | null> | null = null;

export function getRedisClient(): Promise<RedisClientType | null> {
  if (_clientPromise) return _clientPromise;

  const redisUrl = process.env.REDIS_URL ?? 'redis://satvaaah-redis:6379';

  _clientPromise = (async () => {
    try {
      const client = createClient({ url: redisUrl }) as RedisClientType;

      client.on('error', (err) => {
        logger.error('redis.error', { error: (err as Error).message });
      });

      client.on('reconnecting', () => logger.warn('redis.reconnecting'));
      client.on('ready',        () => logger.info('redis.ready'));

      await client.connect();
      logger.info(`redis.connected: ${redisUrl}`);
      return client;
    } catch (err) {
      logger.error(`redis.connect.failed — cache disabled: ${(err as Error).message}`);
      _clientPromise = null; // Allow retry on next request
      return null;
    }
  })();

  return _clientPromise;
}

/**
 * Convenience: get a JSON value from Redis.
 * Returns null if Redis is unreachable or key is missing.
 */
export async function redisGet<T>(key: string): Promise<T | null> {
  try {
    const client = await getRedisClient();
    if (!client) return null;
    const raw = await client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Convenience: set a JSON value in Redis with optional TTL in seconds.
 * Fire-and-forget — never throws to the caller.
 */
export async function redisSet(
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;
    const raw = JSON.stringify(value);
    if (ttlSeconds) {
      await client.setEx(key, ttlSeconds, raw);
    } else {
      await client.set(key, raw);
    }
  } catch {
    // Non-fatal — caller proceeds without cache write
  }
}
