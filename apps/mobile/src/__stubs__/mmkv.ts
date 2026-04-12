/**
 * apps/mobile/src/__stubs__/mmkv.ts
 *
 * Persistent MMKV stub for Expo Go.
 *
 * WHY THIS EXISTS:
 *   react-native-mmkv requires native modules (JSI). Expo Go does not run
 *   native modules unless a custom dev client is built. Metro resolves
 *   'react-native-mmkv' to this file via metro.config.js STUBS map.
 *
 * STORAGE STRATEGY:
 *   - In-memory cache (sync) — satisfies synchronous MMKV API
 *   - Write-through to AsyncStorage (async) — persists across restarts
 *   - On cold start, in-memory cache is empty (correct defaults apply)
 *   - hydrateFromStorage() in auth.store reads from AsyncStorage async
 *
 * PRODUCTION:
 *   When building with EAS / expo run:ios, react-native-mmkv resolves to
 *   the real native package (Metro stub is only active in Expo Go).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Per-instance in-memory cache
// Key format: `mmkv:${id}:${key}`
const memCache: Record<string, string> = {};

function storageKey(id: string, key: string): string {
  return `mmkv:${id}:${key}`;
}

export class MMKV {
  private id: string;

  constructor(options?: { id?: string; encryptionKey?: string }) {
    this.id = options?.id ?? 'default';
    // Note: encryptionKey is accepted but not used — AsyncStorage
    // does not support encryption. Use expo-secure-store for secrets.
    // auth.store tokens are sensitive; they rely on device lock screen
    // for protection in Expo Go. Production uses real MMKV with SecureStore key.
  }

  // ── Synchronous API (matches real react-native-mmkv) ───────────────────────

  set(key: string, value: string | number | boolean): void {
    const sk = storageKey(this.id, key);
    const str = String(value);
    memCache[sk] = str;
    // Write-through: AsyncStorage is fire-and-forget, never throws to caller
    AsyncStorage.setItem(sk, str).catch(() => {});
  }

  getString(key: string): string | undefined {
    return memCache[storageKey(this.id, key)];
  }

  getNumber(key: string): number {
    return Number(memCache[storageKey(this.id, key)] ?? 0);
  }

  getBoolean(key: string): boolean {
    return memCache[storageKey(this.id, key)] === 'true';
  }

  delete(key: string): void {
    const sk = storageKey(this.id, key);
    delete memCache[sk];
    AsyncStorage.removeItem(sk).catch(() => {});
  }

  contains(key: string): boolean {
    return storageKey(this.id, key) in memCache;
  }

  clearAll(): void {
    const prefix = `mmkv:${this.id}:`;
    Object.keys(memCache).forEach((k) => {
      if (k.startsWith(prefix)) {
        delete memCache[k];
        AsyncStorage.removeItem(k).catch(() => {});
      }
    });
  }

  // ── Async preload (Expo Go only) ──────────────────────────────────────────
  // Called once during app hydration to warm the in-memory cache from
  // AsyncStorage. After this, all getString/getBoolean calls return
  // the persisted values from the previous session.
  async preload(): Promise<void> {
    try {
      const prefix = `mmkv:${this.id}:`;
      const allKeys = await AsyncStorage.getAllKeys();
      const ownKeys = allKeys.filter((k) => k.startsWith(prefix));
      if (ownKeys.length === 0) return;
      const pairs = await AsyncStorage.multiGet(ownKeys);
      pairs.forEach(([k, v]) => {
        if (v !== null) memCache[k] = v;
      });
    } catch {
      // Non-fatal — in-memory cache stays empty, defaults apply
    }
  }
}

// ── Module-level singleton instances (pre-warmed by preloadAllMmkvStores) ───

let _authStorage: MMKV | null = null;
let _consumerStorage: MMKV | null = null;

export function getAuthStorage(): MMKV {
  if (!_authStorage) _authStorage = new MMKV({ id: 'satvaaah-auth' });
  return _authStorage;
}

export function getConsumerStorage(): MMKV {
  if (!_consumerStorage) _consumerStorage = new MMKV({ id: 'satvaaah-consumer' });
  return _consumerStorage;
}

/**
 * preloadAllMmkvStores()
 * Call ONCE in App.tsx before any store reads.
 * Warms the in-memory cache from AsyncStorage so cold-start reads
 * return the persisted session values rather than undefined.
 */
export async function preloadAllMmkvStores(): Promise<void> {
  await Promise.all([
    getAuthStorage().preload(),
    getConsumerStorage().preload(),
    // Location store has its own MMKV instance — preload it too
    new MMKV({ id: 'satvaaah-location' }).preload(),
  ]);
}
