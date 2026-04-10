/**
 * apps/mobile/src/config/env.ts
 * Environment config — reads from Expo EXPO_PUBLIC_* vars at build time.
 */
export const ENV = {
  API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://192.168.1.3:3000',
  WS_BASE_URL:  process.env.EXPO_PUBLIC_WS_BASE_URL  ?? 'http://192.168.1.3:3000',
  BRANCH_KEY:   process.env.EXPO_PUBLIC_BRANCH_KEY   ?? '',
} as const;
