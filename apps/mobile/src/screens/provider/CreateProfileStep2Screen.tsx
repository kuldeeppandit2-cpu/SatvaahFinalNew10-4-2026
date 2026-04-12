/**
 * SatvAAh — apps/mobile/src/screens/provider/CreateProfileStep2Screen.tsx
 * Phase 22 — Step 2: Identity — display name, city, area.
 *
 * After submit:
 *   → POST /api/v1/providers/register
 *   → PROFILE IS LIVE. Trust Score: 20. Tier: Basic.
 *   → Hero moment: ring animates 0→20 in saffron. "🎉 You are live!"
 *   → Shows real search_intents: "6 people searched for plumbers near Banjara Hills in last 10 min"
 *   → Auto-advances to Step 3 (geo) after 4s or on "Boost further →" CTA
 */

import React, { useEffect, useState, useRef } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 View,
 Text,
 StyleSheet,
 TextInput,
 TouchableOpacity,
 ScrollView,
 ActivityIndicator,
 StatusBar,
 
 KeyboardAvoidingView,
 Platform,
 Animated,
 Easing,
 Alert,
 FlatList,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProviderOnboardingParamList } from '../../navigation/provider.navigator';
import { useProviderStore, tierColor } from '../../stores/provider.store';
import { providerApi, type City, type NearbySearchIntent } from '../../api/provider.api';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<ProviderOnboardingParamList, 'CreateProfileStep2'>;

// ─── Component ────────────────────────────────────────────────────────────────

export default function CreateProfileStep2Screen({
  navigation }: Props) {
  const {
    draft,
    cities,
    profile,
    setCities,
    setIdentity,
    setProfile,
    setLoading,
    isLoading,
  } = useProviderStore();

  const [displayName, setDisplayName] = useState(draft.displayName);
  const [selectedCity, setSelectedCity] = useState<City | null>(
    cities.find((c) => c.id === draft.cityId) ?? null
  );
  const [areaInput,    setAreaInput]    = useState(draft.areaName);
  // V050 fields — optional at registration, editable later in P11
  const [addressInput, setAddressInput] = useState('');
  const [pincodeInput, setPincodeInput] = useState('');
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Hero state
  const [heroVisible, setHeroVisible] = useState(false);
  const [searchIntents, setSearchIntents] = useState<NearbySearchIntent[]>([]);

  // Trust ring animation
  const scoreAnim = useRef(new Animated.Value(0)).current;
  const ringAnim = useRef(new Animated.Value(0)).current;
  const heroFade = useRef(new Animated.Value(0)).current;
  const intentsAnim = useRef(new Animated.Value(0)).current;

  // Load cities on mount
  useEffect(() => {
    if (cities.length === 0) {
      providerApi
        .getActiveCities()
        .then(setCities)
        .catch(() => {}); // fail silently — user can retry
    }
  }, []);

  const isValid =
    displayName.trim().length >= 2 &&
    !!selectedCity &&
    areaInput.trim().length >= 2;

  const handleSubmit = async () => {
    if (!isValid || !draft.listingType || !draft.taxonomyNodeId) return;
    setSubmitting(true);
    try {
      const p = await providerApi.registerProvider({
        listingType:    draft.listingType,
        tab:            draft.tab!,
        taxonomyNodeId: draft.taxonomyNodeId,
        displayName:    displayName.trim(),
        cityId:         selectedCity!.id,
        areaName:       areaInput.trim(),
        areaLat:        draft.areaLat ?? undefined,
        areaLng:        draft.areaLng ?? undefined,
        // V050 fields — addressLine and pincode collected in P5
        // These can be empty at register time; provider fills them in P11 edit screen
        addressLine:    addressInput.trim() || undefined,
        pincode:        pincodeInput.trim() || undefined,
      });
      setProfile(p);
      setIdentity({
        displayName: displayName.trim(),
        cityId: selectedCity!.id,
        cityName: selectedCity!.name,
        areaName: areaInput.trim(),
      });
      triggerHero();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Try again.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const triggerHero = () => {
    setHeroVisible(true);

    // Animate ring 0 → 20 (out of 100 → degrees = 20/100 * 360)
    Animated.timing(ringAnim, {
      toValue: 1,
      duration: 1400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // Count up score 0 → 20
    Animated.timing(scoreAnim, {
      toValue: 20,
      duration: 1400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // Fade in hero content
    Animated.timing(heroFade, {
      toValue: 1,
      duration: 600,
      delay: 200,
      useNativeDriver: true,
    }).start();

    // Load and show intents after 1.6s
    setTimeout(async () => {
      const intents = await providerApi.getNearbySearchIntents(
        draft.areaLat ?? 17.385,  // fallback to Hyderabad city center
        draft.areaLng ?? 78.4867,
        draft.tab ?? undefined
      );
      setSearchIntents(intents);
      Animated.timing(intentsAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }, 1600);
  };

  const handleBoostFurther = () => {
    navigation.navigate('CreateProfileStep3Geo');
  };

  // ─── Hero screen ────────────────────────────────────────────────────────────

  if (heroVisible) {
    const scoreDisplay = scoreAnim.interpolate({
      inputRange: [0, 20],
      outputRange: [0, 20],
    });

    const RING_RADIUS = 72;
    const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

    const strokeDashoffset = ringAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [CIRCUMFERENCE, CIRCUMFERENCE * (1 - 20 / 100)],
    });

    return (
      <SafeAreaView style={styles.heroSafe}>
      <ScreenHeader title="Your Location" onBack={() => navigation.goBack()} />
        <StatusBar barStyle="light-content" backgroundColor="#1C1C2E" />
        <ScrollView
          contentContainerStyle={styles.heroContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* Ring */}
          <View style={styles.ringWrap}>
            <svg_ring
              radius={RING_RADIUS}
              circumference={CIRCUMFERENCE}
              strokeDashoffset={strokeDashoffset}
              scoreAnim={scoreAnim}
            />
          </View>

          {/* Animated score ring using RN primitives */}
          <View style={styles.ringContainer}>
            {/* Background ring */}
            <View style={styles.ringBg} />
            {/* Score display */}
            <Animated.Text style={styles.ringScore}>
              {scoreAnim.interpolate({
                inputRange: [0, 20],
                outputRange: ['0', '20'],
              }) as unknown as string}
            </Animated.Text>
            <Text style={styles.ringScoreLabel}>/100</Text>
            <Text style={styles.tierBadgeHero}>Basic</Text>
          </View>

          <Animated.View style={[styles.heroBody, { opacity: heroFade }]}>
            <Text style={styles.heroEmoji}>🎉</Text>
            <Text style={styles.heroHeadline}>You are live!</Text>
            <Text style={styles.heroSubline}>
              Consumers can now find you on SatvAAh
            </Text>

            {/* Search intents */}
            <Animated.View style={[styles.intentsWrap, { opacity: intentsAnim }]}>
              {searchIntents.length > 0 ? (
                <>
                  <Text style={styles.intentsHeader}>🔍 Real demand near you</Text>
                  {searchIntents.slice(0, 3).map((intent, i) => (
                    <View key={intent.id ?? i} style={styles.intentRow}>
                      <View style={styles.intentDot} />
                      <Text style={styles.intentText}>
                        <Text style={styles.intentCount}>{intent.search_count} people </Text>
                        searched for{' '}
                        <Text style={styles.intentCategory}>{intent.category}</Text>
                        {intent.area ? ` near ${intent.area}` : ''} in the last{' '}
                        {intent.window_minutes} min
                      </Text>
                    </View>
                  ))}
                </>
              ) : (
                <View style={styles.intentPlaceholder}>
                  <Text style={styles.intentPlaceholderText}>
                    🌱 You're among the first providers here. Early movers rank highest.
                  </Text>
                </View>
              )}
            </Animated.View>

            {/* Boost CTA */}
            <View style={styles.heroActions}>
              <TouchableOpacity
                style={styles.boostBtn}
                onPress={handleBoostFurther}
                activeOpacity={0.85}
              >
                <Text style={styles.boostBtnText}>Add location → +20 points</Text>
                <Text style={styles.boostBtnSub}>
                  Reach score 40 · Rank higher in search
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.skipGeoBtn}
                onPress={() => navigation.navigate('FCMPermission')}
                activeOpacity={0.7}
              >
                <Text style={styles.skipGeoText}>Do this later</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Form ────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: '66%' }]} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Step indicator */}
          <View style={styles.stepRow}>
            <Text style={styles.stepLabel}>Step 2 of 3</Text>
            <Text style={styles.stepHint}>Your profile details</Text>
          </View>

          <Text style={styles.title}>Tell consumers who you are</Text>

          {/* Category context chip */}
          {draft.categoryName && (
            <View style={styles.contextChip}>
              <Text style={styles.contextChipText}>
                {draft.categoryName}
                {draft.subCategoryName ? ` › ${draft.subCategoryName}` : ''}
              </Text>
            </View>
          )}

          {/* Display name */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Display Name *</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={
                draft.listingType === 'establishment' || draft.listingType === 'product_brand'
                  ? 'e.g. Ramu di Hatti, A-Z Milk'
                  : 'e.g. Ramesh Kumar, Dr. Priya Singh'
              }
              placeholderTextColor="#B0A9A0"
              autoCapitalize="words"
              maxLength={80}
              returnKeyType="next"
            />
            {displayName.length > 0 && displayName.trim().length < 2 && (
              <Text style={styles.fieldError}>Name must be at least 2 characters</Text>
            )}
          </View>

          {/* City picker */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>City *</Text>
            <TouchableOpacity
              style={[styles.input, styles.pickerInput]}
              onPress={() => setShowCityPicker((v) => !v)}
            >
              <Text
                style={[
                  styles.pickerText,
                  !selectedCity && styles.pickerPlaceholder,
                ]}
              >
                {selectedCity ? selectedCity.name : 'Select city'}
              </Text>
              <Text style={styles.pickerChevron}>{showCityPicker ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {showCityPicker && (
              <View style={styles.cityDropdown}>
                {cities.length === 0 ? (
                  <ActivityIndicator color="#C8691A" style={{ padding: 16 }} />
                ) : (
                  cities.map((city) => (
                    <TouchableOpacity
                      key={city.id}
                      style={[
                        styles.cityOption,
                        selectedCity?.id === city.id && styles.cityOptionSelected,
                      ]}
                      onPress={() => {
                        setSelectedCity(city);
                        setShowCityPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.cityOptionText,
                          selectedCity?.id === city.id && styles.cityOptionTextSelected,
                        ]}
                      >
                        {city.name}
                      </Text>
                      <Text style={styles.cityState}>{city.state}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}
          </View>

          {/* Area input */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Area / Locality *</Text>
            <TextInput
              style={styles.input}
              value={areaInput}
              onChangeText={setAreaInput}
              placeholder="e.g. Banjara Hills, Kondapur, Jubilee Hills"
              placeholderTextColor="#B0A9A0"
              autoCapitalize="words"
              maxLength={100}
              returnKeyType="done"
            />
            <Text style={styles.fieldHint}>
              Where do you offer your services? Consumers will find you based on this.
            </Text>
          </View>

          {/* Visibility note */}
          <View style={styles.visibilityNote}>
            <Text style={styles.visibilityIcon}>🔍</Text>
            <Text style={styles.visibilityText}>
              After this step, your profile goes{' '}
              <Text style={styles.visibilityHighlight}>live immediately</Text>{' '}
              with a Trust Score of 20. Add your location in the next step to reach 40.
            </Text>
          </View>

          {/* Submit button */}
          <TouchableOpacity
            style={[styles.submitBtn, (!isValid || submitting) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!isValid || submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color="#FAF7F0" />
            ) : (
              <Text style={styles.submitBtnText}>Go Live 🚀</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Dummy component reference (SVG not used — pure RN ring below)
const svg_ring = () => null;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FAF7F0',
  },
  heroSafe: {
    flex: 1,
    backgroundColor: '#1C1C2E',
  },
  progressBar: {
    height: 3,
    backgroundColor: '#F0E4CC',
  },
  progressFill: {
    height: 3,
    backgroundColor: '#C8691A',
    borderRadius: 2,
  },
  container: {
    paddingHorizontal: 20,
    paddingBottom: 48,,
    flexGrow: 1,
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 14,
    paddingBottom: 8,
  },
  stepLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
    color: '#C8691A',
    letterSpacing: 0.5,
  },
  stepHint: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    color: '#9B9390',
  },
  title: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 22,
    color: '#1C1C2E',
    marginBottom: 16,
  },
  contextChip: {
    backgroundColor: '#FEF3E8',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  contextChipText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12.5,
    color: '#C8691A',
  },
  field: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13.5,
    color: '#1C1C2E',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E0D6C8',
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 15,
    color: '#1C1C2E',
  },
  pickerInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 15,
    color: '#1C1C2E',
    flex: 1,
  },
  pickerPlaceholder: {
    color: '#B0A9A0',
  },
  pickerChevron: {
    fontSize: 11,
    color: '#9B9390',
  },
  cityDropdown: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E0D6C8',
    marginTop: 4,
    maxHeight: 200,
    overflow: 'hidden',
  },
  cityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E8DF',
  },
  cityOptionSelected: {
    backgroundColor: '#FEF3E8',
  },
  cityOptionText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 14,
    color: '#1C1C2E',
  },
  cityOptionTextSelected: {
    color: '#C8691A',
  },
  cityState: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    color: '#9B9390',
  },
  fieldError: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    color: '#C0392B',
    marginTop: 4,
  },
  fieldHint: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    color: '#9B9390',
    marginTop: 4,
  },
  visibilityNote: {
    flexDirection: 'row',
    backgroundColor: '#EDF5F4',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    marginBottom: 24,
    alignItems: 'flex-start',
  },
  visibilityIcon: {
    fontSize: 16,
  },
  visibilityText: {
    flex: 1,
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13.5,
    color: '#2E5C57',
    lineHeight: 20,
  },
  visibilityHighlight: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#2E7D72',
  },
  submitBtn: {
    backgroundColor: '#C8691A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#C8691A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  submitBtnDisabled: {
    opacity: 0.45,
    shadowOpacity: 0,
  },
  submitBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 17,
    color: '#FAF7F0',
    letterSpacing: 0.3,
  },

  // ─── Hero ────────────────────────────────────────────────────────────────

  heroContainer: {
    padding: 28,
    alignItems: 'center',
    paddingBottom: 60,
  },
  ringContainer: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'transparent',
    borderWidth: 14,
    borderColor: '#C8691A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    marginBottom: 8,
    shadowColor: '#C8691A',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
  ringBg: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 90,
    borderWidth: 14,
    borderColor: '#2E2E42',
  },
  ringScore: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 48,
    color: '#C8691A',
    lineHeight: 54,
  },
  ringScoreLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 16,
    color: '#6B6878',
    marginTop: -4,
  },
  tierBadgeHero: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
    color: '#C8691A',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  heroBody: {
    alignItems: 'center',
    width: '100%',
  },
  heroEmoji: {
    fontSize: 40,
    marginTop: 24,
    marginBottom: 8,
  },
  heroHeadline: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 30,
    color: '#FAF7F0',
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSubline: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 15,
    color: '#9B96A0',
    textAlign: 'center',
    marginBottom: 28,
  },
  intentsWrap: {
    width: '100%',
    backgroundColor: '#25253A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 28,
    gap: 10,
  },
  intentsHeader: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13,
    color: '#FAF7F0',
    marginBottom: 4,
  },
  intentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  intentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#C8691A',
    marginTop: 6,
  },
  intentText: {
    flex: 1,
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13,
    color: '#B0AABC',
    lineHeight: 20,
  },
  intentCount: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: '#FAF7F0',
  },
  intentCategory: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#C8691A',
  },
  intentPlaceholder: {
    padding: 4,
  },
  intentPlaceholderText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13,
    color: '#9B96A0',
    lineHeight: 20,
  },
  heroActions: {
    width: '100%',
    gap: 12,
  },
  boostBtn: {
    backgroundColor: '#C8691A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 3,
    shadowColor: '#C8691A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  boostBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 16,
    color: '#FAF7F0',
  },
  boostBtnSub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    color: '#F5D5B8',
  },
  skipGeoBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  skipGeoText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 14,
    color: '#6B6878',
  },
  ringWrap: {
    display: 'none', // SVG ring placeholder — not used (RN native ring used)
  },
});
