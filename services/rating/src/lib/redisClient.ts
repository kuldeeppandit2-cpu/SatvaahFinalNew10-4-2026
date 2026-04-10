/**
 * SatvAAh — services/rating/src/lib/redisClient.ts
 *
 * Redis singleton for the rating service.
 * Used for: burst detection (INCR + TTL window).
 *
 * CRITICAL_RULE #16: Fail-OPEN during Redis unavailability.
 * If Redis is down, burst detection is skipped (flag is not set),
 * and the service continues normally. The API is never fail-closed
 * due to Redis unavailability.
 */

import Redis from 'ioredis';
import { logger } from '@satvaaah/logger';

let client: Redis | null = null;
let connectAttempted = false;

/**
 * Returns the Redis client, or null if unavailable.
 * Callers MUST handle null — never assume Redis is up.
 */
export function getRedisClient(): Redis | null {
  if (connectAttempted) return client;

  connectAttempted = true;

  const host = process.env.REDIS_HOST ?? 'satvaaah-redis'; // CRITICAL_RULE #10
  const port = parseInt(process.env.REDIS_PORT ?? '6379', 10);

  try {
    client = new Redis({
      host,
      port,
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    client.on('error', (err) => {
      logger.warn('Redis error in rating service — fail-open');
      client = null;
      connectAttempted = false; // allow reconnect attempt next time
    });

    client.on('connect', () => {
      logger.info('Redis connected — rating service');
    });

    client.connect().catch((err) => {
      logger.warn('Redis connect failed — fail-open');
      client = null;
      connectAttempted = false;
    });
  } catch (err: any) {
    logger.warn('Redis init failed — fail-open');
    client = null;
    connectAttempted = false;
  }

  return client;
}

/**
 * Increment a burst counter key.
 * Sets TTL on first increment only.
 * Returns the new count, or null on Redis failure (fail-open).
 */
export async function incrBurstCounter(
  key: string,
  windowSeconds: number
): Promise<number | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      // First hit — set the sliding window TTL
      await redis.expire(key, windowSeconds);
    }
    return count;
  } catch (err: any) {
    logger.warn('Redis burst incr failed — fail-open');
    return null; // fail-open: treat as no burst
  }
}
