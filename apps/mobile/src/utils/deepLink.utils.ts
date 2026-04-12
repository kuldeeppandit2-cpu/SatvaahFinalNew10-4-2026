/**
 * SatvAAh — apps/mobile/src/utils/deepLink.utils.ts
 *
 * Deep link URL parsing utilities for Branch.io integration.
 *
 * MASTER_CONTEXT rules:
 *   • Branch.io ONLY. Firebase Dynamic Links deprecated August 2025.
 *   • App scheme:       satvaaah://
 *   • Provider profile: satvaaah://provider/{id}
 *   • Referral join:    satvaaah://join/{code}
 *   • Certificate verify: satvaaah.com/verify/{certId}
 *     → This is a PUBLIC WEB URL served by CloudFront. The app does NOT handle it.
 *       It opens in the device browser. Do not add a native handler for /verify.
 *
 * This file is intentionally free of React/Navigation imports so it can be
 * unit-tested without a React Native environment.
 *
 * @see apps/mobile/src/hooks/useDeepLink.ts — subscriber + navigator
 */

import { BranchParams } from '../__stubs__/branch';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderProfileRoute {
  type: 'provider_profile';
  providerId: string;
}

export interface ReferralJoinRoute {
  type: 'referral_join';
  referralCode: string;
}

/** FCM rating_reminder: open RateProvider screen for a specific contact event */
export interface RatingReminderRoute {
  type: 'rating_reminder';
  contactEventId: string;
  providerId: string;
}

/** FCM contact_declined: open SearchResults for same category as the declined lead */
export interface ContactDeclinedRoute {
  type: 'contact_declined';
  taxonomyNodeId: string;
  taxonomyL4?: string;
  tab?: string;
}

export interface UnknownRoute {
  type: 'unknown';
  rawUrl: string;
}

export type DeepLinkRoute =
  | ProviderProfileRoute
  | ReferralJoinRoute
  | RatingReminderRoute
  | ContactDeclinedRoute
  | UnknownRoute;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEME = 'satvaaah://';
const WEB_HOST = 'satvaaah.com';

/**
 * UUID v4 pattern — provider IDs are gen_random_uuid() from PostgreSQL.
 * We validate to avoid navigating with a garbage ID.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Referral code format from MASTER_CONTEXT:
 * users.referralCode is VarChar(16) — alphanumeric.
 */
const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{4,16}$/i;

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * parseSatvaaahDeepLink
 *
 * Parses a Branch.io canonical URL (or deeplink_path) into a typed DeepLinkRoute.
 * Returns null if the URL is completely empty or clearly not a SatvAAh link.
 * Returns UnknownRoute for recognisable but unhandled paths.
 *
 * @param url        - $canonical_url or $deeplink_path from Branch params
 * @param params     - Full Branch params (may contain custom keys for referral code)
 */
export function parseSatvaaahDeepLink(
  url: string,
  params: BranchParams = {},
): DeepLinkRoute | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const trimmed = url.trim();

  // ── Native scheme: satvaaah://... ──────────────────────────────────────────
  if (trimmed.startsWith(SCHEME)) {
    const path = trimmed.slice(SCHEME.length); // e.g. "provider/abc-123" or "join/REF001"
    return parseNativePath(path, params);
  }

  // ── Web URL: https://satvaaah.com/... ──────────────────────────────────────
  // Branch sometimes sends a web fallback URL. Parse it the same way.
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === WEB_HOST || parsed.hostname === `www.${WEB_HOST}`) {
      return parseWebPath(parsed.pathname, params);
    }
  } catch {
    // Not a valid URL — fall through to unknown
  }

  return { type: 'unknown', rawUrl: trimmed };
}

// ---------------------------------------------------------------------------
// Native path parser: satvaaah://{path}
// ---------------------------------------------------------------------------

function parseNativePath(path: string, params: BranchParams): DeepLinkRoute {
  // satvaaah://provider/{providerId}
  const providerMatch = path.match(/^provider\/([^/?#]+)/);
  if (providerMatch) {
    const providerId = providerMatch[1];
    if (isValidUuid(providerId)) {
      return { type: 'provider_profile', providerId };
    }
    console.warn('[deepLink.utils] Invalid provider UUID in deep link:', providerId);
    return { type: 'unknown', rawUrl: `satvaaah://${path}` };
  }

  // satvaaah://join/{referralCode}
  const joinMatch = path.match(/^join\/([^/?#]+)/);
  if (joinMatch) {
    const code = extractReferralCode(joinMatch[1], params);
    if (code) {
      return { type: 'referral_join', referralCode: code };
    }
    console.warn('[deepLink.utils] Invalid referral code in deep link:', joinMatch[1]);
    return { type: 'unknown', rawUrl: `satvaaah://${path}` };
  }

  // satvaaah://rate/{contactEventId}?provider_id={uuid}
  // FCM rating_reminder action — opens RateProvider screen
  const rateMatch = path.match(/^rate\/([^/?#]+)/);
  if (rateMatch) {
    const contactEventId = rateMatch[1];
    const providerId = (params['provider_id'] as string) ?? '';
    if (isValidUuid(contactEventId)) {
      return { type: 'rating_reminder', contactEventId, providerId };
    }
    return { type: 'unknown', rawUrl: `satvaaah://${path}` };
  }

  // satvaaah://search/{taxonomyNodeId}?tab={tab}&l4={label}
  // FCM contact_declined action — opens SearchResults for same category
  const searchMatch = path.match(/^search\/([^/?#]+)/);
  if (searchMatch) {
    const taxonomyNodeId = searchMatch[1];
    const tab = (params['tab'] as string) ?? 'services';
    const taxonomyL4 = (params['l4'] as string) ?? undefined;
    if (isValidUuid(taxonomyNodeId)) {
      return { type: 'contact_declined', taxonomyNodeId, tab, taxonomyL4 };
    }
    return { type: 'unknown', rawUrl: `satvaaah://${path}` };
  }

  return { type: 'unknown', rawUrl: `satvaaah://${path}` };
}

// ---------------------------------------------------------------------------
// Web path parser: https://satvaaah.com/{path}
// ---------------------------------------------------------------------------

function parseWebPath(pathname: string, params: BranchParams): DeepLinkRoute {
  // /provider/{providerId}  — same as native
  const providerMatch = pathname.match(/^\/provider\/([^/?#]+)/);
  if (providerMatch) {
    const providerId = providerMatch[1];
    if (isValidUuid(providerId)) {
      return { type: 'provider_profile', providerId };
    }
    return { type: 'unknown', rawUrl: `https://${WEB_HOST}${pathname}` };
  }

  // /join/{referralCode}
  const joinMatch = pathname.match(/^\/join\/([^/?#]+)/);
  if (joinMatch) {
    const code = extractReferralCode(joinMatch[1], params);
    if (code) {
      return { type: 'referral_join', referralCode: code };
    }
    return { type: 'unknown', rawUrl: `https://${WEB_HOST}${pathname}` };
  }

  // /verify/{certId} — certificate verification is a PUBLIC WEB PAGE.
  // The app should NOT intercept this URL. Return null so the OS handles it
  // (opens in browser → CloudFront → certificate page).
  const verifyMatch = pathname.match(/^\/verify\/([^/?#]+)/);
  if (verifyMatch) {
    // Intentionally return null — let the OS open satvaaah.com/verify in browser.
    return null as unknown as DeepLinkRoute;
  }

  return { type: 'unknown', rawUrl: `https://${WEB_HOST}${pathname}` };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * isValidUuid
 * Checks whether a string is a valid UUID v4.
 * provider IDs are PostgreSQL gen_random_uuid() — always lowercase UUID v4.
 */
export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * extractReferralCode
 *
 * Referral code may come from:
 *   1. The URL path segment (satvaaah://join/REF001)
 *   2. Branch custom data key "referral_code" (set when creating Branch link)
 *      — Branch.io preserves custom params through deferred deep linking.
 *
 * Branch custom data takes precedence (more reliable through install flow).
 */
export function extractReferralCode(
  pathSegment: string,
  params: BranchParams,
): string | null {
  // Branch custom data key (set when creating the referral Branch link)
  const fromParams = params['referral_code'] as string | undefined;
  if (fromParams && REFERRAL_CODE_PATTERN.test(fromParams)) {
    return fromParams.toUpperCase();
  }

  // Path segment fallback
  if (pathSegment && REFERRAL_CODE_PATTERN.test(pathSegment)) {
    return pathSegment.toUpperCase();
  }

  return null;
}

/**
 * buildProviderDeepLink
 *
 * Creates a satvaaah://provider/{providerId} URL.
 * Use this when generating shareable links within the app.
 * Branch.io wraps this into a short link — see App.tsx for Branch link creation.
 */
export function buildProviderDeepLink(providerId: string): string {
  if (!isValidUuid(providerId)) {
    throw new Error(`buildProviderDeepLink: invalid UUID — "${providerId}"`);
  }
  return `${SCHEME}provider/${providerId}`;
}

/**
 * buildReferralDeepLink
 *
 * Creates a satvaaah://join/{referralCode} URL.
 * Used as the $deeplink_path when creating a Branch referral short link.
 */
export function buildReferralDeepLink(referralCode: string): string {
  if (!REFERRAL_CODE_PATTERN.test(referralCode)) {
    throw new Error(`buildReferralDeepLink: invalid referral code — "${referralCode}"`);
  }
  return `${SCHEME}join/${referralCode.toUpperCase()}`;
}
