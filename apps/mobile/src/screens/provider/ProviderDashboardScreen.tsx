/**
 * ProviderDashboardScreen.tsx
 * SatvAAh · Phase 23 · Provider Dashboard
 *
 * Trust ring 120px SVG animated via WebSocket /trust namespace.
 * Live updates: trust_score_updated event → ring animates to new score.
 * Availability toggle broadcasts via REST + consumer sees within 1s.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../../stores/auth.store';
import { useProviderStore } from '../../stores/provider.store';
import {
  getProviderDashboard,
  getTrustMe,
  updateAvailability,
} from '../../api/provider.api';

// ─── Constants ───────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');
const WS_BASE_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'http://localhost:3002';

const COLORS = {
  saffron:       '#C8691A',
  deepInk:       '#1C1C2E',
  ivory:         '#FAF7F0',
  verdigris:     '#2E7D72',
  ltVerdigris:   '#6BA89E',
  warmSand:      '#F0E4CC',
  terracotta:    '#C0392B',
  grey:          '#6B6560',
  white:         '#FFFFFF',
  border:        '#E8E0D0',
  successGreen:  '#27AE60',
  cardBg:        '#FFFFFF',
} as const;

// Trust tier thresholds (mirrors system_config — never hardcode in prod, loaded from API)
const TIER_THRESHOLD = { basic: 20, trusted: 60, highly_trusted: 80 } as const;

type TrustTier = 'unverified' | 'basic' | 'trusted' | 'highly_trusted';
type AvailabilityStatus = 'available_now' | 'by_appointment' | 'unavailable';

function tierFromScore(score: number): TrustTier {
  if (score >= 80) return 'highly_trusted';
  if (score >= 60) return 'trusted';
  if (score >= 20) return 'basic';
  return 'unverified';
}

function tierColor(tier: TrustTier): string {
  switch (tier) {
    case 'highly_trusted': return COLORS.verdigris;
    case 'trusted':        return COLORS.ltVerdigris;
    case 'basic':          return COLORS.saffron;
    default:               return COLORS.grey;
  }
}

function tierLabel(tier: TrustTier): string {
  switch (tier) {
    case 'highly_trusted': return 'Highly Trusted';
    case 'trusted':        return 'Trusted';
    case 'basic':          return 'Basic';
    default:               return 'Unverified';
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface MomentumItem {
  signal: string;
  delta: number;
}

interface TrustMomentum {
  deltaPtsWeek: number;
  items: MomentumItem[];
}

interface NextAction {
  signalName: string;
  ptsAvailable: number;
  wouldUnlockTier: string | null;
  screen: string;    // navigation target name
}

interface DashboardData {
  providerId: string;
  displayName: string;
  trustScore: number;
  trustTier: TrustTier;
  customerVoiceWeight: number;       // e.g. 0.65 → "65% of score"
  customerVoiceRatingCount: number; // 342
  monthsSinceJoin: number;           // 14
  initialScore: number;               // always 20
  momentum: TrustMomentum | null;
  next_action: NextAction | null;
  earningsThisYearPaise: number;    // 1842000 = Rs 18,420
  competitorCommissionRate: number;  // 0.25
  availabilityStatus: AvailabilityStatus;
  subscriptionTier: string;           // free | silver | gold
}

// ─── Trust Ring SVG ──────────────────────────────────────────────────────────

const RING_SIZE   = 140;
const RING_CX     = RING_SIZE / 2;
const RING_CY     = RING_SIZE / 2;
const RING_RADIUS = 54;
const RING_STROKE = 9;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface TrustRingProps {
  score: number;
  tier: TrustTier;
  animValue: Animated.Value; // 0 → 1 = 0 → 100 pts
  wsConnected: boolean;
}

function TrustRing({ score, tier, animValue, wsConnected }: TrustRingProps) {
  const color = tierColor(tier);
  const label = tierLabel(tier);

  const strokeDashoffset = animValue.interpolate({
    inputRange: [0, 100],
    outputRange: [CIRCUMFERENCE, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.ringContainer}>
      {/* Live indicator dot */}
      {wsConnected && (
        <View style={styles.wsLiveDot} />
      )}
      <Svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      >
        {/* Track circle */}
        <Circle
          cx={RING_CX}
          cy={RING_CY}
          r={RING_RADIUS}
          stroke={COLORS.border}
          strokeWidth={RING_STROKE}
          fill="none"
        />
        {/* Animated progress arc — rotate so it starts at top */}
        <G rotation="-90" origin={`${RING_CX}, ${RING_CY}`}>
          <AnimatedCircle
            cx={RING_CX}
            cy={RING_CY}
            r={RING_RADIUS}
            stroke={color}
            strokeWidth={RING_STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={strokeDashoffset}
          />
        </G>
      </Svg>
      {/* Score + tier overlay */}
      <View style={styles.ringOverlay} pointerEvents="none">
        <Text style={[styles.ringScore, { color: COLORS.deepInk }]}>
          {score}
        </Text>
        <Text style={[styles.ringTierLabel, { color }]}>
          {label}
        </Text>
      </View>
    </View>
  );
}

// ─── Zero Commission Counter ──────────────────────────────────────────────────

function formatRs(paise: number): string {
  return Math.round(paise / 100).toLocaleString('en-IN');
}

// ─── Availability Status Badge ────────────────────────────────────────────────

function availabilityLabel(status: AvailabilityStatus): string {
  switch (status) {
    case 'available_now':   return 'Available Now';
    case 'by_appointment':  return 'By Appointment';
    case 'unavailable':     return 'Unavailable';
  }
}

function availabilityColor(status: AvailabilityStatus): string {
  switch (status) {
    case 'available_now':   return COLORS.verdigris;
    case 'by_appointment':  return COLORS.saffron;
    case 'unavailable':     return COLORS.grey;
  }
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ProviderDashboardScreen() {
  const navigation = useNavigation<any>();
  const { accessToken } = useAuthStore();

  const [dashboard,    setDashboard]    = useState<DashboardData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [wsConnected,  setWsConnected]  = useState(false);
  const isFirstConnect = useRef(true); // REST catchup on reconnect — not on first connect
  const [avail,        setAvail]        = useState<AvailabilityStatus>('available_now');
  const [availSaving,  setAvailSaving]  = useState(false);

  // Animated value for trust ring (current score, 0–100)
  const ringAnim = useRef(new Animated.Value(0)).current;
  const socketRef = useRef<Socket | null>(null);

  // ── Fetch Dashboard ─────────────────────────────────────────────────────────
  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await getProviderDashboard();
      setDashboard(data);
      setAvail(data.availabilityStatus);
      // Animate ring to current score on first load
      Animated.timing(ringAnim, {
        toValue: data.trustScore,
        duration: 1200,
        useNativeDriver: false,
      }).start();
    } catch (err) {
      console.error('[Dashboard] loadDashboard error', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ringAnim]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // ── WebSocket /trust namespace ───────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken || !dashboard?.providerId) return;

    const socket = io(`${WS_BASE_URL}/trust`, {
      auth:       { token: accessToken },
      transports: ['websocket'],
      reconnectionDelay:    1000,
      reconnectionDelayMax: 30000,
    });

    socket.on('connect', () => {
      setWsConnected(true);
      // Join provider room (server may auto-join from JWT, but emit anyway)
      socket.emit('subscribe_trust', dashboard.providerId);
      if (isFirstConnect.current) {
        isFirstConnect.current = false;
      } else {
        // REST catchup — fetch score missed during disconnect (MASTER_CONTEXT)
        getTrustMe().then((trust) => {
          Animated.timing(ringAnim, {
            toValue: trust.displayScore,
            duration: 800,
            useNativeDriver: false,
          }).start();
          setDashboard((prev) => prev
            ? { ...prev, trustScore: trust.displayScore, trustTier: trust.trustTier }
            : prev);
        }).catch(() => {}); // silent — live WS will resume
      }
    });

    socket.on('disconnect', () => setWsConnected(false));

    socket.on('trust_score_updated', (payload: {
      score:     number;
      tier:      TrustTier;
      delta:     number;
      momentum?: TrustMomentum;
    }) => {
      // Animate ring to new score smoothly
      Animated.timing(ringAnim, {
        toValue:        payload.score,
        duration:       800,
        useNativeDriver: false,
      }).start();

      setDashboard(prev => prev ? {
        ...prev,
        trustScore: payload.score,
        trustTier:  payload.tier,
        momentum:    payload.momentum ?? prev.momentum,
      } : prev);
    });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken, dashboard?.providerId, ringAnim]);

  // ── Availability Toggle ──────────────────────────────────────────────────────
  const cycleAvailability = useCallback(async () => {
    const next: AvailabilityStatus =
      avail === 'available_now' ? 'unavailable' : 'available_now';

    setAvail(next);              // optimistic
    setAvailSaving(true);
    try {
      await updateAvailability({ status: next });
      // Server broadcasts to /availability namespace → consumers see within 1s
    } catch {
      setAvail(avail);           // rollback on error
    } finally {
      setAvailSaving(false);
    }
  }, [avail]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadDashboard(true);
  }, [loadDashboard]);

  // ── Derived Values ──────────────────────────────────────────────────────────
  const voicePct = useMemo(
    () => Math.round((dashboard?.customerVoiceWeight ?? 0) * 100),
    [dashboard?.customerVoiceWeight],
  );

  const competitorTaken = useMemo(() => {
    if (!dashboard) return 0;
    return Math.round(
      (dashboard.earningsThisYearPaise / 100) * dashboard.competitorCommissionRate,
    );
  }, [dashboard]);

  const currentTier = dashboard ? tierFromScore(dashboard.trustScore) : 'basic';
  const ringColor   = tierColor(currentTier);

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.saffron} />
      </SafeAreaView>
    );
  }

  if (!dashboard) return null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.saffron}
          />
        }
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Namaste,</Text>
            <Text style={styles.providerName} numberOfLines={1}>
              {dashboard.displayName}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('ProviderSettings')}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>

        {/* ── Trust Ring Card ──────────────────────────────────────────────── */}
        <View style={styles.card}>
          <TrustRing
            score={dashboard.trustScore}
            tier={currentTier}
            animValue={ringAnim}
            wsConnected={wsConnected}
          />

          {/* Trust Biography */}
          <Text style={styles.biographyText}>
            {dashboard.monthsSinceJoin} month
            {dashboard.monthsSinceJoin !== 1 ? 's' : ''} ago you joined at{' '}
            {dashboard.initialScore}. Today:{' '}
            <Text style={{ color: ringColor, fontFamily: 'PlusJakartaSans-Bold' }}>
              {dashboard.trustScore}
            </Text>
            .
          </Text>

          {/* Customer Voice Bar */}
          <View style={styles.voiceBarSection}>
            <View style={styles.voiceBarHeader}>
              <Text style={styles.voiceBarLabel}>Customer voice</Text>
              <Text style={styles.voiceBarValue}>
                {voicePct}% of score · {dashboard.customerVoiceRatingCount.toLocaleString('en-IN')} ratings
              </Text>
            </View>
            <View style={styles.voiceBarTrack}>
              <View
                style={[
                  styles.voiceBarFill,
                  { width: `${voicePct}%`, backgroundColor: ringColor },
                ]}
              />
            </View>
          </View>
        </View>

        {/* ── Trust Momentum Widget ────────────────────────────────────────── */}
        {dashboard.momentum && (
          <View style={styles.card}>
            <View style={styles.momentumHeader}>
              <Text style={styles.momentumArrow}>
                {dashboard.momentum.deltaPtsWeek >= 0 ? '↑' : '↓'}
              </Text>
              <Text style={[
                styles.momentumDelta,
                { color: dashboard.momentum.deltaPtsWeek >= 0 ? COLORS.verdigris : COLORS.terracotta },
              ]}>
                {dashboard.momentum.deltaPtsWeek >= 0 ? '+' : ''}
                {dashboard.momentum.deltaPtsWeek} pts this week
              </Text>
            </View>
            {dashboard.momentum.items.map((item, i) => (
              <View key={i} style={styles.momentumRow}>
                <Text style={styles.momentumSignal}>{item.signal}</Text>
                <Text style={[
                  styles.momentumItemDelta,
                  { color: item.delta >= 0 ? COLORS.verdigris : COLORS.terracotta },
                ]}>
                  {item.delta >= 0 ? '+' : ''}{item.delta}
                </Text>
              </View>
            ))}
            <TouchableOpacity
              onPress={() => navigation.navigate('TrustHistory')}
              style={styles.viewHistoryLink}
            >
              <Text style={styles.viewHistoryText}>Full history →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Next Action Card ─────────────────────────────────────────────── */}
        {dashboard.next_action && (
          <TouchableOpacity
            style={[styles.card, styles.nextActionCard]}
            onPress={() => navigation.navigate(dashboard.next_action!.screen)}
            activeOpacity={0.82}
          >
            <View style={styles.nextActionLeft}>
              <Text style={styles.nextActionEmoji}>🎯</Text>
              <View style={styles.nextActionText}>
                <Text style={styles.nextActionTitle}>
                  {dashboard.next_action.signalName}
                  {'  '}
                  <Text style={{ color: COLORS.verdigris }}>
                    +{dashboard.next_action.ptsAvailable} pts
                  </Text>
                </Text>
                {dashboard.next_action.wouldUnlockTier && (
                  <Text style={styles.nextActionSub}>
                    → {dashboard.next_action.wouldUnlockTier} today
                  </Text>
                )}
              </View>
            </View>
            <View style={[styles.nextActionBtn, { backgroundColor: ringColor }]}>
              <Text style={styles.nextActionBtnText}>Add Now</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* ── Zero Commission Counter ──────────────────────────────────────── */}
        <View style={[styles.card, styles.commissionCard]}>
          <Text style={styles.commissionEmoji}>💰</Text>
          <View style={styles.commissionText}>
            <Text style={styles.commissionTitle}>
              You have kept{' '}
              <Text style={{ color: COLORS.verdigris, fontFamily: 'PlusJakartaSans-Bold' }}>
                ₹{formatRs(dashboard.earningsThisYearPaise)}
              </Text>{' '}
              this year.
            </Text>
            <Text style={styles.commissionSub}>
              Other platforms: ₹{competitorTaken.toLocaleString('en-IN')} taken.
            </Text>
          </View>
        </View>

        {/* ── Availability Toggle ──────────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.availRow}>
            <View>
              <Text style={styles.availLabel}>Availability</Text>
              <Text style={[
                styles.availStatus,
                { color: availabilityColor(avail) },
              ]}>
                {availabilityLabel(avail)}
              </Text>
            </View>
            <View style={styles.availRight}>
              {availSaving ? (
                <ActivityIndicator size="small" color={COLORS.saffron} />
              ) : (
                <Pressable
                  onPress={cycleAvailability}
                  style={[
                    styles.availToggle,
                    {
                      backgroundColor:
                        avail === 'available_now' ? COLORS.verdigris : COLORS.border,
                    },
                  ]}
                >
                  <View style={[
                    styles.availThumb,
                    {
                      alignSelf: avail === 'available_now' ? 'flex-end' : 'flex-start',
                    },
                  ]} />
                </Pressable>
              )}
              <TouchableOpacity
                onPress={() => navigation.navigate('Availability')}
                style={styles.availMoreBtn}
              >
                <Text style={styles.availMoreText}>Schedule →</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.availNote}>
            Consumers see your status within 1 second.
          </Text>
        </View>

        {/* ── Recent Leads ─────────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Leads</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Leads')}>
            <Text style={styles.sectionLink}>See all →</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.card, styles.leadsPreviewCard]}
          onPress={() => navigation.navigate('Leads')}
        >
          <Text style={styles.leadsPreviewText}>
            View and manage your leads →
          </Text>
        </TouchableOpacity>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.ivory,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.ivory,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 24,,
    flexGrow: 1,
  },

  // Header
  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingTop:     16,
    paddingBottom:  12,
  },
  greeting: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      COLORS.grey,
  },
  providerName: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   20,
    color:      COLORS.deepInk,
    maxWidth:   SCREEN_W * 0.65,
  },
  settingsIcon: {
    fontSize:  22,
    color:     COLORS.deepInk,
  },

  // Cards
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius:    16,
    padding:         18,
    marginBottom:    14,
    shadowColor:     '#1C1C2E',
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.07,
    shadowRadius:    6,
    elevation:       2,
  },

  // Trust Ring
  ringContainer: {
    alignSelf:   'center',
    width:       RING_SIZE,
    height:      RING_SIZE,
    marginBottom: 12,
  },
  ringOverlay: {
    position:       'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems:     'center',
  },
  ringScore: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   32,
  },
  ringTierLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
    marginTop:  2,
  },
  wsLiveDot: {
    position:        'absolute',
    top:             6,
    right:           6,
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: COLORS.verdigris,
    zIndex:          10,
  },

  // Biography
  biographyText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   14,
    color:      COLORS.grey,
    textAlign:  'center',
    marginBottom: 14,
    lineHeight:  20,
  },

  // Customer Voice Bar
  voiceBarSection: {
    marginTop: 2,
  },
  voiceBarHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'baseline',
    marginBottom:   6,
  },
  voiceBarLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   13,
    color:      COLORS.deepInk,
  },
  voiceBarValue: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      COLORS.grey,
  },
  voiceBarTrack: {
    height:       8,
    borderRadius: 4,
    backgroundColor: COLORS.border,
    overflow:     'hidden',
  },
  voiceBarFill: {
    height:       8,
    borderRadius: 4,
  },

  // Momentum
  momentumHeader: {
    flexDirection: 'row',
    alignItems:    'center',
    marginBottom:  10,
  },
  momentumArrow: {
    fontSize:     22,
    marginRight:  6,
    color:        COLORS.deepInk,
    fontFamily:   'PlusJakartaSans-Bold',
  },
  momentumDelta: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   16,
  },
  momentumRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  momentumSignal: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      COLORS.deepInk,
  },
  momentumItemDelta: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   13,
  },
  viewHistoryLink: {
    marginTop: 10,
    alignSelf: 'flex-end',
  },
  viewHistoryText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
    color:      COLORS.saffron,
  },

  // Next Action
  nextActionCard: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    backgroundColor: '#FDF8F2',
    borderWidth:    1,
    borderColor:    COLORS.warmSand,
  },
  nextActionLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    flex:          1,
    marginRight:   10,
  },
  nextActionEmoji: {
    fontSize:    22,
    marginRight: 10,
  },
  nextActionText: {
    flex: 1,
  },
  nextActionTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   14,
    color:      COLORS.deepInk,
    lineHeight: 20,
  },
  nextActionSub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
    marginTop:  2,
  },
  nextActionBtn: {
    paddingHorizontal: 14,
    paddingVertical:    8,
    borderRadius:      10,
  },
  nextActionBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   13,
    color:      COLORS.white,
  },

  // Zero Commission
  commissionCard: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    backgroundColor: '#F0FAF8',
    borderWidth:    1,
    borderColor:    '#C8E8E4',
  },
  commissionEmoji: {
    fontSize:    24,
    marginRight: 12,
    marginTop:   2,
  },
  commissionText: {
    flex: 1,
  },
  commissionTitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   14,
    color:      COLORS.deepInk,
    lineHeight: 20,
  },
  commissionSub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
    marginTop:  3,
  },

  // Availability
  availRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  availLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      COLORS.deepInk,
  },
  availStatus: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    marginTop:  2,
  },
  availRight: {
    alignItems: 'flex-end',
    gap:        6,
  },
  availToggle: {
    width:        52,
    height:       28,
    borderRadius: 14,
    padding:      3,
  },
  availThumb: {
    width:           22,
    height:          22,
    borderRadius:    11,
    backgroundColor: COLORS.white,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.15,
    shadowRadius:    2,
    elevation:       2,
  },
  availMoreBtn: {
    paddingVertical: 2,
  },
  availMoreText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
    color:      COLORS.saffron,
  },
  availNote: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      COLORS.grey,
    marginTop:  8,
  },

  // Sections
  sectionHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   8,
    marginTop:      4,
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   16,
    color:      COLORS.deepInk,
  },
  sectionLink: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   13,
    color:      COLORS.saffron,
  },

  // Leads Preview
  leadsPreviewCard: {
    alignItems:      'center',
    backgroundColor: COLORS.warmSand,
  },
  leadsPreviewText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   14,
    color:      COLORS.deepInk,
  },

  bottomSpacer: { height: 24 },
});
