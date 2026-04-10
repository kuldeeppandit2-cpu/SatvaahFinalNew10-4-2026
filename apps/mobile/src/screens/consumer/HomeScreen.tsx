/**
 * apps/mobile/src/screens/consumer/HomeScreen.tsx
 * SatvAAh Phase 18 — Consumer Home
 *
 * Layout:
 *   ┌────────────────────────────────────────────────┐
 *   │  SatvAAh logo              [Leads: 14 pill]    │  ← Header
 *   │  [Products][Establish.][Services][Expertise]   │  ← Surface tabs
 *   │  ┌─────────────────────────────────────────┐   │
 *   │  │ 🔍  Search products, vendors...         │   │  ← Tap → SearchScreen
 *   │  └─────────────────────────────────────────┘   │
 *   │  ── Trusted Circle (after 3+ contacts) ──      │
 *   │  [Provider] [Provider] [Provider] →            │
 *   │  ── Rising Brands (Products tab only) ──       │
 *   │  [Brand] [Brand] [Brand] →                     │
 *   │  ── Browse categories ──                       │
 *   │  [Cat] [Cat] [Cat]                             │
 *   │  [Cat] [Cat] [Cat]                             │
 *   └────────────────────────────────────────────────┘
 *
 * Lead pill colours:
 *   > 10 → Saffron #C8691A
 *   1–10 → Amber   #D97706
 *   0    → Terracotta #C4502A
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Image,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  Dimensions,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  getCategories,
  leadPillColor,
  trustRingColor,
  type Tab,
  type Category,
  type RisingBrand,
} from '../../api/search.api';
import { apiClient } from '../../utils/apiClient';
import { useAuthStore } from '../../stores/auth.store';

// ─── Navigation ────────────────────────────────────────────────────────────────

type ConsumerStackParamList = {
  Home: undefined;
  Search: { tab: Tab; initialQuery?: string };
  SearchResults: {
    query: string;
    taxonomyNodeId: string;
    tab: Tab;
  };
  ProviderProfile: { providerId: string };
  CategoryBrowse: {
    tab: Tab;
    level: 'l2' | 'l3' | 'l4';
    l1: string;
    l2?: string;
    title: string;
    icon: string;
    color: string;
    l4Leaves?: Array<{
      id: string; l4: string; serviceType: string;
      pricingModel: string | null; priceUnit: string | null;
      verificationLabel: string; locationLabel: string; slotLabel: string;
    }>;
  };
};

type Nav = NativeStackNavigationProp<ConsumerStackParamList>;

// ─── Constants ─────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: 'products',       label: 'Products'       },
  { key: 'services',       label: 'Services'       },
  { key: 'expertise',      label: 'Expertise'      },
  { key: 'establishments', label: 'Establishments' },
];

const SEARCH_PLACEHOLDERS: Record<Tab, string> = {
  products:       'Search products, vendors…',
  establishments: 'Search restaurants, shops…',
  services:       'Search plumbers, maids…',
  expertise:      'Search doctors, lawyers…',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CATEGORY_COLS = 3;
const CATEGORY_ITEM_SIZE = (SCREEN_WIDTH - 48) / CATEGORY_COLS;

// ─── Sub-components ────────────────────────────────────────────────────────────

interface LeadPillProps { remaining: number; allocated: number }

const LeadPill: React.FC<LeadPillProps> = ({ remaining, allocated }) => {
  const bg = leadPillColor(remaining);
  return (
    <View style={[styles.leadPill, { backgroundColor: bg }]}>
      <Text style={styles.leadPillText}>
        {remaining}/{allocated} Leads
      </Text>
    </View>
  );
};

interface TrustedProviderChipProps {
  id: string;
  name: string;
  photoUrl: string | null;
  tier: string;
  onPress: () => void;
}

const TrustedProviderChip: React.FC<TrustedProviderChipProps> = ({
  id, name, photoUrl, tier, onPress,
}) => {
  const ringColor = trustRingColor(tier as any);
  return (
    <TouchableOpacity style={styles.trustedChip} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.trustedAvatarRing, { borderColor: ringColor }]}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.trustedAvatar} />
        ) : (
          <View style={[styles.trustedAvatar, styles.trustedAvatarFallback]}>
            <Text style={styles.trustedAvatarInitial}>
              {name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.trustedChipName} numberOfLines={1}>{name}</Text>
    </TouchableOpacity>
  );
};

interface RisingBrandCardProps {
  brand: RisingBrand;
  onPress: () => void;
}

const RisingBrandCard: React.FC<RisingBrandCardProps> = ({ brand, onPress }) => {
  const ringColor = trustRingColor(brand.trustTier);
  return (
    <TouchableOpacity style={styles.risingCard} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.risingAvatarRing, { borderColor: ringColor }]}>
        {brand.profilePhotoUrl ? (
          <Image source={{ uri: brand.profilePhotoUrl }} style={styles.risingAvatar} />
        ) : (
          <View style={[styles.risingAvatar, styles.risingAvatarFallback]}>
            <Text style={styles.risingAvatarInitial}>
              {brand.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.risingName} numberOfLines={2}>{brand.displayName}</Text>
      <Text style={styles.risingCategory} numberOfLines={1}>{brand.taxonomyName}</Text>
      <View style={styles.risingScoreBadge}>
        <Text style={styles.risingScoreText}>▲ {brand.score_delta_30d}</Text>
      </View>
    </TouchableOpacity>
  );
};

interface CategoryTileProps {
  category: Category;
  onPress: () => void;
}

const CategoryTile: React.FC<CategoryTileProps> = ({ category, onPress }) => (
  <TouchableOpacity
    style={[styles.categoryTile, { width: CATEGORY_ITEM_SIZE, backgroundColor: category.color || '#C8691A' }]}
    onPress={onPress}
    activeOpacity={0.8}
  >
    <View style={styles.categoryIconWhiteBox}>
      <Text style={styles.categoryIconText}>
        {category.icon || category.name.charAt(0)}
      </Text>
    </View>
    <Text style={styles.categoryNameWhite} numberOfLines={2}>{category.name}</Text>
    {category.provider_count > 0 && (
      <Text style={styles.categoryCountWhite}>{category.provider_count}</Text>
    )}
  </TouchableOpacity>
);

// ─── Trusted Circle Data ──────────────────────────────────────────────────────

interface TrustedProvider {
  id: string;
  displayName: string;
  profilePhotoUrl: string | null;
  trustTier: string;
  taxonomyName: string;
}

interface ConsumerProfile {
  id: string;
  displayName: string;
  leadsRemaining: number;
  leadsAllocated: number;
  contactCount: number;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const userId = useAuthStore((s) => s.userId); // for future personalization

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('products');
  const [consumerProfile, setConsumerProfile] = useState<ConsumerProfile | null>(null);
  const [trustedCircle, setTrustedCircle] = useState<TrustedProvider[]>([]);
  const [risingBrands, setRisingBrands] = useState<RisingBrand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Data Fetch ─────────────────────────────────────────────────────────────

  const fetchConsumerProfile = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ success: true; data: ConsumerProfile }>(
        '/api/v1/consumers/me',
      );
      setConsumerProfile(data.data);
    } catch {
      // Non-critical — pill just won't show
    }
  }, []);

  const fetchTrustedCircle = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ success: true; data: TrustedProvider[] }>(
        '/api/v1/saved-providers',
        { params: { limit: 10, type: 'contacted' } },
      );
      // Backend returns { data: { providers: [...], total } } or flat array
      const providers = Array.isArray(data.data) ? data.data : (data.data?.providers ?? []);
      setTrustedCircle(providers);
    } catch {
      setTrustedCircle([]);
    }
  }, []);

  const fetchTabData = useCallback(async (tab: Tab, isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [cats, brands] = await Promise.allSettled([
        getCategories(tab),
        tab === 'products' ? Promise.resolve([]) : Promise.resolve([]), // getRisingBrands not yet implemented server-side
        // TODO Phase 19: Replace hardcoded coords with useLocation() hook
      ]);
      setCategories(cats.status === 'fulfilled' ? cats.value : []);
      setRisingBrands(brands.status === 'fulfilled' ? brands.value as RisingBrand[] : []);
    } catch {
      setCategories([]);
      setRisingBrands([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    await Promise.all([
      fetchConsumerProfile(),
      fetchTrustedCircle(),
      fetchTabData(activeTab),
    ]);
  }, [activeTab, fetchConsumerProfile, fetchTrustedCircle, fetchTabData]);

  useEffect(() => {
    bootstrap();
  }, []);

  // Re-fetch categories/brands when tab changes
  useEffect(() => {
    fetchTabData(activeTab);
  }, [activeTab]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await bootstrap();
    setRefreshing(false);
  }, [bootstrap]);

  // ── Navigation Handlers ───────────────────────────────────────────────────

  const openSearch = useCallback(() => {
    navigation.navigate('Search', { tab: activeTab });
  }, [navigation, activeTab]);

  const openProvider = useCallback((providerId: string) => {
    navigation.navigate('ProviderProfile', { providerId });
  }, [navigation]);

  const openCategoryBrowse = useCallback((category: Category) => {
    navigation.navigate('CategoryBrowse', {
      tab: activeTab,
      level: 'l2',
      l1: category.l1,
      title: category.name,
      icon: category.icon || category.name.charAt(0),
      color: category.color || '#C8691A',
    });
  }, [navigation, activeTab]);

  // ── Renders ────────────────────────────────────────────────────────────────

  const showTrustedCircle =
    (consumerProfile?.contactCount ?? 0) >= 3 && trustedCircle.length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.logo}>SatvAAh</Text>
        {consumerProfile && (
          <LeadPill
            remaining={consumerProfile.leadsRemaining}
            allocated={consumerProfile.leadsAllocated}
          />
        )}
      </View>

      {/* ── Surface Tabs ── */}
      <View style={styles.tabsRow}>
        {TABS.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[styles.tabItem, activeTab === key && styles.tabItemActive]}
            onPress={() => setActiveTab(key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabLabel, activeTab === key && styles.tabLabelActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Search Bar (tappable — opens SearchScreen) ── */}
      <Pressable style={styles.searchBar} onPress={openSearch} accessibilityRole="search">
        <Text style={styles.searchIcon}>🔍</Text>
        <Text style={styles.searchPlaceholder}>
          {SEARCH_PLACEHOLDERS[activeTab]}
        </Text>
        <View style={styles.searchMicDot} />
      </Pressable>

      {/* ── Scrollable Content ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#C8691A"
            colors={['#C8691A']}
          />
        }
      >
        {/* Trusted Circle */}
        {showTrustedCircle && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Trusted Circle</Text>
            <Text style={styles.sectionSubtitle}>Providers you've worked with</Text>
            <FlatList
              data={trustedCircle}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.horizontalList}
              renderItem={({ item }) => (
                <TrustedProviderChip
                  id={item.id}
                  name={item.displayName}
                  photoUrl={item.profilePhotoUrl}
                  tier={item.trustTier}
                  onPress={() => openProvider(item.id)}
                />
              )}
            />
          </View>
        )}

        {/* Rising Brands — Products tab only */}
        {activeTab === 'products' && risingBrands.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Rising Brands</Text>
            <Text style={styles.sectionSubtitle}>New brands building trust fast</Text>
            <FlatList
              data={risingBrands}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.horizontalList}
              renderItem={({ item }) => (
                <RisingBrandCard
                  brand={item}
                  onPress={() => openProvider(item.id)}
                />
              )}
            />
          </View>
        )}

        {/* Category Grid */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Browse categories</Text>
          {loading ? (
            <ActivityIndicator color="#C8691A" style={{ marginTop: 24 }} />
          ) : (
            <View style={styles.categoryGrid}>
              {categories.map((cat) => (
                <CategoryTile
                  key={cat.id}
                  category={cat}
                  onPress={() => openCategoryBrowse(cat)}
                />
              ))}
            </View>
          )}
        </View>

        {/* Bottom breathing room */}
        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FAF7F0', // Ivory
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  logo: {
    fontSize: 22,
    fontFamily: 'PlusJakartaSans-Bold',
    color: '#C8691A', // Saffron
    letterSpacing: -0.5,
  },
  leadPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  leadPillText: {
    color: '#FAF7F0',
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },

  // Surface Tabs
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D0',
    backgroundColor: '#FAF7F0',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: '#C8691A',
  },
  tabLabel: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#1C1C2E',
  },
  tabLabelActive: {
    color: '#C8691A',
    fontFamily: 'PlusJakartaSans-SemiBold',
  },

  // Search Bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#F0E4CC', // Warm Sand
    borderRadius: 12,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9B8E7C',
  },
  searchMicDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#C8691A',
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 16 },

  // Section wrapper
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E', // Deep Ink
  },
  sectionSubtitle: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    marginTop: 2,
    marginBottom: 12,
  },
  horizontalList: {
    paddingRight: 16,
  },

  // Trusted Circle
  trustedChip: {
    alignItems: 'center',
    marginRight: 16,
    width: 64,
  },
  trustedAvatarRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trustedAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  trustedAvatarFallback: {
    backgroundColor: '#E8E0D0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  trustedAvatarInitial: {
    fontSize: 18,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
  },
  trustedChipName: {
    marginTop: 6,
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#1C1C2E',
    textAlign: 'center',
  },

  // Rising Brands
  risingCard: {
    width: 120,
    marginRight: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  risingAvatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2.5,
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  risingAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  risingAvatarFallback: {
    backgroundColor: '#E8E0D0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  risingAvatarInitial: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
  },
  risingName: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
    textAlign: 'center',
  },
  risingCategory: {
    marginTop: 2,
    fontSize: 10,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    textAlign: 'center',
  },
  risingScoreBadge: {
    marginTop: 6,
    backgroundColor: '#E8F4F2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  risingScoreText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#2E7D72',
  },

  // Category Grid
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  categoryTile: {
    alignItems: 'center',
    padding: 10,
    marginBottom: 10,
    marginHorizontal: 4,
    borderRadius: 14,
  },
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
  },
  categoryIconWhiteBox: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  categoryIconText: {
    fontSize: 28,
  },
  categoryNameWhite: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  categoryCountWhite: {
    marginTop: 2,
    fontSize: 10,
    fontFamily: 'PlusJakartaSans-Regular',
    color: 'rgba(255,255,255,0.75)',
  },
});

export default HomeScreen;
