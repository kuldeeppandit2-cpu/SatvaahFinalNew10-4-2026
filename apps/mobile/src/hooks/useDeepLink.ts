/**
 * SatvAAh — apps/mobile/src/hooks/useDeepLink.ts
 *
 * Branch.io deep link handler hook.
 * Subscribes to Branch link open events and routes the app to the
 * correct screen based on the incoming deep link.
 *
 * MASTER_CONTEXT rules:
 *   • Branch.io ONLY — Firebase Dynamic Links deprecated August 2025.
 *   • Deep link scheme: satvaaah://
 *   • Provider profile: satvaaah://provider/{id}
 *   • Referral join:    satvaaah://join/{code} → satvaaah.com/join/{code}
 *   • Certificate verify: satvaaah.com/verify/{certId} (web, CloudFront — not app)
 *   • Deferred deep linking (install attribution) handled by Branch SDK init in App.tsx.
 *
 * Usage:
 *   Call useDeepLink() once in the root navigator (NavigationContainer onReady).
 *   The hook registers the Branch subscribe listener and cleans up on unmount.
 *
 * @see apps/mobile/src/utils/deepLink.utils.ts  — URL parsing helpers
 * @see apps/mobile/App.tsx                       — Branch.initSessionTtl + subscribe
 */

import { useEffect, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';
import branch, { BranchParams } from '../__stubs__/branch';
import { parseSatvaaahDeepLink, DeepLinkRoute } from '../utils/deepLink.utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Navigation prop — react-navigation RootNavigator */
type NavigationProp = ReturnType<typeof useNavigation>;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useDeepLink
 *
 * Subscribes to Branch.io link open events.
 * On each valid deep link the hook navigates to the appropriate screen.
 *
 * Must be called inside a NavigationContainer — navigation must be ready.
 */
export function useDeepLink(): void {
  const navigation = useNavigation<any>();
  // Track whether navigation is ready to avoid navigating before the stack mounts
  const isNavReady = useRef(false);

  useEffect(() => {
    isNavReady.current = true;
    return () => {
      isNavReady.current = false;
    };
  }, []);

  useEffect(() => {
    /**
     * Branch subscribe callback.
     * Called on:
     *   - App open via Branch link (cold start + warm start)
     *   - Deferred deep link resolution after first install
     */
    const unsubscribe = branch.subscribe({
      onOpenComplete: ({ error, params }: { error: Error | null; params: BranchParams | null }) => {
        if (error) {
          // Non-fatal — log and continue. Never crash on deep link error.
          console.warn('[useDeepLink] Branch link open error:', error.message);
          return;
        }

        if (!params) {
          return;
        }

        // Branch sets +clicked_branch_link=false for non-Branch opens (direct launch).
        // Only route when a real Branch link was clicked.
        if (!params['+clicked_branch_link']) {
          return;
        }

        const canonicalUrl: string | undefined =
          (params.$canonical_url as string) ||
          (params.$deeplink_path as string) ||
          undefined;

        if (!canonicalUrl) {
          console.warn('[useDeepLink] Branch params missing $canonical_url/$deeplink_path', params);
          return;
        }

        const route = parseSatvaaahDeepLink(canonicalUrl, params);

        if (!route) {
          console.warn('[useDeepLink] Unrecognised deep link:', canonicalUrl);
          return;
        }

        if (!isNavReady.current) {
          console.warn('[useDeepLink] Navigation not ready — dropping deep link:', canonicalUrl);
          return;
        }

        handleDeepLinkRoute(navigation, route);
      },
    });

    // Cleanup Branch subscriber on unmount
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigation]);
}

// ---------------------------------------------------------------------------
// Internal: route to screen
// ---------------------------------------------------------------------------

function handleDeepLinkRoute(navigation: NavigationProp, route: DeepLinkRoute): void {
  switch (route.type) {
    case 'provider_profile':
      navigation.navigate('ProviderProfile', {
        providerId: route.providerId,
        fromDeepLink: true,
      });
      break;

    case 'referral_join':
      navigation.navigate('Onboarding', {
        referralCode: route.referralCode,
      });
      break;

    case 'rating_reminder':
      /**
       * satvaaah://rate/{contactEventId}?provider_id={uuid}
       * FCM rating_reminder — sent 24h after accepted contact_event.
       * Opens RateProvider screen so consumer can rate the provider.
       */
      navigation.navigate('RateProvider', {
        contactEventId: route.contactEventId,
        providerId:     route.providerId,
        fromNotification: true,
      });
      break;

    case 'contact_declined':
      /**
       * satvaaah://search/{taxonomyNodeId}?tab={tab}&l4={label}
       * FCM contact_declined — provider declined the lead.
       * Opens SearchResults for the same category so consumer can find alternatives.
       */
      navigation.navigate('SearchResults', {
        query:          route.taxonomyL4 ?? 'providers',
        taxonomyNodeId: route.taxonomyNodeId,
        taxonomyL4:     route.taxonomyL4,
        tab:            (route.tab as any) ?? 'services',
      });
      break;

    case 'unknown':
    default:
      console.warn('[useDeepLink] Unknown route type — falling back to Home');
      navigation.navigate('Home');
      break;
  }
}
