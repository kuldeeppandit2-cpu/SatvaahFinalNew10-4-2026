/**
 * @package @satvaaah/config
 * systemConfig.ts — Admin-configurable system configuration loader
 *
 * RULES:
 *   - ALL thresholds come from system_config table. Nothing hardcoded.
 *   - loadSystemConfig() reads the system_config table via Prisma.
 *   - Returns a typed config object (key → value map).
 *   - Hot-reloads on SIGHUP signal (no restart needed for config changes).
 *   - getConfig(key) throws ConfigurationError if key is missing.
 *   - getConfigInt(key) / getConfigFloat(key) / getConfigBool(key) for typed access.
 *   - Startup: call loadSystemConfig() once in service bootstrap (await it).
 *
 * Usage:
 *   import { loadSystemConfig, getConfig, getConfigInt } from '@satvaaah/config';
 *
 *   // In service startup:
 *   await loadSystemConfig();
 *
 *   // In request handler:
 *   const threshold = getConfigInt('trust_tier_basic_threshold'); // returns 20
 *   const policy = getConfig('wa_channel_policy'); // returns 'cac_and_extraordinary'
 */

import { PrismaClient } from '@prisma/client';
import { ConfigurationError } from '@satvaaah/errors';
import { logger } from '@satvaaah/logger';
import { SystemConfigKey } from '@satvaaah/types';

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY CACHE
// ─────────────────────────────────────────────────────────────────────────────

let _configCache: Map<string, string> | null = null;
let _loadedAt: Date | null = null;
let _isLoading = false;

// Cache TTL — return existing cache if loaded within this window.
// Services call loadSystemConfig() per-request; this prevents DB round-trips.
// Set to 60 seconds — short enough to pick up admin config changes quickly.
const CACHE_TTL_MS = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// LOADER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads all rows from system_config table into in-memory cache.
 * Safe to call multiple times — subsequent calls reload the cache.
 * Called automatically on startup and on SIGHUP.
 */
export async function loadSystemConfig(prisma?: PrismaClient): Promise<Record<string, string>> {
  // Fast-return if cache is fresh — prevents DB round-trip on every request
  if (_configCache && _loadedAt && (Date.now() - _loadedAt.getTime()) < CACHE_TTL_MS) {
    return Object.fromEntries(_configCache);
  }

  if (_isLoading) {
    // Another request is loading — return stale cache or empty object
    // Caller falls back to inline defaults per Rule #20
    logger.warn('loadSystemConfig called while already loading — returning stale cache');
    return Object.fromEntries(_configCache ?? new Map());
  }

  _isLoading = true;
  const client = prisma ?? _getDefaultPrismaClient();

  try {
    logger.info('Loading system_config from database...');

    const rows = await client.systemConfig.findMany({
      select: { key: true, value: true },
    });

    const newCache = new Map<string, string>();
    for (const row of rows) {
      newCache.set(row.key, row.value);
    }

    _configCache = newCache;
    _loadedAt = new Date();

    logger.info('system_config loaded', {
      key_count: rows.length,
      loaded_at: _loadedAt.toISOString(),
    });
  } catch (err) {
    logger.error('Failed to load system_config', { error: err });

    // If no cache exists yet (startup failure), this is fatal
    if (!_configCache) {
      throw new Error(
        'Failed to load system_config on startup. Database may be unavailable.',
      );
    }
    // Otherwise keep stale cache — better than crashing
    logger.warn('Keeping stale system_config cache due to reload failure');
  } finally {
    _isLoading = false;
  }

  // Return config as plain object for callers that use: const config = await loadSystemConfig()
  // Pattern used by rating, trust, user, search services.
  return Object.fromEntries(_configCache ?? new Map());
}

// ─────────────────────────────────────────────────────────────────────────────
// HOT-RELOAD ON SIGHUP
// ─────────────────────────────────────────────────────────────────────────────

let _sighupRegistered = false;

/**
 * Registers SIGHUP handler for hot-reloading config.
 * Call once during service startup after loadSystemConfig().
 *
 * On SIGHUP (e.g. `kill -HUP <pid>` or ECS task restart):
 *   - Re-reads system_config table
 *   - Updates in-memory cache without service restart
 *
 * Usage: registerSighupReload(prisma);
 */
export function registerSighupReload(prisma?: PrismaClient): void {
  if (_sighupRegistered) return;
  _sighupRegistered = true;

  process.on('SIGHUP', () => {
    logger.info('SIGHUP received — hot-reloading system_config');
    loadSystemConfig(prisma).catch((err) => {
      logger.error('SIGHUP config reload failed', { error: err });
    });
  });

  logger.info('SIGHUP hot-reload registered for system_config');
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCESSORS
// ─────────────────────────────────────────────────────────────────────────────

function requireCache(): Map<string, string> {
  if (!_configCache) {
    throw new Error(
      'system_config not loaded. Call loadSystemConfig() during service startup.',
    );
  }
  return _configCache;
}

/**
 * Returns the string value of a system_config key.
 * Throws ConfigurationError if the key is not present in the table.
 */
export function getConfig(key: SystemConfigKey): string {
  const cache = requireCache();
  const value = cache.get(key as string);
  if (value === undefined) {
    throw new ConfigurationError(key as string);
  }
  return value;
}

/**
 * Returns the string value or undefined if key is missing.
 * Use when a key is optional (has a code-level default).
 */
export function getConfigOptional(key: SystemConfigKey): string | undefined {
  if (!_configCache) return undefined;
  return _configCache.get(key as string);
}

/**
 * Returns the value parsed as an integer.
 * Throws ConfigurationError if key is missing or value is not a valid integer.
 */
export function getConfigInt(key: SystemConfigKey): number {
  const raw = getConfig(key);
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new ConfigurationError(`${key as string} (expected integer, got: '${raw}')`);
  }
  return n;
}

/**
 * Returns the value parsed as a float.
 */
export function getConfigFloat(key: SystemConfigKey): number {
  const raw = getConfig(key);
  const n = parseFloat(raw);
  if (Number.isNaN(n)) {
    throw new ConfigurationError(`${key as string} (expected number, got: '${raw}')`);
  }
  return n;
}

/**
 * Returns the value parsed as a boolean.
 * Recognises: 'true'/'false', '1'/'0', 'yes'/'no'.
 */
export function getConfigBool(key: SystemConfigKey): boolean {
  const raw = getConfig(key).toLowerCase().trim();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  throw new ConfigurationError(
    `${key as string} (expected boolean, got: '${raw}')`,
  );
}

/**
 * Returns the value parsed as JSON.
 * Useful for complex config like customer_weight_curve.
 */
export function getConfigJson<T = unknown>(key: SystemConfigKey): T {
  const raw = getConfig(key);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ConfigurationError(
      `${key as string} (expected JSON, got: '${raw.slice(0, 50)}...')`,
    );
  }
}

/**
 * Returns metadata about the current config load.
 */
export function getConfigMeta(): { loadedAt: Date | null; keyCount: number } {
  return {
    loadedAt: _loadedAt,
    keyCount: _configCache?.size ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRISMA CLIENT HELPER
// ─────────────────────────────────────────────────────────────────────────────

let _defaultPrisma: PrismaClient | null = null;

function _getDefaultPrismaClient(): PrismaClient {
  if (_defaultPrisma) return _defaultPrisma;
  // Import lazily to avoid circular dependency with packages/db
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { prisma } = require('@satvaaah/db');
  _defaultPrisma = prisma;
  return _defaultPrisma!;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE TYPED CONFIG GETTERS (commonly used thresholds)
// ─────────────────────────────────────────────────────────────────────────────

/** Returns trust_tier_basic_threshold (default: 20). */
export function getTrustTierBasicThreshold(): number {
  return getConfigInt('trust_tier_basic_threshold');
}

/** Returns trust_tier_trusted_threshold (default: 60). */
export function getTrustTierTrustedThreshold(): number {
  return getConfigInt('trust_tier_trusted_threshold');
}

/** Returns trust_tier_highly_trusted_threshold (default: 80). */
export function getTrustTierHighlyTrustedThreshold(): number {
  return getConfigInt('trust_tier_highly_trusted_threshold');
}

/** Returns push_discovery_trust_threshold (default: 80). */
export function getPushDiscoveryThreshold(): number {
  return getConfigInt('push_discovery_trust_threshold');
}

/**
 * Returns daily rating limit for the given tab.
 * Products: 10 | Services: 5 | Expertise: 3 | Establishments: 8
 */
export function getDailyRatingLimit(tab: string): number {
  const keyMap: Record<string, SystemConfigKey> = {
    products: 'rating_daily_limit_products',       // V031 seed key name
    services: 'rating_daily_limit_services',       // V031 seed key name
    expertise: 'rating_daily_limit_expertise',     // V031 seed key name
    establishments: 'rating_daily_limit_establishments', // V031 seed key name
  };
  const key = keyMap[tab.toLowerCase()];
  if (!key) {
    throw new ConfigurationError(`No daily_rating_limit config for tab: ${tab}`);
  }
  return getConfigInt(key);
}

/**
 * Returns customer_weight_curve as a sorted array of [ratingCount, weight] pairs.
 * Seeded value: "0:0.10,3:0.20,10:0.30,50:0.65,200:0.70"
 */
export function getCustomerWeightCurve(): Array<[number, number]> {
  const raw = getConfig('customer_weight_curve');
  return raw.split(',').map((segment) => {
    const [count, weight] = segment.split(':').map(Number);
    return [count, weight] as [number, number];
  }).sort((a, b) => a[0] - b[0]);
}
