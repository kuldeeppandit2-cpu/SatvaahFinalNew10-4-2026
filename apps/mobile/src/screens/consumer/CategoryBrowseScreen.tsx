/**
 * apps/mobile/src/screens/consumer/CategoryBrowseScreen.tsx
 * SatvAAh — Category Browse (L2 / L3 / L4)
 *
 * VISUAL DESIGN (all levels L1-L4 same treatment):
 *   Tile background  = category hex_color (unique dark color per L1)
 *   White inner box  = white rounded square inside the colored tile
 *   Icon/Emoji       = L1/L2/L3 use emoji, L4 uses 2-letter text placeholder
 *   Text             = white on colored tile
 *
 * NAVIGATION FLOW:
 *   HomeScreen(L1 tap) → level=l2 → level=l3 → level=l4 → SearchResults
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';

import {
  getCategoriesL2,
  getCategoriesL3,
  type Tab,
  type L2Group,
  type L3Group,
  type L4Leaf,
} from '../../api/search.api';

// ─── Local navigation types ───────────────────────────────────────────────────
type LocalStack = {
  CategoryBrowse: {
    tab: Tab;
    level: 'l2' | 'l3' | 'l4';
    l1: string;
    l2?: string;
    title: string;
    icon: string;
    color: string;
    l4Leaves?: L4Leaf[];
  };
  SearchResults: {
    query: string;
    taxonomyNodeId?: string;
    taxonomyL4?: string;
    taxonomyL3?: string;
    taxonomyL2?: string;
    taxonomyL1?: string;
    tab: Tab;
    locationName?: string;
  };
};

type Nav   = NativeStackNavigationProp<LocalStack>;
type Route = RouteProp<LocalStack, 'CategoryBrowse'>;

// ─── Constants ────────────────────────────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLS          = 3;
const TILE_SIZE     = (SCREEN_WIDTH - 32) / COLS;  // 16px padding each side

const TILE_PALETTE = ['#B5451B','#1B5C99','#9C2152','#7B1212','#1A4E8C','#1E6B2E','#5A1278','#C45200','#016E9A','#4A7A1E','#3A1E8C','#00574E','#941040','#C46D00','#1E2B7A','#7A3B00','#006B5B','#8C1A3A','#2D5016','#5C0099'];
function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return TILE_PALETTE[Math.abs(h) % TILE_PALETTE.length];
}

// ─── Single tile — same design for L2 / L3 / L4 ─────────────────────────────
interface TileProps {
  color: string;
  icon: string;
  label: string;
  subLabel: string;
  onPress: () => void;
}

const CategoryTile: React.FC<TileProps> = ({ color, icon, label, subLabel, onPress }) => (
  <TouchableOpacity
    style={[styles.tile, { width: TILE_SIZE, backgroundColor: color || '#C8691A' }]}
    onPress={onPress}
    activeOpacity={0.8}
  >
    <View style={styles.tileWhiteBox}>
      <Text style={styles.tileIcon}>{icon}</Text>
    </View>
    <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>
    {subLabel ? <Text style={styles.tileSubLabel} numberOfLines={1}>{subLabel}</Text> : null}
  </TouchableOpacity>
);

// ─── Main Screen ──────────────────────────────────────────────────────────────
export function CategoryBrowseScreen(): React.ReactElement {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const { tab, level, l1, l2, title, icon, color, l4Leaves } = route.params;

  const [l2Groups, setL2Groups] = useState<L2Group[]>([]);
  const [l3Groups, setL3Groups] = useState<L3Group[]>([]);
  const [loading,  setLoading ] = useState(level !== 'l4');
  const [error,    setError   ] = useState(false);

  // ── Load data ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (level === 'l4') { setLoading(false); return; }

    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true); setError(false);
      try {
        if (level === 'l2') {
          const g = await getCategoriesL2(tab, l1);
          if (!cancelled) setL2Groups(g);
        } else if (level === 'l3' && l2) {
          const g = await getCategoriesL3(tab, l1, l2);
          if (!cancelled) setL3Groups(g);
        }
      } catch { if (!cancelled) setError(true); }
      finally  { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [tab, level, l1, l2]);

  // ── Navigation handlers ──────────────────────────────────────────────────
  const onPressL2 = useCallback((g: L2Group) => {
    navigation.push('CategoryBrowse', {
      tab, level: 'l3', l1, l2: g.l2,
      title: g.l2, icon: g.icon, color,
    });
  }, [navigation, tab, l1, color]);

  const onPressL3 = useCallback((g: L3Group) => {
    navigation.push('CategoryBrowse', {
      tab, level: 'l4', l1, l2,
      title: g.l3, icon: g.icon, color,
      l4Leaves: g.leaves,
    });
  }, [navigation, tab, l1, l2, color]);

  const onPressL4 = useCallback((leaf: L4Leaf) => {
    // title at l4 level = the L3 label (set by onPressL3 → title: g.l3)
    const l3Label = level === 'l4' ? title : undefined;
    navigation.navigate('SearchResults', {
      query:          leaf.l4,
      taxonomyNodeId: leaf.id,
      taxonomyL4:     leaf.l4,
      taxonomyL3:     l3Label,
      taxonomyL2:     l2 ?? undefined,
      taxonomyL1:     l1,
      tab,
    });
  }, [navigation, tab, l1, l2, title, level]);

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
        {renderHeader(icon, title, () => navigation.goBack())}
        <ActivityIndicator color="#C8691A" style={styles.loader} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {renderHeader(icon, title, () => navigation.goBack())}
        <Text style={styles.errorText}>Could not load categories. Go back and try again.</Text>
      </SafeAreaView>
    );
  }

  // Build flat tile array for FlatList
  const tiles: Array<{ key: string; color: string; icon: string; label: string; subLabel: string; onPress: () => void }> =
    level === 'l2'
      ? l2Groups.map(g => ({ key: g.l2, color: hashColor(g.l2), icon: g.icon, label: g.l2, subLabel: `${g.child_count} categories`, onPress: () => onPressL2(g) }))
      : level === 'l3'
        ? l3Groups.map(g => ({ key: g.l3, color: hashColor(g.l3), icon: g.icon, label: g.l3, subLabel: `${g.leaves.length} items`, onPress: () => onPressL3(g) }))
        : (l4Leaves ?? []).map(leaf => ({ key: leaf.id, color: hashColor(leaf.l4), icon: leaf.l4.slice(0, 2).toUpperCase(), label: leaf.l4, subLabel: leaf.serviceType, onPress: () => onPressL4(leaf) }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      {renderHeader(icon, title, () => navigation.goBack())}
      <FlatList
        data={tiles}
        numColumns={COLS}
        keyExtractor={t => t.key}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: t }) => (
          <CategoryTile
            color={t.color}
            icon={t.icon}
            label={t.label}
            subLabel={t.subLabel}
            onPress={t.onPress}
          />
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No categories found</Text>}
        ListFooterComponent={<View style={{ height: 80 }} />}
      />
    </SafeAreaView>
  );
}

function renderHeader(icon: string, title: string, onBack: () => void): React.ReactElement {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backBtn}
        onPress={onBack}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>
      <Text style={styles.headerIcon}>{icon}</Text>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FAF7F0' },
  loader: { marginTop: 48 },
  errorText: { margin: 24, textAlign: 'center', color: '#C8691A', fontFamily: 'PlusJakartaSans-Regular', fontSize: 14 },
  emptyText: { marginTop: 48, textAlign: 'center', color: '#1C1C2E', fontFamily: 'PlusJakartaSans-Regular', fontSize: 14 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D0',
    backgroundColor: '#FAF7F0',
  },
  backBtn:     { marginRight: 8 },
  backArrow:   { fontSize: 22, color: '#C8691A', fontFamily: 'PlusJakartaSans-Medium' },
  headerIcon:  { fontSize: 20, marginRight: 8 },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: 'PlusJakartaSans-SemiBold', color: '#1C1C2E' },

  grid: { paddingHorizontal: 10, paddingTop: 14 },

  // ── Tile — same for all levels ─────────────────────────────────────────────
  tile: {
    alignItems: 'center',
    padding: 10,
    marginBottom: 10,
    marginHorizontal: 3,
    borderRadius: 14,
  },
  tileWhiteBox: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  tileIcon:     { fontSize: 28 },
  tileLabel:    { fontSize: 11, fontFamily: 'PlusJakartaSans-Medium',  color: '#FFFFFF', textAlign: 'center' },
  tileSubLabel: { marginTop: 2, fontSize: 9,  fontFamily: 'PlusJakartaSans-Regular', color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
});
