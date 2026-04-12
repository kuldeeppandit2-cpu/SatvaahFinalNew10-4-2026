/**
 * WelcomeBackScreen
 *
 * Shown every time an authenticated user opens the app.
 * "Welcome back Satish! What would you like to be today?"
 * Two large cards: Customer | Provider
 *
 * On tap → sets mode in store → RootNavigator picks the right app.
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, StatusBar, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth.store';
import { apiClient } from '../../api/client';
import { COLORS } from '../../constants/colors';

const { width: W } = Dimensions.get('window');

export function WelcomeBackScreen(): React.ReactElement {
  const setMode        = useAuthStore((s) => s.setMode);
  const displayName    = useAuthStore((s) => s.displayName);
  const setDisplayName = useAuthStore((s) => s.setDisplayName);
  const [loading, setLoading] = useState<'consumer' | 'provider' | null>(null);

  // Fetch display name if not cached
  useEffect(() => {
    if (displayName) return;
    apiClient.get('/api/v1/consumers/profile')
      .then(res => {
        const name = res.data?.data?.display_name;
        if (name) setDisplayName(name);
      })
      .catch(() => {});
  }, []);

  const firstName = displayName
    ? displayName.split(' ')[0]
    : 'there';

  async function handleMode(mode: 'consumer' | 'provider') {
    setLoading(mode);
    try {
      await apiClient.patch('/api/v1/users/me/mode', { mode });
    } catch {}
    setMode(mode);
    setLoading(null);
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.ivory} />

      <View style={s.root}>

        {/* Brand */}
        <View style={s.brandRow}>
          <Text style={s.brandInk}>Satv</Text>
          <View style={s.brandBox}><Text style={s.brandAA}>AA</Text></View>
          <Text style={s.brandInk}>h</Text>
        </View>

        {/* Greeting */}
        <Text style={s.greeting}>Welcome back, {firstName}!</Text>
        <Text style={s.question}>What would you like to be today?</Text>

        {/* Cards */}
        <View style={s.cards}>

          {/* Customer */}
          <TouchableOpacity
            style={[s.card, s.cardCustomer]}
            onPress={() => handleMode('consumer')}
            disabled={loading !== null}
            activeOpacity={0.85}
          >
            <View style={s.cardIcon}>
              <Ionicons name="search" size={32} color={COLORS.deepInk} />
            </View>
            <Text style={s.cardTitle}>Customer</Text>
            <Text style={s.cardSub}>Find trusted providers near you</Text>
            {loading === 'consumer'
              ? <ActivityIndicator color={COLORS.deepInk} style={{ marginTop: 12 }} />
              : (
                <View style={s.cardArrow}>
                  <Ionicons name="arrow-forward" size={18} color={COLORS.deepInk} />
                </View>
              )
            }
          </TouchableOpacity>

          {/* Provider */}
          <TouchableOpacity
            style={[s.card, s.cardProvider]}
            onPress={() => handleMode('provider')}
            disabled={loading !== null}
            activeOpacity={0.85}
          >
            <View style={[s.cardIcon, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <Ionicons name="briefcase" size={32} color={COLORS.ivory} />
            </View>
            <Text style={[s.cardTitle, { color: COLORS.ivory }]}>Provider</Text>
            <Text style={[s.cardSub, { color: 'rgba(255,255,255,0.75)' }]}>
              Manage leads, grow your Trust Score
            </Text>
            {loading === 'provider'
              ? <ActivityIndicator color={COLORS.ivory} style={{ marginTop: 12 }} />
              : (
                <View style={[s.cardArrow, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                  <Ionicons name="arrow-forward" size={18} color={COLORS.ivory} />
                </View>
              )
            }
          </TouchableOpacity>

        </View>

        {/* Footer */}
        <Text style={s.footer}>
          You can switch anytime from your profile.
        </Text>

      </View>
    </SafeAreaView>
  );
}

const CARD_W = W - 48;

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: COLORS.ivory },
  root:       { flex: 1, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center' },

  brandRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 32 },
  brandInk:   { fontSize: 40, fontWeight: '800', color: COLORS.deepInk },
  brandBox:   { backgroundColor: COLORS.saffron, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1, marginHorizontal: 1 },
  brandAA:    { fontSize: 36, fontWeight: '800', color: COLORS.ivory },

  greeting:   { fontSize: 24, fontWeight: '700', color: COLORS.deepInk, textAlign: 'center', marginBottom: 8 },
  question:   { fontSize: 16, color: COLORS.muted, textAlign: 'center', marginBottom: 36 },

  cards:      { width: CARD_W, gap: 16 },

  card:       {
    width: CARD_W, borderRadius: 20, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  cardCustomer: { backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.border },
  cardProvider: { backgroundColor: COLORS.saffron },

  cardIcon:   { width: 56, height: 56, borderRadius: 16, backgroundColor: COLORS.warmSand, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  cardTitle:  { fontSize: 22, fontWeight: '700', color: COLORS.deepInk, marginBottom: 6 },
  cardSub:    { fontSize: 14, color: COLORS.muted, lineHeight: 20, marginBottom: 16 },
  cardArrow:  { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.warmSand, justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-end' },

  footer:     { fontSize: 12, color: COLORS.muted, textAlign: 'center', marginTop: 28 },
});
