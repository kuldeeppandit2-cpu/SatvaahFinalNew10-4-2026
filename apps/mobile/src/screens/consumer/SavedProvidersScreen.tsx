/**
 * SavedProvidersScreen.tsx
 * SatvAAh — Phase 21
 *
 * Features:
 *   - Live trust scores (fetched fresh, NOT cached at save time)
 *   - Score-change indicator: "↑ +12 since you saved · Now Highly Trusted"
 *   - Live availability via WebSocket (/availability namespace — NO auth)
 *     Consumer joins room: city:{city_id} on connect
 *   - Swipe left to unsave (react-native-gesture-handler Swipeable)
 *
 * Endpoints:
 *   GET    /api/v1/saved-providers         (user :3002)
 *   DELETE /api/v1/saved-providers/:id     (user :3002)
 *
 * WebSocket:
 *   Namespace: /availability  (no auth — public, per MASTER_CONTEXT)
 *   Room:      city:{city_id}
 *   Event:     availability_updated → { provider_id: string, isAvailable: boolean }
 *   Transport: Socket.IO on user service :3002
 *   Reconnect: exponential backoff 1s→30s, infinite retries
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 ActivityIndicator,
 Animated,
 RefreshControl,
 ScrollView,
 StyleSheet,
 Text,
 TouchableOpacity,
 View,,
  StatusBar,} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { io, Socket } from 'socket.io-client';
import { ENV } from '../../config/env';
import {
  type SavedProviderItem,
  computeScoreDelta,
  fetchSavedProviders,
  trustTierColour,
  trustTierLabel,
  unsaveProvider,
  type TrustTier,
} from '../../api/savedProviders.api';

// ─── Brand ───────────────────────────────────────────────────────────────────

const SAFFRON = '#C8691A';
const DEEP_INK = '#1C1C2E';
const IVORY = '#FAF7F0';
const VERDIGRIS = '#2E7D72';
const WARM_SAND = '#F0E4CC';
const GREY = '#6B6560';
const BORDER = '#E8E0D0';

// User service WebSocket host — should come from env config in production
// Use canonical ENV.WS_BASE_URL — routes through nginx gateway (fix-17)
const WS_HOST = ENV.WS_BASE_URL;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ScoreDeltaBadge({
  currentScore,
  scoreAtSave,
  currentTier,
}: {
  currentScore: number;
  scoreAtSave: number;
  currentTier: TrustTier;
}) {
  const delta = computeScoreDelta(currentScore, scoreAtSave);
  if (!delta) return null;

  const isUp = delta.direction === 'up';
  const colour = isUp ? VERDIGRIS : '#B00020';
  const arrow = isUp ? '↑' : '↓';
  const sign = isUp ? '+' : '-';
  const tierLabel = trustTierLabel(currentTier);

  return (
        <View style={[styles.deltaBadge, { backgroundColor: isUp ? '#E8F5E9' : '#FDECEA' }]}>
      <Text style={[styles.deltaText, { color: colour }]}>
        {arrow} {sign}{delta.delta} since you saved · Now {tierLabel}
      </Text>
    </View>
  );
}

function AvailabilityDot({ isAvailable }: { isAvailable: boolean }) {
  return (
    <View style={[styles.availDot, { backgroundColor: isAvailable ? VERDIGRIS : GREY }]} />
  );
}

// ─── Provider Card (swipeable) ────────────────────────────────────────────────

function ProviderCard({
  item,
  onUnsave,
  onPress,
  liveAvailability,
}: {
  item: SavedProviderItem;
  onUnsave: (providerId: string) => void;
  onPress: (providerId: string) => void;
  liveAvailability: Record<string, boolean>;
}) {
  const swipeRef = useRef<Swipeable>(null);
  const isAvailable = liveAvailability[item.providerId] ?? item.provider.isAvailable;
  const tierColour = trustTierColour(item.provider.trustTier);

  const handleUnsave = useCallback(() => {
    swipeRef.current?.close();
    onUnsave(item.providerId);
  }, [item.providerId, onUnsave]);

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [1, 0.8],
      extrapolate: 'clamp',
    });
    return (
      <TouchableOpacity style={styles.swipeAction} onPress={handleUnsave}>
        <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
          <Ionicons name="bookmark-outline" size={22} color="#fff" />
          <Text style={styles.swipeActionText}>Unsave</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      rightThreshold={40}
      friction={2}
    >
      <TouchableOpacity
        style={styles.card}
        onPress={() => onPress(item.providerId)}
        activeOpacity={0.85}
      >
        {/* Avatar */}
        <View style={[styles.cardAvatar, { borderColor: tierColour }]}>
          <Text style={styles.cardAvatarText}>
            {item.provider.displayName.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}
          </Text>
          <AvailabilityDot isAvailable={isAvailable} />
        </View>

        {/* Main info */}
        <View style={styles.cardBody}>
          <View style={styles.cardTopRow}>
            <Text style={styles.cardName} numberOfLines={1}>
              {item.provider.displayName}
            </Text>
            {/* Live trust score */}
            <View style={[styles.scoreChip, { backgroundColor: tierColour + '22', borderColor: tierColour }]}>
              <Text style={[styles.scoreChipText, { color: tierColour }]}>
                {item.provider.trustScore}
              </Text>
            </View>
          </View>

          <Text style={styles.cardTax} numberOfLines={1}>
            {item.provider.primary_taxonomy_label}
            {item.provider.area_label ? ` · ${item.provider.area_label}` : ''}
          </Text>

          {/* Score delta badge */}
          <ScoreDeltaBadge
            currentScore={item.provider.trustScore}
            scoreAtSave={item.trust_score_at_save}
            currentTier={item.provider.trustTier}
          />

          {/* Tier label + availability */}
          <View style={styles.cardFooterRow}>
            <Text style={[styles.tierLabel, { color: tierColour }]}>
              {trustTierLabel(item.provider.trustTier)}
            </Text>
            <Text style={styles.availText}>
              {isAvailable ? '● Available' : '○ Unavailable'}
            </Text>
          </View>
        </View>

        <Ionicons name="chevron-forward" size={16} color={GREY} />
      </TouchableOpacity>
    </Swipeable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SavedProvidersScreen() {
  const navigation = useNavigation<any>();
  const [providers, setProviders] = useState<SavedProviderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unsavingId, setUnsavingId] = useState<string | null>(null);
  /** Real-time availability overrides — keyed by provider_id */
  const [liveAvailability, setLiveAvailability] = useState<Record<string, boolean>>({});
  const socketRef = useRef<Socket | null>(null);
  const cityIdRef = useRef<string | null>(null);

  // ── Load saved providers ──────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const res = await fetchSavedProviders();
      setProviders(res.providers);
      // Grab the first provider's city_id for WS room join
      if (res.providers.length > 0) {
        cityIdRef.current = res.providers[0].provider.cityId;
      }
    } catch (err) {
      console.error('[SavedProvidersScreen] loadData', err);
    }
  }, []);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // ── WebSocket — /availability namespace (NO auth) ─────────────────────────

  useEffect(() => {
    let reconnectDelay = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const socket = io(`${WS_HOST}/availability`, {
        transports: ['websocket'],
        autoConnect: true,
        reconnection: false, // manual reconnect for backoff control
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        reconnectDelay = 1000; // reset on successful connect
        if (cityIdRef.current) {
          socket.emit('join_city', cityIdRef.current);
        }
      });

      socket.on('availability_updated', (payload: { provider_id: string; isAvailable: boolean }) => {
        setLiveAvailability((prev) => ({
          ...prev,
          [payload.provider_id]: payload.isAvailable,
        }));
      });

      socket.on('disconnect', () => {
        // Exponential backoff: 1s → 2s → 4s → ... → 30s cap
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
        reconnectTimer = setTimeout(() => {
          socket.connect();
        }, reconnectDelay);
      });
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  // Re-join availability room when city_id becomes known (after data loads)
  useEffect(() => {
    if (cityIdRef.current && socketRef.current?.connected) {
      socketRef.current.emit('join_city', cityIdRef.current);
    }
  }, [providers]);

  // ── Unsave ────────────────────────────────────────────────────────────────

  const handleUnsave = useCallback(async (providerId: string) => {
    setUnsavingId(providerId);
    try {
      await unsaveProvider(providerId);
      setProviders((prev) => prev.filter((p) => p.providerId !== providerId));
    } catch (err) {
      console.error('[SavedProvidersScreen] unsave failed', err);
    } finally {
      setUnsavingId(null);
    }
  }, []);

  const handleProviderPress = useCallback(
    (providerId: string) => {
      navigation.navigate('ProviderProfile', { providerId });
    },
    [navigation],
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={SAFFRON} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F0' }} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
    <ScreenHeader title="Saved Providers" onBack={() => navigation.goBack()} />


    <View style={styles.container}>
      {/* Swipe hint */}
      {providers.length > 0 && (
        <View style={styles.hintBar}>
          <Ionicons name="arrow-back-outline" size={14} color={GREY} />
          <Text style={styles.hintText}>Swipe left on a card to unsave</Text>
        </View>
      )}

      <ScrollView
        style={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={SAFFRON} />
        }
        showsVerticalScrollIndicator={false}
      >
        {providers.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="bookmark-outline" size={44} color={GREY} />
            <Text style={styles.emptyTitle}>No saved providers</Text>
            <Text style={styles.emptySubtitle}>
              Save providers from their profiles to track their trust scores here.
            </Text>
          </View>
        ) : (
          providers.map((item) => (
            <ProviderCard
              key={item.providerId}
              item={item}
              onUnsave={handleUnsave}
              onPress={handleProviderPress}
              liveAvailability={liveAvailability}
            />
          ))
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Unsaving overlay — rare but guards against double-tap */}
      {unsavingId !== null && (
        <View style={styles.unsavingOverlay}>
          <ActivityIndicator color="#fff" size="small" />
        </View>
      )}
    </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: IVORY },
  loader: { flex: 1, backgroundColor: IVORY, justifyContent: 'center', alignItems: 'center' },
  list: { flex: 1 },

  hintBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: WARM_SAND,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  hintText: { fontSize: 12, color: GREY, fontFamily: 'Plus Jakarta Sans' },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: 12,
  },
  cardAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: WARM_SAND,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    position: 'relative',
  },
  cardAvatarText: { fontSize: 16, fontWeight: '700', color: DEEP_INK },
  availDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
  },
  cardBody: { flex: 1 },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  cardName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: DEEP_INK,
    fontFamily: 'Plus Jakarta Sans',
    marginRight: 8,
  },
  scoreChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  scoreChipText: { fontSize: 13, fontWeight: '700', fontFamily: 'Plus Jakarta Sans' },
  cardTax: { fontSize: 12, color: GREY, fontFamily: 'Plus Jakarta Sans', marginBottom: 4 },

  deltaBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  deltaText: { fontSize: 11, fontWeight: '600', fontFamily: 'Plus Jakarta Sans' },

  cardFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tierLabel: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize', fontFamily: 'Plus Jakarta Sans' },
  availText: { fontSize: 11, color: GREY, fontFamily: 'Plus Jakarta Sans' },

  swipeAction: {
    backgroundColor: '#B00020',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  swipeActionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
    fontFamily: 'Plus Jakarta Sans',
  },

  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: DEEP_INK, fontFamily: 'Plus Jakarta Sans' },
  emptySubtitle: {
    fontSize: 14,
    color: GREY,
    textAlign: 'center',
    fontFamily: 'Plus Jakarta Sans',
    lineHeight: 20,
  },

  unsavingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
