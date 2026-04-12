/**
 * SatvAAh — Root App Component
 * Branch.io init · Plus Jakarta Sans (9 weights) · Zustand hydration · NavigationContainer
 * Rule #18: Branch.io ONLY — zero Firebase Dynamic Links
 */

import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import { NavigationContainer } from '@react-navigation/native';
// react-native-branch and @react-native-firebase/messaging
// are stubbed for Expo Go / simulator testing
// Real implementations require native build (expo run:ios)
const branch = { subscribe: (_: any) => () => {} };
const messaging: any = () => ({
  requestPermission: async () => 1,
  getToken: async () => null,
  onTokenRefresh: (_: any) => () => {},
  onMessage: (_: any) => () => {},
});
messaging.AuthorizationStatus = { AUTHORIZED: 1, PROVISIONAL: 2 };

import { RootNavigator } from './src/navigation/RootNavigator';
import { linking } from './src/navigation/linking';
import { useAuthStore } from './src/stores/auth.store';
import { useConsumerStore } from './src/stores/consumer.store';
import { preloadAllMmkvStores } from './src/__stubs__/mmkv';
import { apiClient } from './src/api/client';
import * as Location from 'expo-location';
import { useLocationStore } from './src/stores/location.store';

// Keep splash visible until fonts + hydration complete
SplashScreen.preventAutoHideAsync();

export default function App(): React.ReactElement {
  const [appReady, setAppReady] = useState(false);
  const hydrateAuthStore     = useAuthStore((s) => s.hydrateFromStorage);
  const hydrateConsumerStore = useConsumerStore((s) => s.hydrateFromStorage);
  const isHydrated  = useAuthStore((s) => s.isHydrated);
  const setFcmToken = useAuthStore((s) => s.setFcmToken);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setLocation = useLocationStore((s) => s.setLocation);

  useEffect(() => {
    async function prepare(): Promise<void> {
      // ── Step 1: Preload MMKV → AsyncStorage cache ─────────────────────────
      // MUST run first. Warms the in-memory MMKV cache so subsequent
      // synchronous getString/getBoolean calls return persisted values.
      // Without this, every cold start loses the auth session (BUG-01 fix).
      try {
        await preloadAllMmkvStores();
        // Hydrate location store from persisted last-known coords (BUG-04 fix)
        await useLocationStore.getState().preload();
      } catch {
        // Non-fatal — stores fall back to defaults (fresh login required)
      }

      // ── Step 2: Load fonts — NON-FATAL ────────────────────────────────────
      try {
        await Font.loadAsync({
          'PlusJakartaSans-ExtraLight': require('./assets/fonts/PlusJakartaSans-ExtraLight.ttf'),
          'PlusJakartaSans-Light':      require('./assets/fonts/PlusJakartaSans-Light.ttf'),
          'PlusJakartaSans-Regular':    require('./assets/fonts/PlusJakartaSans-Regular.ttf'),
          'PlusJakartaSans-Medium':     require('./assets/fonts/PlusJakartaSans-Medium.ttf'),
          'PlusJakartaSans-SemiBold':   require('./assets/fonts/PlusJakartaSans-SemiBold.ttf'),
          'PlusJakartaSans-Bold':       require('./assets/fonts/PlusJakartaSans-Bold.ttf'),
          'PlusJakartaSans-ExtraBold':  require('./assets/fonts/PlusJakartaSans-ExtraBold.ttf'),
          'PlusJakartaSans-Italic':     require('./assets/fonts/PlusJakartaSans-Italic.ttf'),
          'PlusJakartaSans-BoldItalic': require('./assets/fonts/PlusJakartaSans-BoldItalic.ttf'),
        });
      } catch (fontError) {
        console.log('[App] Fonts using system fallback:', (fontError as Error)?.message);
      }

      // ── Step 3: Hydrate auth store ────────────────────────────────────────
      // Sets isHydrated=true → allows SplashScreen.hideAsync() to run.
      // Now reads from warmed MMKV cache → returns persisted tokens.
      try {
        await hydrateAuthStore();
      } catch (err) {
        console.warn('[App] Auth hydration failed:', err);
      }

      // ── Step 4: Hydrate consumer store ────────────────────────────────────
      // Reads persisted recentSearches + hasCompletedProfileSetup from MMKV.
      // Fire-and-forget — consumer store failure never blocks splash dismiss.
      hydrateConsumerStore().catch(() => {});

      setAppReady(true);
    }

    // Timeout fallback — if prepare() hangs for any reason, 
    // force the app to show after 3 seconds rather than staying black
    const timeout = setTimeout(() => setAppReady(true), 3000);
    prepare().finally(() => clearTimeout(timeout));
  }, [hydrateAuthStore, hydrateConsumerStore]);

  // GPS capture on every app open — silent, non-blocking
  useEffect(() => {
    async function captureLocation(): Promise<void> {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        console.log('[GPS] Location captured:', loc.coords.latitude, loc.coords.longitude);
      } catch {
        console.log('[GPS] Location capture failed — using default');
      }
    }
    captureLocation();
  }, [setLocation]);

  // 3. Register FCM token with backend once authenticated
  //    Called whenever accessToken changes (login / token refresh)
  //    CRITICAL: All push notifications (leads, messages, ratings, discovery) depend on this.
  useEffect(() => {
    if (!accessToken) return;

    async function registerFcmToken(): Promise<void> {
      try {
        // Request permission (iOS requires explicit ask; Android 13+ does too)
        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (!enabled) {
          console.log('[FCM] Permission not granted');
          return;
        }

        const token = await messaging().getToken();
        if (!token) return;

        // Persist locally (for offline badge)
        setFcmToken(token);

        // Register with backend — notification service reads users.fcm_token
        await apiClient.patch(
          '/api/v1/users/me',
          { fcm_token: token },
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );

        console.log('[FCM] Token registered');

        // Listen for token refresh (rotated by Firebase periodically)
        const unsubscribe = messaging().onTokenRefresh(async (newToken) => {
          setFcmToken(newToken);
          await apiClient.patch(
            '/api/v1/users/me',
            { fcm_token: newToken },
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          console.log('[FCM] Token refreshed and re-registered');
        });

        return () => unsubscribe();
      } catch (err) {
        // Non-fatal — app works without push; providers will miss leads until next open
        console.warn('[FCM] Token registration failed:', err);
      }
    }

    registerFcmToken();
  }, [accessToken, setFcmToken]);

  useEffect(() => {
    if (appReady && isHydrated) {
      SplashScreen.hideAsync();
    }
  }, [appReady, isHydrated]);

  if (!appReady || !isHydrated) {
    return <></>;
  }

  return (
    <>
      <StatusBar style="auto" />
      <NavigationContainer linking={linking}>
        <RootNavigator />
      </NavigationContainer>
    </>
  );
}
