/**
 * SatvAAh Navigation Types
 * Full TypeScript param types for all stacks and tabs
 * Rule #18: satvaaah:// scheme — Branch.io only
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';

// ─── Auth Stack ───────────────────────────────────────────────────────────────
export type AuthStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  Otp: {
    phone: string;          // E.164 format: +919876543210
    verificationId: string; // Firebase verificationId
  };
  ModeSelection: {
    firebaseIdToken: string;
    phone: string;
  };
};

// ─── Consumer Tab Navigator ───────────────────────────────────────────────────
export type ConsumerTabParamList = {
  HomeTab: undefined;
  SearchTab: undefined;
  MessagesTab: undefined;
  ProfileTab: undefined;
};

// ─── Consumer Stack (within tabs) ────────────────────────────────────────────
export type ConsumerStackParamList = {
  Home: undefined;
  Search: {
    // 'tab' is the correct param name (SearchScreen reads route.params.tab)
    // 'initialTab' was wrong — caused tab to be silently dropped (BUG-09 fix)
    tab?: 'products' | 'services' | 'expertise' | 'establishments';
    initialQuery?: string;
  };
  SearchResults: {
    query: string;
    tab: 'products' | 'services' | 'expertise' | 'establishments';
    // Taxonomy anchor — all optional (open search if absent)
    taxonomyNodeId?: string;
    taxonomyL4?: string;
    taxonomyL3?: string;
    taxonomyL2?: string;
    taxonomyL1?: string;
    locationName?: string;
    fromDeepLink?: boolean;
  };
  ProviderProfile: {
    providerId: string;
    previewName?: string;
    previewScore?: number;
    fromDeepLink?: boolean;
  };
  ContactCall: {
    providerId: string;
    providerName: string;
    providerPhone?: string;
    providerScore?: number;
    providerTier?: string;
    topSignals?: string[];
  };
  ContactMessage: {
    providerId: string;
    providerName: string;
    contactEventId?: string;
    providerScore?: number;
    providerTier?: string;
  };
  SlotBookingScreen: {
    providerId: string;
    providerName: string;
  };
  Conversation: {
    contactEventId: string;
    otherPartyName: string;
    otherPartyId: string;
  };
  RateProvider: {
    providerId: string;
    providerName?: string;        // optional — deep link may not have name
    contactEventId?: string;      // null = open community rating
    ratingType?: 'verified' | 'open'; // optional — defaults to 'verified' in screen
    fromNotification?: boolean;   // true = opened from rating_reminder FCM (BUG-07 fix)
  };
  OpenRating: {
    provider_id: string;
    provider_name?: string;
    tab?: string;
    rating_dimensions?: unknown[];
  };
  SavedProviders: undefined;
  ConsumerProfile: undefined;
  ConsumerTrust: undefined;        // BUG-10 fix — was missing entirely
  ConsumerSubscription: undefined;
  Notifications: undefined;
  NotificationSettings: undefined;
  DataRights: undefined;
  Support: undefined;
  SearchFilter: {
    filters: {
      min_trust?: number;
      max_distance?: number;
      availability?: boolean;
      homeVisit?: boolean;
      languages?: string;
      min_rating?: number;
      sort: 'trust_score' | 'distance' | 'rating';
    };
    tab: 'products' | 'services' | 'expertise' | 'establishments';
  };
  DeepLinkResolver: {
    providerId?: string;
    referralCode?: string;
    certId?: string;
  };
  Razorpay: {
    orderId: string;
    amount: number;
    currency?: string;
    description?: string;
  };
  CategoryBrowse: {
    tab: 'products' | 'services' | 'expertise' | 'establishments';
    level: 'l2' | 'l3' | 'l4';
    l1: string;
    l2?: string;
    title: string;
    icon: string;
    color: string;
    l4Leaves?: Array<{
      id: string;
      l4: string;
      serviceType: string;
      pricingModel: string | null;
      priceUnit: string | null;
      verificationLabel: string;
      locationLabel: string;
      slotLabel: string;
    }>;
  };
};

// ─── Provider Stack ────────────────────────────────────────────────────────
export type ProviderTabParamList = {
  DashboardTab: undefined;
  LeadsTab: undefined;
  CredentialsTab: undefined;
  ProfileTab: undefined;
};

export type ProviderStackParamList = {
  // Onboarding flow (first time only)
  EntityType: undefined;
  CreateProfileStep1: {
    listingType: string;
  };
  CreateProfileStep2: {
    listingType: string;
    step1Data: Record<string, unknown>;
  };
  CreateProfileStep3Geo: {
    listingType: string;
    step1Data: Record<string, unknown>;
    step2Data: Record<string, unknown>;
  };
  FCMPermission: undefined;
  // Dashboard
  Dashboard: undefined;
  Leads: undefined;
  LeadDetail: {
    leadId: string;
  };
  // Verification
  AadhaarVerify: undefined;
  CredentialUpload: {
    credentialType: string;
  };
  Availability: undefined;
  // Trust + Analytics
  TrustBiography: {
    providerId: string;
  };
  Analytics: undefined;
  Certificate: {
    certificateId?: string;
  };
  // Profile
  ProviderProfileEdit: undefined;
  ProviderSubscription: undefined;
  ProviderNotifications: undefined;
  ProviderRatesConsumer: {
    contactEventId: string;
    consumerName?: string;
    providerCategory?: string;
  };
};

// ─── Root Navigator (top-level) ───────────────────────────────────────────────
export type RootStackParamList = {
  WelcomeBack: undefined;
  Splash: undefined;
  Auth: undefined;
  ConsumerApp: undefined;
  ProviderApp: undefined;
};

// ─── Screen prop helpers ──────────────────────────────────────────────────────
export type AuthScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type ConsumerScreenProps<T extends keyof ConsumerStackParamList> =
  NativeStackScreenProps<ConsumerStackParamList, T>;

export type ProviderScreenProps<T extends keyof ProviderStackParamList> =
  NativeStackScreenProps<ProviderStackParamList, T>;

// Extend global ReactNavigation type for useNavigation() to be typed
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
