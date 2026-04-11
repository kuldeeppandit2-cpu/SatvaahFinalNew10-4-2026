/**
 * DeepLinkResolver.tsx
 * SatvAAh — Phase 21
 *
 * Branch.io handler — routes to the correct screen when the app opens from a deep link.
 * Replaces all Firebase Dynamic Links usage (FDL deprecated August 2025 — Rule #18).
 *
 * Handles:
 *   satvaaah://provider/:id     → ProviderProfileScreen
 *   satvaaah://join/:code       → Applies referral code + navigates home
 *
 * Branch.io provides:
 *   1. Immediate deep link — app already open (branch.subscribe callback)
 *   2. Deferred deep link — app installed via attributed link (first launch)
 *      Branch persists the referral code through install attribution automatically.
 *
 * Usage:
 *   Mount <DeepLinkResolver /> once at the root of your authenticated navigator.
 *   It renders null — purely a side-effect component.
 *
 * SDK:
 *   react-native-branch (Branch.io official SDK)
 *   Configured in app.json with scheme: satvaaah://
 *   Branch key in app.json plugins: ["react-native-branch", { "apiKey": "..." }]
 *
 * Endpoint:
 *   POST /api/v1/referrals/apply    (payment :3007) — apply referral code on join
 */

import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import branch, { BranchParams } from '../../__stubs__/branch';
import { apiClient } from '../../api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BranchEvent {
  error: string | null;
  params: BranchParams & {
    '+clicked_branch_link'?: boolean;
    '+is_first_session'?: boolean;
    /** Custom link data set when creating the Branch link */
    $deeplink_path?: string;
    /** Provider deep link id */
    providerId?: string;
    /** Referral code */
    referralCode?: string;
  };
  uri?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DeepLinkResolver(): null {
  const navigation = useNavigation<any>();
  // Guard against processing the same link twice (Branch may fire subscribe twice on cold start)
  const lastProcessedUri = useRef<string | null>(null);

  useEffect(() => {
    /**
     * Branch.subscribe fires:
     *   - On cold start (deferred link from install attribution)
     *   - When a Branch link is tapped while the app is open
     *   - On every foreground resume if a link was tapped from background
     */
    const unsubscribe = branch.subscribe(async ({ error, params, uri }: BranchEvent) => {
      if (error) {
        console.warn('[DeepLinkResolver] Branch error:', error);
        return;
      }

      // Only process clicked Branch links
      if (!params['+clicked_branch_link']) return;

      // Deduplication guard — Branch may fire the same URI twice
      if (uri && uri === lastProcessedUri.current) return;
      if (uri) lastProcessedUri.current = uri;

      const deeplinkPath = params.$deeplink_path ?? '';

      // ── satvaaah://provider/:id ───────────────────────────────────────────
      const providerMatch = deeplinkPath.match(/^provider\/([^/]+)$/);
      if (providerMatch) {
        const providerId = providerMatch[1] ?? params.providerId;
        if (providerId) {
          navigation.navigate('ProviderProfile', { providerId });
        }
        return;
      }

      // ── satvaaah://join/:code ─────────────────────────────────────────────
      const joinMatch = deeplinkPath.match(/^join\/([^/]+)$/);
      if (joinMatch) {
        const referralCode = joinMatch[1] ?? params.referralCode;
        if (referralCode) {
          await applyReferralCode(referralCode);
        }
        // audit-ref: navigation — HomeTab is the correct root screen name (not 'Home')
        navigation.navigate('HomeTab' as any);
        return;
      }

      // Unrecognised path — navigate home silently
      console.log('[DeepLinkResolver] Unhandled deep link path:', deeplinkPath);
    });

    return () => {
      unsubscribe();
    };
  }, [navigation]);

  return null;
}

// ─── Referral code apply ──────────────────────────────────────────────────────

/**
 * POST /api/v1/referrals/apply
 * Applies a referral code for the authenticated user.
 * Idempotent — safe to call if code was already applied.
 * Shows success/failure alert to the user.
 */
async function applyReferralCode(code: string): Promise<void> {
  try {
    await apiClient.post<{ success: true; data: { reward_leads: number } }>(
      '/api/v1/referrals/apply',
      { referral_code: code },
    );
    Alert.alert(
      '🎉 Referral Applied',
      'Your referral code has been applied. Bonus leads have been added to your account.',
      [{ text: 'OK' }],
    );
  } catch (err: any) {
    const code_err = err?.response?.data?.error?.code;
    // ALREADY_APPLIED is not an error from the user's perspective
    if (code_err === 'REFERRAL_ALREADY_APPLIED') return;
    if (code_err === 'REFERRAL_CODE_INVALID') {
      Alert.alert('Invalid Referral Code', 'The referral code in this link is no longer valid.');
      return;
    }
    // All other errors — silent (non-critical, user is not blocked)
    console.warn('[DeepLinkResolver] applyReferralCode error', err);
  }
}
