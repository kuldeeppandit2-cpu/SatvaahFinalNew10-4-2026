/**
 * SatvAAh — apps/mobile/src/screens/provider/CreateProfileStep3GeoScreen.tsx
 * Phase 22 — Step 3: Geo verification.
 *
 * - Google Maps MapView with draggable Marker
 * - GPS button — requests expo-location, accuracy ≤ 50m required
 * - Confirm pin → POST /api/v1/providers/me/verify/geo
 * - Trust score 20 → 40 hero moment
 * - +20 pts for geo verification
 *
 * NOTE: PostGIS backend does ST_MakePoint(lng, lat).
 * We send { lat, lng } as named fields — backend handles column ordering.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 View,
 Text,
 StyleSheet,
 TouchableOpacity,
 ActivityIndicator,
 StatusBar,
 
 Animated,
 Easing,
 Alert,
 Platform,
 Dimensions,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from '../../__stubs__/maps';
import * as Location from 'expo-location';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProviderOnboardingParamList } from '../../navigation/provider.navigator';
import { useProviderStore } from '../../stores/provider.store';
import { providerApi } from '../../api/provider.api';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<ProviderOnboardingParamList, 'CreateProfileStep3Geo'>;

const { height: SCREEN_H } = Dimensions.get('window');

// GPS accuracy threshold per spec — must be ≤ 50m
const MAX_ACCURACY_METERS = 50;

// Default region: Hyderabad (launch city)
const DEFAULT_REGION: Region = {
  latitude: 17.385,
  longitude: 78.4867,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function CreateProfileStep3GeoScreen({
  navigation }: Props) {
  const { draft, profile, setProfile, setIdentity } = useProviderStore();

  // Map state
  const [markerCoord, setMarkerCoord] = useState({
    latitude: draft.areaLat ?? DEFAULT_REGION.latitude,
    longitude: draft.areaLng ?? DEFAULT_REGION.longitude,
  });
  const [mapRegion, setMapRegion] = useState<Region>({
    ...DEFAULT_REGION,
    latitude: draft.areaLat ?? DEFAULT_REGION.latitude,
    longitude: draft.areaLng ?? DEFAULT_REGION.longitude,
  });

  // GPS state
  const [gpsLoading, setGpsLoading] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [accuracyOk, setAccuracyOk] = useState(false);
  const [gpsUsed, setGpsUsed] = useState(false);

  // Confirm state
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Hero animation
  const heroFade = useRef(new Animated.Value(0)).current;
  const ringAnim = useRef(new Animated.Value(0)).current; // 0→1 represents 20→40
  const scoreAnim = useRef(new Animated.Value(20)).current;

  const mapRef = useRef<MapView>(null);

  // ─── GPS ────────────────────────────────────────────────────────────────────

  const handleGPS = useCallback(async () => {
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location Permission',
          'SatvAAh needs location permission to verify your service area. Please enable it in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude, accuracy: acc } = loc.coords;
      const accRounded = Math.round(acc ?? 999);

      setMarkerCoord({ latitude, longitude });
      setAccuracy(accRounded);
      setAccuracyOk(accRounded <= MAX_ACCURACY_METERS);
      setGpsUsed(true);

      mapRef.current?.animateToRegion(
        {
          latitude,
          longitude,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        },
        600
      );
    } catch {
      Alert.alert('Error', 'Could not get location. Please drag the pin manually.');
    } finally {
      setGpsLoading(false);
    }
  }, []);

  // ─── Confirm ────────────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const result = await providerApi.verifyGeo({
        lat: markerCoord.latitude,
        lng: markerCoord.longitude,
        accuracy: accuracy ?? 999,
      });

      // Update store with new profile data
      if (profile) {
        setProfile({
          ...profile,
          // trustScore updated via WebSocket/trust SQS async — not returned from geo verify
          trustTier: result.trustTier as any,
          isGeoVerified: true,
        });
      }
      setIdentity({
        areaLat: markerCoord.latitude,
        areaLng: markerCoord.longitude,
      });

      setConfirmed(true);
      triggerHero();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Geo verification failed.';
      Alert.alert('Error', msg);
    } finally {
      setConfirming(false);
    }
  };

  const triggerHero = () => {
    Animated.parallel([
      Animated.timing(heroFade, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(ringAnim, {
        toValue: 1,
        duration: 1600,
        delay: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(scoreAnim, {
        toValue: 40,
        duration: 1600,
        delay: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  };

  const handleDone = () => {
    navigation.navigate('FCMPermission');
  };

  // ─── Hero ────────────────────────────────────────────────────────────────────

  if (confirmed) {
    return (
      <SafeAreaView style={styles.heroSafe}>
      <ScreenHeader title="Service Area" onBack={() => navigation.goBack()} />
        <StatusBar barStyle="light-content" backgroundColor="#1C1C2E" />
        <Animated.View style={[styles.heroContainer, { opacity: heroFade }]}>
          {/* Trust Ring */}
          <View style={styles.ringOuter}>
            <Animated.View
              style={[
                styles.ringInner,
                {
                  borderColor: ringAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['#C8691A', '#C8691A'],
                  }),
                  shadowColor: '#C8691A',
                  shadowOpacity: ringAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.2, 0.6],
                  }) as any,
                },
              ]}
            >
              <Animated.Text style={styles.ringScore}>
                {scoreAnim.interpolate({
                  inputRange: [20, 40],
                  outputRange: ['20', '40'],
                }) as unknown as string}
              </Animated.Text>
              <Text style={styles.ringScoreLabel}>/100</Text>
              <Text style={styles.tierBadgeHero}>Basic</Text>
            </Animated.View>

            {/* +20 badge */}
            <Animated.View
              style={[
                styles.deltaBadge,
                {
                  opacity: ringAnim,
                  transform: [
                    {
                      scale: ringAnim.interpolate({
                        inputRange: [0, 0.5, 1],
                        outputRange: [0, 1.2, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Text style={styles.deltaBadgeText}>+20</Text>
            </Animated.View>
          </View>

          <Text style={styles.heroEmoji}>📍</Text>
          <Text style={styles.heroHeadline}>Location verified!</Text>
          <Text style={styles.heroSubline}>
            You now rank higher in search results near your location.
          </Text>

          {/* What's next */}
          <View style={styles.whatsNextWrap}>
            <Text style={styles.whatsNextHeader}>Next milestones</Text>
            <NextMilestone score={60} label="Add Aadhaar · Reach Trusted tier 🏅" />
            <NextMilestone score={80} label="Full verification · Earn Certificate 🏆" />
          </View>

          <TouchableOpacity
            style={styles.doneBtn}
            onPress={handleDone}
            activeOpacity={0.85}
          >
            <Text style={styles.doneBtnText}>Continue →</Text>
          </TouchableOpacity>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // ─── Map Screen ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />

      {/* Progress */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: '100%' }]} />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.stepLabel}>Step 3 of 3 · Optional (but recommended)</Text>
          <Text style={styles.headerTitle}>Pin your exact location</Text>
        </View>
        <View style={styles.plusBadge}>
          <Text style={styles.plusBadgeText}>+20 pts</Text>
        </View>
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          provider={PROVIDER_GOOGLE}
          initialRegion={mapRegion}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
        >
          <Marker
            coordinate={markerCoord}
            draggable
            onDragEnd={(e) => {
              setMarkerCoord(e.nativeEvent.coordinate);
              setAccuracy(null);   // manual drag — no GPS accuracy
              setAccuracyOk(true); // manual pin always allowed
            }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.markerPin}>
              <View style={styles.markerPinHead} />
              <View style={styles.markerPinTip} />
            </View>
          </Marker>
        </MapView>

        {/* GPS Accuracy badge */}
        {accuracy !== null && (
          <View
            style={[
              styles.accuracyBadge,
              accuracyOk ? styles.accuracyOk : styles.accuracyBad,
            ]}
          >
            <Text style={styles.accuracyText}>
              {accuracyOk ? '✓' : '⚠'} GPS accuracy: ±{accuracy}m
              {!accuracyOk && ` (need ≤${MAX_ACCURACY_METERS}m)`}
            </Text>
          </View>
        )}
      </View>

      {/* Bottom card */}
      <View style={styles.bottomCard}>
        <Text style={styles.bottomHint}>
          Drag the pin to your exact location, or use GPS for best accuracy.
        </Text>

        {/* GPS button */}
        <TouchableOpacity
          style={[styles.gpsBtn, gpsLoading && styles.gpsBtnLoading]}
          onPress={handleGPS}
          disabled={gpsLoading}
          activeOpacity={0.8}
        >
          {gpsLoading ? (
            <ActivityIndicator color="#2E7D72" size="small" />
          ) : (
            <>
              <Text style={styles.gpsBtnIcon}>🎯</Text>
              <Text style={styles.gpsBtnText}>Use my GPS location</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Confirm button */}
        <TouchableOpacity
          style={[styles.confirmBtn, (!accuracyOk || confirming) && styles.confirmBtnLoading]}
          onPress={handleConfirm}
          disabled={!accuracyOk || confirming}
          activeOpacity={0.85}
        >
          {confirming ? (
            <ActivityIndicator color="#FAF7F0" />
          ) : (
            <Text style={styles.confirmBtnText}>Confirm Location · +20 points</Text>
          )}
        </TouchableOpacity>

        {/* Skip */}
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => navigation.navigate('FCMPermission')}
          disabled={confirming}
        >
          <Text style={styles.skipBtnText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NextMilestone({ score, label }: { score: number; label: string }) {
  return (
    <View style={styles.milestoneRow}>
      <View style={styles.milestoneDot} />
      <View style={styles.milestoneContent}>
        <Text style={styles.milestoneScore}>{score}</Text>
        <Text style={styles.milestoneLabel}>{label}</Text>
      </View>
    </View>
  );
}

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  stepLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11.5,
    color: '#9B9390',
    marginBottom: 2,
  },
  headerTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 18,
    color: '#1C1C2E',
  },
  plusBadge: {
    backgroundColor: '#FEF3E8',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#C8691A40',
  },
  plusBadgeText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
    color: '#C8691A',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  markerPin: {
    alignItems: 'center',
  },
  markerPinHead: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#C8691A',
    borderWidth: 3,
    borderColor: '#FAF7F0',
    shadowColor: '#1C1C2E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  markerPinTip: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#C8691A',
    marginTop: -2,
  },
  accuracyBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  accuracyOk: {
    backgroundColor: '#2E7D72',
  },
  accuracyBad: {
    backgroundColor: '#C0392B',
  },
  accuracyText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
    color: '#FFFFFF',
  },
  bottomCard: {
    backgroundColor: '#FAF7F0',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    gap: 10,
    shadowColor: '#1C1C2E',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 8,
  },
  bottomHint: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13.5,
    color: '#1C1C2E',
    textAlign: 'center',
    marginBottom: 4,
  },
  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#2E7D72',
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: '#EDF5F4',
  },
  gpsBtnLoading: {
    opacity: 0.7,
  },
  gpsBtnIcon: {
    fontSize: 18,
  },
  gpsBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 14.5,
    color: '#2E7D72',
  },
  confirmBtn: {
    backgroundColor: '#C8691A',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: '#C8691A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  confirmBtnLoading: {
    opacity: 0.7,
  },
  confirmBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 15.5,
    color: '#FAF7F0',
  },
  skipBtn: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  skipBtnText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13.5,
    color: '#9B9390',
  },

  // ─── Hero ────────────────────────────────────────────────────────────────

  heroContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 20,
    gap: 0,
  },
  ringOuter: {
    position: 'relative',
    marginBottom: 4,
  },
  ringInner: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 14,
    borderColor: '#C8691A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 24,
    elevation: 12,
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
    fontSize: 11,
    color: '#C8691A',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  deltaBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#2E7D72',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 3,
    borderColor: '#1C1C2E',
  },
  deltaBadgeText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
    color: '#FFFFFF',
  },
  heroEmoji: {
    fontSize: 36,
    marginTop: 20,
    marginBottom: 6,
  },
  heroHeadline: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 28,
    color: '#FAF7F0',
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSubline: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 14.5,
    color: '#9B96A0',
    textAlign: 'center',
    marginBottom: 24,
  },
  whatsNextWrap: {
    width: '100%',
    backgroundColor: '#25253A',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 24,
  },
  whatsNextHeader: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
    color: '#6B6878',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  milestoneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#C8691A40',
    borderWidth: 2,
    borderColor: '#C8691A',
  },
  milestoneContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  milestoneScore: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 16,
    color: '#C8691A',
    width: 30,
  },
  milestoneLabel: {
    flex: 1,
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13,
    color: '#B0AABC',
    lineHeight: 18,
  },
  doneBtn: {
    width: '100%',
    backgroundColor: '#C8691A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#C8691A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  doneBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 16,
    color: '#FAF7F0',
  },
});
