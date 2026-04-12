/**
 * SatvAAh Consumer Store — Zustand
 * savedProviders · recentSearches · leadBalance · activeContactEvents
 */

import { create } from 'zustand';
import { MMKV } from '../__stubs__/mmkv';

const storage = new MMKV({ id: 'satvaaah-consumer' });
const RECENT_SEARCHES_KEY = 'consumer.recentSearches';
const PROFILE_SETUP_KEY   = 'consumer.profileSetupComplete';
const MAX_RECENT = 5;

export interface SavedProvider {
  providerId: string;
  name: string;
  trustScore: number;
  category: string;
  savedAt: string; // ISO timestamp
}

export interface RecentSearch {
  query: string;
  tab: 'products' | 'services' | 'expertise' | 'establishments';
  taxonomyNodeId?: string;
  searchedAt: string;
}

export interface ActiveContactEvent {
  contactEventId: string;
  providerId: string;
  providerName: string;
  contactType: 'call' | 'message' | 'slot_booking';
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: string;
}

export interface ConsumerState {
  // Saved providers (bookmarks)
  savedProviders: SavedProvider[];

  // Recent searches — persisted in MMKV, last 5
  recentSearches: RecentSearch[];

  // Lead balance (from consumer_lead_usage)
  leadBalance: number;
  leadsAllocated: number;

  // Active contact events for Trusted Circle display
  activeContactEvents: ActiveContactEvent[];

  // Consumer trust score (starts at 75 per system_config consumer_trust_start)
  consumerTrustScore: number;

  // Profile setup flag — persisted, shown once only
  hasCompletedProfileSetup: boolean;
  markProfileSetupComplete: () => void;

  // Async hydration — call once in App.tsx after preloadAllMmkvStores()
  // Reads persisted values into Zustand state after cold-start preload
  hydrateFromStorage: () => Promise<void>;

  // Actions
  setSavedProviders: (providers: SavedProvider[]) => void;
  addSavedProvider: (provider: SavedProvider) => void;
  removeSavedProvider: (providerId: string) => void;
  addRecentSearch: (search: RecentSearch) => void;
  clearRecentSearches: () => void;
  setLeadBalance: (balance: number, allocated: number) => void;
  setActiveContactEvents: (events: ActiveContactEvent[]) => void;
  setConsumerTrustScore: (score: number) => void;
  reset: () => void;
}

export const useConsumerStore = create<ConsumerState>((set, get) => {
  // Hydrate recent searches from MMKV
  const persistedSearches = storage.getString(RECENT_SEARCHES_KEY);
  const initialRecentSearches: RecentSearch[] = persistedSearches
    ? (JSON.parse(persistedSearches) as RecentSearch[])
    : [];

  return {
    savedProviders: [],
    recentSearches: initialRecentSearches,
    hasCompletedProfileSetup: storage.getBoolean(PROFILE_SETUP_KEY) ?? false,
    leadBalance: 0,
    leadsAllocated: 0,
    activeContactEvents: [],
    consumerTrustScore: 75, // system_config: consumer_trust_start=75

    markProfileSetupComplete: (): void => {
      storage.set(PROFILE_SETUP_KEY, true);
      set({ hasCompletedProfileSetup: true });
    },

    hydrateFromStorage: async (): Promise<void> => {
      // preload() has already run (called from App.tsx preloadAllMmkvStores).
      // Now read fresh values from the warmed in-memory cache.
      await storage.preload(); // idempotent — safe to call again
      const persistedSearches = storage.getString(RECENT_SEARCHES_KEY);
      const initialRecentSearches: RecentSearch[] = persistedSearches
        ? (JSON.parse(persistedSearches) as RecentSearch[])
        : [];
      const hasCompletedProfileSetup = storage.getBoolean(PROFILE_SETUP_KEY) ?? false;
      set({ recentSearches: initialRecentSearches, hasCompletedProfileSetup });
    },

    setSavedProviders: (providers): void => set({ savedProviders: providers }),

    addSavedProvider: (provider): void => {
      const current = get().savedProviders;
      if (current.find((p) => p.providerId === provider.providerId)) return;
      set({ savedProviders: [provider, ...current] });
    },

    removeSavedProvider: (providerId): void => {
      set({ savedProviders: get().savedProviders.filter((p) => p.providerId !== providerId) });
    },

    addRecentSearch: (search): void => {
      const current = get().recentSearches.filter((s) => s.query !== search.query);
      const updated = [search, ...current].slice(0, MAX_RECENT);
      storage.set(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      set({ recentSearches: updated });
    },

    clearRecentSearches: (): void => {
      storage.delete(RECENT_SEARCHES_KEY);
      set({ recentSearches: [] });
    },

    setLeadBalance: (balance, allocated): void =>
      set({ leadBalance: balance, leadsAllocated: allocated }),

    setActiveContactEvents: (events): void => set({ activeContactEvents: events }),

    setConsumerTrustScore: (score): void => set({ consumerTrustScore: score }),

    reset: (): void => {
      storage.delete(RECENT_SEARCHES_KEY);
      set({
        savedProviders: [],
        recentSearches: [],
        leadBalance: 0,
        leadsAllocated: 0,
        activeContactEvents: [],
        consumerTrustScore: 75,
      });
    },
  };
});
