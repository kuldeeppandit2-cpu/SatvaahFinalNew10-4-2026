/**
 * SatvAAh Consumer Navigator
 * Bottom tabs: Home · Search · Messages · Profile
 * Each tab owns its own stack for nested navigation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { COLORS } from '../constants/colors';

// Screens
import HomeScreen from '../screens/consumer/HomeScreen';
import SearchScreen from '../screens/consumer/SearchScreen';
import SearchResultsScreen from '../screens/consumer/SearchResultsScreen';
import { ProviderProfileScreen } from '../screens/consumer/ProviderProfileScreen';
import { ContactCallScreen } from '../screens/consumer/ContactCallScreen';
import { ContactMessageScreen } from '../screens/consumer/ContactMessageScreen';
import { ConversationScreen } from '../screens/consumer/ConversationScreen';
import { MessagesListScreen } from '../screens/consumer/MessagesListScreen';
import RateProviderScreen from '../screens/consumer/RateProviderScreen';
import SavedProvidersScreen from '../screens/consumer/SavedProvidersScreen';
import ConsumerProfileScreen from '../screens/consumer/ConsumerProfileScreen';
import SubscriptionScreen from '../screens/consumer/SubscriptionScreen';
import NotificationsScreen from '../screens/consumer/NotificationsScreen';
import DeepLinkResolver from '../screens/consumer/DeepLinkResolver';
import { SlotBookingScreen } from '../screens/consumer/SlotBookingScreen';
import ConsumerTrustScreen from '../screens/consumer/ConsumerTrustScreen';
import RazorpayScreen from '../screens/consumer/RazorpayScreen';
import SearchFilterScreen from '../screens/consumer/SearchFilterScreen';
import { CategoryBrowseScreen } from '../screens/consumer/CategoryBrowseScreen';
import OpenRatingScreen from '../screens/consumer/OpenRatingScreen';
import { DataRightsScreen } from '../screens/shared/DataRightsScreen';
import { NotificationSettingsScreen } from '../screens/shared/NotificationSettingsScreen';
import { SupportScreen } from '../screens/shared/SupportScreen';

import { useNotificationStore } from '../stores/notification.store';
import type { ConsumerTabParamList, ConsumerStackParamList } from './types';

const Tab = createBottomTabNavigator<ConsumerTabParamList>();
const Stack = createNativeStackNavigator<ConsumerStackParamList>();

// ─── Tab Icon component ───────────────────────────────────────────────────────
function TabIcon({ label, focused }: { label: string; focused: boolean }): React.ReactElement {
  const iconMap: Record<string, string> = {
    Home: '🏠', Search: '🔍', Messages: '💬', Profile: '👤',
  };
  return (
    <View style={styles.tabIconContainer}>
      <Text style={styles.tabIconEmoji}>{iconMap[label] ?? '●'}</Text>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
    </View>
  );
}

// ─── Home Stack ───────────────────────────────────────────────────────────────
function HomeStack(): React.ReactElement {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="ProviderProfile" component={ProviderProfileScreen} />
      <Stack.Screen name="ContactCall" component={ContactCallScreen} />
      <Stack.Screen name="ContactMessage" component={ContactMessageScreen} />
      <Stack.Screen name="Conversation" component={ConversationScreen} />
      <Stack.Screen name="RateProvider" component={RateProviderScreen} />
      <Stack.Screen name="SavedProviders" component={SavedProvidersScreen} />
      <Stack.Screen name="ConsumerTrust" component={ConsumerTrustScreen} />
      <Stack.Screen name="Razorpay" component={RazorpayScreen} />
      <Stack.Screen name="SearchFilter" component={SearchFilterScreen} />
      <Stack.Screen name="DataRights" component={DataRightsScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="DeepLinkResolver" component={DeepLinkResolver} />
      <Stack.Screen name="SlotBookingScreen" component={SlotBookingScreen} />
      <Stack.Screen name="CategoryBrowse" component={CategoryBrowseScreen} />
      <Stack.Screen name="SearchResults" component={SearchResultsScreen} />
      <Stack.Screen name="OpenRating" component={OpenRatingScreen} />
    </Stack.Navigator>
  );
}

// ─── Search Stack ─────────────────────────────────────────────────────────────
function SearchStack(): React.ReactElement {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="SearchResults" component={SearchResultsScreen} />
      <Stack.Screen name="ProviderProfile" component={ProviderProfileScreen} />
      <Stack.Screen name="ContactCall" component={ContactCallScreen} />
      <Stack.Screen name="ContactMessage" component={ContactMessageScreen} />
      <Stack.Screen name="Conversation" component={ConversationScreen} />
      <Stack.Screen name="RateProvider" component={RateProviderScreen} />
      <Stack.Screen name="SlotBookingScreen" component={SlotBookingScreen} />
      <Stack.Screen name="OpenRating" component={OpenRatingScreen} />
    </Stack.Navigator>
  );
}

// ─── Messages Stack ───────────────────────────────────────────────────────────
function MessagesStack(): React.ReactElement {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MessagesList" component={MessagesListScreen} />
      <Stack.Screen name="Conversation" component={ConversationScreen} />
      <Stack.Screen name="ProviderProfile" component={ProviderProfileScreen} />
      <Stack.Screen name="ContactCall" component={ContactCallScreen} />
      <Stack.Screen name="OpenRating" component={OpenRatingScreen} />
    </Stack.Navigator>
  );
}

// ─── Profile Stack ────────────────────────────────────────────────────────────
function ProfileStack(): React.ReactElement {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ConsumerProfile" component={ConsumerProfileScreen} />
      <Stack.Screen name="ConsumerSubscription" component={SubscriptionScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      {/* ConsumerTrust in ProfileStack (item 22) — was missing, caused nav crash */}
      <Stack.Screen name="ConsumerTrust" component={ConsumerTrustScreen} />
      <Stack.Screen name="DataRights" component={DataRightsScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="OpenRating" component={OpenRatingScreen} />
    </Stack.Navigator>
  );
}

// ─── Consumer Tab Navigator ───────────────────────────────────────────────────
export function ConsumerNavigator(): React.ReactElement {
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: COLORS.saffron,
        tabBarInactiveTintColor: COLORS.muted,
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeStack}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Home" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="SearchTab"
        component={SearchStack}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Search" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="MessagesTab"
        component={MessagesStack}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Messages" focused={focused} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStack}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Profile" focused={focused} />,
        }}
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
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconEmoji: { fontSize: 20 },
  tabLabel: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 10,
    color: '#1C1C2E',
    marginTop: 2,
  },
  tabLabelActive: {
    color: COLORS.saffron,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
});
