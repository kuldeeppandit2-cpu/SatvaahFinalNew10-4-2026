/**
 * apps/mobile/src/screens/consumer/ProviderProfileScreen.tsx
 * SatvAAh Phase 19 — Provider Public Profile
 *
 * Phase 19 prompt spec enforced:
 *   ✓ Trust ring SVG 60px, animated 0→score 900ms
 *   ✓ Verification badges (OTP / Geo / Aadhaar / Credential)
 *   ✓ Trust narrative + peer context percentage
 *   ✓ Customer voice bar (verification% / customer voice%)
 *   ✓ Social proof
 *   ✓ Sticky contact bar ALWAYS visible at bottom
 *   ✓ Lead cost hidden when contact_lead_cost = 0
 *   ✓ TrustBreakdownModal — "How this score is calculated"
 *
 * MASTER_CONTEXT rules enforced:
 *   ✓ Provider phone always visible — no blur/reveal gate
 *   ✓ Ring colours from trustRingColor() — single source of truth
 *   ✓ Certificate banner only for Highly Trusted (score ≥ 80)
 *   ✓ Book Slot gated: Gold tier + provider has_calendar
 *   ✓ Promise.allSettled — one failure doesn't block others
 *   ✓ All amounts in paise; ₹0 commission line shown
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Animated, RefreshControl, Alert, SafeAreaView,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { apiClient }                                          from '../../api/client';
import { getTrustScore, trustRingColor, trustTierLabel }      from '../../api/trust.api';
import type { TrustScore }                                    from '../../api/trust.api';
import { getSavedProviders, saveProvider, unsaveProvider }    from '../../api/contact.api';
import { TrustBreakdownModal }                                from './TrustBreakdownModal';
import { useAuthStore }                                       from '../../stores/auth.store';
import type { ConsumerStackParamList }                        from '../../navigation/types';

// ─── Brand colours ────────────────────────────────────────────────────────────
const SAFFRON    = '#C8691A';
const VERDIGRIS  = '#2E7D72';
const DEEP_INK   = '#1C1C2E';
const IVORY      = '#FAF7F0';
const WARM_SAND  = '#F0E4CC';
const MUTED      = '#9E9589';

// ─── Trust Ring SVG — animated 0→score, 900ms ────────────────────────────────
const RING_SIZE   = 60;   // Phase 19 prompt spec: 60px
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC   = 2 * Math.PI * RING_RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function TrustRingSVG({ score }: { score: number }): React.ReactElement {
  const animVal = useRef(new Animated.Value(0)).current;
  const color   = trustRingColor(score); // single source of truth

  useEffect(() => {
    Animated.timing(animVal, {
      toValue: score,
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [score, animVal]);

  const dashOffset = animVal.interpolate({
    inputRange:  [0, 100],
    outputRange: [RING_CIRC, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ width: RING_SIZE, height: RING_SIZE }}>
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
          stroke="#E0D9CF" strokeWidth={RING_STROKE} fill="none"
        />
        <AnimatedCircle
          cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
          stroke={color} strokeWidth={RING_STROKE} fill="none"
          strokeDasharray={`${RING_CIRC}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.ringCenter]}>
        <Text style={[styles.ringScore, { color }]}>{score}</Text>
      </View>
    </View>
  );
}

// ─── Provider profile shape ───────────────────────────────────────────────────
interface ProviderProfile {
  id:                  string;
  displayName:        string;
  listingType:        string;
  category:            string;
  bio:                 string;
  famous_for:          string | null;   // provider's own words, max 200 chars
  phone:               string;          // MASTER_CONTEXT: always visible, no gate
  photo_url:           string | null;
  availability:        'available' | 'by_appointment' | 'unavailable';
  has_calendar:        boolean;         // slot booking gate
  experience_years:    number | null;
  languages:           string[];
  rating_avg:          number;
  rating_count:        number;
  geo_confirmed:       boolean;
  aadhaar_verified:    boolean;
  credential_verified: boolean;
  otp_verified:        boolean;
  city:                string;
  area:                string;
  distance_km:         number | null;
}

type ProfileNav = NativeStackNavigationProp<ConsumerStackParamList, 'ProviderProfile'>;

// ─── Screen ───────────────────────────────────────────────────────────────────
export function ProviderProfileScreen(): React.ReactElement {
  const navigation       = useNavigation<ProfileNav>();
  const route            = useRoute<any>();
  const { providerId }   = route.params as { providerId: string };
  const subscriptionTier = useAuthStore((s) => s.subscriptionTier);
  const isGold           = subscriptionTier === 'gold';

  const [profile,        setProfile]       = useState<ProviderProfile | null>(null);
  const [trust,          setTrust]         = useState<TrustScore | null>(null);
  const [savedId,        setSavedId]       = useState<string | null>(null);
  const [isSaving,       setIsSaving]      = useState(false);
  const [refreshing,     setRefreshing]    = useState(false);
  const [showBreakdown,  setShowBreakdown] = useState(false);
  const [contactLeadCost] = useState(0);  // paise — 0 at launch (admin-configurable)

  const showLeadCost = contactLeadCost > 0; // hidden entirely when 0

  // ── Load all three sections with Promise.allSettled ──────────────────────
  const loadData = useCallback(async () => {
    const [profileRes, trustRes, savedRes] = await Promise.allSettled([
      apiClient.get(`/api/v1/providers/${providerId}`),
      getTrustScore(providerId),
      getSavedProviders(),
    ]);

    if (profileRes.status === 'fulfilled' && profileRes.value.data.success) {
      setProfile(profileRes.value.data.data as ProviderProfile);
    }
    if (trustRes.status === 'fulfilled') {
      setTrust(trustRes.value);
    }
    if (savedRes.status === 'fulfilled') {
      const match = savedRes.value.find((s) => s.providerId === providerId);
      setSavedId(match?.id ?? null);
    }
  }, [providerId]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // ── Save / unsave provider ────────────────────────────────────────────────
  async function handleSaveToggle(): Promise<void> {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (savedId) {
        await unsaveProvider(savedId);
        setSavedId(null);
      } else {
        const saved = await saveProvider(providerId);
        setSavedId(saved.id);
      }
    } catch {
      Alert.alert('Error', 'Could not update saved providers. Try again.');
    } finally {
      setIsSaving(false);
    }
  }

  // ── Contact actions ───────────────────────────────────────────────────────
  function handleContact(type: 'call' | 'message' | 'slot_booking'): void {
    if (!profile) return;
    if (type === 'call') {
      navigation.navigate('ContactCall', {
        providerId,
        providerName:  profile.displayName,
        providerPhone: profile.phone,          // always passed — phone is always visible
        providerScore: trust?.displayScore,
        providerTier:  trust ? trustTierLabel(trust.trustTier) : undefined,
      });
    } else if (type === 'message') {
      navigation.navigate('ContactMessage', {
        providerId,
        providerName:  profile.displayName,
        providerScore: trust?.displayScore,
        providerTier:  trust ? trustTierLabel(trust.trustTier) : undefined,
        // contactEventId omitted — ContactMessageScreen creates the event
      });
    } else {
      // Slot booking — Gold tier + has_calendar (gated here AND on backend)
      if (!isGold || !profile.has_calendar) return;
      navigation.navigate('SlotBookingScreen', {
        providerId,
        providerName: profile.displayName,
      });
    }
  }

  if (!profile || !trust) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading profile…</Text>
      </View>
    );
  }

  const tierColor = trustRingColor(trust.displayScore);
  const tierLabel = trustTierLabel(trust.trustTier);
  const isHighly  = trust.trustTier === 'highly_trusted';

  const badges = [
    { label: 'OTP Verified',  verified: profile.otp_verified },
    { label: 'Geo-Confirmed', verified: profile.geo_confirmed },
    { label: 'Aadhaar',       verified: profile.aadhaar_verified },
    { label: 'Credential',    verified: profile.credential_verified },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <TouchableOpacity
        style={{ padding: 16, paddingBottom: 0 }}
        onPress={() => navigation.goBack()}
      >
        <Text style={{ fontSize: 16, color: '#C8691A', fontFamily: 'PlusJakartaSans-SemiBold' }}>← Back</Text>
      </TouchableOpacity>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SAFFRON} />
        }
      >
        {/* ── Hero: avatar, name, ring ── */}
        <View style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={[styles.avatar, { borderColor: tierColor }]}>
              <Text style={styles.avatarInitial}>
                {profile.displayName.charAt(0).toUpperCase()}
              </Text>
            </View>

            <View style={styles.heroMeta}>
              <Text style={styles.displayName}>{profile.displayName}</Text>
              <Text style={styles.category}>{profile.category}</Text>
              {profile.distance_km != null && (
                <Text style={styles.distance}>{profile.distance_km.toFixed(1)} km away</Text>
              )}
            </View>

            <View style={styles.ringCol}>
              <TrustRingSVG score={trust.displayScore} />
              <Text style={[styles.tierBadge, { color: tierColor }]}>{tierLabel}</Text>
            </View>
          </View>

          {/* Certificate banner — Highly Trusted only */}
          {isHighly && trust.has_certificate && (
            <View style={styles.certBanner}>
              <Text style={styles.certText}>
                ✓ SatvAAh Certificate · {trust.certificate_id}
              </Text>
            </View>
          )}
        </View>

        {/* ── Verification badges ── */}
        <View style={styles.section}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.badgeRow}>
              {badges.map((b) => (
                <View key={b.label}
                  style={[styles.badge, b.verified ? styles.badgeOn : styles.badgeOff]}>
                  <Text style={[styles.badgeText, !b.verified && styles.badgeTextOff]}>
                    {b.verified ? '✓ ' : '○ '}{b.label}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* ── Trust narrative ── */}
        <View style={styles.section}>
          <Text style={styles.narrative}>
            Earned{' '}
            <Text style={{ color: tierColor, fontWeight: '700' }}>
              {trust.displayScore}/100
            </Text>
            {trust.peer_context_percentage > 0
              ? ` · Top ${100 - trust.peer_context_percentage}% of ${profile.category} in ${profile.city}.`
              : '.'}
          </Text>
          <TouchableOpacity onPress={() => setShowBreakdown(true)}>
            <Text style={styles.howLink}>How this score is calculated →</Text>
          </TouchableOpacity>
        </View>

        {/* ── Customer voice bar ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trust Composition</Text>
          <Text style={styles.cvCaption}>
            {trust.rating_count} ratings · Customer voice{' '}
            {Math.round(trust.customerVoiceWeight * 100)}%
          </Text>
          <View style={styles.cvTrack}>
            <View style={[styles.cvVerif, { flex: trust.verification_weight }]} />
            <View style={[styles.cvVoice, { flex: trust.customerVoiceWeight }]} />
          </View>
          <View style={styles.cvLegend}>
            <Text style={styles.cvText}>
              Verification {Math.round(trust.verification_weight * 100)}%
            </Text>
            <Text style={[styles.cvText, { color: VERDIGRIS }]}>
              Customer Voice {Math.round(trust.customerVoiceWeight * 100)}%
            </Text>
          </View>
        </View>

        {/* ── Social proof ── */}
        {trust.peer_context_percentage > 0 && (
          <View style={styles.section}>
            <Text style={styles.socialProof}>
              📍 {trust.peer_context_percentage}% of {profile.category} providers in{' '}
              {profile.city} score lower.
            </Text>
          </View>
        )}

        {/* ── About ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          {!!profile.bio && <Text style={styles.bodyText}>{profile.bio}</Text>}
          {!!profile.famous_for && (
            <View style={styles.famousFor}>
              <Text style={styles.famousForText}>"{profile.famous_for}"</Text>
            </View>
          )}
          {!!profile.experience_years && (
            <Text style={styles.bodyText}>{profile.experience_years} years experience</Text>
          )}
          {(profile.languages?.length ?? 0) > 0 && (
            <Text style={styles.bodyText}>Speaks: {profile.languages.join(', ')}</Text>
          )}
        </View>

        {/* ── Zero commission ── */}
        <View style={styles.zeroCommission}>
          <Text style={styles.zeroText}>
            ₹0 commission — always. Committed in our company constitution.
          </Text>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── Sticky contact bar — ALWAYS VISIBLE ── */}
      <View style={styles.stickyBar}>
        <View style={styles.urgencyRow}>
          <Text style={styles.urgencyText}>
            ⭐ {profile.rating_avg != null ? profile.rating_avg.toFixed(1) : '0.0'} · {profile.rating_count ?? 0} ratings
          </Text>
          <Text style={styles.availText}>
            {profile.availability === 'available'       ? '🟢 Available'
            : profile.availability === 'by_appointment' ? '🟡 By Appointment'
            : '🔴 Busy'}
          </Text>
        </View>

        {/* Lead cost — hidden when 0 */}
        {showLeadCost && (
          <Text style={styles.leadCost}>Uses 1 lead (₹{contactLeadCost / 100})</Text>
        )}

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: VERDIGRIS }]}
            onPress={() => handleContact('call')}
          >
            <Text style={styles.actionBtnText}>📞 Call</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: SAFFRON }]}
            onPress={() => handleContact('message')}
          >
            <Text style={styles.actionBtnText}>💬 Message</Text>
          </TouchableOpacity>

          {/* Book Slot — Gold tier + has_calendar only */}
          {isGold && profile.has_calendar && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: DEEP_INK }]}
              onPress={() => handleContact('slot_booking')}
            >
              <Text style={styles.actionBtnText}>📅 Book</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── TrustBreakdownModal ── */}
      {showBreakdown && (
        <TrustBreakdownModal
          trust={trust}
          providerName={profile.displayName}
          onClose={() => setShowBreakdown(false)}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea:        { flex: 1, backgroundColor: IVORY },
  container:       { flex: 1 },
  scrollContent:   { paddingBottom: 16 },
  loadingContainer:{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: IVORY },
  loadingText:     { fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: MUTED },

  hero:            { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EDE7DB' },
  heroRow:         { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar:          { width: 64, height: 64, borderRadius: 32, borderWidth: 3, backgroundColor: WARM_SAND, alignItems: 'center', justifyContent: 'center' },
  avatarInitial:   { fontFamily: 'PlusJakartaSans-Bold', fontSize: 24, color: DEEP_INK },
  heroMeta:        { flex: 1 },
  displayName:     { fontFamily: 'PlusJakartaSans-Bold', fontSize: 18, color: DEEP_INK },
  category:        { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: MUTED, marginTop: 2 },
  distance:        { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: MUTED, marginTop: 2 },
  ringCol:         { alignItems: 'center', gap: 4 },
  ringCenter:      { alignItems: 'center', justifyContent: 'center' },
  ringScore:       { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14 },
  tierBadge:       { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10 },

  certBanner:      { marginTop: 12, backgroundColor: '#E8F5F3', borderRadius: 8, padding: 10 },
  certText:        { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: VERDIGRIS },

  section:         { margin: 12, backgroundColor: '#fff', borderRadius: 12, padding: 16, shadowColor: DEEP_INK, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  sectionTitle:    { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: DEEP_INK, marginBottom: 8 },
  bodyText:        { fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: DEEP_INK, lineHeight: 20, marginBottom: 4 },

  badgeRow:        { flexDirection: 'row', gap: 8 },
  badge:           { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  badgeOn:         { backgroundColor: '#E8F5F3' },
  badgeOff:        { backgroundColor: '#F0EDE8' },
  badgeText:       { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: VERDIGRIS },
  badgeTextOff:    { color: MUTED },

  narrative:       { fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: DEEP_INK, lineHeight: 22, marginBottom: 8 },
  howLink:         { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: SAFFRON },

  cvCaption:       { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: MUTED, marginBottom: 8 },
  cvTrack:         { height: 10, borderRadius: 5, flexDirection: 'row', overflow: 'hidden', backgroundColor: '#EDE7DB' },
  cvVerif:         { backgroundColor: SAFFRON },
  cvVoice:         { backgroundColor: VERDIGRIS },
  cvLegend:        { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  cvText:          { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: MUTED },

  socialProof:     { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: DEEP_INK, lineHeight: 20 },
  famousFor:       { backgroundColor: WARM_SAND, borderRadius: 8, padding: 10, marginVertical: 6 },
  famousForText:   { fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: DEEP_INK, fontStyle: 'italic' },

  zeroCommission:  { marginHorizontal: 12, marginBottom: 8, padding: 12, backgroundColor: '#FFF8F0', borderRadius: 8, borderLeftWidth: 3, borderLeftColor: SAFFRON },
  zeroText:        { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: SAFFRON },

  stickyBar:       { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#EDE7DB', padding: 12, paddingBottom: 24 },
  urgencyRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  urgencyText:     { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: DEEP_INK },
  availText:       { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: MUTED },
  leadCost:        { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: MUTED, marginBottom: 8, textAlign: 'center' },
  actionRow:       { flexDirection: 'row', gap: 8 },
  actionBtn:       { flex: 1, height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionBtnText:   { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: IVORY },
});
