/**
 * SatvAAh Deep Link Config — Branch.io ONLY
 * Rule #18: Firebase Dynamic Links deprecated August 2025. Never use FDL.
 * Scheme: satvaaah://
 * Universal links: satvaaah.com, satvaaah.app.link
 */

import { LinkingOptions } from '@react-navigation/native';
import branch, { BranchParams } from '../__stubs__/branch';
import type { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    'satvaaah://',
    'https://satvaaah.com',
    'https://satvaaah.app.link',
    'https://satvaaah-alternate.app.link',
  ],

  // Branch.io getInitialURL — handles deferred deep links on first install
  async getInitialURL(): Promise<string | null> {
    try {
      const lastParams = await branch.getLatestReferringParams();
      if (lastParams?.['+clicked_branch_link']) {
        const url = lastParams?.['$canonical_url'] as string | undefined;
        if (url) return url;
        // Build URL from Branch params
        const providerId = lastParams?.['provider_id'] as string | undefined;
        if (providerId) return `satvaaah://provider/${providerId}`;
        const referralCode = lastParams?.['referral_code'] as string | undefined;
        if (referralCode) return `satvaaah://join/${referralCode}`;
      }
    } catch (e) {
      console.warn('[linking] getInitialURL Branch error:', e);
    }
    return null;
  },

  // Branch.io subscribe — handles links while app is open/backgrounded
  subscribe(listener: (url: string) => void): () => void {
    const unsubscribe = branch.subscribe({
      onOpenComplete: ({ error, params }) => {
        if (error) {
          console.error('[linking] Branch subscribe error:', error);
          return;
        }
        if (!params?.['+clicked_branch_link']) return;

        const url = params?.['$canonical_url'] as string | undefined;
        if (url) {
          listener(url);
          return;
        }
        // Build URL from Branch params
        const providerId = params?.['provider_id'] as string | undefined;
        if (providerId) {
          listener(`satvaaah://provider/${providerId}`);
          return;
        }
        const referralCode = params?.['referral_code'] as string | undefined;
        if (referralCode) {
          listener(`satvaaah://join/${referralCode}`);
        }
      },
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  },

  config: {
    screens: {
      // Root
      Auth: {
        screens: {
          Onboarding: 'onboarding',
          Login: 'login',
          Otp: 'otp',
          ModeSelection: 'mode-selection',
        },
      },
      ConsumerApp: {
        screens: {
          // Provider profile deep link: satvaaah://provider/:id
          ProviderProfile: 'provider/:providerId',
          // Referral join: satvaaah://join/:code
          DeepLinkResolver: 'join/:referralCode',
          // Rating reminder: satvaaah://rate/:contactEventId (FCM action — item 28)
          RateProvider: 'rate/:contactEventId',
          // Contact declined alternatives: satvaaah://search/:taxonomyNodeId (FCM action — item 28)
          SearchResults: 'search/:taxonomyNodeId',
        },
      },
      ProviderApp: {
        screens: {},
      },
    },
  },
};
