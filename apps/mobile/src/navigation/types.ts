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
    initialQuery?: string;
    initialTab?: 'products' | 'services' | 'expertise' | 'establishments';
  };
  SearchResults: {
    query: string;
    tab: 'products' | 'services' | 'expertise' | 'establishments';
    taxonomyNodeId?: string;
  };
  ProviderProfile: {
    providerId: string;
    // Optional pre-fetched data for fast initial render
    previewName?: string;
    previewScore?: number;
  };
  ContactCall: {
    providerId: string;
    providerName: string;
    providerPhone?: string;  // always visible per MASTER_CONTEXT
    providerScore?: number;  // for trust ring colour in bottom sheet
    providerTier?: string;   // tier label display
    topSignals?: string[];   // top 3 verified signal labels for urgency strip
  };
  ContactMessage: {
    providerId: string;
    providerName: string;
    contactEventId?: string;  // optional — screen creates the event itself
    providerScore?: number;   // for trust ring colour in bottom sheet
    providerTier?: string;    // tier label display
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
    providerName: string;
    contactEventId?: string;         // null = open community rating
    ratingType: 'verified' | 'open'; // drives weight
  };
  SavedProviders: undefined;
  ConsumerProfile: undefined;
  ConsumerSubscription: undefined;
  Notifications: undefined;
  DeepLinkResolver: {
    providerId?: string;
    referralCode?: string;
    certId?: string;
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
};

// ─── Root Navigator (top-level) ───────────────────────────────────────────────
export type RootStackParamList = {
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
