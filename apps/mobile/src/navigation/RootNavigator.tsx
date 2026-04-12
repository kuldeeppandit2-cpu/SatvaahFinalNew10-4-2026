import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuthStore } from '../stores/auth.store';
import { AuthNavigator } from './AuthNavigator';
import { ConsumerNavigator } from './ConsumerNavigator';
import { ProviderNavigator } from './ProviderNavigator';
import { SplashScreen } from '../screens/shared/SplashScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): React.ReactElement {
  const accessToken = useAuthStore((s) => s.accessToken);
  const mode = useAuthStore((s) => s.mode);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  // Show splash while MMKV is hydrating — prevents auth flash
  // SplashScreen handles its own 1.5s timer then navigates
  if (!isHydrated) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="Splash" component={SplashScreen} />
      </Stack.Navigator>
    );
  }

  const isAuthenticated = !!accessToken;
  const isConsumer = isAuthenticated && mode === 'consumer';
  const isProvider = isAuthenticated && mode === 'provider';

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {!isAuthenticated ? (
        <Stack.Screen name="Auth" component={AuthNavigator} />
      ) : isConsumer ? (
        <Stack.Screen name="ConsumerApp" component={ConsumerNavigator} />
      ) : isProvider ? (
        <Stack.Screen name="ProviderApp" component={ProviderNavigator} />
      ) : (
        <Stack.Screen name="Auth" component={AuthNavigator} />
      )}
    </Stack.Navigator>
  );
}
