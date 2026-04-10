/**
 * Redis singleton for auth service.
 * CRITICAL RULE #16: Fail-OPEN on Redis unavailability — never fail-closed.
 * If Redis is down, rate limiting and blocklist checks are skipped gracefully.
 */

import Redis from 'ioredis';
import { logger } from '@satvaaah/logger';

let redisClient: Redis | null = null;
let redisAvailable = true;
export function getRedis(): Redis | null {
  return redisAvailable ? redisClient : null;
}

export function initRedis(): void {
  // Support REDIS_URL (docker-compose) or individual host/port env vars
  const redisUrl = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST || 'satvaaah-redis'; // Critical Rule #10
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD;

  const connectionConfig = redisUrl
    ? { host: new URL(redisUrl).hostname, port: parseInt(new URL(redisUrl).port || '6379', 10),
        password: new URL(redisUrl).password || undefined }
    : { host, port, password: password || undefined };

  redisClient = new Redis({
    ...connectionConfig,
    // Do NOT set retryStrategy to infinite — fail-open instead
    retryStrategy: (times: number) => {
      if (times > 3) {
        redisAvailable = false;
        logger.warn('Redis unavailable after retries — switching to fail-open mode');
        return null; // stop retrying
      }
      return Math.min(times * 200, 1000);
    },
    lazyConnect: false,
    enableOfflineQueue: false, // Don't queue commands when disconnected
    connectTimeout: 3000,
    commandTimeout: 2000,
  });

  redisClient.on('connect', () => {
    redisAvailable = true;
    logger.info('Redis connected');
  });

  redisClient.on('ready', () => {
    redisAvailable = true;
  });

  redisClient.on('error', (err: Error) => {
    // Log but DO NOT throw — fail-open (Critical Rule #16)
    logger.warn('Redis error — fail-open');
  });

  redisClient.on('close', () => {
    redisAvailable = false;
    logger.warn('Redis connection closed — fail-open mode active');
  });

  redisClient.on('reconnecting', () => {
    logger.info('Redis reconnecting...');
  });
}

/**
 * Safe Redis GET — returns null on any error (fail-open).
 */
export async function safeRedisGet(key: string): Promise<string | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    return await client.get(key);
  } catch {
    return null; // fail-open
  }
}

/**
 * Safe Redis SETEX — silently fails on error (fail-open).
 */
export async function safeRedisSetex(key: string, ttl: number, value: string): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    await client.setex(key, ttl, value);
  } catch {
    // fail-open — blocklist entry lost, acceptable risk vs bringing API down
  }
}

/**
 * Safe Redis INCR + EXPIRE — returns null on error (fail-open for rate limiting).
 */
export async function safeRedisIncr(key: string, ttlSeconds: number): Promise<number | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, ttlSeconds);
    }
    return count;
  } catch {
    return null; // fail-open
  }
}
