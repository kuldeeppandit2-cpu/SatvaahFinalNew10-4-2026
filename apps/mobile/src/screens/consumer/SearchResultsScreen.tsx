/**
 * apps/mobile/src/screens/consumer/SearchResultsScreen.tsx
 * SatvAAh Phase 18 — Search Results
 *
 * Spec:
 *   • Taxonomy params forwarded to backend (items 2, 5, 6 from audit)
 *   • ring_km lock on pagination (item 5)
 *   • Verified-first display sort: isClaimed=true group before scraped (item 8)
 *   • Verified/Unverified badge on card (item 9)
 *   • Customers served count on card (item 10)
 *   • Near X · Change location chip in header (item 11)
 *   • Narration banner: ring expansion + taxonomy fallback (item 21)
 *   • FlashList, WebSocket /availability, REST catchup
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
import { useLocationStore } from '../../stores/location.store';
import { ENV } from '../../config/env';
import { Ionicons } from '@expo/vector-icons';

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
    taxonomyNodeId?: string;
    taxonomyL4?: string;
    taxonomyL3?: string;
    taxonomyL2?: string;
    taxonomyL1?: string;
    tab: Tab;
    locationName?: string;
    filters?: FilterParams;
  };
  SearchFilter: { filters: FilterParams; tab: Tab };
  ProviderProfile: { providerId: string };
};

type Nav   = NativeStackNavigationProp<ConsumerStackParamList>;
type Route = RouteProp<ConsumerStackParamList, 'SearchResults'>;

// ─── Sort Options ──────────────────────────────────────────────────────────────

const SORT_OPTIONS: { key: SortOrder; label: string }[] = [
  { key: 'trust_score', label: 'Most Trusted' },
  { key: 'distance',    label: 'Nearest'      },
  { key: 'rating',      label: 'Top Rated'    },
];

// ─── Provider Card ─────────────────────────────────────────────────────────────

interface ProviderCardProps {
  item: ProviderCardData;
  onPress: () => void;
}

const ProviderCard: React.FC<ProviderCardProps> = React.memo(({ item, onPress }) => {
  const ringColor = item.isScrapeRecord ? '#9B8E7C' : trustRingColor(item.trustTier);
  const tierLabel = trustTierLabel(item.trustTier);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.displayName}, ${item.taxonomy_name}, trust score ${item.trustScore}`}
    >
      {/* Avatar with trust ring — grey ring for scraped providers */}
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

          {/* Verified / Unverified badge */}
          {item.isScrapeRecord ? (
            <View style={styles.unverifiedBadge}>
              <Text style={styles.unverifiedBadgeText}>Unverified</Text>
            </View>
          ) : (
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedBadgeText}>✓ Verified</Text>
            </View>
          )}
        </View>

        <Text style={styles.cardCategory} numberOfLines={1}>{item.taxonomy_name}</Text>
        <Text style={styles.cardArea} numberOfLines={1}>{item.areaName}</Text>

        {/* Customers served count — only show if > 0 */}
        {item.rating_count > 0 && (
          <Text style={styles.cardServedCount}>
            {item.rating_count} customer{item.rating_count !== 1 ? 's' : ''} served
          </Text>
        )}

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
        {item.distance_km != null && (
          <Text style={styles.distanceText}>{item.distance_km.toFixed(1)} km</Text>
        )}
      </View>
    </Pressable>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

const SearchResultsScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const {
    query,
    taxonomyNodeId,
    taxonomyL4,
    taxonomyL3,
    taxonomyL2,
    taxonomyL1,
    tab,
    locationName: routeLocationName,
    filters: routeFilters,
  } = route.params;

  // Read GPS from locationStore (populated at login by ModeSelectionScreen — Step 8)
  const { lat, lng } = useLocationStore();
  const locationName = routeLocationName ?? 'your location';

  // ── Track coords used in the last search — re-fire only if moved > 5km (BUG-13 fix)
  const lastSearchCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

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
  const [availMap, setAvailMap]         = useState<Record<string, boolean>>({});
  const wsConnected                     = useRef(false);
  const socketRef                       = useRef<Socket | null>(null);
  const lastAvailTs                     = useRef(new Date().toISOString());
  const cityIdRef                       = useRef<string>('');
  // Lock ring_km after page 1 so pagination stays within the found ring
  const lockedRingKm                    = useRef<number | undefined>(undefined);

  // ── Fetch results ──────────────────────────────────────────────────────────

  const fetchResults = useCallback(
    async (pageNum: number) => {
      if (pageNum === 1) {
        setLoading(true);
        lockedRingKm.current = undefined; // reset ring lock on fresh search
        lastSearchCoordsRef.current = { lat, lng }; // record coords for drift detection
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const res = await searchProviders({
          q: query,
          tab,
          lat,
          lng,
          page: pageNum,
          // Lock ring_km for pages > 1 so we stay in the same ring
          ring_km: pageNum > 1 ? lockedRingKm.current : undefined,
          sort,
          ...filters,
          // Taxonomy anchor — ensures backend uses the selected L4 node
          taxonomy_node_id: taxonomyNodeId,
          taxonomy_l4:      taxonomyL4,
          taxonomy_l3:      taxonomyL3,
          taxonomy_l2:      taxonomyL2,
          taxonomy_l1:      taxonomyL1,
        });

        // Lock ring for subsequent pages
        if (pageNum === 1) {
          lockedRingKm.current = res.meta.ring_km;
        }

        setMeta(res.meta);
        setResults((prev) =>
          pageNum === 1 ? res.data : [...prev, ...res.data],
        );

        // Capture city_id for WS room join — use first result's cityId.
        // Emit join_city here if socket is already connected (most common case).
        // The socket.on('connect') handler also emits if cityIdRef is populated first.
        if (pageNum === 1 && res.data.length > 0 && !cityIdRef.current) {
          const cityId = res.data[0].cityId;
          if (cityId) {
            cityIdRef.current = cityId;
            // Emit immediately if socket connected, otherwise socket.on('connect') will retry
            if (socketRef.current?.connected) {
              socketRef.current.emit('join_city', cityId);
            }
          }
        }
      } catch {
        setError('Could not load results. Pull down to retry.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [query, tab, lat, lng, sort, filters, taxonomyNodeId, taxonomyL4, taxonomyL3, taxonomyL2, taxonomyL1],
  );

  useEffect(() => {
    setPage(1);
    setResults([]);
    fetchResults(1);
  }, [query, tab, sort, filters]);

  // Re-fire search when GPS coords change significantly (BUG-13 fix).
  // On cold start: store defaults to Hyderabad, first search fires with wrong city.
  // When real GPS arrives (~1-2s later), this effect fires and corrects results.
  // Threshold: 5km — avoids re-firing on minor GPS drift during normal use.
  // haversineKm: rough distance formula, accurate enough for 5km threshold.
  useEffect(() => {
    const last = lastSearchCoordsRef.current;
    if (!last) return; // first search not yet fired — main effect will handle it
    const dLat = (lat - last.lat) * (Math.PI / 180);
    const dLng = (lng - last.lng) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(last.lat * (Math.PI / 180))
      * Math.cos(lat * (Math.PI / 180))
      * Math.sin(dLng / 2) ** 2;
    const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (distanceKm > 5) {
      setPage(1);
      setResults([]);
      fetchResults(1);
    }
  }, [lat, lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket /availability ────────────────────────────────────────────────

  useEffect(() => {
    const socket = io(`${ENV.WS_BASE_URL}/availability`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.3,
      auth: {},
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      wsConnected.current = true;
      // Emit join_city immediately if cityId already resolved from search results
      if (cityIdRef.current) {
        socket.emit('join_city', cityIdRef.current);
      } else {
        // cityId not yet available — search results may still be in-flight.
        // Retry once after 3s. fetchResults() also emits if socket is connected
        // by the time the first results arrive, so this covers the opposite race.
        const retryTimer = setTimeout(() => {
          if (cityIdRef.current && socket.connected) {
            socket.emit('join_city', cityIdRef.current);
          }
        }, 3000);
        // Store cleanup on socket ref so it can be cleared if socket disconnects
        (socket as any)._cityJoinRetry = retryTimer;
      }
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
        .catch(() => {});
    });

    socket.on('availability_updated', (payload: {
      providerId: string;
      isAvailable: boolean;
      mode: string;
      updatedAt: string;
    }) => {
      setAvailMap((prev) => ({
        ...prev,
        [payload.providerId]: payload.isAvailable,
      }));
      lastAvailTs.current = payload.updatedAt;
    });

    socket.on('disconnect', () => {
      wsConnected.current = false;
      // Clear pending join_city retry if socket disconnects before it fires
      if ((socket as any)._cityJoinRetry) {
        clearTimeout((socket as any)._cityJoinRetry);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ── Filter screen result listener ──────────────────────────────────────────

  useEffect(() => {
    if (routeFilters) {
      setFilters(routeFilters);
      setSort(routeFilters.sort ?? 'trust_score');
    }
  }, [routeFilters]);

  // ── Merge availability + verified-first sort ───────────────────────────────
  // Backend already sorts verified-first, but after availability overlay we
  // preserve the verified group at top: claimed providers before scraped ones.

  const displayResults = useMemo(() => {
    const merged = results.map((p) =>
      availMap[p.id] !== undefined
        ? { ...p, is_available: availMap[p.id] }
        : p,
    );
    // Stable verified-first: claimed group on top, scraped group below
    // Within each group preserve backend order (trust_score DESC, distance ASC)
    const verified  = merged.filter((p) => !p.isScrapeRecord);
    const unverified = merged.filter((p) => p.isScrapeRecord);
    return [...verified, ...unverified];
  }, [results, availMap]);

  // ── Pagination — uses has_more (fixed from meta.pages) ────────────────────

  const onEndReached = useCallback(() => {
    if (!meta || loadingMore || loading) return;
    if (!meta.has_more) return;
    const next = page + 1;
    setPage(next);
    fetchResults(next);
  }, [meta, page, loadingMore, loading, fetchResults]);

  // ── Render helpers ─────────────────────────────────────────────────────────

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
      return <ActivityIndicator color="#C8691A" style={{ marginVertical: 16 }} />;
    }
    if (meta && !meta.has_more && results.length > 0) {
      return (
        <Text style={styles.endText}>All {meta.total} results shown</Text>
      );
    }
    return null;
  }, [loadingMore, meta, results.length]);

  const openFilters = useCallback(() => {
    navigation.navigate('SearchFilter', { filters, tab });
  }, [navigation, filters, tab]);

  // ── Sort bar ───────────────────────────────────────────────────────────────

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

  // ── Narration banner — show for ring expansion OR taxonomy fallback ─────────

  const showNarration = !!meta?.narration && (
    (meta.ring_km > 3) ||
    (meta.taxonomy_level_used && meta.taxonomy_level_used !== 'l4')
  );

  const NarrationBanner = showNarration ? (
    <View style={styles.narrationBanner}>
      <Text style={styles.narrationText}>{meta!.narration}</Text>
    </View>
  ) : null;

  // ── Main render ────────────────────────────────────────────────────────────

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
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
          <Ionicons name="chevron-back" size={24} color="#1C1C2E" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerQuery} numberOfLines={1}>{query}</Text>
          {meta && (
            <Text style={styles.headerCount}>
              {meta.total} result{meta.total !== 1 ? 's' : ''} · {tab}
            </Text>
          )}
        </View>
        {/* Near X · Change location chip (item 11) */}
        <TouchableOpacity
          style={styles.locationChip}
          onPress={() => navigation.navigate('LocationPicker' as any, {
            query: query ?? '',
            taxonomyNodeId,
            taxonomyL4,
            taxonomyL3,
            taxonomyL2,
            taxonomyL1,
            tab,
            returnToSearch: true,
          })}
          accessibilityLabel="Change search location"
        >
          <Text style={styles.locationChipText} numberOfLines={1}>
            📍 {locationName}
          </Text>
          <Text style={styles.locationChipChange}> · Change</Text>
        </TouchableOpacity>
        {/* 🏠 Jump to Home — skip back through L1→L4 drill-down */}
        <TouchableOpacity
          style={styles.homeBtn}
          onPress={() => navigation.navigate('HomeTab' as any)}
          accessibilityLabel="Go to Home"
        >
          <Text style={styles.homeBtnIcon}>🏠</Text>
        </TouchableOpacity>
      </View>

      {/* ── Ring / taxonomy narration banner ── */}
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
        estimatedItemSize={160}
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
              <Text style={styles.emptyTitle}>No providers found yet</Text>
              <Text style={styles.emptyBody}>
                We searched up to 1000km around you. No providers are registered in this category yet.
              </Text>
              <Text style={styles.emptyBody}>
                We'll notify you as soon as a provider registers nearby.
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
  safe: { flex: 1, backgroundColor: '#FAF7F0' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
    paddingHorizontal: 16,
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
  // Near X · Change chip (item 11)
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#F0E8D8',
    marginLeft: 8,
    maxWidth: 140,
  },
  locationChipText: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#1C1C2E',
    flexShrink: 1,
  },
  locationChipChange: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#C8691A',
  },

  // Narration banner — Saffron bg, Ivory text
  narrationBanner: {
    backgroundColor: '#C8691A',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  narrationText: {
    color: '#FAF7F0',
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Medium',
    lineHeight: 18,
  },

  // Sort bar
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
  sortChipActive: { borderColor: '#C8691A', backgroundColor: '#FFF5EC' },
  sortLabel: { fontSize: 12, fontFamily: 'PlusJakartaSans-Medium', color: '#1C1C2E' },
  sortLabelActive: { color: '#C8691A', fontFamily: 'PlusJakartaSans-SemiBold' },
  homeBtn: {
    padding: 6,
    marginLeft: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  homeBtnIcon: {
    fontSize: 16,
  },
  filterBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: '#1C1C2E' },
  filterBtnText: { fontSize: 12, fontFamily: 'PlusJakartaSans-SemiBold', color: '#FAF7F0' },

  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF0EC',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: 'PlusJakartaSans-Regular', color: '#C4502A' },
  retryText: { fontSize: 13, fontFamily: 'PlusJakartaSans-SemiBold', color: '#C8691A', marginLeft: 8 },

  // List
  listContent: { paddingBottom: 100,
    },
  separator: { height: 1, backgroundColor: '#EDE6D8', marginLeft: 80 },
  endText: { textAlign: 'center', fontSize: 12, fontFamily: 'PlusJakartaSans-Regular', color: '#9B8E7C', padding: 16 },

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
  cardPressed: { backgroundColor: '#F5EFE4' },
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
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: {
    backgroundColor: '#E8E0D0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: { fontSize: 18, fontFamily: 'PlusJakartaSans-SemiBold', color: '#1C1C2E' },
  cardInfo: { flex: 1, marginRight: 8 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  cardName: { fontSize: 15, fontFamily: 'PlusJakartaSans-Bold', color: '#1C1C2E', flexShrink: 1 },

  // Verified badge (item 9)
  verifiedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#E6F4F2',
  },
  verifiedBadgeText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#2E7D72',
  },
  // Unverified badge (item 9)
  unverifiedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#F4F0E8',
  },
  unverifiedBadgeText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#9B8E7C',
  },

  cardCategory: { fontSize: 13, fontFamily: 'PlusJakartaSans-SemiBold', color: '#C8691A', marginTop: 3 },
  cardArea: { fontSize: 12, fontFamily: 'PlusJakartaSans-Medium', color: '#1C1C2E', marginTop: 2 },

  // Customers served (item 10)
  cardServedCount: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#6B6560',
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
  availDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
  availText: { fontSize: 11, fontFamily: 'PlusJakartaSans-SemiBold' },
  homeVisitTag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: '#F0E4CC' },
  homeVisitText: { fontSize: 11, fontFamily: 'PlusJakartaSans-Medium', color: '#C8691A' },

  // Trust score badge
  cardRight: { alignItems: 'center', flexShrink: 0, width: 56 },
  scoreBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF7F0',
  },
  scoreText: { fontSize: 15, fontFamily: 'PlusJakartaSans-Bold', lineHeight: 16 },
  scoreTierLabel: { fontSize: 8, fontFamily: 'PlusJakartaSans-Medium', letterSpacing: -0.2 },
  ratingText: { marginTop: 4, fontSize: 11, fontFamily: 'PlusJakartaSans-Medium', color: '#D97706' },
  distanceText: { marginTop: 2, fontSize: 11, fontFamily: 'PlusJakartaSans-Regular', color: '#9B8E7C' },

  // Empty state
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingTop: 80 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontFamily: 'PlusJakartaSans-SemiBold', color: '#1C1C2E', textAlign: 'center', marginBottom: 8 },
  emptyBody: { fontSize: 13, fontFamily: 'PlusJakartaSans-Regular', color: '#1C1C2E', textAlign: 'center', lineHeight: 20 },
  // Location picker modal

});

export default SearchResultsScreen;
