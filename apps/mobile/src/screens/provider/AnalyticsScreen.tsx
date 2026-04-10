/**
 * AnalyticsScreen.tsx
 * Phase 24 — Provider Verification
 *
 * Period selector (7d / 30d / year).
 * AI narration from GAAS (Claude Sonnet 4.6 via services/admin port 3009).
 * Charts: profile views, contacts, trust trend, search appearances.
 * Silver+ gets full dashboard. Bronze gets summary only (upgrade prompt shown).
 *
 * Subscription tiers: bronze | silver | gold | platinum
 * GAAS = AI narration generated nightly by lambdas/ai-narration (Claude Sonnet 4.6)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  RefreshControl,
  Platform,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Svg, { Path, Line, Circle, Text as SvgText, Rect } from 'react-native-svg';
import { useAuthStore } from '../../stores/auth.store';
import { useProviderStore } from '../../stores/provider.store';
import { apiClient } from '../../api/client';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { ProviderStackParamList } from '../../navigation/ProviderStack';
import { SubscriptionTier } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type NavProp = NativeStackNavigationProp<ProviderStackParamList, 'Analytics'>;
type Period = '7d' | '30d' | 'year';

interface DataPoint {
  label: string;
  value: number;
}

interface AnalyticsSummary {
  profileViews: number;
  profileViewsDelta: number;
  contacts: number;
  contactsDelta: number;
  searchAppearances: number;
  searchAppearancesDelta: number;
  avg_response_time_hrs: number;
  conversion_rate: number; // contacts / views
}

interface AnalyticsData {
  period: Period;
  summary: AnalyticsSummary;
  profileViewsSeries: DataPoint[];
  contactsSeries: DataPoint[];
  trustTrendSeries: DataPoint[];
  searchAppearancesSeries: DataPoint[];
  aiNarration: string | null;
  narrationGeneratedAt: string | null;
  subscriptionTier: SubscriptionTier;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');
const CHART_W = SCREEN_W - SPACING.lg * 2 - SPACING.md * 2; // card inner width
const CHART_H = 140;

const PERIODS: { key: Period; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'year', label: '1 year' },
];

const FULL_DASHBOARD_TIERS: SubscriptionTier[] = ['silver', 'gold', 'platinum'];

// ─── Sparkline chart component ───────────────────────────────────────────────

interface SparklineProps {
  data: DataPoint[];
  color?: string;
  width?: number;
  height?: number;
  showLabels?: boolean;
  filled?: boolean;
}

const Sparkline: React.FC<SparklineProps> = ({
  data,
  color = COLORS.verdigris,
  width = CHART_W,
  height = CHART_H,
  showLabels = false,
  filled = true,
}) => {
  if (!data || data.length < 2) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: '#AAAABC' }}>
          No data
        </Text>
      </View>
    );
  }

  const pad = { top: 10, right: 8, bottom: showLabels ? 28 : 8, left: 8 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const vals = data.map(d => d.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;

  const x = (i: number) => pad.left + (i / (data.length - 1)) * plotW;
  const y = (v: number) => pad.top + plotH - ((v - minV) / range) * plotH;

  // Build SVG path
  const pathD = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`)
    .join(' ');

  const fillD =
    pathD +
    ` L ${x(data.length - 1).toFixed(1)} ${(pad.top + plotH).toFixed(1)}` +
    ` L ${pad.left.toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z`;

  // Pick 4 evenly spaced label indices
  const labelIndices = showLabels
    ? [0, Math.floor(data.length / 3), Math.floor((2 * data.length) / 3), data.length - 1]
    : [];

  return (
    <Svg width={width} height={height}>
      {/* Gridlines */}
      {[0.25, 0.5, 0.75, 1].map(t => (
        <Line
          key={t}
          x1={pad.left}
          y1={pad.top + plotH * (1 - t)}
          x2={pad.left + plotW}
          y2={pad.top + plotH * (1 - t)}
          stroke="#F0F0F5"
          strokeWidth={1}
          strokeDasharray="4,4"
        />
      ))}

      {/* Filled area */}
      {filled && (
        <Path d={fillD} fill={color} fillOpacity={0.1} />
      )}

      {/* Line */}
      <Path d={pathD} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* Last point dot */}
      <Circle
        cx={x(data.length - 1)}
        cy={y(data[data.length - 1].value)}
        r={4}
        fill={color}
      />

      {/* X labels */}
      {labelIndices.map(i => (
        <SvgText
          key={i}
          x={x(i)}
          y={height - 4}
          textAnchor="middle"
          fontSize={10}
          fill="#AAAABC"
          fontFamily={FONTS.regular}
        >
          {data[i]?.label ?? ''}
        </SvgText>
      ))}
    </Svg>
  );
};

// ─── Stat card component ─────────────────────────────────────────────────────

interface StatCardProps {
  icon: string;
  label: string;
  value: string | number;
  delta?: number;
  deltaLabel?: string;
  blurred?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, delta, deltaLabel, blurred }) => {
  const isPositive = delta !== undefined && delta >= 0;

  return (
    <View style={[statStyles.card, blurred && statStyles.cardBlurred]}>
      <Text style={statStyles.icon}>{icon}</Text>
      <Text style={[statStyles.value, blurred && statStyles.blurredText]}>
        {blurred ? '—' : value}
      </Text>
      <Text style={statStyles.label}>{label}</Text>
      {delta !== undefined && !blurred && (
        <View
          style={[
            statStyles.deltaBadge,
            { backgroundColor: isPositive ? '#E8F5F3' : '#FFF0F0' },
          ]}
        >
          <Text
            style={[
              statStyles.deltaText,
              { color: isPositive ? COLORS.verdigris : '#C0392B' },
            ]}
          >
            {isPositive ? '↑' : '↓'} {Math.abs(delta)}%{' '}
            <Text style={statStyles.deltaLabel}>{deltaLabel}</Text>
          </Text>
        </View>
      )}
    </View>
  );
};

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    minWidth: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cardBlurred: {
    backgroundColor: '#F8F8FA',
  },
  icon: { fontSize: 22, marginBottom: 4 },
  value: {
    fontFamily: FONTS.bold,
    fontSize: 24,
    color: COLORS.deepInk,
    marginBottom: 2,
  },
  blurredText: { color: '#D0D0DC' },
  label: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: '#AAAABC',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: SPACING.xs,
  },
  deltaBadge: {
    borderRadius: 12,
    paddingHorizontal: SPACING.xs + 2,
    paddingVertical: 2,
  },
  deltaText: {
    fontFamily: FONTS.semiBold,
    fontSize: 11,
  },
  deltaLabel: {
    fontFamily: FONTS.regular,
    fontSize: 10,
    color: '#8888A0',
  },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export const AnalyticsScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();
  const { accessToken } = useAuthStore();
  const subscriptionTier = useAuthStore((s) => s.subscriptionTier);

  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const narrationFade = useRef(new Animated.Value(0)).current;

  const isFullDashboard = FULL_DASHBOARD_TIERS.includes(
    (subscriptionTier || data?.subscriptionTier || 'bronze') as SubscriptionTier
  );

  useEffect(() => {
    fetchAnalytics(period);
  }, [period]);

  const fetchAnalytics = async (p: Period, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    narrationFade.setValue(0);

    try {
      const res = await apiClient.get(`/api/v1/providers/me/analytics?period=${p}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setData(res.data.data);

      if (res.data.data?.aiNarration) {
        Animated.timing(narrationFade, {
          toValue: 1,
          duration: 600,
          delay: 300,
          useNativeDriver: true,
        }).start();
      }
    } catch (err: any) {
      setError('Could not load analytics. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const renderBronzeGate = () => (
    <View style={styles.upgradeGate}>
      <Text style={styles.upgradeGateIcon}>📊</Text>
      <Text style={styles.upgradeGateTitle}>Full analytics available on Silver+</Text>
      <Text style={styles.upgradeGateBody}>
        Upgrade to Silver or above to unlock detailed charts, trend analysis, search
        appearances, and your weekly AI narration from SatvAAh's analytics engine.
      </Text>
      <TouchableOpacity
        style={styles.upgradeGateCta}
        onPress={() => navigation.navigate('ProviderSubscription')}
      >
        <Text style={styles.upgradeGateCtaText}>Upgrade now — from ₹3,000/yr</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={COLORS.verdigris} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.ivory} />

      {/* Nav */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.navBack}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Analytics</Text>
        <View style={styles.tierPill}>
          <Text style={styles.tierPillText}>
            {(subscriptionTier || 'bronze').charAt(0).toUpperCase() +
              (subscriptionTier || 'bronze').slice(1)}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchAnalytics(period, true)}
            tintColor={COLORS.verdigris}
          />
        }
      >
        {/* Period selector */}
        <View style={styles.periodSelector}>
          {PERIODS.map(p => (
            <TouchableOpacity
              key={p.key}
              style={[styles.periodTab, period === p.key && styles.periodTabActive]}
              onPress={() => setPeriod(p.key)}
            >
              <Text
                style={[
                  styles.periodTabText,
                  period === p.key && styles.periodTabTextActive,
                ]}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* AI Narration (GAAS) */}
        {data?.aiNarration && (
          <Animated.View style={[styles.narrationCard, { opacity: narrationFade }]}>
            <View style={styles.narrationHeader}>
              <Text style={styles.narrationAiIcon}>✨</Text>
              <Text style={styles.narrationTitle}>SatvAAh AI — Your week in review</Text>
            </View>
            <Text style={styles.narrationText}>{data.aiNarration}</Text>
            {data.narrationGeneratedAt && (
              <Text style={styles.narrationTimestamp}>
                Generated{' '}
                {new Date(data.narrationGeneratedAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'Asia/Kolkata',
                })}
              </Text>
            )}
          </Animated.View>
        )}

        {/* Summary stats row */}
        {data && (
          <>
            <Text style={styles.sectionLabel}>Overview</Text>
            <View style={styles.statsRow}>
              <StatCard
                icon="👁️"
                label="Profile Views"
                value={data.summary.profileViews.toLocaleString('en-IN')}
                delta={data.summary.profileViews_delta}
                deltaLabel="vs prev"
              />
              <StatCard
                icon="🤝"
                label="Contacts"
                value={data.summary.contacts.toLocaleString('en-IN')}
                delta={data.summary.contactsDelta}
                deltaLabel="vs prev"
              />
            </View>
            <View style={[styles.statsRow, { marginTop: SPACING.sm }]}>
              <StatCard
                icon="🔍"
                label="Searches"
                value={
                  isFullDashboard
                    ? data.summary.searchAppearances.toLocaleString('en-IN')
                    : '—'
                }
                blurred={!isFullDashboard}
              />
              <StatCard
                icon="📈"
                label="Conversion"
                value={
                  isFullDashboard
                    ? `${(data.summary.conversion_rate * 100).toFixed(1)}%`
                    : '—'
                }
                blurred={!isFullDashboard}
              />
            </View>

            {/* Profile views chart */}
            <Text style={styles.sectionLabel}>Profile views</Text>
            <View style={styles.chartCard}>
              <Sparkline
                data={data.profileViewsSeries}
                color={COLORS.saffron}
                showLabels
              />
            </View>

            {/* Contacts chart */}
            <Text style={styles.sectionLabel}>Contacts received</Text>
            <View style={styles.chartCard}>
              <Sparkline
                data={data.contactsSeries}
                color={COLORS.verdigris}
                showLabels
              />
            </View>

            {/* Full dashboard: trust trend + search */}
            {isFullDashboard ? (
              <>
                <Text style={styles.sectionLabel}>Trust score trend</Text>
                <View style={styles.chartCard}>
                  <Sparkline
                    data={data.trustTrendSeries}
                    color="#7B68EE"
                    showLabels
                    filled={false}
                  />
                </View>

                <Text style={styles.sectionLabel}>Search appearances</Text>
                <View style={styles.chartCard}>
                  <Sparkline
                    data={data.searchAppearancesSeries}
                    color={COLORS.deepInk}
                    showLabels
                  />
                </View>
              </>
            ) : (
              renderBronzeGate()
            )}
          </>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => fetchAnalytics(period)}>
              <Text style={styles.errorRetry}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.ivory },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  tierPill: {
    backgroundColor: COLORS.warmSand,
    borderRadius: 14,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  tierPillText: {
    fontFamily: FONTS.semiBold,
    fontSize: 12,
    color: COLORS.saffron,
    textTransform: 'capitalize',
  },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl * 2,
  },

  // Period selector
  periodSelector: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 4,
    marginBottom: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  periodTab: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    borderRadius: RADIUS.md,
  },
  periodTabActive: { backgroundColor: COLORS.deepInk },
  periodTabText: {
    fontFamily: FONTS.medium,
    fontSize: 14,
    color: '#8888A0',
  },
  periodTabTextActive: { color: '#fff', fontFamily: FONTS.semiBold },

  // AI Narration
  narrationCard: {
    backgroundColor: COLORS.deepInk,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  narrationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.md,
  },
  narrationAiIcon: { fontSize: 18 },
  narrationTitle: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  narrationText: {
    fontFamily: FONTS.regular,
    fontSize: 15,
    color: '#fff',
    lineHeight: 23,
    marginBottom: SPACING.sm,
  },
  narrationTimestamp: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
  },

  sectionLabel: {
    fontFamily: FONTS.bold,
    fontSize: 15,
    color: COLORS.deepInk,
    marginBottom: SPACING.sm,
    marginTop: SPACING.sm,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },

  // Chart
  chartCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },

  // Upgrade gate
  upgradeGate: {
    backgroundColor: COLORS.warmSand,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    alignItems: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
  },
  upgradeGateIcon: { fontSize: 40, marginBottom: SPACING.sm },
  upgradeGateTitle: {
    fontFamily: FONTS.bold,
    fontSize: 18,
    color: COLORS.deepInk,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  upgradeGateBody: {
    fontFamily: FONTS.regular,
    fontSize: 14,
    color: '#5A5A6E',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: SPACING.lg,
  },
  upgradeGateCta: {
    backgroundColor: COLORS.saffron,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  upgradeGateCtaText: {
    fontFamily: FONTS.bold,
    fontSize: 15,
    color: '#fff',
  },

  // Error
  errorBanner: {
    backgroundColor: '#FFF3F3',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorText: { fontFamily: FONTS.medium, fontSize: 14, color: '#C0392B', flex: 1 },
  errorRetry: { fontFamily: FONTS.semiBold, fontSize: 14, color: COLORS.verdigris },
});

export default AnalyticsScreen;
