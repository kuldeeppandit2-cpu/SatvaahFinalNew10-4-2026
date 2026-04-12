/**
 * SatvAAh Mode Selection — shown after OTP
 * Matches approved onboarding slide 4 design exactly
 */
import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 View, Text, TouchableOpacity, StyleSheet,
 ActivityIndicator, Alert, StatusBar, Dimensions,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { AuthScreenProps } from '../../navigation/types';
import { verifyFirebaseToken } from '../../api/auth.api';
import { useAuthStore } from '../../stores/auth.store';
import { useLocationStore } from '../../stores/location.store';
import { apiClient } from '../../api/client';
import { COLORS } from '../../constants/colors';
import * as Location from 'expo-location';

type ModeRouteProps = AuthScreenProps<'ModeSelection'>['route'];
const { height: H } = Dimensions.get('window');

function Brand() {
  return (
    <View style={b.wrap}>
      <View style={b.row}>
        <Text style={b.ink}>Satv</Text>
        <View style={b.box}><Text style={b.aaText}>AA</Text></View>
        <Text style={b.ink}>h</Text>
      </View>
      <Text style={b.tagline}>Truth that travels</Text>
    </View>
  );
}

export function ModeSelectionScreen(): React.ReactElement {
  const route = useRoute<ModeRouteProps>();
  const { firebaseIdToken, phone } = route.params;
  const [selected, setSelected] = useState<'consumer' | 'provider' | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const setTokens       = useAuthStore((s) => s.setTokens);
  const setUser         = useAuthStore((s) => s.setUser);
  const setMode         = useAuthStore((s) => s.setMode);
  const setDisplayName  = useAuthStore((s) => s.setDisplayName);
  const setLocation    = useLocationStore((s) => s.setLocation);

  /**
   * Silent GPS capture — consumer mode only.
   * Fire-and-forget: never blocks UI, never throws to caller.
   * 1. Request foreground permission (already granted in most cases after login)
   * 2. Get current position (Balanced accuracy, 8s timeout)
   * 3. Populate useLocationStore (used by all search screens)
   * 4. PATCH /api/v1/consumers/me/location (persists to consumer_profiles)
   */
  function captureGpsSilently(): void {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 8000,
        } as any);
        const { latitude: lat, longitude: lng } = loc.coords;
        // Populate store — all search screens read from here
        setLocation({ lat, lng });
        // Persist to backend — fire-and-forget
        apiClient.patch('/api/v1/consumers/me/location', { lat, lng }).catch(() => {});
      } catch {
        // GPS denied or unavailable — store retains Hyderabad default, silently skip
      }
    })();
  }

  async function handleSelect(mode: 'consumer' | 'provider') {
    if (isLoading) return;
    setSelected(mode);
    setIsLoading(true);
    try {
      const result = await verifyFirebaseToken({
        firebaseIdToken, phone, mode, consent_given: true,
      });
      setTokens(result.access_token, result.refresh_token);
      setUser(result.userId, phone);
      setMode(mode);
      if (result.display_name) setDisplayName(result.display_name);
      // Capture GPS after successful auth — consumer only
      if (mode === 'consumer') {
        captureGpsSilently();
      }
    } catch (error: unknown) {
      const code = (error as any)?.response?.data?.error?.code;
      Alert.alert(
        'Something went wrong',
        code === 'CONSENT_REQUIRED'
          ? 'You must agree to data processing to use SatvAAh.'
          : 'Could not complete sign in. Please try again.',
      );
      setSelected(null);
    } finally {
      setIsLoading(false);
    }
  }

  const SLIDE_H = H - 274;
  const TOP_H   = SLIDE_H * 0.44;
  const BRAND_H = SLIDE_H * 0.56;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F0' }} edges={['top', 'bottom']}>

    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />

      {/* Top zone — label + headline + maid/lawyer + cards */}
      <View style={[s.top, { minHeight: TOP_H }]}>
        <View style={s.tag}><Text style={s.tagTxt}>TWO IDENTITIES</Text></View>

        <Text style={s.hl}>{'On one app\nTwo Identities'}</Text>

        <Text style={s.maidLawyer}>
          You can be a lawyer looking for a maid —{'\n'}or a maid looking for a lawyer.
        </Text>

        {/* Customer */}
        <TouchableOpacity
          style={[s.card, selected === 'consumer' && s.cardActive]}
          onPress={() => handleSelect('consumer')}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          <View style={s.cardInner}>
            <View>
              <Text style={[s.cardTitle, selected === 'consumer' && s.cardTitleActive]}>
                Customer
              </Text>
              <Text style={s.cardSub}>Find &amp; connect with providers</Text>
            </View>
            {isLoading && selected === 'consumer' && (
              <ActivityIndicator color={selected === 'consumer' ? '#FAF7F0' : COLORS.saffron} />
            )}
          </View>
        </TouchableOpacity>

        {/* Provider */}
        <TouchableOpacity
          style={[s.card, s.cardSaffron, selected === 'provider' && s.cardSaffronActive]}
          onPress={() => handleSelect('provider')}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          <View style={s.cardInner}>
            <View>
              <Text style={[s.cardTitleSaffron, selected === 'provider' && s.cardTitleActive]}>
                Provider
              </Text>
              <Text style={s.cardSub}>List services, earn your Trust Score</Text>
            </View>
            {isLoading && selected === 'provider' && (
              <ActivityIndicator color={selected === 'provider' ? '#FAF7F0' : COLORS.saffron} />
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Brand zone — centred */}
      <View style={[s.brandZone, { height: BRAND_H }]}>
        <Brand />
      </View>

      {/* Footer */}
      <View style={s.footerWrap}>
        <Text style={s.footTxt}>Let the world know about you with your Trust Score.</Text>
      </View>
    </View>
    </SafeAreaView>
  );
}

const b = StyleSheet.create({
  wrap:    { alignItems: 'center' },
  row:     { flexDirection: 'row', alignItems: 'center' },
  ink:     { fontSize: 52, fontWeight: '800', color: '#1C1C2E' },
  box:     { backgroundColor: '#C8691A', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 2, marginHorizontal: 1 },
  aaText:  { fontSize: 46, fontWeight: '800', color: '#FAF7F0' },
  tagline: { fontSize: 13, fontWeight: '700', fontStyle: 'italic', color: '#C8691A', letterSpacing: 5, marginTop: 12, textAlign: 'center' },
});

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#FAF7F0' },
  top:           { paddingHorizontal: 28, paddingTop: 20, justifyContent: 'flex-start' },
  tag:           { alignSelf: 'flex-start', backgroundColor: '#1C1C2E', borderRadius: 4, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 16 },
  tagTxt:        { fontSize: 10, fontWeight: '700', color: '#FAF7F0', letterSpacing: 2 },
  hl:            { fontSize: 20, fontWeight: '800', color: '#1C1C2E', lineHeight: 28, marginBottom: 12 },
  maidLawyer:    { fontSize: 14, color: '#6B6B7B', lineHeight: 22, marginBottom: 24 },
  card:          { borderWidth: 2, borderColor: '#1C1C2E', borderRadius: 14, padding: 18, marginBottom: 12 },
  cardActive:    { backgroundColor: '#1C1C2E' },
  cardSaffron:   { borderColor: '#C8691A' },
  cardSaffronActive: { backgroundColor: '#C8691A' },
  cardInner:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle:     { fontSize: 17, fontWeight: '700', color: '#1C1C2E', marginBottom: 4 },
  cardTitleSaffron: { fontSize: 17, fontWeight: '700', color: '#C8691A', marginBottom: 4 },
  cardTitleActive:  { color: '#FAF7F0' },
  cardSub:       { fontSize: 13, color: '#9a9a9a' },
  brandZone:     { paddingHorizontal: 28, justifyContent: 'center', alignItems: 'center' },
  footerWrap:    { paddingHorizontal: 28, paddingBottom: 44, alignItems: 'center' },
  footTxt:       { fontSize: 13, fontWeight: '600', color: '#1C1C2E', textAlign: 'center' },
});
