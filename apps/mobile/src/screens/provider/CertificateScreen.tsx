/**
 * CertificateScreen.tsx
 * Phase 24 — Provider Verification
 *
 * Shown when trust_tier first crosses highly_trusted (triggered via
 * lambdas/certificate-generator via SQS certificate-generator queue).
 *
 * FULL SCREEN — cannot be dismissed when first shown (isFirstShow=true).
 * Verdigris ring 120px animated 2s.
 * "🏅 You have earned it"
 * Certificate preview (A4 portrait). Download PDF. WhatsApp share (CAC).
 *
 * Idempotency: certificate_records table. Once per provider lifetime.
 * CAC = provider shares certificate to non-users via WhatsApp.
 * Uses WhatsApp template #15 certificate_ready (extraordinary event).
 *
 * certificate verification public URL: satvaaah.com/verify/{cert_id}
 * (CloudFront + S3, no auth required)
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Easing,
  Linking,
  Share,
  Platform,
  StatusBar,
  Dimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useAuthStore } from '../../stores/auth.store';
import { useProviderStore } from '../../stores/provider.store';
import { apiClient } from '../../api/client';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { ProviderStackParamList } from '../../navigation/ProviderStack';

// ─── Types ────────────────────────────────────────────────────────────────────

type NavProp = NativeStackNavigationProp<ProviderStackParamList, 'Certificate'>;
type RoutePropType = RouteProp<ProviderStackParamList, 'Certificate'>;

interface CertificateData {
  certId: string;
  providerName: string;
  listingType: string;
  trustScore: number;
  issuedAt: string;
  validUntil: string | null;
  verifyUrl: string;
  pdfUrl: string; // Pre-signed S3 URL
  category: string;
  city: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const RING_SIZE = 120;
const STROKE = 9;
const RING_RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ─── Animated ring ────────────────────────────────────────────────────────────

const VerdigrisRing: React.FC<{ progress: Animated.Value }> = ({ progress }) => {
  const dashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [CIRCUMFERENCE, 0],
  });

  return (
    <Svg width={RING_SIZE} height={RING_SIZE} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Defs>
        <LinearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor={COLORS.verdigris} />
          <Stop offset="100%" stopColor={COLORS.lightVerdigris} />
        </LinearGradient>
      </Defs>
      {/* Track */}
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        stroke="#E8F5F3"
        strokeWidth={STROKE}
        fill="none"
      />
      {/* Progress */}
      <AnimatedCircle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        stroke="url(#ringGrad)"
        strokeWidth={STROKE}
        fill="none"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={dashoffset}
        strokeLinecap="round"
      />
    </Svg>
  );
};

// ─── Certificate preview (A4 portrait proportions) ────────────────────────────

interface CertPreviewProps {
  cert: CertificateData;
}

const CertificatePreview: React.FC<CertPreviewProps> = ({ cert }) => {
  const previewW = SCREEN_W - SPACING.lg * 2;
  // A4: 210mm × 297mm → ratio 1:1.414
  const previewH = previewW * 1.414;

  const issuedDate = new Date(cert.issuedAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  return (
    <View
      style={[
        certStyles.preview,
        { width: previewW, height: previewH },
      ]}
    >
      {/* Watermark border */}
      <View style={certStyles.outerBorder} />
      <View style={certStyles.innerBorder} />

      {/* Header */}
      <View style={certStyles.certHeader}>
        <Text style={certStyles.certBrand}>SatvAAh</Text>
        <Text style={certStyles.certTagline}>Truth that travels.</Text>
        <View style={certStyles.certDivider} />
      </View>

      {/* Certificate title */}
      <Text style={certStyles.certTitleSub}>Certificate of Trust</Text>
      <Text style={certStyles.certTitleMain}>Highly Trusted Professional</Text>

      {/* Body */}
      <Text style={certStyles.certPreamble}>This is to certify that</Text>
      <Text style={certStyles.certProviderName}>{cert.providerName}</Text>
      <Text style={certStyles.certCategory}>{cert.category}</Text>
      <Text style={certStyles.certCity}>{cert.city}</Text>

      <View style={certStyles.certScoreRow}>
        <View style={certStyles.certScoreBox}>
          <Text style={certStyles.certScoreNum}>{cert.trustScore}</Text>
          <Text style={certStyles.certScoreLabel}>Trust Score</Text>
        </View>
      </View>

      <Text style={certStyles.certBody}>
        has achieved the{' '}
        <Text style={certStyles.certBodyBold}>Highly Trusted</Text> tier on SatvAAh —
        India's trust layer for the informal economy — through verified identity,
        verified credentials, and genuine consumer voice.
      </Text>

      {/* Issued */}
      <View style={certStyles.certIssuedRow}>
        <Text style={certStyles.certIssuedLabel}>Issued on</Text>
        <Text style={certStyles.certIssuedDate}>{issuedDate}</Text>
      </View>

      {/* Verify URL */}
      <View style={certStyles.certVerifyBox}>
        <Text style={certStyles.certVerifyLabel}>Verify at</Text>
        <Text style={certStyles.certVerifyUrl}>{cert.verifyUrl}</Text>
      </View>

      {/* SatvAAh seal placeholder */}
      <View style={certStyles.certSeal}>
        <Text style={certStyles.certSealText}>🏅</Text>
      </View>
    </View>
  );
};

const certStyles = StyleSheet.create({
  preview: {
    backgroundColor: '#FEFCF8',
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    padding: SPACING.xl,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
    overflow: 'hidden',
  },
  outerBorder: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    bottom: 10,
    borderWidth: 2,
    borderColor: '#C8691A22',
    borderRadius: RADIUS.md,
  },
  innerBorder: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    bottom: 16,
    borderWidth: 1,
    borderColor: '#2E7D7222',
    borderRadius: RADIUS.sm,
  },
  certHeader: { alignItems: 'center', marginBottom: SPACING.lg, marginTop: SPACING.sm },
  certBrand: {
    fontFamily: FONTS.bold,
    fontSize: 28,
    color: COLORS.saffron,
    letterSpacing: 1,
  },
  certTagline: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: '#AAAABC',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
  },
  certDivider: {
    width: 60,
    height: 2,
    backgroundColor: COLORS.verdigris,
    borderRadius: 1,
  },
  certTitleSub: {
    fontFamily: FONTS.medium,
    fontSize: 12,
    color: '#8888A0',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 4,
  },
  certTitleMain: {
    fontFamily: FONTS.bold,
    fontSize: 20,
    color: COLORS.deepInk,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    letterSpacing: 0.5,
  },
  certPreamble: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: '#8888A0',
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  certProviderName: {
    fontFamily: FONTS.bold,
    fontSize: 22,
    color: COLORS.deepInk,
    textAlign: 'center',
    marginBottom: 4,
  },
  certCategory: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: COLORS.verdigris,
    textAlign: 'center',
    marginBottom: 2,
    textTransform: 'capitalize',
  },
  certCity: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: '#8888A0',
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  certScoreRow: { alignItems: 'center', marginBottom: SPACING.md },
  certScoreBox: {
    alignItems: 'center',
    backgroundColor: '#E8F5F3',
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
  },
  certScoreNum: {
    fontFamily: FONTS.bold,
    fontSize: 36,
    color: COLORS.verdigris,
  },
  certScoreLabel: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: '#8888A0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  certBody: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: '#5A5A6E',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.sm,
  },
  certBodyBold: { fontFamily: FONTS.bold, color: COLORS.deepInk },
  certIssuedRow: { alignItems: 'center', marginBottom: SPACING.sm },
  certIssuedLabel: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: '#AAAABC',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  certIssuedDate: {
    fontFamily: FONTS.semiBold,
    fontSize: 13,
    color: COLORS.deepInk,
  },
  certVerifyBox: { alignItems: 'center', marginTop: SPACING.sm },
  certVerifyLabel: {
    fontFamily: FONTS.regular,
    fontSize: 10,
    color: '#AAAABC',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  certVerifyUrl: {
    fontFamily: FONTS.medium,
    fontSize: 11,
    color: COLORS.verdigris,
  },
  certSeal: {
    position: 'absolute',
    bottom: 32,
    right: 32,
  },
  certSealText: { fontSize: 32 },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export const CertificateScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RoutePropType>();
  const { accessToken } = useAuthStore();

  // isFirstShow: passed from navigation when triggered by certificate Lambda event
  const isFirstShow = route.params?.isFirstShow ?? false;
  const certId = route.params?.certId;

  const [cert, setCert] = useState<CertificateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Animations
  const ringProgress = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleScale = useRef(new Animated.Value(0.8)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const dismissOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fetchCertificate();
  }, []);

  const fetchCertificate = async () => {
    setLoading(true);
    try {
      const url = certId
        ? `/api/v1/trust/certificate/${certId}`
        : '/api/v1/trust/certificate/mine';
      const res = await apiClient.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setCert(res.data.data ?? res.data);
      playEntryAnimation();
    } catch (err) {
      setError('Could not load your certificate. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const playEntryAnimation = () => {
    Animated.sequence([
      // 1. Ring draws in 2s
      Animated.timing(ringProgress, {
        toValue: 1,
        duration: 2000,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      // 2. Title fades+scales in
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.spring(titleScale, {
          toValue: 1,
          friction: 6,
          tension: 80,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(400),
      // 3. Content fades in
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      // 4. Dismiss button fades in (only if isFirstShow — after 3s total)
      Animated.timing(dismissOpacity, {
        toValue: isFirstShow ? 1 : 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const downloadPDF = async () => {
    if (!cert) return;
    setDownloading(true);
    try {
      const fileName = `SatvAAh_Certificate_${cert.certId}.pdf`;
      const localPath = `${FileSystem.documentDirectory}${fileName}`;

      const downloadResult = await FileSystem.downloadAsync(cert.pdfUrl, localPath);

      if (downloadResult.status !== 200) {
        throw new Error('Download failed');
      }

      if (Platform.OS === 'ios') {
        await Sharing.shareAsync(localPath, {
          mimeType: 'application/pdf',
          dialogTitle: 'Save your SatvAAh Certificate',
        });
      } else {
        await Sharing.shareAsync(localPath, {
          mimeType: 'application/pdf',
        });
      }
    } catch (err) {
      Alert.alert('Download failed', 'Could not download your certificate. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const shareOnWhatsApp = async () => {
    if (!cert) return;
    setSharing(true);

    const message = encodeURIComponent(
      `🏅 I've earned the *Highly Trusted* certificate on SatvAAh!\n\n` +
        `I'm a verified ${cert.category} professional in ${cert.city} with a trust score of ${cert.trustScore}.\n\n` +
        `You can verify my certificate here:\n${cert.verifyUrl}\n\n` +
        `_SatvAAh — Truth that travels._`
    );

    const whatsappUrl = `whatsapp://send?text=${message}`;

    try {
      const canOpen = await Linking.canOpenURL(whatsappUrl);
      if (canOpen) {
        await Linking.openURL(whatsappUrl);
      } else {
        // Fallback to web share
        await Share.share({
          message: decodeURIComponent(message),
          title: 'My SatvAAh Certificate',
        });
      }
    } catch (_) {
      await Share.share({
        message: `I've earned the Highly Trusted certificate on SatvAAh! Verify at: ${cert.verifyUrl}`,
      });
    } finally {
      setSharing(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.fullScreenLoading}>
        <ActivityIndicator size="large" color={COLORS.verdigris} />
      </View>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safeArea, isFirstShow && styles.safeAreaFirstShow]}
      edges={['top', 'bottom']}
    >
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.ivory} />

      {/* Nav — hidden on first show */}
      {!isFirstShow && (
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.navBack}>←</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>Your Certificate</Text>
          <View style={{ width: 40 }} />
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        // Prevent dismissal on first show by making scroll bouncy but not navigatable
        scrollEnabled={!isFirstShow || !!cert}
      >
        {/* Hero section */}
        <View style={styles.heroSection}>
          {/* Verdigris ring 120px */}
          <View style={styles.ringWrapper}>
            <VerdigrisRing progress={ringProgress} />
            <View style={styles.ringCenter}>
              <Text style={styles.ringCenterIcon}>🏅</Text>
            </View>
          </View>

          {/* Title */}
          <Animated.View
            style={[
              styles.titleBlock,
              {
                opacity: titleOpacity,
                transform: [{ scale: titleScale }],
              },
            ]}
          >
            <Text style={styles.earnedLabel}>🏅 You have earned it</Text>
            <Text style={styles.heroTitle}>Highly Trusted</Text>
            <Text style={styles.heroSubtitle}>Certificate of Trust</Text>
          </Animated.View>
        </View>

        {/* Certificate + actions */}
        <Animated.View style={[styles.contentBlock, { opacity: contentOpacity }]}>
          {cert && (
            <>
              {/* Certificate preview */}
              <CertificatePreview cert={cert} />

              {/* Actions */}
              <View style={styles.actionsSection}>
                {/* Download PDF */}
                <TouchableOpacity
                  style={styles.actionPrimary}
                  onPress={downloadPDF}
                  disabled={downloading}
                  activeOpacity={0.85}
                >
                  {downloading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Text style={styles.actionPrimaryIcon}>⬇️</Text>
                      <Text style={styles.actionPrimaryText}>Download PDF</Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* WhatsApp share (CAC) */}
                <TouchableOpacity
                  style={styles.actionWhatsApp}
                  onPress={shareOnWhatsApp}
                  disabled={sharing}
                  activeOpacity={0.85}
                >
                  {sharing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Text style={styles.actionWhatsAppIcon}>💬</Text>
                      <View style={styles.actionWhatsAppText}>
                        <Text style={styles.actionWhatsAppLabel}>Share on WhatsApp</Text>
                        <Text style={styles.actionWhatsAppSub}>
                          Let non-users verify your trust
                        </Text>
                      </View>
                    </>
                  )}
                </TouchableOpacity>

                {/* Verify URL */}
                <View style={styles.verifyUrlBox}>
                  <Text style={styles.verifyUrlLabel}>Public verification link</Text>
                  <TouchableOpacity
                    onPress={() => cert?.verifyUrl && Linking.openURL(cert.verifyUrl)}
                  >
                    <Text style={styles.verifyUrlValue}>{cert?.verifyUrl}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Trust biography link */}
              <TouchableOpacity
                style={styles.biographyLink}
                onPress={() => navigation.navigate('TrustBiography')}
              >
                <Text style={styles.biographyLinkText}>
                  See the full Trust Biography that earned this →
                </Text>
              </TouchableOpacity>
            </>
          )}

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {/* First-show dismiss button — appears after animation completes */}
      {isFirstShow && (
        <Animated.View style={[styles.dismissContainer, { opacity: dismissOpacity }]}>
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={() => {
              if (navigation.canGoBack()) navigation.goBack();
              else navigation.navigate('Dashboard');
            }}
          >
            <Text style={styles.dismissButtonText}>Continue to Dashboard</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.ivory },
  safeAreaFirstShow: { backgroundColor: '#fff' },
  fullScreenLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.ivory,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.ivory,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8EF',
  },
  navBack: { fontFamily: FONTS.semiBold, fontSize: 20, color: COLORS.deepInk },
  navTitle: { fontFamily: FONTS.bold, fontSize: 17, color: COLORS.deepInk },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: 100,
  },

  // Hero
  heroSection: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  ringWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCenterIcon: { fontSize: 40 },
  titleBlock: { alignItems: 'center' },
  earnedLabel: {
    fontFamily: FONTS.semiBold,
    fontSize: 16,
    color: COLORS.saffron,
    marginBottom: SPACING.xs,
  },
  heroTitle: {
    fontFamily: FONTS.bold,
    fontSize: 32,
    color: COLORS.deepInk,
    marginBottom: 4,
  },
  heroSubtitle: {
    fontFamily: FONTS.medium,
    fontSize: 15,
    color: '#8888A0',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },

  contentBlock: { gap: SPACING.lg },

  // Actions
  actionsSection: {
    gap: SPACING.md,
    marginTop: SPACING.md,
  },
  actionPrimary: {
    backgroundColor: COLORS.verdigris,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    shadowColor: COLORS.verdigris,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  actionPrimaryIcon: { fontSize: 20 },
  actionPrimaryText: {
    fontFamily: FONTS.bold,
    fontSize: 17,
    color: '#fff',
  },
  actionWhatsApp: {
    backgroundColor: '#25D366',
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    shadowColor: '#25D366',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  actionWhatsAppIcon: { fontSize: 26 },
  actionWhatsAppText: { flex: 1 },
  actionWhatsAppLabel: {
    fontFamily: FONTS.bold,
    fontSize: 16,
    color: '#fff',
    marginBottom: 2,
  },
  actionWhatsAppSub: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
  },

  // Verify URL
  verifyUrlBox: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  verifyUrlLabel: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: '#AAAABC',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  verifyUrlValue: {
    fontFamily: FONTS.medium,
    fontSize: 13,
    color: COLORS.verdigris,
  },

  // Biography link
  biographyLink: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  biographyLinkText: {
    fontFamily: FONTS.medium,
    fontSize: 14,
    color: COLORS.verdigris,
  },

  // Dismiss (first show)
  dismissContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.lg,
    paddingBottom: Platform.OS === 'ios' ? 34 : SPACING.lg,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingTop: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8E8EF',
  },
  dismissButton: {
    backgroundColor: COLORS.deepInk,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md + 4,
    alignItems: 'center',
  },
  dismissButtonText: {
    fontFamily: FONTS.bold,
    fontSize: 17,
    color: '#fff',
  },

  // Error
  errorBanner: {
    backgroundColor: '#FFF3F3',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  errorText: { fontFamily: FONTS.medium, fontSize: 14, color: '#C0392B' },
});

export default CertificateScreen;
