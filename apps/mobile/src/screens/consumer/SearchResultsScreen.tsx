import { useLocation } from "../../hooks/useLocation";
/**
 * apps/mobile/src/screens/consumer/SearchResultsScreen.tsx
 * SatvAAh Phase 18 — Search Results
 *
 * Spec requirements:
 *   • Ring narration banner: Saffron bg (#C8691A), Ivory text (#FAF7F0)
 *     — shown when ring expanded beyond 3km
 *   • ProviderCard with trust ring (colour = tier)
 *   • FlashList (NOT FlatList) — performance
 *   • Real-time availability via WebSocket /availability namespace
 *     — public, no auth, joins room city:{city_id}
 *     — REST catchup on reconnect (exponential backoff 1s→30s)
 *   • Sort by trust_score DESC default
 *   • Pagination: 10 per page, infinite scroll
 *
 * WebSocket /availability:
 *   Server: user service port 3002
 *   Room:   city:{city_id}
 *   Event:  availability_updated → { provider_id, is_available, updated_at }
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';
import { FlashList } from '../../__stubs__/flash-list';
import { io, type Socket } from 'socket.io-client';

import {
  searchProviders,
  getAvailabilityChanges,
  trustRingColor,
  trustTierLabel,
  type Tab,
  type SortOrder,
  type ProviderCardData,
  type SearchMeta,
} from '../../api/search.api';
import { useAuthStore } from '../../stores/auth.store';
import { useLocationStore } from '../../stores/location.store';
import { ENV } from '../../config/env';

// ─── Navigation ────────────────────────────────────────────────────────────────

type FilterParams = {
  min_trust?: number;
  max_distance?: number;
  availability?: boolean;
  homeVisit?: boolean;
  languages?: string;
  min_rating?: number;
  sort: SortOrder;
};

type ConsumerStackParamList = {
  SearchResults: {
    query: string;
    taxonomyNodeId: string;
    tab: Tab;
    filters?: FilterParams;
  };
  SearchFilter: {
    filters: FilterParams;
    tab: Tab;
    query?: string;
    taxonomyNodeId?: string;
  };
  ProviderProfile: { providerId: string };
};

type Nav  = NativeStackNavigationProp<ConsumerStackParamList>;
type Route = RouteProp<ConsumerStackParamList, 'SearchResults'>;

// ─── Sort Options ──────────────────────────────────────────────────────────────

const SORT_OPTIONS: { key: SortOrder; label: string }[] = [
  { key: 'trust_score', label: 'Most Trusted' },
  { key: 'distance',    label: 'Nearest'       },
  { key: 'rating',      label: 'Top Rated'     },
];

// city_id resolved from search results (first hit's cityId) — see cityIdRef below

// ─── Provider Card ─────────────────────────────────────────────────────────────

interface ProviderCardProps {
  item: ProviderCardData;
  onPress: () => void;
}

const ProviderCard: React.FC<ProviderCardProps> = React.memo(({ item, onPress }) => {
  const ringColor = trustRingColor(item.trustTier);
  const tierLabel = trustTierLabel(item.trustTier);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.displayName}, ${item.taxonomy_name}, trust score ${item.trustScore}`}
    >
      {/* Avatar with trust ring */}
      <View style={[styles.avatarRing, { borderColor: ringColor }]}>
        {item.profile_photo_url ? (
          <Image source={{ uri: item.profile_photo_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>
              {item.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.cardInfo}>
        <View style={styles.cardNameRow}>
          <Text style={styles.cardName} numberOfLines={1}>{item.displayName}</Text>
          {item.certificate_id && (
            <View style={styles.certBadge}>
              <Text style={styles.certBadgeText}>✓</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardCategory} numberOfLines={1}>{item.taxonomy_name}</Text>
        <Text style={styles.cardArea} numberOfLines={1}>{item.areaName}</Text>

        {/* Availability + home visit row */}
        <View style={styles.cardTagRow}>
          <View style={[
            styles.availBadge,
            { backgroundColor: item.is_available ? '#E8F4F2' : '#F4E8E8' },
          ]}>
            <View style={[
              styles.availDot,
              { backgroundColor: item.is_available ? '#2E7D72' : '#C4502A' },
            ]} />
            <Text style={[
              styles.availText,
              { color: item.is_available ? '#2E7D72' : '#C4502A' },
            ]}>
              {item.is_available ? 'Available' : 'Busy'}
            </Text>
          </View>
          {item.homeVisit && (
            <View style={styles.homeVisitTag}>
              <Text style={styles.homeVisitText}>🏠 Home visit</Text>
            </View>
          )}
        </View>
      </View>

      {/* Right: trust score */}
      <View style={styles.cardRight}>
        <View style={[styles.scoreBadge, { borderColor: ringColor }]}>
          <Text style={[styles.scoreText, { color: ringColor }]}>{item.trustScore}</Text>
          <Text style={[styles.scoreTierLabel, { color: ringColor }]}>
            {tierLabel.split(' ')[0]}
          </Text>
        </View>
        {item.rating_avg != null && (
          <Text style={styles.ratingText}>★ {item.rating_avg.toFixed(1)}</Text>
        )}
        {item.distance_km != null && <Text style={styles.distanceText}>{item.distance_km?.toFixed(1) ?? '0.0'} km</Text>}
      </View>
    </Pressable>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

const SearchResultsScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const { query, taxonomyNodeId, tab, filters: routeFilters } = route.params;
  const location = useLocation();

  // ── State ──────────────────────────────────────────────────────────────────
  const [results, setResults]           = useState<ProviderCardData[]>([]);
  const [meta, setMeta]                 = useState<SearchMeta | null>(null);
  const [page, setPage]                 = useState(1);
  const [loading, setLoading]           = useState(true);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [sort, setSort]                 = useState<SortOrder>(
    routeFilters?.sort ?? 'trust_score',
  );
  const [filters, setFilters]           = useState<FilterParams>(
    routeFilters ?? { sort: 'trust_score' },
  );
  // Track availability changes: provider_id → is_available
  const [availMap, setAvailMap]         = useState<Record<string, boolean>>({});
  const wsConnected                     = useRef(false);
  const socketRef                       = useRef<Socket | null>(null);
  const lastAvailTs                     = useRef(new Date().toISOString());
  // city_id for /availability WS room — resolved from first search result
  const cityIdRef                       = useRef<string>('');

  // ── Fetch results ──────────────────────────────────────────────────────────

  const fetchResults = useCallback(
    async (pageNum: number, isRefresh = false) => {
      if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const res = await searchProviders({
          q: query,
          tab,
          lat: location.lat,
          lng: location.lng,
          page: pageNum,
          sort,
          ...filters,
        });
        setMeta(res.meta);
        setResults((prev) =>
          pageNum === 1 ? res.data : [...prev, ...res.data],
        );
      } catch (e: any) {
        setError('Could not load results. Pull down to retry.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [query, tab, sort, filters, location],
  );

  useEffect(() => {
    setPage(1);
    setResults([]);
    fetchResults(1);
  }, [query, tab, sort, filters]);

  // ── WebSocket /availability ────────────────────────────────────────────────
  // Namespace: /availability — PUBLIC, no auth
  // Room: city:{city_id}
  // Reconnection: exponential backoff 1s→30s, infinite retries

  useEffect(() => {
    const socket = io(`${ENV.WS_BASE_URL}/availability`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.3,
      auth: {}, // Public namespace — no auth
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      wsConnected.current = true;
      // join_city expects a UUID string — only join if we have a valid cityId
      if (cityIdRef.current) {
        socket.emit('join_city', cityIdRef.current);
      }

      // REST catchup — apply any changes missed during disconnect
      const since = lastAvailTs.current;
      getAvailabilityChanges(since)
        .then((changes) => {
          if (changes.length === 0) return;
          const patch: Record<string, boolean> = {};
          changes.forEach((c) => { patch[c.providerId] = c.is_available; });
          setAvailMap((prev) => ({ ...prev, ...patch }));
          if (changes.length > 0) {
            lastAvailTs.current = changes[changes.length - 1].updatedAt;
          }
        })
        .catch(() => {
          // Non-critical catchup failure — silently ignore
        });
    });

    socket.on('availability_updated', (payload: {
      providerId: string;
      isAvailable: boolean;
      mode: string;
      updatedAt: string;
    }) => {
      setAvailMap((prev) => ({
        ...prev,
        [payload.provider_id]: payload.isAvailable,
      }));
      lastAvailTs.current = payload.updatedAt;
    });

    socket.on('disconnect', () => {
      wsConnected.current = false;
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ── Filter screen result listener ─────────────────────────────────────────
  // SearchFilterScreen navigates back with new filters via route.params
  useEffect(() => {
    if (routeFilters) {
      setFilters(routeFilters);
      setSort(routeFilters.sort ?? 'trust_score');
    }
  }, [routeFilters]);

  // ── Merge availability overrides into result list ─────────────────────────
  const displayResults = useMemo(
    () =>
      results.map((p) =>
        availMap[p.id] !== undefined
          ? { ...p, is_available: availMap[p.id] }
          : p,
      ),
    [results, availMap],
  );

  // ── Pagination ────────────────────────────────────────────────────────────

  const onEndReached = useCallback(() => {
    if (!meta || loadingMore || loading) return;
    if (page >= meta.pages) return;
    const next = page + 1;
    setPage(next);
    fetchResults(next);
  }, [meta, page, loadingMore, loading, fetchResults]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: ProviderCardData }) => (
      <ProviderCard
        item={item}
        onPress={() => navigation.navigate('ProviderProfile', { providerId: item.id })}
      />
    ),
    [navigation],
  );

  const keyExtractor = useCallback((item: ProviderCardData) => item.id, []);

  const ListFooter = useMemo(() => {
    if (loadingMore) {
      return (
        <ActivityIndicator
          color="#C8691A"
          style={{ marginVertical: 16 }}
        />
      );
    }
    if (meta && page >= meta.pages && results.length > 0) {
      return (
        <Text style={styles.endText}>
          All {meta.total} results shown
        </Text>
      );
    }
    return null;
  }, [loadingMore, meta, page, results.length]);

  const openFilters = useCallback(() => {
    navigation.navigate('SearchFilter', { filters, tab, query, taxonomyNodeId });
  }, [navigation, filters, tab, query, taxonomyNodeId]);

  // ── Sort bar ──────────────────────────────────────────────────────────────

  const SortBar = (
    <View style={styles.sortBar}>
      {SORT_OPTIONS.map((opt) => (
        <TouchableOpacity
          key={opt.key}
          style={[styles.sortChip, sort === opt.key && styles.sortChipActive]}
          onPress={() => setSort(opt.key)}
        >
          <Text style={[styles.sortLabel, sort === opt.key && styles.sortLabelActive]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
      <View style={{ flex: 1 }} />
      <TouchableOpacity style={styles.filterBtn} onPress={openFilters}>
        <Text style={styles.filterBtnText}>Filter ⚙️</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Narration banner ──────────────────────────────────────────────────────

  const NarrationBanner =
    meta?.narration && meta.ring_km > 3 ? (
      <View style={styles.narrationBanner}>
        <Text style={styles.narrationText}>{meta.narration}</Text>
      </View>
    ) : null;

  // ── Main render ───────────────────────────────────────────────────────────

  if (loading && results.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#C8691A" />
          <Text style={styles.loadingText}>Finding trusted providers…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerQuery} numberOfLines={1}>{query}</Text>
          {meta && (
            <Text style={styles.headerCount}>
              {meta.total} result{meta.total !== 1 ? 's' : ''} · {tab}
            </Text>
          )}
        </View>
      </View>

      {/* ── Ring narration banner — Saffron bg, Ivory text ── */}
      {NarrationBanner}

      {/* ── Sort / filter bar ── */}
      {SortBar}

      {/* ── Error state ── */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => fetchResults(1)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Results FlashList ── */}
      <FlashList
        data={displayResults}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={100}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.3}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>No providers found</Text>
              <Text style={styles.emptyBody}>
                Try adjusting your filters or search a different category.
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
};

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FAF7F0',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D0',
    backgroundColor: '#FAF7F0',
  },
  backBtn: { padding: 8, marginRight: 8 },
  backIcon: { fontSize: 20, color: '#1C1C2E' },
  headerInfo: { flex: 1 },
  headerQuery: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
  },
  headerCount: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    marginTop: 2,
  },

  // Narration banner — Saffron bg, Ivory text
  narrationBanner: {
    backgroundColor: '#C8691A',  // Saffron
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  narrationText: {
    color: '#FAF7F0',             // Ivory
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Medium',
    lineHeight: 18,
  },

  // Sort + filter bar
  sortBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FAF7F0',
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D0',
  },
  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#E8E0D0',
    backgroundColor: '#FAF7F0',
  },
  sortChipActive: {
    borderColor: '#C8691A',
    backgroundColor: '#FFF5EC',
  },
  sortLabel: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#1C1C2E',
  },
  sortLabelActive: {
    color: '#C8691A',
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  filterBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#1C1C2E',
  },
  filterBtnText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#FAF7F0',
  },

  // Error banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF0EC',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#C4502A',
  },
  retryText: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#C8691A',
    marginLeft: 8,
  },

  // List
  listContent: { paddingBottom: 100 },
  separator: {
    height: 1,
    backgroundColor: '#EDE6D8',
    marginLeft: 80,
  },
  endText: {
    textAlign: 'center',
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9B8E7C',
    padding: 16,
  },

  // Provider Card
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E0D5',
    shadowColor: '#1C1C2E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardPressed: {
    backgroundColor: '#F5EFE4',
  },
  avatarRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarFallback: {
    backgroundColor: '#E8E0D0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 18,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
  },
  cardInfo: { flex: 1, marginRight: 8 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center' },
  cardName: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-Bold',
    color: '#1C1C2E',
  },
  certBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#2E7D72',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  certBadgeText: {
    fontSize: 10,
    color: '#FAF7F0',
    fontFamily: 'PlusJakartaSans-Bold',
  },
  cardCategory: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#C8691A',
    marginTop: 3,
  },
  cardArea: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#1C1C2E',
    marginTop: 2,
  },
  cardTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    flexWrap: 'wrap',
    gap: 4,
  },
  availBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  availDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  availText: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  homeVisitTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#F0E4CC',
  },
  homeVisitText: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#C8691A',
  },

  // Trust score badge (right side)
  cardRight: {
    alignItems: 'center',
    flexShrink: 0,
    width: 56,
  },
  scoreBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF7F0',
  },
  scoreText: {
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-Bold',
    lineHeight: 16,
  },
  scoreTierLabel: {
    fontSize: 8,
    fontFamily: 'PlusJakartaSans-Medium',
    letterSpacing: -0.2,
  },
  ratingText: {
    marginTop: 4,
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#D97706',
  },
  distanceText: {
    marginTop: 2,
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9B8E7C',
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 80,
  },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default SearchResultsScreen;
