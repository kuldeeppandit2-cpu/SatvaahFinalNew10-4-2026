import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuthStore } from '../stores/auth.store';
import { AuthNavigator } from './AuthNavigator';
import { ConsumerNavigator } from './ConsumerNavigator';
import { ProviderNavigator } from './ProviderNavigator';
import { SplashScreen } from '../screens/shared/SplashScreen';
import { WelcomeBackScreen } from '../screens/shared/WelcomeBackScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): React.ReactElement {
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

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {/* Auth (Onboarding) always shows first.
          Onboarding branches: no token → Login, has token → WelcomeBack */}
      <Stack.Screen name="Auth" component={AuthNavigator} />
      <Stack.Screen name="WelcomeBack" component={WelcomeBackScreen} />
      <Stack.Screen name="ConsumerApp" component={ConsumerNavigator} />
      <Stack.Screen name="ProviderApp" component={ProviderNavigator} />
    </Stack.Navigator>
  );
}
