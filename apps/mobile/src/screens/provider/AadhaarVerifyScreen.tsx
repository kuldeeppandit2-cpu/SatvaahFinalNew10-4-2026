/**
 * AadhaarVerifyScreen.tsx
 * Phase 24 — Provider Verification
 *
 * DigiLocker OAuth2 PKCE flow for Aadhaar-linked identity verification.
 * Privacy statement (5 mandatory points) → DigiLocker launch → callback
 * → +25 pts hero moment → trust ring animates 40 → 65 → "Tier: Trusted"
 *
 * CRITICAL: Aadhaar number is NEVER stored anywhere (DB, logs, Redis, S3).
 * Only bcrypt(digilocker_uid + per_record_salt, cost=12) = 72 bytes stored.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Linking,
  Alert,
  Platform,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { useAuthStore } from '../../stores/auth.store';
import { useProviderStore } from '../../stores/provider.store';
import { apiClient } from '../../api/client';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { ProviderStackParamList } from '../../navigation/ProviderStack';

// ─── Types ────────────────────────────────────────────────────────────────────

type NavProp = NativeStackNavigationProp<ProviderStackParamList, 'AadhaarVerify'>;

type VerifyState =
  | 'privacy'       // Showing privacy statement
  | 'launching'     // Opening DigiLocker
  | 'waiting'       // DigiLocker open, waiting for callback
  | 'processing'    // Backend verifying
  | 'success'       // +25 pts hero moment
  | 'already_done'; // Previously verified

interface PrivacyPoint {
  icon: string;
  title: string;
  body: string;
  mandatory: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DIGILOCKER_AUTH_BASE = 'https://digilocker.gov.in/public/oauth2/1/authorize';
const REDIRECT_URI = 'satvaaah://auth/digilocker/callback';
const SCOPE = 'openid profile';

const PRIVACY_POINTS: PrivacyPoint[] = [
  {
    icon: '🔒',
    title: 'Aadhaar number NEVER stored',
    body: 'Your 12-digit Aadhaar number is never stored in any database, log, cache, or file by SatvAAh at any point in this process.',
    mandatory: true,
  },
  {
    icon: '🔗',
    title: 'DigiLocker does the work',
    body: 'Verification happens entirely within DigiLocker — a Government of India platform. SatvAAh only receives a confirmation signal, not your Aadhaar data.',
    mandatory: true,
  },
  {
    icon: '🧂',
    title: 'Cryptographic one-way hash only',
    body: 'We store only a bcrypt hash (cost 12) of your DigiLocker UID combined with a unique salt. This is mathematically irreversible — it cannot be decoded.',
    mandatory: true,
  },
  {
    icon: '📋',
    title: 'Governed by DPDP Act 2023',
    body: 'Your data rights are protected under India\'s Digital Personal Data Protection Act 2023. You may request deletion at any time from Settings → Account → Delete Account.',
    mandatory: true,
  },
  {
    icon: '✅',
    title: 'Your consent is required',
    body: 'By tapping "Verify with DigiLocker" below, you explicitly consent to this one-time identity verification. This consent is recorded and time-stamped.',
    mandatory: true,
  },
];

const RING_SIZE = 140;
const STROKE_WIDTH = 10;
const RADIUS_VAL = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS_VAL;

// ─── Animated Ring Component ─────────────────────────────────────────────────

interface TrustRingProps {
  score: number;
  maxScore?: number;
  color?: string;
  size?: number;
  animateFrom?: number;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const TrustRing: React.FC<TrustRingProps> = ({
  score,
  maxScore = 100,
  color = COLORS.verdigris,
  size = RING_SIZE,
  animateFrom,
}) => {
  const r = (size - STROKE_WIDTH) / 2;
  const circ = 2 * Math.PI * r;
  const animatedValue = useRef(
    new Animated.Value(animateFrom !== undefined ? animateFrom : score)
  ).current;

  useEffect(() => {
    if (animateFrom !== undefined) {
      Animated.timing(animatedValue, {
        toValue: score,
        duration: 1800,
        useNativeDriver: true,
      }).start();
    }
  }, [score]);

  const strokeDashoffset = animatedValue.interpolate({
    inputRange: [0, maxScore],
    outputRange: [circ, 0],
  });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={COLORS.ivory}
          strokeWidth={STROKE_WIDTH}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
};

// ─── Main Screen ─────────────────────────────────────────────────────────────

export const AadhaarVerifyScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();
  const { accessToken, userId } = useAuthStore();
  const { profile } = useProviderStore();

  const [state, setState] = useState<VerifyState>('privacy');
  const [consentChecked, setConsentChecked] = useState(false);
  const [codeVerifier, setCodeVerifier] = useState('');
  const [newScore, setNewScore] = useState(65);
  const [prevScore, setPrevScore] = useState(40);
  const [error, setError] = useState<string | null>(null);

  // Hero moment animations
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const heroScale = useRef(new Animated.Value(0.7)).current;
  const pointsBounce = useRef(new Animated.Value(0)).current;
  const tierFade = useRef(new Animated.Value(0)).current;

  // ── Deep link listener ──────────────────────────────────────────────────

  useEffect(() => {
    const subscription = Linking.addEventListener('url', handleDeepLink);
    return () => subscription.remove();
  }, [codeVerifier]);

  const handleDeepLink = useCallback(
    async (event: { url: string }) => {
      const url = event.url;
      if (!url.startsWith('satvaaah://auth/digilocker/callback')) return;

      const params = new URLSearchParams(url.split('?')[1] || '');
      const code = params.get('code');
      const stateParam = params.get('state');
      const errorParam = params.get('error');

      if (errorParam) {
        setError('DigiLocker verification was cancelled or failed. Please try again.');
        setState('privacy');
        return;
      }

      if (!code) {
        setError('Invalid callback from DigiLocker. Please try again.');
        setState('privacy');
        return;
      }

      await processVerification(code, codeVerifier);
    },
    [codeVerifier]
  );

  // ── PKCE helpers ──────────────────────────────────────────────────────────

  const generateCodeVerifier = async (): Promise<string> => {
    const bytes = await Crypto.getRandomBytesAsync(32);
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const generateCodeChallenge = async (verifier: string): Promise<string> => {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: Crypto.CryptoEncoding.BASE64 }
    );
    return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  // ── Launch DigiLocker ─────────────────────────────────────────────────────

  const launchDigiLocker = async () => {
    if (!consentChecked) {
      Alert.alert(
        'Consent Required',
        'Please acknowledge the privacy statement by checking the consent box before proceeding.'
      );
      return;
    }

    setState('launching');

    try {
      const verifier = await generateCodeVerifier();
      const challenge = await generateCodeChallenge(verifier);
      const stateNonce = await Crypto.getRandomBytesAsync(16);
      const stateStr = btoa(String.fromCharCode(...stateNonce));

      setCodeVerifier(verifier);

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.DIGILOCKER_CLIENT_ID || '',
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state: stateStr,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });

      const authUrl = `${DIGILOCKER_AUTH_BASE}?${params.toString()}`;

      setState('waiting');

      await WebBrowser.openBrowserAsync(authUrl, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
        showTitle: false,
        enableBarCollapsing: false,
      });
    } catch (err) {
      console.error('[AadhaarVerify] DigiLocker launch error:', err);
      setError('Failed to open DigiLocker. Please check your internet connection and try again.');
      setState('privacy');
    }
  };

  // ── Process verification callback ────────────────────────────────────────

  const processVerification = async (code: string, verifier: string) => {
    setState('processing');
    setError(null);

    try {
      const response = await apiClient.post(
        '/api/v1/providers/trust/v1/verify/digilocker',
        {
          code,
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI,
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      // Backend returns { success, data: { new_score, ... } }
      const { new_score, previous_score, new_tier, delta_pts } = response.data?.data ?? response.data;

      setPrevScore(previous_score ?? 40);
      setNewScore(new_score ?? 65);

      // Local state already updated via setPrevScore/setNewScore from API response

      setState('success');
      playHeroAnimation();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || 'Verification failed. Please try again later.';
      setError(msg);
      setState('privacy');
    }
  };

  // ── Hero moment animation ─────────────────────────────────────────────────

  const playHeroAnimation = () => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(heroOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(heroScale, {
          toValue: 1,
          friction: 5,
          tension: 80,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(600),
      Animated.spring(pointsBounce, {
        toValue: 1,
        friction: 4,
        tension: 100,
        useNativeDriver: true,
      }),
      Animated.delay(400),
      Animated.timing(tierFade, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  };

  // ── Renders ───────────────────────────────────────────────────────────────

  const renderPrivacyState = () => (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.headerSection}>
        <View style={styles.iconContainer}>
          <Text style={styles.headerIcon}>🛡️</Text>
        </View>
        <Text style={styles.screenTitle}>Verify your identity</Text>
        <Text style={styles.screenSubtitle}>
          Link your Aadhaar via DigiLocker to earn{' '}
          <Text style={styles.pointsHighlight}>+25 trust points</Text> and unlock the{' '}
          <Text style={styles.tierHighlight}>Trusted</Text> tier.
        </Text>
      </View>

      {/* Trust tier preview */}
      <View style={styles.tierPreviewCard}>
        <View style={styles.tierPreviewRow}>
          <View style={styles.tierScoreBox}>
            <Text style={styles.tierScoreLabel}>Current</Text>
            <Text style={styles.tierScoreValue}>{prevScore}</Text>
          </View>
          <Text style={styles.tierArrow}>→</Text>
          <View style={[styles.tierScoreBox, styles.tierScoreBoxActive]}>
            <Text style={[styles.tierScoreLabel, { color: COLORS.verdigris }]}>After</Text>
            <Text style={[styles.tierScoreValue, { color: COLORS.verdigris }]}>65+</Text>
          </View>
        </View>
        <View style={styles.tierBadge}>
          <Text style={styles.tierBadgeText}>🏅 Tier: Trusted</Text>
        </View>
      </View>

      {/* Privacy statement */}
      <View style={styles.privacyCard}>
        <Text style={styles.privacyTitle}>Before you proceed — please read</Text>
        <Text style={styles.privacySubtitle}>
          5 commitments SatvAAh makes to you about your Aadhaar data
        </Text>

        {PRIVACY_POINTS.map((point, idx) => (
          <View key={idx} style={styles.privacyPoint}>
            <View style={styles.privacyIconWrap}>
              <Text style={styles.privacyIcon}>{point.icon}</Text>
            </View>
            <View style={styles.privacyTextWrap}>
              <Text style={styles.privacyPointTitle}>{point.title}</Text>
              <Text style={styles.privacyPointBody}>{point.body}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Consent checkbox */}
      <TouchableOpacity
        style={styles.consentRow}
        onPress={() => setConsentChecked(!consentChecked)}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, consentChecked && styles.checkboxChecked]}>
          {consentChecked && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.consentText}>
          I have read and understood the above privacy commitments and I consent to
          Aadhaar-linked identity verification via DigiLocker.
        </Text>
      </TouchableOpacity>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* CTA */}
      <TouchableOpacity
        style={[styles.ctaButton, !consentChecked && styles.ctaButtonDisabled]}
        onPress={launchDigiLocker}
        activeOpacity={0.85}
        disabled={!consentChecked}
      >
        <Text style={styles.ctaButtonText}>Verify with DigiLocker</Text>
        <Text style={styles.ctaButtonSub}>Opens Government of India's DigiLocker app</Text>
      </TouchableOpacity>

      <Text style={styles.govNote}>
        DigiLocker is operated by the Ministry of Electronics & Information Technology,
        Government of India.
      </Text>
    </ScrollView>
  );

  const renderProcessingState = () => (
    <View style={styles.centeredState}>
      <ActivityIndicator size="large" color={COLORS.verdigris} />
      <Text style={styles.processingTitle}>Verifying your identity…</Text>
      <Text style={styles.processingSubtitle}>
        This usually takes a few seconds. Please don't close the app.
      </Text>
    </View>
  );

  const renderWaitingState = () => (
    <View style={styles.centeredState}>
      <Text style={styles.waitingIcon}>🔗</Text>
      <Text style={styles.processingTitle}>DigiLocker is open</Text>
      <Text style={styles.processingSubtitle}>
        Complete verification in DigiLocker, then return to SatvAAh.
      </Text>
    </View>
  );

  const renderSuccessState = () => (
    <Animated.View
      style={[
        styles.successContainer,
        { opacity: heroOpacity, transform: [{ scale: heroScale }] },
      ]}
    >
      <Text style={styles.successEmoji}>🏅</Text>
      <Text style={styles.successTitle}>Identity Verified</Text>

      {/* Animated trust ring */}
      <View style={styles.ringWrapper}>
        <TrustRing
          score={newScore}
          animateFrom={prevScore}
          color={COLORS.verdigris}
          size={RING_SIZE}
        />
        <View style={styles.ringCenter}>
          <Text style={styles.ringScore}>{newScore}</Text>
        </View>
      </View>

      {/* +25 pts bounce */}
      <Animated.View
        style={[
          styles.pointsDelta,
          {
            opacity: pointsBounce,
            transform: [
              {
                translateY: pointsBounce.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={styles.pointsDeltaText}>+25 pts</Text>
        <Text style={styles.pointsDeltaLabel}>Aadhaar Verified</Text>
      </Animated.View>

      {/* Tier badge */}
      <Animated.View style={[styles.tierSuccessBadge, { opacity: tierFade }]}>
        <Text style={styles.tierSuccessIcon}>🏅</Text>
        <Text style={styles.tierSuccessText}>Tier: Trusted</Text>
      </Animated.View>

      <Text style={styles.successBody}>
        Your professional identity is now Aadhaar-verified. Consumers can see this on your
        profile. Your Aadhaar number was never stored.
      </Text>

      <TouchableOpacity
        style={styles.successCta}
        onPress={() => navigation.navigate('TrustBiography')}
        activeOpacity={0.85}
      >
        <Text style={styles.successCtaText}>See your Trust Biography →</Text>
      </TouchableOpacity>
    </Animated.View>
  );

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.ivory} />

      {/* Back button (not shown in success state) */}
      {state !== 'success' && (
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
      )}

      {state === 'privacy' && renderPrivacyState()}
      {state === 'launching' && renderProcessingState()}
      {state === 'waiting' && renderWaitingState()}
      {state === 'processing' && renderProcessingState()}
      {state === 'success' && renderSuccessState()}
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.ivory,
  },
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 16,
    left: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.warmSand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 18,
    color: COLORS.deepInk,
    fontFamily: FONTS.semiBold,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 72,
    paddingBottom: SPACING.xl,
    flexGrow: 1,
  },

  // Header
  headerSection: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.warmSand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  headerIcon: {
    fontSize: 32,
  },
  screenTitle: {
    fontFamily: FONTS.bold,
    fontSize: 26,
    color: COLORS.deepInk,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  screenSubtitle: {
    fontFamily: FONTS.regular,
    fontSize: 15,
    color: '#5A5A6E',
    textAlign: 'center',
    lineHeight: 22,
  },
  pointsHighlight: {
    fontFamily: FONTS.semiBold,
    color: COLORS.saffron,
  },
  tierHighlight: {
    fontFamily: FONTS.semiBold,
    color: COLORS.verdigris,
  },

  // Tier preview
  tierPreviewCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  tierPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  tierScoreBox: {
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.warmSand,
    minWidth: 80,
  },
  tierScoreBoxActive: {
    backgroundColor: '#E8F5F3',
  },
  tierScoreLabel: {
    fontFamily: FONTS.medium,
    fontSize: 11,
    color: '#8888A0',
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tierScoreValue: {
    fontFamily: FONTS.bold,
    fontSize: 28,
    color: COLORS.deepInk,
  },
  tierArrow: {
    fontFamily: FONTS.bold,
    fontSize: 20,
    color: COLORS.saffron,
  },
  tierBadge: {
    backgroundColor: '#E8F5F3',
    borderRadius: 20,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  tierBadgeText: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: COLORS.verdigris,
  },

  // Privacy card
  privacyCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  privacyTitle: {
    fontFamily: FONTS.bold,
    fontSize: 16,
    color: COLORS.deepInk,
    marginBottom: 4,
  },
  privacySubtitle: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: '#8888A0',
    marginBottom: SPACING.md,
  },
  privacyPoint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
    paddingBottom: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F5',
  },
  privacyIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.warmSand,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  privacyIcon: {
    fontSize: 16,
  },
  privacyTextWrap: {
    flex: 1,
  },
  privacyPointTitle: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: COLORS.deepInk,
    marginBottom: 3,
  },
  privacyPointBody: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: '#5A5A6E',
    lineHeight: 19,
  },

  // Consent
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.xs,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#CCCCDD',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: COLORS.verdigris,
    borderColor: COLORS.verdigris,
  },
  checkmark: {
    color: '#fff',
    fontSize: 13,
    fontFamily: FONTS.bold,
  },
  consentText: {
    flex: 1,
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: '#5A5A6E',
    lineHeight: 19,
  },

  // Error
  errorBanner: {
    backgroundColor: '#FFF3F3',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 3,
    borderLeftColor: '#E05555',
  },
  errorText: {
    fontFamily: FONTS.medium,
    fontSize: 14,
    color: '#C0392B',
    lineHeight: 20,
  },

  // CTA
  ctaButton: {
    backgroundColor: COLORS.verdigris,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md + 4,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    marginBottom: SPACING.md,
    shadowColor: COLORS.verdigris,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  ctaButtonDisabled: {
    backgroundColor: '#AACCC8',
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaButtonText: {
    fontFamily: FONTS.bold,
    fontSize: 17,
    color: '#fff',
    marginBottom: 2,
  },
  ctaButtonSub: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
  },
  govNote: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: '#AAAABC',
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: SPACING.lg,
  },

  // Centered states
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    gap: SPACING.md,
  },
  processingTitle: {
    fontFamily: FONTS.bold,
    fontSize: 20,
    color: COLORS.deepInk,
    textAlign: 'center',
  },
  processingSubtitle: {
    fontFamily: FONTS.regular,
    fontSize: 14,
    color: '#8888A0',
    textAlign: 'center',
    lineHeight: 21,
  },
  waitingIcon: {
    fontSize: 48,
  },

  // Success
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.ivory,
  },
  successEmoji: {
    fontSize: 52,
    marginBottom: SPACING.sm,
  },
  successTitle: {
    fontFamily: FONTS.bold,
    fontSize: 28,
    color: COLORS.deepInk,
    marginBottom: SPACING.xl,
  },
  ringWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xl,
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringScore: {
    fontFamily: FONTS.bold,
    fontSize: 36,
    color: COLORS.deepInk,
  },
  pointsDelta: {
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  pointsDeltaText: {
    fontFamily: FONTS.bold,
    fontSize: 32,
    color: COLORS.saffron,
  },
  pointsDeltaLabel: {
    fontFamily: FONTS.medium,
    fontSize: 14,
    color: '#8888A0',
  },
  tierSuccessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5F3',
    borderRadius: 24,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    gap: SPACING.xs,
    marginBottom: SPACING.xl,
  },
  tierSuccessIcon: {
    fontSize: 18,
  },
  tierSuccessText: {
    fontFamily: FONTS.bold,
    fontSize: 17,
    color: COLORS.verdigris,
  },
  successBody: {
    fontFamily: FONTS.regular,
    fontSize: 14,
    color: '#5A5A6E',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: SPACING.xl,
    paddingHorizontal: SPACING.sm,
  },
  successCta: {
    backgroundColor: COLORS.verdigris,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  successCtaText: {
    fontFamily: FONTS.semiBold,
    fontSize: 16,
    color: '#fff',
  },
});

export default AadhaarVerifyScreen;
