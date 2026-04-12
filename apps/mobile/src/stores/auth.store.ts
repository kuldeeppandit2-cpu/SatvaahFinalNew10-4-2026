/**
 * SatvAAh Auth Store — Zustand
 * MMKV encrypted storage (NOT AsyncStorage)
 * Folder: stores/ (NOT store/) — Rule verified
 * Rule #15: RS256 tokens — never HS256
 * Rule #21: consent_given always true
 */

import { create } from 'zustand';
import axios from 'axios';
import { MMKV } from '../__stubs__/mmkv';

// Encrypted MMKV storage (device-level encryption in native build).
// In Expo Go: AsyncStorage-backed stub (see __stubs__/mmkv.ts).
// Production fix: encryptionKey must come from expo-secure-store (see TODO in stub).
const storage = new MMKV({
  id: 'satvaaah-auth',
  encryptionKey: 'satvaaah-mmkv-key-v1', // TODO(PROD): replace with expo-secure-store key
});

const KEYS = {
  ACCESS_TOKEN: 'auth.accessToken',
  REFRESH_TOKEN: 'auth.refreshToken',
  USER_ID: 'auth.userId',
  PHONE: 'auth.phone',
  MODE: 'auth.mode',
  SUBSCRIPTION_TIER: 'auth.subscriptionTier',
  FCM_TOKEN: 'auth.fcmToken',
  ONBOARDING_SEEN: 'auth.onboardingSeen', // NOT cleared on logout — by design
  DISPLAY_NAME: 'auth.displayName',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────
export type UserMode = 'consumer' | 'provider';
export type SubscriptionTier = 'free' | 'silver' | 'gold';

export interface AuthState {
  // Auth tokens (RS256 JWT — Rule #15)
  accessToken: string | null;
  refreshToken: string | null;

  // User identity
  userId: string | null;
  phone: string | null;
  displayName: string | null;
  mode: UserMode | null;
  subscriptionTier: SubscriptionTier;
  fcmToken: string | null;

  // Onboarding flag — persisted across logouts (first-time-only onboarding)
  hasSeenOnboarding: boolean;

  // Hydration guard — prevents auth flash
  isHydrated: boolean;

  // Actions
  hydrateFromStorage: () => Promise<void>;
  setTokens: (access: string, refresh: string) => void;
  setUser: (userId: string, phone: string) => void;
  setDisplayName: (name: string) => void;
  setMode: (mode: UserMode) => void;
  setFcmToken: (token: string) => void;
  setSubscriptionTier: (tier: SubscriptionTier) => void;
  refreshAccessToken: (newAccess: string, newRefresh: string) => void;
  markOnboardingSeen: () => void;
  logout: () => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────
export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  refreshToken: null,
  userId: null,
  phone: null,
  displayName: null,
  mode: null,
  subscriptionTier: 'free',
  fcmToken: null,
  hasSeenOnboarding: false,
  isHydrated: false,

  // Read all persisted values from MMKV on app start.
  // Step 1: preload() warms in-memory cache from AsyncStorage (Expo Go only).
  //         In native build with real MMKV, preload() is a no-op (data already sync).
  // Step 2: read all keys — now returns persisted values from previous session.
  hydrateFromStorage: async (): Promise<void> => {
    await storage.preload();
    const accessToken = storage.getString(KEYS.ACCESS_TOKEN) ?? null;
    const refreshToken = storage.getString(KEYS.REFRESH_TOKEN) ?? null;
    const userId = storage.getString(KEYS.USER_ID) ?? null;
    const phone = storage.getString(KEYS.PHONE) ?? null;
    const displayName = storage.getString(KEYS.DISPLAY_NAME) ?? null;
    const mode = (storage.getString(KEYS.MODE) as UserMode) ?? null;
    const subscriptionTier = (storage.getString(KEYS.SUBSCRIPTION_TIER) as SubscriptionTier) ?? 'free';
    const fcmToken = storage.getString(KEYS.FCM_TOKEN) ?? null;
    // ONBOARDING_SEEN survives logout — intentional
    const hasSeenOnboarding = storage.getBoolean(KEYS.ONBOARDING_SEEN) ?? false;

    set({
      accessToken,
      refreshToken,
      userId,
      phone,
      displayName,
      mode,
      subscriptionTier,
      fcmToken,
      hasSeenOnboarding,
      isHydrated: true,
    });
  },

  setTokens: (access: string, refresh: string): void => {
    storage.set(KEYS.ACCESS_TOKEN, access);
    storage.set(KEYS.REFRESH_TOKEN, refresh);
    set({ accessToken: access, refreshToken: refresh });
  },

  setUser: (userId: string, phone: string): void => {
    storage.set(KEYS.USER_ID, userId);
    storage.set(KEYS.PHONE, phone);
    set({ userId, phone });
  },
  setDisplayName: (name: string): void => {
    storage.set(KEYS.DISPLAY_NAME, name);
    set({ displayName: name });
  },

  setMode: (mode: UserMode): void => {
    storage.set(KEYS.MODE, mode);
    set({ mode });
  },

  setFcmToken: (token: string): void => {
    storage.set(KEYS.FCM_TOKEN, token);
    set({ fcmToken: token });
    // Register FCM token with backend so notification service can push to this device.
    // Fire-and-forget — if this fails the token will be retried on next app open.
    // audit-ref: P7 — FCM token must reach users.fcm_token in DB for any push to work.
    const accessToken = get().accessToken;
    if (accessToken) {
      const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://192.168.1.9:3000';
      axios.patch(`${BASE_URL}/api/v1/users/me`, { fcm_token: token }, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch((err) => {
        console.warn('[auth.store] FCM token registration failed:', err?.message);
      });
    }
  },

  setSubscriptionTier: (tier: SubscriptionTier): void => {
    storage.set(KEYS.SUBSCRIPTION_TIER, tier);
    set({ subscriptionTier: tier });
  },

  refreshAccessToken: (newAccess: string, newRefresh: string): void => {
    storage.set(KEYS.ACCESS_TOKEN, newAccess);
    storage.set(KEYS.REFRESH_TOKEN, newRefresh);
    set({ accessToken: newAccess, refreshToken: newRefresh });
  },

  markOnboardingSeen: (): void => {
    storage.set(KEYS.ONBOARDING_SEEN, true);
    set({ hasSeenOnboarding: true });
  },

  logout: (): void => {
    // Clear tokens and user — NOT ONBOARDING_SEEN (by design — first-time-only)
    storage.delete(KEYS.ACCESS_TOKEN);
    storage.delete(KEYS.REFRESH_TOKEN);
    storage.delete(KEYS.USER_ID);
    storage.delete(KEYS.PHONE);
    storage.delete(KEYS.MODE);
    storage.delete(KEYS.SUBSCRIPTION_TIER);
    storage.delete(KEYS.FCM_TOKEN);
    // ONBOARDING_SEEN deliberately kept

    set({
      accessToken: null,
      refreshToken: null,
      userId: null,
      phone: null,
      displayName: null,
      mode: null,
      subscriptionTier: 'free',
      fcmToken: null,
    });
  },
}));
