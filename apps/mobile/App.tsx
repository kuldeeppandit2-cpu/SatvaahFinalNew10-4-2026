/**
 * SatvAAh — Root App Component
 * Simplified for Expo Go compatibility
 */

import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { linking } from './src/navigation/linking';
import { useAuthStore } from './src/stores/auth.store';
import { useConsumerStore } from './src/stores/consumer.store';
import { preloadAllMmkvStores } from './src/__stubs__/mmkv';
import { useLocationStore } from './src/stores/location.store';
import * as Location from 'expo-location';

// Stubs for native-only modules
const messaging: any = () => ({
  requestPermission: async () => 1,
  getToken: async () => null,
  onTokenRefresh: (_: any) => () => {},
  onMessage: (_: any) => () => {},
});
messaging.AuthorizationStatus = { AUTHORIZED: 1, PROVISIONAL: 2 };

export default function App(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const hydrateAuth     = useAuthStore((s) => s.hydrateFromStorage);
  const hydrateConsumer = useConsumerStore((s) => s.hydrateFromStorage);
  const setLocation     = useLocationStore((s) => s.setLocation);

  useEffect(() => {
    async function init() {
      try { await preloadAllMmkvStores(); } catch {}
      try { await useLocationStore.getState().preload(); } catch {}
      try { await hydrateAuth(); } catch {}
      try { hydrateConsumer(); } catch {}
    }
    // Always show app after 2s max, regardless of what happens
    const t = setTimeout(() => setReady(true), 2000);
    init().then(() => { clearTimeout(t); setReady(true); }).catch(() => setReady(true));
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .then(loc => setLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude }))
        .catch(() => {});
    }).catch(() => {});
  }, []);

  // Show blank ivory screen while loading (max 2s)
  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: '#FAF7F0' }} />;
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
