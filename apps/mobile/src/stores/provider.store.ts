/**
 * SatvAAh — apps/mobile/src/stores/provider.store.ts
 * Zustand store — Phase 22 Provider Onboarding
 * Persists onboarding progress across the 3-step flow.
 */

import { create } from 'zustand';
import type {
  ListingType,
  ProviderProfile,
  TaxonomyNode,
  City,
  TrustTier,
} from '../api/provider.api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntityClass = 'individual' | 'establishment' | 'brand';

export interface ProviderOnboardingDraft {
  // Step 0 — entity type selection
  entityClass: EntityClass | null;
  listingType: ListingType | null;

  // Step 1 — category selection
  taxonomyNodeId: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
  tab: 'products' | 'services' | 'expertise' | 'establishments' | null;

  // Step 2 — identity
  displayName: string;
  cityId: string | null;
  cityName: string | null;
  areaName: string;
  area_place_id: string | null;
  areaLat: number | null;
  areaLng: number | null;
}

export interface ProviderState {
  // Live provider profile (populated after register/claim)
  profile: ProviderProfile | null;

  // Onboarding draft (clears on completion)
  draft: ProviderOnboardingDraft;

  // Cached lookup data
  cities: City[];
  categories: TaxonomyNode[];
  subCategories: TaxonomyNode[];

  // Loading / error
  isLoading: boolean;
  error: string | null;

  // ─── Actions ───────────────────────────────────────────────────────────────
  setEntityClass: (entityClass: EntityClass, listingType: ListingType | null) => void;
  setListingType: (listing_type: ListingType) => void;
  setCategory: (node: TaxonomyNode) => void;
  setSubCategory: (node: TaxonomyNode) => void;
  setIdentity: (fields: {
    displayName?: string;
    cityId?: string;
    cityName?: string;
    areaName?: string;
    area_place_id?: string;
    areaLat?: number;
    areaLng?: number;
  }) => void;

  setProfile: (profile: ProviderProfile) => void;
  setCities: (cities: City[]) => void;
  setCategories: (cats: TaxonomyNode[]) => void;
  setSubCategories: (cats: TaxonomyNode[]) => void;

  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;

  clearDraft: () => void;
  reset: () => void;
}

// ─── Initial state ────────────────────────────────────────────────────────────

const EMPTY_DRAFT: ProviderOnboardingDraft = {
  entityClass: null,
  listingType: null,
  taxonomyNodeId: null,
  categoryName: null,
  subCategoryName: null,
  tab: null,
  displayName: '',
  cityId: null,
  cityName: null,
  areaName: '',
  area_place_id: null,
  areaLat: null,
  areaLng: null,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useProviderStore = create<ProviderState>((set) => ({
  profile: null,
  draft: { ...EMPTY_DRAFT },
  cities: [],
  categories: [],
  subCategories: [],
  isLoading: false,
  error: null,

  setEntityClass: (entityClass, listingType) =>
    set((s) => ({
      draft: {
        ...s.draft,
        entityClass,
        listingType,
        // Map entity class to tab for Step 1
        tab:
          entityClass === 'establishment'
            ? 'establishments'
            : entityClass === 'brand'
            ? 'products'
            : s.draft.tab, // individual — determined in Step 1
      },
    })),

  setListingType: (listing_type) =>
    set((s) => ({ draft: { ...s.draft, listingType: listing_type } })),

  setCategory: (node) =>
    set((s) => ({
      draft: {
        ...s.draft,
        taxonomyNodeId: node.id,
        categoryName: node.name,
        subCategoryName: null,  // reset sub on category change
        tab: node.tab,
        // Derive listing_type from tab when entityClass=individual
        listingType:
          s.draft.entityClass === 'individual'
            ? tabToListingType(node.tab)
            : s.draft.listingType,
      },
      subCategories: [],
    })),

  setSubCategory: (node) =>
    set((s) => ({
      draft: {
        ...s.draft,
        taxonomyNodeId: node.id, // Use the most specific node
        subCategoryName: node.name,
      },
    })),

  setIdentity: (fields) =>
    set((s) => ({ draft: { ...s.draft, ...fields } })),

  setProfile: (profile) => set({ profile }),
  setCities: (cities) => set({ cities }),
  setCategories: (categories) => set({ categories }),
  setSubCategories: (subCategories) => set({ subCategories }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  clearDraft: () => set({ draft: { ...EMPTY_DRAFT } }),
  reset: () =>
    set({
      profile: null,
      draft: { ...EMPTY_DRAFT },
      cities: [],
      categories: [],
      subCategories: [],
      isLoading: false,
      error: null,
    }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tabToListingType(
  tab: 'products' | 'services' | 'expertise' | 'establishments'
): ListingType {
  switch (tab) {
    case 'services':       return 'individual_service';
    case 'products':       return 'individual_product';
    case 'expertise':      return 'expertise';
    case 'establishments': return 'establishment';
  }
}

/** Colour for a trust tier — matches MASTER_CONTEXT brand spec */
export function tierColor(tier: TrustTier | null): string {
  switch (tier) {
    case 'basic':          return '#C8691A'; // Saffron
    case 'trusted':        return '#6BA89E'; // Light Verdigris
    case 'highly_trusted': return '#2E7D72'; // Verdigris
    default:               return '#6B6560'; // Grey / Unverified
  }
}

/** Tier display label */
export function tierLabel(tier: TrustTier | null): string {
  switch (tier) {
    case 'basic':          return 'Basic';
    case 'trusted':        return 'Trusted';
    case 'highly_trusted': return 'Highly Trusted';
    default:               return 'Unverified';
  }
}
