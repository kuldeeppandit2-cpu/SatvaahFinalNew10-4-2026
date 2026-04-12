/**
 * ConsumerTrustScreen.tsx
 * SatvAAh — Phase 21
 *
 * Displays the consumer's trust profile as seen by providers:
 *   - Trust ring SVG (score starts at 75 for new consumers)
 *   - 6 trust signals with individual scores
 *   - "Providers can see your trust tier" badge
 *   - How to improve guide
 *   - Tier guide: Highly Trusted 80+ / Trusted 60+ / Basic 20+ / Unverified 0-19
 *   - DPDP data rights shortcut
 *
 * Endpoint:
 *   GET /api/v1/consumers/me/trust   (rating :3005)
 *
 * Note: consumer trust_score starts at 75 DEFAULT (V005 consumer_profiles migration).
 *       This is distinct from provider trust_score which starts at 0.
 */

import React, { useEffect, useState } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 ActivityIndicator,
 ScrollView,
 StyleSheet,
 Text,
 TouchableOpacity,
 View,
} from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../api/client';

// ─── Brand ───────────────────────────────────────────────────────────────────

const SAFFRON = '#C8691A';
const DEEP_INK = '#1C1C2E';
const IVORY = '#FAF7F0';
const VERDIGRIS = '#2E7D72';
const LIGHT_VERDIGRIS = '#6BA89E';
const WARM_SAND = '#F0E4CC';
const GREY = '#6B6560';
const BORDER = '#E8E0D0';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConsumerTrustTier =
  | 'unverified'   // 0–19
  | 'basic'        // 20–59
  | 'trusted'      // 60–79
  | 'highly_trusted'; // 80–100

export interface ConsumerTrustSignal {
  key: string;
  label: string;
  description: string;
  earnedPoints: number;
  maxPoints: number;
  isMet: boolean;
  icon: string;
}

export interface ConsumerTrustData {
  trustScore: number;
  trustTier: ConsumerTrustTier;
  signals: ConsumerTrustSignal[];
  /** ISO UTC — when the score was last recalculated */
  lastCalculatedAt: string;
}

// ─── Tier config ─────────────────────────────────────────────────────────────

interface TierConfig {
  label: string;
  min: number;
  max: number;
  colour: string;
  description: string;
}

const TIER_CONFIG: Record<ConsumerTrustTier, TierConfig> = {
  unverified: {
    label: 'Unverified',
    min: 0,
    max: 19,
    colour: '#6B6560',
    description: 'Phone not yet verified. Complete OTP to activate your profile.',
  },
  basic: {
    label: 'Basic',
    min: 20,
    max: 59,
    colour: SAFFRON,
    description: 'Phone verified. Providers can see your basic profile.',
  },
  trusted: {
    label: 'Trusted',
    min: 60,
    max: 79,
    colour: LIGHT_VERDIGRIS,
    description: 'Strong rating history. Providers prioritise your contact requests.',
  },
  highly_trusted: {
    label: 'Highly Trusted',
    min: 80,
    max: 100,
    colour: VERDIGRIS,
    description: 'Excellent standing. Your contacts receive highest priority from providers.',
  },
};

// ─── How to improve guidance ──────────────────────────────────────────────────

const IMPROVE_TIPS: { icon: string; text: string }[] = [
  { icon: 'star-outline', text: 'Submit honest ratings after each contact' },
  { icon: 'call-outline', text: 'Complete accepted contacts — avoid no-shows' },
  { icon: 'time-outline', text: 'Maintain your account over time' },
  { icon: 'flag-outline', text: 'Avoid disputed or flagged ratings' },
  { icon: 'card-outline', text: 'Keep an active Silver or Gold subscription' },
  { icon: 'person-outline', text: 'Keep your profile information accurate' },
];

// ─── Trust Ring SVG ───────────────────────────────────────────────────────────

function TrustRing({
  score,
  tier,
}: {
  score: number;
  tier: ConsumerTrustTier;
}) {
  const size = 180;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = Math.max(0, Math.min(100, score));
  const dashOffset = circumference * (1 - clampedScore / 100);
  const tierColour = TIER_CONFIG[tier].colour;
  const centre = size / 2;

  return (
        <ScreenHeader title="Trust Score" onBack={() => navigation.goBack()} />
    <View style={styles.ringContainer}>
      <Svg width={size} height={size}>
        {/* Track */}
        <Circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={WARM_SAND}
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <Circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={tierColour}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${centre}, ${centre}`}
        />
        {/* Score label */}
        <SvgText
          x={centre}
          y={centre - 8}
          fontSize="38"
          fontWeight="700"
          fill={DEEP_INK}
          textAnchor="middle"
          fontFamily="Plus Jakarta Sans"
        >
          {clampedScore}
        </SvgText>
        {/* Tier label */}
        <SvgText
          x={centre}
          y={centre + 16}
          fontSize="12"
          fill={tierColour}
          textAnchor="middle"
          fontFamily="Plus Jakarta Sans"
          fontWeight="600"
        >
          {TIER_CONFIG[tier].label}
        </SvgText>
      </Svg>
    </View>
  );
}

// ─── Signal Row ───────────────────────────────────────────────────────────────

function SignalRow({ signal }: { signal: ConsumerTrustSignal }) {
  const progress =
    signal.maxPoints > 0
      ? Math.min(signal.earnedPoints / signal.maxPoints, 1)
      : signal.isMet
      ? 1
      : 0;

  return (
    <View style={styles.signalRow}>
      <View style={styles.signalIconBox}>
        <Ionicons
          name={signal.icon as any}
          size={18}
          color={signal.isMet ? VERDIGRIS : GREY}
        />
      </View>
      <View style={styles.signalContent}>
        <View style={styles.signalTopRow}>
          <Text style={styles.signalLabel}>{signal.label}</Text>
          <Text style={[styles.signalPoints, { color: signal.isMet ? VERDIGRIS : GREY }]}>
            {signal.earnedPoints}/{signal.maxPoints}
          </Text>
        </View>
        <Text style={styles.signalDesc}>{signal.description}</Text>
        <View style={styles.signalTrack}>
          <View style={[styles.signalFill, { width: `${progress * 100}%` as any, backgroundColor: signal.isMet ? VERDIGRIS : SAFFRON }]} />
        </View>
      </View>
      {signal.isMet && (
        <Ionicons name="checkmark-circle" size={18} color={VERDIGRIS} style={{ marginLeft: 8 }} />
      )}
    </View>
  );
}

// ─── Tier Guide ───────────────────────────────────────────────────────────────

function TierGuide({ currentTier }: { currentTier: ConsumerTrustTier }) {
  const tiers = Object.entries(TIER_CONFIG) as [ConsumerTrustTier, TierConfig][];
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Trust Tier Guide</Text>
      {tiers.map(([key, config]) => (
        <View
          key={key}
          style={[styles.tierRow, key === currentTier && styles.tierRowActive]}
        >
          <View style={[styles.tierDot, { backgroundColor: config.colour }]} />
          <View style={styles.tierContent}>
            <View style={styles.tierTopRow}>
              <Text style={[styles.tierLabel, key === currentTier && { fontWeight: '700' }]}>
                {config.label}
              </Text>
              <Text style={styles.tierRange}>
                {config.min}–{config.max}
              </Text>
            </View>
            <Text style={styles.tierDesc}>{config.description}</Text>
          </View>
          {key === currentTier && (
            <View style={styles.youBadge}>
              <Text style={styles.youBadgeText}>You</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ConsumerTrustScreen() {
  const navigation = useNavigation<any>();
  const [trustData, setTrustData] = useState<ConsumerTrustData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showImprove, setShowImprove] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ success: true; data: ConsumerTrustData }>('/api/v1/consumers/me/trust')
      .then((res) => setTrustData(res.data.data))
      .catch((err) => console.error('[ConsumerTrustScreen]', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={SAFFRON} size="large" />
      </View>
    );
  }

  if (!trustData) {
    return (
      <View style={styles.loader}>
        <Text style={styles.errorText}>Could not load trust data.</Text>
      </View>
    );
  }

  const tierConfig = TIER_CONFIG[trustData.trustTier];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >

      {/* Ring + visibility notice */}
      <View style={styles.heroSection}>
        <TrustRing score={trustData.trustScore} tier={trustData.trustTier} />
        <View style={[styles.visibilityBadge, { borderColor: tierConfig.colour }]}>
          <Ionicons name="eye-outline" size={14} color={tierConfig.colour} />
          <Text style={[styles.visibilityText, { color: tierConfig.colour }]}>
            Providers can see your trust tier
          </Text>
        </View>
        <Text style={styles.
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F0' }} edges={['top']}>tierDesc}>{tierConfig.description}</Text>
        <Text style={styles.lastCalc}>
          Updated{' '}
          {new Date(trustData.lastCalculatedAt).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            timeZone: 'Asia/Kolkata',
          })}
        </Text>
      </View>

      {/* 6 Trust Signals */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Trust Signals</Text>
        <Text style={styles.sectionSubtitle}>
          These factors determine your trust score
        </Text>
        {trustData.signals.map((signal) => (
          <SignalRow key={signal.key} signal={signal} />
        ))}
      </View>

      {/* How to Improve (collapsible) */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.improveHeader}
          onPress={() => setShowImprove((v) => !v)}
        >
          <Text style={styles.sectionTitle}>How to Improve Your Score</Text>
          <Ionicons
            name={showImprove ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={GREY}
          />
        </TouchableOpacity>
        {showImprove && (
          <View style={styles.improveTips}>
            {IMPROVE_TIPS.map((tip, i) => (
              <View key={i} style={styles.tipRow}>
                <Ionicons name={tip.icon as any} size={16} color={SAFFRON} />
                <Text style={styles.tipText}>{tip.text}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Tier Guide */}
      <TierGuide currentTier={trustData.trustTier} />

      {/* DPDP data rights */}
      <TouchableOpacity
        style={styles.dpdpRow}
        onPress={() => navigation.navigate('DataRights')}
      >
        <Ionicons name="shield-outline" size={18} color={VERDIGRIS} />
        <Text style={styles.dpdpText}>
          Your trust data is governed by the DPDP Act 2023. View your data rights.
        </Text>
        <Ionicons name="chevron-forward" size={14} color={GREY} />
      </TouchableOpacity>
    </ScrollView>
        </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: IVORY },
  scrollContent: { paddingBottom: 48 },
  loader: { flex: 1, backgroundColor: IVORY, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: GREY, fontSize: 15 },

  heroSection: {
    backgroundColor: '#fff',
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  ringContainer: { marginBottom: 12 },
  visibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 8,
  },
  visibilityText: { fontSize: 12, fontWeight: '600', fontFamily: 'Plus Jakarta Sans' },
  tierDesc: {
    fontSize: 13,
    color: GREY,
    textAlign: 'center',
    fontFamily: 'Plus Jakarta Sans',
    marginBottom: 6,
    lineHeight: 19,
  },
  lastCalc: { fontSize: 11, color: GREY, fontFamily: 'Plus Jakarta Sans' },

  section: {
    backgroundColor: '#fff',
    marginTop: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: DEEP_INK,
    fontFamily: 'Plus Jakarta Sans',
    marginBottom: 2,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: GREY,
    fontFamily: 'Plus Jakarta Sans',
    marginBottom: 12,
  },

  // Signal row
  signalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  signalIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: WARM_SAND,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  signalContent: { flex: 1 },
  signalTopRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  signalLabel: { fontSize: 14, fontWeight: '600', color: DEEP_INK, fontFamily: 'Plus Jakarta Sans' },
  signalPoints: { fontSize: 13, fontWeight: '600', fontFamily: 'Plus Jakarta Sans' },
  signalDesc: { fontSize: 12, color: GREY, fontFamily: 'Plus Jakarta Sans', marginBottom: 6 },
  signalTrack: {
    height: 4,
    backgroundColor: WARM_SAND,
    borderRadius: 2,
    overflow: 'hidden',
  },
  signalFill: { height: '100%', borderRadius: 2 },

  // How to improve
  improveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 4,
  },
  improveTips: { marginTop: 8 },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  tipText: { fontSize: 13, color: DEEP_INK, fontFamily: 'Plus Jakarta Sans', flex: 1 },

  // Tier guide
  tierRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  tierRowActive: { backgroundColor: '#F9F6F0' },
  tierDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    marginRight: 12,
  },
  tierContent: { flex: 1 },
  tierTopRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  tierLabel: { fontSize: 14, color: DEEP_INK, fontFamily: 'Plus Jakarta Sans' },
  tierRange: { fontSize: 12, color: GREY, fontFamily: 'Plus Jakarta Sans' },
  tierDesc: { fontSize: 12, color: GREY, fontFamily: 'Plus Jakarta Sans', lineHeight: 17 },
  youBadge: {
    backgroundColor: VERDIGRIS,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 8,
    alignSelf: 'flex-start',
  },
  youBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },

  // DPDP
  dpdpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
  },
  dpdpText: {
    flex: 1,
    fontSize: 13,
    color: DEEP_INK,
    fontFamily: 'Plus Jakarta Sans',
    lineHeight: 18,
  },
});
