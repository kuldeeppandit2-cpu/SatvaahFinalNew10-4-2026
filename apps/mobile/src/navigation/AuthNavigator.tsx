/**
 * SatvAAh Auth Navigator
 * Stack: Onboarding (always) → Login → Otp → ModeSelection
 * Onboarding shows every time — returning users branch to WelcomeBack at end
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { OnboardingScreen } from '../screens/shared/OnboardingScreen';
import { LoginScreen } from '../screens/shared/LoginScreen';
import { OtpScreen } from '../screens/shared/OtpScreen';
import { ModeSelectionScreen } from '../screens/shared/ModeSelectionScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator(): React.ReactElement {
  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      initialRouteName="Onboarding"
    >
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Otp" component={OtpScreen} />
      <Stack.Screen name="ModeSelection" component={ModeSelectionScreen} />
    </Stack.Navigator>
  );
}
