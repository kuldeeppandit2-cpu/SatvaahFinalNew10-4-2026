/**
 * TrustBiographyScreen.tsx
 * Phase 24 — Provider Verification
 *
 * Chronological timeline from trust_score_history (IMMUTABLE).
 * Peer context + "This record belongs to you. Not to SatvAAh."
 * Professional identity statement — the emotional centrepiece.
 *
 * V008 trust_score_history: IMMUTABLE. provider_id, event_type, delta_pts,
 * new_display_score, new_tier, event_at. Belongs to provider forever.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Share,
  Platform,
  StatusBar,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '../../stores/auth.store';
import { useProviderStore } from '../../stores/provider.store';
import { apiClient } from '../../api/client';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { ProviderStackParamList } from '../../navigation/ProviderStack';
import { TrustScoreHistory, TrustTier } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type NavProp = NativeStackNavigationProp<ProviderStackParamList, 'TrustBiography'>;

interface TrustEvent {
  id: string;
  eventType: string;
  delta_pts: number;
  new_display_score: number;
  newTier: TrustTier | null;
  event_at: string;
}

interface PeerContext {
  percentile: number;
  city: string;
  category: string;
  peerCount: number;
}

interface ProviderBiographyData {
  providerName: string;
  listingType: string;
  history: TrustEvent[];
  peerContext: PeerContext;
  current_score: number;
  current_tier: TrustTier;
  memberSince: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EVENT_META: Record<string, { label: string; icon: string; color: string }> = {
  otp_verified: { label: 'Phone verified', icon: '📱', color: '#4A90D9' },
  profileCompleted: { label: 'Profile completed', icon: '✏️', color: '#7B68EE' },
  aadhaar_verified: { label: 'Aadhaar verified', icon: '🛡️', color: COLORS.verdigris },
  credential_verified: { label: 'Credential verified', icon: '📜', color: '#27AE60' },
  linkedin_verified: { label: 'LinkedIn verified', icon: '💼', color: '#0077B5' },
  websiteVerified: { label: 'Website verified', icon: '🌐', color: '#E67E22' },
  rating_received: { label: 'Rating received', icon: '⭐', color: COLORS.saffron },
  tierChange: { label: 'Tier upgraded', icon: '🏅', color: COLORS.saffron },
  hasProfilePhoto: { label: 'Photo added', icon: '📸', color: '#8E44AD' },
  isGeoVerified: { label: 'Location verified', icon: '📍', color: '#16A085' },
  contact_accepted: { label: 'Lead accepted', icon: '🤝', color: '#2980B9' },
  subscription_activated: { label: 'Subscription activated', icon: '💎', color: '#C8691A' },
  hasCredentials: { label: 'Establishment verified', icon: '🏢', color: '#34495E' },
};

const TIER_LABELS: Record<TrustTier, string> = {
  unverified:     'Unverified',
  basic:          'Basic',
  trusted:        'Trusted',
  highly_trusted: 'Highly Trusted',
};

const TIER_COLORS: Record<TrustTier, string> = {
  unverified:     '#6B6560',
  basic:          '#AAAABC',
  trusted:        COLORS.lightVerdigris,
  highly_trusted: COLORS.verdigris,
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
};

const formatMonth = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
};

// Group events by month
const groupByMonth = (events: TrustEvent[]): { month: string; events: TrustEvent[] }[] => {
  const map = new Map<string, TrustEvent[]>();
  for (const e of events) {
    const month = formatMonth(e.eventAt);
    if (!map.has(month)) map.set(month, []);
    map.get(month)!.push(e);
  }
  return Array.from(map.entries()).map(([month, evs]) => ({ month, events: evs }));
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface TimelineEventProps {
  event: TrustEvent;
  isLast: boolean;
  index: number;
}

const TimelineEvent: React.FC<TimelineEventProps> = ({ event, isLast, index }) => {
  const meta = EVENT_META[event.eventType] ?? {
    label: event.eventType.replace(/_/g, ' '),
    icon: '•',
    color: '#8888A0',
  };

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        delay: index * 60,
        useNativeDriver: true,
      }),
      Animated.timing(translateAnim, {
        toValue: 0,
        duration: 350,
        delay: index * 60,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.eventRow,
        { opacity: fadeAnim, transform: [{ translateY: translateAnim }] },
      ]}
    >
      {/* Timeline line + dot */}
      <View style={styles.timelineColumn}>
        <View style={[styles.timelineDot, { backgroundColor: meta.color }]}>
          <Text style={styles.timelineIcon}>{meta.icon}</Text>
        </View>
        {!isLast && <View style={styles.timelineLine} />}
      </View>

      {/* Event card */}
      <View style={styles.eventCard}>
        <View style={styles.eventHeader}>
          <Text style={styles.eventLabel}>{meta.label}</Text>
          {event.deltaPts > 0 && (
            <View style={[styles.deltaBadge, { backgroundColor: `${meta.color}18` }]}>
              <Text style={[styles.deltaText, { color: meta.color }]}>
                +{event.deltaPts} pts
              </Text>
            </View>
          )}
        </View>
        <View style={styles.eventFooter}>
          <Text style={styles.eventDate}>{formatDate(event.eventAt)}</Text>
          <Text style={styles.eventScore}>Score: {event.newDisplayScore}</Text>
          {event.newTier && (
            <View
              style={[
                styles.eventTierBadge,
                { backgroundColor: `${TIER_COLORS[event.newTier]}20` },
              ]}
            >
              <Text
                style={[styles.eventTierText, { color: TIER_COLORS[event.newTier] }]}
              >
                {TIER_LABELS[event.newTier]}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
};

// ─── Main Screen ─────────────────────────────────────────────────────────────

export const TrustBiographyScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();
  const { accessToken } = useAuthStore();
  const profile = useProviderStore((s) => s.profile);

  const [data, setData] = useState<ProviderBiographyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hero text animation
  const heroFade = useRef(new Animated.Value(0)).current;
  const heroTranslate = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    fetchBiography();
  }, []);

  const fetchBiography = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const providerId = profile?.id;
      if (!providerId) { setError('Profile not loaded.'); return; }
      const res = await apiClient.get(`/api/v1/trust/${providerId}/history`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      // Backend: { success, data: events[], peerContext, meta }
      setData({ ...res.data, history: res.data.data ?? [] });
      playHeroAnimation();
    } catch (err: any) {
      setError('Could not load your Trust Biography. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const playHeroAnimation = () => {
    Animated.parallel([
      Animated.timing(heroFade, {
        toValue: 1,
        duration: 700,
        delay: 200,
        useNativeDriver: true,
      }),
      Animated.timing(heroTranslate, {
        toValue: 0,
        duration: 600,
        delay: 200,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleShare = async () => {
    if (!data) return;
    try {
      await Share.share({
        message: `My SatvAAh Trust Score is ${data.meta?.currentScore ?? data.current_score}. I'm in the top ${100 - data.peerContext.percentile}% of ${data.peerContext.category} providers in ${data.peerContext.city}. satvaaah.com`,
        title: `${data.providerName} — SatvAAh Trust Biography`,
      });
    } catch (_) {}
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScreenHeader title="Trust Biography" onBack={() => navigation.goBack()} />
        <View style={styles.loadingState}>
          <View style={styles.loadingPulse} />
          <View style={[styles.loadingPulse, { width: '80%', marginTop: SPACING.sm }]} />
          <View style={[styles.loadingPulse, { width: '60%', marginTop: SPACING.sm }]} />
        </View>
      </SafeAreaView>
    );
  }

  const grouped = data ? groupByMonth([...data.history].reverse()) : [];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.ivory} />

      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.navBack}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Trust Biography</Text>
        <TouchableOpacity onPress={handleShare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.navShare}>Share</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchBiography(true)}
            tintColor={COLORS.verdigris}
          />
        }
      >
        {/* ── Emotional centrepiece ──────────────────────────────────────── */}
        {data && (
          <Animated.View
            style={[
              styles.identityCard,
              { opacity: heroFade, transform: [{ translateY: heroTranslate }] },
            ]}
          >
            <View style={styles.identityHeader}>
              <View
                style={[
                  styles.identityTierBadge,
                  { backgroundColor: `${TIER_COLORS[data.currentTier]}20` },
                ]}
              >
                <Text style={[styles.identityTierText, { color: TIER_COLORS[data.currentTier] }]}>
                  🏅 {TIER_LABELS[data.currentTier]}
                </Text>
              </View>
              <View style={styles.identityScoreBox}>
                <Text style={styles.identityScoreNum}>{data.meta?.currentScore ?? data.current_score}</Text>
                <Text style={styles.identityScoreLabel}>Trust Score</Text>
              </View>
            </View>

            <Text style={styles.identityName}>{data.providerName}</Text>
            <Text style={styles.identityCategory}>{data.listingType}</Text>

            {/* THE emotional statement */}
            <View style={styles.ownershipStatement}>
              <Text style={styles.ownershipQuote}>
                "This record belongs to you.{'\n'}Not to SatvAAh."
              </Text>
              <Text style={styles.ownershipBody}>
                Every point you see below was earned by you — through your work, your verifications,
                and the trust of the people you served. This biography travels with you. It cannot be
                taken away. It is yours.
              </Text>
            </View>

            {/* Member since */}
            <View style={styles.memberSince}>
              <Text style={styles.memberSinceIcon}>📅</Text>
              <Text style={styles.memberSinceText}>
                On SatvAAh since {formatDate(data.memberSince)}
              </Text>
            </View>
          </Animated.View>
        )}

        {/* ── Peer context ───────────────────────────────────────────────── */}
        {data?.peerContext && (
          <View style={styles.peerCard}>
            <Text style={styles.peerTitle}>How you compare</Text>
            <View style={styles.peerRow}>
              <View style={styles.peerStat}>
                <Text style={styles.peerStatNum}>
                  Top {100 - data.peerContext.percentile}%
                </Text>
                <Text style={styles.peerStatLabel}>
                  of {data.peerContext.category} providers
                </Text>
              </View>
              <View style={styles.peerDivider} />
              <View style={styles.peerStat}>
                <Text style={styles.peerStatNum}>{data.peerContext.peerCount.toLocaleString('en-IN')}</Text>
                <Text style={styles.peerStatLabel}>
                  providers in {data.peerContext.city}
                </Text>
              </View>
            </View>
            <Text style={styles.peerNote}>
              Percentile is updated monthly. It reflects verified providers only.
            </Text>
          </View>
        )}

        {/* ── Chronological timeline ─────────────────────────────────────── */}
        {data && (
          <View style={styles.timelineSection}>
            <Text style={styles.timelineTitle}>Your journey</Text>
            <Text style={styles.timelineSubtitle}>
              {data.history.length} events since you joined
            </Text>

            {grouped.map(({ month, events }, gi) => (
              <View key={month} style={styles.monthGroup}>
                <View style={styles.monthHeader}>
                  <Text style={styles.monthLabel}>{month}</Text>
                  <View style={styles.monthDivider} />
                </View>
                {events.map((event, ei) => (
                  <TimelineEvent
                    key={event.id}
                    event={event}
                    isLast={ei === events.length - 1 && gi === grouped.length - 1}
                    index={gi * 10 + ei}
                  />
                ))}
              </View>
            ))}
          </View>
        )}

        {/* ── Professional identity footer ───────────────────────────────── */}
        {data && (
          <View style={styles.identityFooter}>
            <Text style={styles.identityFooterIcon}>🌟</Text>
            <Text style={styles.identityFooterTitle}>
              Your professional identity
            </Text>
            <Text style={styles.identityFooterBody}>
              You are a{' '}
              <Text style={styles.identityFooterBold}>{data.listingType}</Text> provider
              in <Text style={styles.identityFooterBold}>{data.peerContext?.city}</Text>,
              with a trust score of{' '}
              <Text style={styles.identityFooterBold}>{data.meta?.currentScore ?? data.current_score}</Text> earned
              entirely through verified actions and real customer voice. This is the record
              of your professional life on SatvAAh — portable, permanent, and yours.
            </Text>

            <TouchableOpacity style={styles.shareFooterCta} onPress={handleShare}>
              <Text style={styles.shareFooterCtaText}>Share your biography</Text>
            </TouchableOpacity>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => fetchBiography()}>
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
  safeArea: {
    flex: 1,
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
  navBack: {
    fontFamily: FONTS.semiBold,
    fontSize: 20,
    color: COLORS.deepInk,
  },
  navTitle: {
    fontFamily: FONTS.bold,
    fontSize: 17,
    color: COLORS.deepInk,
  },
  navShare: {
    fontFamily: FONTS.semiBold,
    fontSize: 15,
    color: COLORS.verdigris,
  },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl * 2,
  },

  // Loading
  loadingState: {
    padding: SPACING.xl,
    gap: SPACING.sm,
  },
  loadingPulse: {
    height: 20,
    borderRadius: RADIUS.sm,
    backgroundColor: '#E8E8EF',
    width: '100%',
  },

  // Identity card
  identityCard: {
    backgroundColor: COLORS.deepInk,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    marginBottom: SPACING.lg,
  },
  identityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  identityTierBadge: {
    borderRadius: 20,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  identityTierText: {
    fontFamily: FONTS.semiBold,
    fontSize: 13,
  },
  identityScoreBox: {
    alignItems: 'center',
  },
  identityScoreNum: {
    fontFamily: FONTS.bold,
    fontSize: 36,
    color: '#fff',
    lineHeight: 38,
  },
  identityScoreLabel: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  identityName: {
    fontFamily: FONTS.bold,
    fontSize: 24,
    color: '#fff',
    marginBottom: 4,
  },
  identityCategory: {
    fontFamily: FONTS.medium,
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'capitalize',
    marginBottom: SPACING.lg,
  },
  ownershipStatement: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.verdigris,
    paddingLeft: SPACING.md,
    marginBottom: SPACING.lg,
  },
  ownershipQuote: {
    fontFamily: FONTS.bold,
    fontSize: 18,
    color: '#fff',
    lineHeight: 26,
    marginBottom: SPACING.sm,
    fontStyle: 'italic',
  },
  ownershipBody: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 20,
  },
  memberSince: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  memberSinceIcon: { fontSize: 14 },
  memberSinceText: {
    fontFamily: FONTS.medium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
  },

  // Peer context
  peerCard: {
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
  peerTitle: {
    fontFamily: FONTS.bold,
    fontSize: 15,
    color: COLORS.deepInk,
    marginBottom: SPACING.md,
  },
  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  peerStat: {
    flex: 1,
    alignItems: 'center',
  },
  peerStatNum: {
    fontFamily: FONTS.bold,
    fontSize: 22,
    color: COLORS.verdigris,
    marginBottom: 2,
  },
  peerStatLabel: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: '#8888A0',
    textAlign: 'center',
  },
  peerDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#E8E8EF',
  },
  peerNote: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: '#AAAABC',
    textAlign: 'center',
    marginTop: SPACING.xs,
  },

  // Timeline
  timelineSection: {
    marginBottom: SPACING.lg,
  },
  timelineTitle: {
    fontFamily: FONTS.bold,
    fontSize: 18,
    color: COLORS.deepInk,
    marginBottom: 4,
  },
  timelineSubtitle: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: '#8888A0',
    marginBottom: SPACING.lg,
  },
  monthGroup: {
    marginBottom: SPACING.md,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  monthLabel: {
    fontFamily: FONTS.semiBold,
    fontSize: 13,
    color: '#8888A0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flexShrink: 0,
  },
  monthDivider: {
    flex: 1,
    height: 1,
    backgroundColor: '#E8E8EF',
  },
  eventRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: 0,
  },
  timelineColumn: {
    alignItems: 'center',
    width: 40,
  },
  timelineDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  timelineIcon: { fontSize: 16 },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#E8E8EF',
    minHeight: 20,
    marginTop: 4,
  },
  eventCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  eventLabel: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: COLORS.deepInk,
    flex: 1,
  },
  deltaBadge: {
    borderRadius: 12,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  deltaText: {
    fontFamily: FONTS.bold,
    fontSize: 13,
  },
  eventFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  eventDate: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: '#AAAABC',
  },
  eventScore: {
    fontFamily: FONTS.medium,
    fontSize: 12,
    color: '#8888A0',
  },
  eventTierBadge: {
    borderRadius: 10,
    paddingHorizontal: SPACING.xs + 2,
    paddingVertical: 1,
  },
  eventTierText: {
    fontFamily: FONTS.semiBold,
    fontSize: 11,
  },

  // Identity footer
  identityFooter: {
    backgroundColor: COLORS.warmSand,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  identityFooterIcon: {
    fontSize: 36,
    marginBottom: SPACING.sm,
  },
  identityFooterTitle: {
    fontFamily: FONTS.bold,
    fontSize: 20,
    color: COLORS.deepInk,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  identityFooterBody: {
    fontFamily: FONTS.regular,
    fontSize: 15,
    color: '#5A5A6E',
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: SPACING.lg,
  },
  identityFooterBold: {
    fontFamily: FONTS.semiBold,
    color: COLORS.deepInk,
  },
  shareFooterCta: {
    backgroundColor: COLORS.deepInk,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  shareFooterCtaText: {
    fontFamily: FONTS.semiBold,
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
  errorText: {
    fontFamily: FONTS.medium,
    fontSize: 14,
    color: '#C0392B',
    flex: 1,
  },
  errorRetry: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: COLORS.verdigris,
    marginLeft: SPACING.sm,
  },
});

export default TrustBiographyScreen;
