/**
 * SatvAAh Auth Store — Zustand
 * MMKV encrypted storage (NOT AsyncStorage)
 * Folder: stores/ (NOT store/) — Rule verified
 * Rule #15: RS256 tokens — never HS256
 * Rule #21: consent_given always true
 */

import { create } from 'zustand';
import { MMKV } from '../__stubs__/mmkv';

// Encrypted MMKV storage (device-level encryption)
const storage = new MMKV({
  id: 'satvaaah-auth',
  encryptionKey: 'satvaaah-mmkv-key-v1', // In production: derive from device secure storage
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
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────
export type UserMode = 'consumer' | 'provider';
export type SubscriptionTier = 'free' | 'bronze' | 'silver' | 'gold';

export interface AuthState {
  // Auth tokens (RS256 JWT — Rule #15)
  accessToken: string | null;
  refreshToken: string | null;

  // User identity
  userId: string | null;
  phone: string | null;
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
  mode: null,
  subscriptionTier: 'free',
  fcmToken: null,
  hasSeenOnboarding: false,
  isHydrated: false,

  // Read all persisted values from MMKV on app start
  hydrateFromStorage: async (): Promise<void> => {
    const accessToken = storage.getString(KEYS.ACCESS_TOKEN) ?? null;
    const refreshToken = storage.getString(KEYS.REFRESH_TOKEN) ?? null;
    const userId = storage.getString(KEYS.USER_ID) ?? null;
    const phone = storage.getString(KEYS.PHONE) ?? null;
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

  setMode: (mode: UserMode): void => {
    storage.set(KEYS.MODE, mode);
    set({ mode });
  },

  setFcmToken: (token: string): void => {
    storage.set(KEYS.FCM_TOKEN, token);
    set({ fcmToken: token });
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
      mode: null,
      subscriptionTier: 'free',
      fcmToken: null,
    });
  },
}));
