/**
 * @package @satvaaah/db
 * index.ts — Re-exports Prisma client singleton and all generated types.
 *
 * Usage:
 *   import { prisma } from '@satvaaah/db';
 *   import type { ProviderProfile, User, TrustScore } from '@satvaaah/db';
 */

// Prisma client singleton
export { prisma, prisma as default } from './client';

// Re-export all Prisma-generated types so services don't import from @prisma/client directly.
// This gives us a single import point and lets us add helper types.
export type {
  PrismaClient,
  User,
  ProviderProfile,
  ConsumerProfile,
  City,
  Area,
  TrustScore,
  TrustScoreConfig,
  TrustScoreHistory,
  ContactEvent,
  Rating,
  DailyRatingUsage,
  SearchIntent,
  ConsumerLeadUsage,
  ProviderLeadUsage,
  SubscriptionPlan,
  SubscriptionRecord,
  SavedProvider,
  TaxonomyNode,
  NotificationLog,
  InAppMessage,
  SystemConfig,
  ConsentRecord,
  TsaasApiKey,
  TsaasUsageLog,
  RefreshToken,
  TrustFlag,
  ReferralEvent,
  ConsumerRating,
  ProviderVerification,
  ExternalRating,
  ScrapingJob,
  ScrapeStaging,
  OutreachSchedule,
  CertificateRecord,
  OpenSearchSyncLog,
  AdminUser,
} from '@prisma/client';

// Re-export Prisma-generated enums (match our @satvaaah/types enums)
export {
  UserMode as PrismaUserMode,
  Availability as PrismaAvailability,
  DeliveryStatus as PrismaDeliveryStatus,
  ListingType as PrismaListingType,
  Tab as PrismaTab,
  TrustTier as PrismaTrustTier,
  ContactType as PrismaContactType,
  ContactStatus as PrismaContactStatus,
  ProviderLeadStatus as PrismaProviderLeadStatus,
  RatingWeightType as PrismaRatingWeightType,
  ModerationStatus as PrismaModerationStatus,
  SubscriptionTier as PrismaSubscriptionTier,
  ConsentType as PrismaConsentType,
  NotificationChannel as PrismaNotificationChannel,
  TrustFlagType as PrismaTrustFlagType,
  TrustFlagSeverity as PrismaTrustFlagSeverity,
  TrustFlagStatus as PrismaTrustFlagStatus,
  ProviderAction as PrismaProviderAction,
} from '@prisma/client';

// Re-export Prisma namespace for advanced usage (transactions, etc.)
export { Prisma } from '@prisma/client';
