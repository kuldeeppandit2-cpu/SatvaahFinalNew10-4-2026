/**
 * SatvAAh Provider Navigator
 * Bottom tabs: Dashboard · Leads · Credentials · Profile
 * Provider onboarding stack runs before tabs if profile not complete
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { COLORS } from '../constants/colors';
import { useProviderStore } from '../stores/provider.store';
import { useNotificationStore } from '../stores/notification.store';

// Screens — Provider
import EntityTypeScreen from '../screens/provider/EntityTypeScreen';
import ProviderEntryScreen from '../screens/provider/ProviderEntryScreen';
import ClaimProfileScreen from '../screens/provider/ClaimProfileScreen';
import CreateProfileStep1Screen from '../screens/provider/CreateProfileStep1Screen';
import CreateProfileStep2Screen from '../screens/provider/CreateProfileStep2Screen';
import CreateProfileStep3GeoScreen from '../screens/provider/CreateProfileStep3GeoScreen';
import FCMPermissionScreen from '../screens/provider/FCMPermissionScreen';
import ProviderDashboardScreen from '../screens/provider/ProviderDashboardScreen';
import LeadsScreen from '../screens/provider/LeadsScreen';
import LeadFilterScreen from '../screens/provider/LeadFilterScreen';
import { TrustHistoryScreen } from '../screens/consumer/TrustHistoryScreen';
import { ProviderSettingsScreen } from '../screens/shared/ProviderSettingsScreen';
import ProviderSubscriptionScreen from '../screens/provider/ProviderSubscriptionScreen';
import AadhaarVerifyScreen from '../screens/provider/AadhaarVerifyScreen';
import AvailabilityScreen from '../screens/provider/AvailabilityScreen';
import TrustBiographyScreen from '../screens/provider/TrustBiographyScreen';
import AnalyticsScreen from '../screens/provider/AnalyticsScreen';
import CertificateScreen from '../screens/provider/CertificateScreen';
import ProviderProfileEditScreen from '../screens/provider/ProviderProfileEditScreen';
import ProviderRatesConsumerScreen from '../screens/provider/ProviderRatesConsumerScreen';

import type { ProviderTabParamList, ProviderStackParamList } from './types';

const Tab = createBottomTabNavigator<ProviderTabParamList>();
const Stack = createNativeStackNavigator<ProviderStackParamList>();

function TabIcon({ label, focused }: { label: string; focused: boolean }): React.ReactElement {
  const iconMap: Record<string, string> = {
    Dashboard: '📊', Leads: '📥', Credentials: '🛡️', Profile: '👤',
  };
  return (
    <View style={styles.tabIconContainer}>
      <Text style={styles.tabIconEmoji}>{iconMap[label] ?? '●'}</Text>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
    </View>
  );
}

// ─── Dashboard Stack ──────────────────────────────────────────────────────────
function DashboardStack(): React.ReactElement {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Dashboard" component={ProviderDashboardScreen} />
      <Stack.Screen name="TrustBiography" component={TrustBiographyScreen} />
      <Stack.Screen name="Analytics" component={AnalyticsScreen} />
      <Stack.Screen name="Certificate" component={CertificateScreen} />
      <Stack.Screen name="Availability" component={AvailabilityScreen} />
    </Stack.Navigator>
  );
}

// ─── Leads Stack ──────────────────────────────────────────────────────────────
function LeadsStack(): React.ReactElement {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Leads" component={LeadsScreen} />
      <Stack.Screen name="LeadFilterScreen" component={LeadFilterScreen} />
      <Stack.Screen name="TrustHistory" component={TrustHistoryScreen} />
      <Stack.Screen name="ProviderSettings" component={ProviderSettingsScreen} />
      <Stack.Screen name="ProviderSubscription" component={ProviderSubscriptionScreen} />
      <Stack.Screen name="ProviderRatesConsumer" component={ProviderRatesConsumerScreen} />
    </Stack.Navigator>
  );
}

// ─── Credentials Stack ────────────────────────────────────────────────────────
function CredentialsStack(): React.ReactElement {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AadhaarVerify" component={AadhaarVerifyScreen} />
    </Stack.Navigator>
  );
}

// ─── Profile Stack ────────────────────────────────────────────────────────────
function ProviderProfileStack(): React.ReactElement {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProviderProfileEdit" component={ProviderProfileEditScreen} />
    </Stack.Navigator>
  );
}

// ─── Onboarding Stack (shown when profile not complete) ───────────────────────
function OnboardingStack(): React.ReactElement {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProviderEntry" component={ProviderEntryScreen} />
      <Stack.Screen name="ClaimProfile" component={ClaimProfileScreen} />
      <Stack.Screen name="EntityType" component={EntityTypeScreen} />
      <Stack.Screen name="CreateProfileStep1" component={CreateProfileStep1Screen} />
      <Stack.Screen name="CreateProfileStep2" component={CreateProfileStep2Screen} />
      <Stack.Screen name="CreateProfileStep3Geo" component={CreateProfileStep3GeoScreen} />
      <Stack.Screen name="FCMPermission" component={FCMPermissionScreen} />
    </Stack.Navigator>
  );
}

// ─── Provider Tab Navigator ───────────────────────────────────────────────────
export function ProviderNavigator(): React.ReactElement {
  const profile = useProviderStore((s) => s.profile);
  const pendingLeadsCount = 0; // TODO: wire to leads store when LeadsScreen is built

  // Show onboarding if provider hasn't completed profile setup
  const profileComplete = !!profile?.listingType;

  if (!profileComplete) {
    return <OnboardingStack />;
  }

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: COLORS.verdigris,
        tabBarInactiveTintColor: COLORS.muted,
      }}
    >
      <Tab.Screen
        name="DashboardTab"
        component={DashboardStack}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Dashboard" focused={focused} /> }}
      />
      <Tab.Screen
        name="LeadsTab"
        component={LeadsStack}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Leads" focused={focused} />,
          tabBarBadge: pendingLeadsCount > 0 ? pendingLeadsCount : undefined,
        }}
      />
      <Tab.Screen
        name="CredentialsTab"
        component={CredentialsStack}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Credentials" focused={focused} /> }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProviderProfileStack}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Profile" focused={focused} /> }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.ivory,
    borderTopColor: '#E8E0D5',
    borderTopWidth: 1,
    height: 64,
    paddingBottom: 8,
  },
  tabIconContainer: { alignItems: 'center', justifyContent: 'center' },
  tabIconEmoji: { fontSize: 20 },
  tabLabel: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 10,
    color: '#1C1C2E',
    marginTop: 2,
  },
  tabLabelActive: {
    color: COLORS.verdigris,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
});
