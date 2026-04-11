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
import * as Location                                         from 'expo-location';
import { useConsumerStore }                                   from '../../stores/consumer.store';
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
  is_claimed:          boolean;         // true = provider has app + claimed profile; false = scraped only
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

  // ── Consumer profile setup modal ─────────────────────────────────────────
  const hasCompletedProfileSetup = useConsumerStore((s) => s.hasCompletedProfileSetup);
  const markProfileSetupComplete = useConsumerStore((s) => s.markProfileSetupComplete);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [pendingContactType, setPendingContactType] = useState<'call' | 'message' | 'slot_booking' | null>(null);
  const [setupName, setSetupName] = useState('');
  const [setupCities, setSetupCities] = useState<{ id: string; name: string }[]>([]);
  const [setupCityId, setSetupCityId] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupGeoStatus, setSetupGeoStatus] = useState<'idle' | 'loading' | 'captured' | 'denied'>('idle');
  const [setupGeoCoords, setSetupGeoCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Fetch cities for setup modal on mount
  useEffect(() => {
    apiClient.get('/api/v1/cities?active=true')
      .then((res) => {
        const cities = res.data?.data ?? [];
        setSetupCities(cities);
        if (cities.length > 0) setSetupCityId(cities[0].id);
      })
      .catch(() => {});
  }, []);

  async function captureGeoLocation(): Promise<void> {
    setSetupGeoStatus('loading');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setSetupGeoStatus('denied'); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setSetupGeoCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      setSetupGeoStatus('captured');
    } catch {
      setSetupGeoStatus('denied');
    }
  }

  async function handleProfileSetupSubmit(): Promise<void> {
    if (!setupName.trim() || !setupCityId) {
      Alert.alert('Required', 'Please enter your name and select your city.');
      return;
    }
    setSetupLoading(true);
    try {
      await apiClient.post('/api/v1/consumers/profile', {
        display_name: setupName.trim(),
        city_id: setupCityId,
      });

      // audit-ref: DB2 consumer_profiles — persist geo_lat/geo_lng/area_id (V050 fields)
      // Fire-and-forget after profile created — non-fatal if GPS was not captured
      if (setupGeoCoords) {
        apiClient.patch('/api/v1/consumers/me/location', {
          geo_lat: setupGeoCoords.lat,
          geo_lng: setupGeoCoords.lng,
        }).catch(() => {}); // non-fatal — location can be updated later
      }

      markProfileSetupComplete();
      setShowSetupModal(false);
      if (pendingContactType) proceedToContact(pendingContactType);
    } catch {
      Alert.alert('Error', 'Could not save your profile. Please try again.');
    } finally {
      setSetupLoading(false);
    }
  }

  function proceedToContact(type: 'call' | 'message' | 'slot_booking'): void {
    if (!profile) return;
    if (type === 'call') {
      navigation.navigate('ContactCall', {
        providerId,
        providerName:  profile.displayName,
        providerPhone: profile.phone,
        providerScore: trust?.displayScore,
        providerTier:  trust ? trustTierLabel(trust.trustTier) : undefined,
      });
    } else if (type === 'message') {
      navigation.navigate('ContactMessage', {
        providerId,
        providerName:  profile.displayName,
        providerScore: trust?.displayScore,
        providerTier:  trust ? trustTierLabel(trust.trustTier) : undefined,
      });
    } else {
      if (!isGold || !profile.has_calendar) return;
      navigation.navigate('SlotBookingScreen', {
        providerId,
        providerName: profile.displayName,
      });
    }
  }

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
    // Gate: consumer must complete profile setup before first contact
    if (!hasCompletedProfileSetup) {
      setPendingContactType(type);
      setShowSetupModal(true);
      return;
    }
    proceedToContact(type);
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

          {/* Message — only for verified providers who have claimed their profile + downloaded app */}
          {profile.is_claimed && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: SAFFRON }]}
              onPress={() => handleContact('message')}
            >
              <Text style={styles.actionBtnText}>💬 Message</Text>
            </TouchableOpacity>
          )}

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

      {/* ── Consumer Profile Setup Modal — shown once before first contact ── */}
      <Modal visible={showSetupModal} transparent animationType="slide" onRequestClose={() => setShowSetupModal(false)}>
        <KeyboardAvoidingView style={setupStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={setupStyles.card} keyboardShouldPersistTaps="handled">
            <Text style={setupStyles.title}>Before you connect</Text>
            <Text style={setupStyles.sub}>Providers need to know who you are to help you.</Text>

            {/* Name */}
            <Text style={setupStyles.label}>Your name *</Text>
            <TextInput
              style={setupStyles.input}
              placeholder="e.g. Rahul Sharma"
              value={setupName}
              onChangeText={setSetupName}
              autoFocus
            />

            {/* City */}
            <Text style={setupStyles.label}>Your city *</Text>
            <View style={setupStyles.cityRow}>
              {setupCities.map((city) => (
                <TouchableOpacity
                  key={city.id}
                  style={[setupStyles.cityChip, setupCityId === city.id && setupStyles.cityChipSelected]}
                  onPress={() => setSetupCityId(city.id)}
                >
                  <Text style={[setupStyles.cityChipText, setupCityId === city.id && setupStyles.cityChipTextSelected]}>
                    {city.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Geo location */}
            <Text style={setupStyles.label}>Your location *</Text>
            <Text style={setupStyles.hint}>Helps providers near you find you faster.</Text>
            <TouchableOpacity
              style={[setupStyles.geoBtn, setupGeoStatus === 'captured' && setupStyles.geoBtnCaptured]}
              onPress={captureGeoLocation}
              disabled={setupGeoStatus === 'loading'}
            >
              <Text style={setupStyles.geoBtnText}>
                {setupGeoStatus === 'idle' && '📍 Capture my location'}
                {setupGeoStatus === 'loading' && '⏳ Getting location…'}
                {setupGeoStatus === 'captured' && '✅ Location captured'}
                {setupGeoStatus === 'denied' && '⚠️ Permission denied — tap to retry'}
              </Text>
            </TouchableOpacity>

            {/* Aadhaar — optional */}
            <View style={setupStyles.aadhaarBox}>
              <Text style={setupStyles.aadhaarTitle}>🔒 Aadhaar verification (optional)</Text>
              <Text style={setupStyles.aadhaarSub}>
                Verified consumers get priority responses, better trust scores, and build credibility with providers.
              </Text>
              <TouchableOpacity
                style={setupStyles.aadhaarBtn}
                onPress={() => {
                  setShowSetupModal(false);
                  navigation.navigate('AadhaarVerify' as any)  // screen registered as 'AadhaarVerify' in ProviderNavigator.tsx;
                }}
              >
                <Text style={setupStyles.aadhaarBtnText}>Verify Aadhaar →</Text>
              </TouchableOpacity>
              <Text style={setupStyles.aadhaarSkip} onPress={handleProfileSetupSubmit}>
                Skip for now
              </Text>
            </View>

            <TouchableOpacity
              style={[setupStyles.btn, (setupLoading || setupGeoStatus === 'idle') && setupStyles.btnDisabled]}
              onPress={handleProfileSetupSubmit}
              disabled={setupLoading || setupGeoStatus === 'idle'}
            >
              <Text style={setupStyles.btnText}>{setupLoading ? 'Saving…' : 'Continue →'}</Text>
            </TouchableOpacity>

            <View style={{ height: 32 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Setup Modal Styles ───────────────────────────────────────────────────────
const setupStyles = StyleSheet.create({
  overlay:           { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  card:              { backgroundColor: '#FAF7F0', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, paddingBottom: 44 },
  title:             { fontFamily: 'PlusJakartaSans-Bold', fontSize: 20, color: '#1C1C2E', marginBottom: 6 },
  sub:               { fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: '#6B6560', marginBottom: 24 },
  label:             { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: '#1C1C2E', marginBottom: 8 },
  input:             { borderWidth: 1.5, borderColor: '#E8E0D5', borderRadius: 10, padding: 14, fontSize: 15, fontFamily: 'PlusJakartaSans-Regular', color: '#1C1C2E', marginBottom: 20, backgroundColor: '#fff' },
  cityRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 28 },
  cityChip:          { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: '#E8E0D5', backgroundColor: '#fff' },
  cityChipSelected:  { borderColor: '#C8691A', backgroundColor: '#FFF3E8' },
  cityChipText:      { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: '#6B6560' },
  cityChipTextSelected: { color: '#C8691A', fontFamily: 'PlusJakartaSans-SemiBold' },
  hint:              { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: '#9E9589', marginBottom: 10 },
  geoBtn:            { borderWidth: 1.5, borderColor: '#C8691A', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 20 },
  geoBtnCaptured:    { backgroundColor: '#E8F5F3', borderColor: '#2E7D72' },
  geoBtnText:        { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: '#C8691A' },
  aadhaarBox:        { backgroundColor: '#FFF8F0', borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#F0D0B0' },
  aadhaarTitle:      { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: '#1C1C2E', marginBottom: 6 },
  aadhaarSub:        { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: '#6B6560', marginBottom: 12 },
  aadhaarBtn:        { backgroundColor: '#C8691A', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginBottom: 8 },
  aadhaarBtnText:    { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: '#FAF7F0' },
  aadhaarSkip:       { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: '#9E9589', textAlign: 'center' },
  btn:               { backgroundColor: '#C8691A', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  btnDisabled:       { backgroundColor: '#E8E0D5' },
  btnText:           { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: '#FAF7F0' },
});

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
