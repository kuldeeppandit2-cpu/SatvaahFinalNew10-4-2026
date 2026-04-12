/**
 * SatvAAh — Root App Component
 */

import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { linking } from './src/navigation/linking';
import { useAuthStore } from './src/stores/auth.store';
import { useConsumerStore } from './src/stores/consumer.store';
import { preloadAllMmkvStores } from './src/__stubs__/mmkv';
import { useLocationStore } from './src/stores/location.store';
import * as Location from 'expo-location';

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
      try { await hydrateConsumer(); } catch {}
      setReady(true);
    }
    const t = setTimeout(() => setReady(true), 3000);
    init().finally(() => { clearTimeout(t); setReady(true); });
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync()
      .then(({ status }) => {
        if (status !== 'granted') return;
        return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      })
      .then(loc => { if (loc) setLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude }); })
      .catch(() => {});
  }, []);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: '#C8691A', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: 'System', fontSize: 48, fontWeight: '800', color: '#FAF7F0', letterSpacing: -1 }}>SatvAAh</Text>
      <Text style={{ fontFamily: 'System', fontSize: 16, fontStyle: 'italic', color: '#FAF7F0', marginTop: 8, opacity: 0.9 }}>Truth that travels.</Text>
    </View>;
  }

  return (
    <>
      <StatusBar style="light" />
      <NavigationContainer linking={linking}>
        <RootNavigator />
      </NavigationContainer>
    </>
  );
}
