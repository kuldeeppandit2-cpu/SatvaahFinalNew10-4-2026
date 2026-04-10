/**
 * SatvAAh Search Store — Zustand
 * query · tab · results · location · filters · pagination
 * Search is always taxonomy-constrained (Rule: no open free-text to providers)
 */

import { create } from 'zustand';

export type SearchTab = 'products' | 'services' | 'expertise' | 'establishments';

export interface ProviderSearchResult {
  providerId: string;
  displayName: string;
  category: string;
  trustScore: number;
  trustTier: 'unverified' | 'basic' | 'trusted' | 'highly_trusted';
  distanceKm: number;
  rating: number;
  ratingCount: number;
  availability: 'available' | 'by_appointment' | 'unavailable';
  photoUrl?: string;
  latitude: number;
  longitude: number;
  // Social proof: '47 people in Banjara Hills used Rajesh'
  socialProofText?: string;
}

export interface SearchFilters {
  minTrust: number;          // 0–100, default 0
  maxDistanceKm: number;     // default: city ring logic
  availability?: 'any' | 'now' | 'by_appointment';
  homeVisit?: boolean;
  minRating?: number;        // 3, 4, 4.5
  sortBy: 'trust' | 'distance' | 'rating' | 'availability';
}

export interface TaxonomySuggestion {
  nodeId: string;
  nodeName: string;
  breadcrumb: string; // e.g. "Home Services → Repair → Plumbing"
  tab: SearchTab;
}

export interface SearchNarration {
  ring: number;        // 1–5
  radiusKm: number;
  resultCount: number;
  text: string;        // "📍 Found 6 verified plumbers within 3km of Banjara Hills"
}

export interface SearchState {
  // Current query state
  query: string;
  tab: SearchTab;
  taxonomyNodeId: string | null;
  results: ProviderSearchResult[];
  suggestions: TaxonomySuggestion[];
  narration: SearchNarration | null;

  // Location (required for geo-search)
  userLat: number | null;
  userLng: number | null;
  locationLabel: string; // "Banjara Hills, Hyderabad"

  // Filters
  filters: SearchFilters;

  // Pagination
  currentPage: number;
  totalPages: number;
  totalResults: number;
  isLoadingMore: boolean;

  // UI state
  isSearching: boolean;
  hasSearched: boolean;

  // Actions
  setQuery: (query: string) => void;
  setTab: (tab: SearchTab) => void;
  setTaxonomyNode: (nodeId: string | null) => void;
  setResults: (
    results: ProviderSearchResult[],
    narration: SearchNarration,
    meta: { total: number; page: number; pages: number },
  ) => void;
  appendResults: (results: ProviderSearchResult[]) => void;
  setSuggestions: (suggestions: TaxonomySuggestion[]) => void;
  setLocation: (lat: number, lng: number, label: string) => void;
  updateFilters: (filters: Partial<SearchFilters>) => void;
  resetFilters: () => void;
  setIsSearching: (v: boolean) => void;
  setIsLoadingMore: (v: boolean) => void;
  clearResults: () => void;
}

const DEFAULT_FILTERS: SearchFilters = {
  minTrust: 0,
  maxDistanceKm: 50,
  availability: 'any',
  homeVisit: undefined,
  minRating: undefined,
  sortBy: 'trust',
};

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  tab: 'services',
  taxonomyNodeId: null,
  results: [],
  suggestions: [],
  narration: null,
  userLat: null,
  userLng: null,
  locationLabel: 'Hyderabad',
  filters: DEFAULT_FILTERS,
  currentPage: 1,
  totalPages: 1,
  totalResults: 0,
  isLoadingMore: false,
  isSearching: false,
  hasSearched: false,

  setQuery: (query): void => set({ query }),
  setTab: (tab): void => set({ tab, results: [], hasSearched: false }),
  setTaxonomyNode: (nodeId): void => set({ taxonomyNodeId: nodeId }),

  setResults: (results, narration, meta): void =>
    set({
      results,
      narration,
      currentPage: meta.page,
      totalPages: meta.pages,
      totalResults: meta.total,
      isSearching: false,
      hasSearched: true,
    }),

  appendResults: (newResults): void =>
    set((s) => ({ results: [...s.results, ...newResults], isLoadingMore: false })),

  setSuggestions: (suggestions): void => set({ suggestions }),

  setLocation: (lat, lng, label): void =>
    set({ userLat: lat, userLng: lng, locationLabel: label }),

  updateFilters: (partial): void =>
    set((s) => ({ filters: { ...s.filters, ...partial } })),

  resetFilters: (): void => set({ filters: DEFAULT_FILTERS }),

  setIsSearching: (v): void => set({ isSearching: v }),

  setIsLoadingMore: (v): void => set({ isLoadingMore: v }),

  clearResults: (): void =>
    set({ results: [], narration: null, hasSearched: false, currentPage: 1 }),
}));
