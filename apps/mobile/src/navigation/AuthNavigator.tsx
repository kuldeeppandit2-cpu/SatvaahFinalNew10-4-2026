/**
 * SatvAAh Auth Navigator
 * Stack: Onboarding → Login → Otp → ModeSelection
 * Onboarding shown first-time only (ONBOARDING_SEEN flag in MMKV)
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuthStore } from '../stores/auth.store';
import { OnboardingScreen } from '../screens/shared/OnboardingScreen';
import { LoginScreen } from '../screens/shared/LoginScreen';
import { OtpScreen } from '../screens/shared/OtpScreen';
import { ModeSelectionScreen } from '../screens/shared/ModeSelectionScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator(): React.ReactElement {
  const hasSeenOnboarding = useAuthStore((s) => s.hasSeenOnboarding);

  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      initialRouteName={hasSeenOnboarding ? 'Login' : 'Onboarding'}
    >
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Otp" component={OtpScreen} />
      <Stack.Screen name="ModeSelection" component={ModeSelectionScreen} />
    </Stack.Navigator>
  );
}
