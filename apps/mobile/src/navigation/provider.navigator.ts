/**
 * apps/mobile/src/navigation/provider.navigator.ts
 * Re-export shim for provider onboarding screens.
 * ProviderOnboardingParamList = the onboarding subset of ProviderStackParamList.
 */
import type { ProviderStackParamList } from './types';

/**
 * ProviderOnboardingParamList — the onboarding flow screens.
 * Alias of ProviderStackParamList so all screen props are correctly typed.
 */
export type ProviderOnboardingParamList = Pick<
  ProviderStackParamList,
  | 'EntityType'
  | 'CreateProfileStep1'
  | 'CreateProfileStep2'
  | 'CreateProfileStep3Geo'
  | 'FCMPermission'
  // ClaimProfile route (scraped profile claim path)
>;
