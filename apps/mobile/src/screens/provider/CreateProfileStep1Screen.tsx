/**
 * SatvAAh — apps/mobile/src/screens/provider/CreateProfileStep1Screen.tsx
 * Phase 22 — Step 1: Pick category and sub-category.
 *
 * Tab picker → Products | Services | Expertise | Establishments
 * (tabs filtered by entityClass from EntityTypeScreen)
 * Category grid from taxonomy_nodes (L1) → Sub-category list (L2)
 * Selected taxonomy_node_id saved to providerStore.draft
 */

import React, { useEffect, useState, useCallback } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 View,
 Text,
 StyleSheet,
 TouchableOpacity,
 FlatList,
 ActivityIndicator,
 StatusBar,
 
 ScrollView,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProviderOnboardingParamList } from '../../navigation/provider.navigator';
import { useProviderStore, type EntityClass } from '../../stores/provider.store';
import { providerApi, type TaxonomyNode, type ProviderTab } from '../../api/provider.api';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<ProviderOnboardingParamList, 'CreateProfileStep1'>;

interface TabConfig {
  key: ProviderTab;
  label: string;
  emoji: string;
  allowedFor: EntityClass[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_TABS: TabConfig[] = [
  {
    key: 'services',
    label: 'Services',
    emoji: '🔧',
    allowedFor: ['individual'],
  },
  {
    key: 'products',
    label: 'Products',
    emoji: '📦',
    allowedFor: ['individual', 'brand'],
  },
  {
    key: 'expertise',
    label: 'Expertise',
    emoji: '🎓',
    allowedFor: ['individual'],
  },
  {
    key: 'establishments',
    label: 'Establishments',
    emoji: '🏪',
    allowedFor: ['establishment'],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function CreateProfileStep1Screen({ route, navigation }: Props) {
  const { entityClass } = route.params as { entityClass: EntityClass };

  const {
    draft,
    categories,
    subCategories,
    setCategory,
    setSubCategory,
    setCategories,
    setSubCategories,
    isLoading,
    setLoading,
    setError,
  } = useProviderStore();

  // Visible tabs based on entity class
  const visibleTabs = ALL_TABS.filter((t) => t.allowedFor.includes(entityClass));

  // Pre-select tab: establishments for establishment, products for brand, services for individual
  const defaultTab: ProviderTab =
    entityClass === 'establishment'
      ? 'establishments'
      : entityClass === 'brand'
      ? 'products'
      : 'services';

  const [activeTab, setActiveTab] = useState<ProviderTab>(
    draft.tab ?? defaultTab
  );
  const [selectedCategory, setSelectedCategoryLocal] = useState<TaxonomyNode | null>(
    draft.taxonomyNodeId
      ? ({
          id: draft.taxonomyNodeId,
          name: draft.categoryName ?? '',
          tab: activeTab,
        } as TaxonomyNode)
      : null
  );
  const [loadingSubcats, setLoadingSubcats] = useState(false);

  // Load L1 categories for active tab
  const loadCategories = useCallback(
    async (tab: ProviderTab) => {
      setLoading(true);
      setError(null);
      try {
        const cats = await providerApi.getCategories(tab);
        setCategories(cats.filter((c) => !c.parent_id)); // L1 only
      } catch (e) {
        setError('Could not load categories. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [setLoading, setError, setCategories]
  );

  useEffect(() => {
    loadCategories(activeTab);
    setSelectedCategoryLocal(null);
    setSubCategories([]);
  }, [activeTab]);

  // Load sub-categories for selected L1 category
  const handleCategorySelect = async (node: TaxonomyNode) => {
    setSelectedCategoryLocal(node);
    setCategory(node);
    setSubCategories([]);
    setLoadingSubcats(true);
    try {
      const subs = await providerApi.getSubCategories(node.id);
      setSubCategories(subs);
    } catch {
      // Non-critical — user can still proceed with L1 only
    } finally {
      setLoadingSubcats(false);
    }
  };

  const handleSubCategorySelect = (node: TaxonomyNode) => {
    setSubCategory(node);
    navigation.navigate('CreateProfileStep2');
  };

  // Proceed without sub-category if none exist
  const handleNext = () => {
    if (!draft.taxonomyNodeId) return;
    navigation.navigate('CreateProfileStep2');
  };

  const canProceed = !!draft.taxonomyNodeId;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <ScreenHeader title="Create Profile" onBack={() => navigation.goBack()} />

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: '33%' }]} />
      </View>

      {/* Step indicator */}
      <View style={styles.stepRow}>
        <Text style={styles.stepLabel}>Step 1 of 3</Text>
        <Text style={styles.stepHint}>Choose your category</Text>
      </View>

      {/* Tab picker */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsContainer}
        style={styles.tabsScroll}
      >
        {visibleTabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.75}
          >
            <Text style={styles.tabEmoji}>{tab.emoji}</Text>
            <Text
              style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.body}>
        {/* Category grid */}
        {isLoading ? (
          <ActivityIndicator
            color="#C8691A"
            style={{ marginTop: 40 }}
            size="large"
          />
        ) : (
          <FlatList
            data={categories}
            keyExtractor={(item) => item.id}
            numColumns={3}
            columnWrapperStyle={styles.catRow}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.catList}
            ListHeaderComponent={
              <Text style={styles.sectionLabel}>
                {selectedCategory ? 'Sub-category' : 'Category'}
              </Text>
            }
            // If a category is selected, show sub-categories instead
            renderItem={({ item }) => {
              if (selectedCategory) return null; // hide cats when showing subcats
              const isSelected = selectedCategory === null
                ? draft.taxonomyNodeId === item.id
                : false;
              return (
                <CategoryChip
                  node={item}
                  selected={isSelected}
                  onPress={() => handleCategorySelect(item)}
                />
              );
            }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No categories found for this tab.</Text>
            }
          />
        )}

        {/* Sub-category section (shown after L1 selected) */}
        {selectedCategory && (
          <View style={styles.subCatSection}>
            {/* Back to categories */}
            <TouchableOpacity
              onPress={() => {
                setSelectedCategoryLocal(null);
                setSubCategories([]);
              }}
              style={styles.backBtn}
            >
              <Text style={styles.backBtnText}>← {selectedCategory.name}</Text>
            </TouchableOpacity>

            <Text style={styles.sectionLabel}>Sub-category (optional)</Text>

            {loadingSubcats ? (
              <ActivityIndicator color="#C8691A" style={{ marginTop: 20 }} />
            ) : subCategories.length > 0 ? (
              <View style={styles.subCatList}>
                {subCategories.map((sub) => (
                  <SubCategoryRow
                    key={sub.id}
                    node={sub}
                    selected={draft.taxonomyNodeId === sub.id}
                    onPress={() => handleSubCategorySelect(sub)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.noSubCat}>
                <Text style={styles.noSubCatText}>
                  No sub-categories. You can continue with "{selectedCategory.name}".
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Next CTA */}
      {canProceed && !selectedCategory && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.nextBtn}
            onPress={handleNext}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>Continue</Text>
            <Text style={styles.nextBtnSub}>
              {draft.categoryName}
              {draft.subCategoryName ? ` › ${draft.subCategoryName}` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// ─── CategoryTile — IDENTICAL to consumer CategoryBrowseScreen tile ─────────────
// Same hex_color fill, same white rounded box, same emoji size, same font, same
// 3-column grid. One-to-one visual parity so provider mode feels like consumer mode.
function CategoryChip({
  node,
  selected,
  onPress,
}: {
  node: TaxonomyNode;
  selected: boolean;
  onPress: () => void;
}) {
  const tileColor = node.color ?? '#C8691A';
  const icon      = node.icon  ?? '📦';

  return (
    <TouchableOpacity
      style={[
        styles.catChip,
        { backgroundColor: tileColor },
        selected && styles.catChipSelected,
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* White inner box — exact match to consumer CategoryBrowseScreen */}
      <View style={styles.catChipIconBox}>
        <Text style={styles.catChipIcon}>{icon}</Text>
      </View>
      <Text style={styles.catChipText} numberOfLines={2}>{node.name}</Text>
      {node.verificationRequired && (
        <Text style={styles.verifiedBadge}>✓ Verified</Text>
      )}
    </TouchableOpacity>
  );
}

function SubCategoryRow({
  node,
  selected,
  onPress,
}: {
  node: TaxonomyNode;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.subRow, selected && styles.subRowSelected]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.subRowLeft}>
        <Text style={[styles.subRowText, selected && styles.subRowTextSelected]}>
          {node.name}
        </Text>
        {node.homeVisit && (
          <Text style={styles.homeVisitBadge}>🏠 Home visit</Text>
        )}
      </View>
      <Text style={[styles.subRowChevron, selected && { color: '#C8691A' }]}>›</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FAF7F0',
  },
  progressBar: {
    height: 3,
    backgroundColor: '#F0E4CC',
  },
  progressFill: {
    height: 3,
    backgroundColor: '#C8691A',
    borderRadius: 2,
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 4,
  },
  stepLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
    color: '#C8691A',
    letterSpacing: 0.5,
  },
  stepHint: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    color: '#9B9390',
  },
  tabsScroll: {
    flexGrow: 0,
    marginTop: 10,
  },
  tabsContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E0D6C8',
    backgroundColor: '#FFFFFF',
  },
  tabActive: {
    backgroundColor: '#1C1C2E',
    borderColor: '#1C1C2E',
  },
  tabEmoji: {
    fontSize: 14,
  },
  tabLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13.5,
    color: '#4A4540',
  },
  tabLabelActive: {
    color: '#FAF7F0',
  },
  body: {
    flex: 1,
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
    color: '#9B9390',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 18,
    marginBottom: 12,
  },
  catList: {
    paddingBottom: 20,
  },
  catRow: {
    gap: 0,           // consumer uses marginHorizontal:3 on tiles, not gap on row
    marginBottom: 0,
  },
  // ── CategoryChip = consumer CategoryTile — pixel-perfect match ──────────────
  catChip: {
    alignItems: 'center',
    padding: 10,
    marginBottom: 10,
    marginHorizontal: 3,
    borderRadius: 14,        // matches consumer tile borderRadius
  },
  catChipIconBox: {
    width: 52,               // matches consumer tileWhiteBox
    height: 52,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  catChipIcon: {
    fontSize: 28,            // matches consumer tileIcon
  },
  catChipSelected: {
    opacity: 0.85,           // subtle selection feedback without changing layout
  },
  catChipText: {
    fontSize: 11,            // matches consumer tileLabel
    fontFamily: 'PlusJakartaSans-Medium',
    color: '#FFFFFF',        // white on coloured tile — same as consumer
    textAlign: 'center',
  },
  catChipTextSelected: {
    color: '#FFFFFF',
  },
  verifiedBadge: {
    marginTop: 2,
    fontSize: 9,
    fontFamily: 'PlusJakartaSans-Regular',
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 14,
    color: '#9B9390',
    textAlign: 'center',
    marginTop: 32,
  },
  subCatSection: {
    flex: 1,
  },
  backBtn: {
    marginTop: 16,
    marginBottom: 4,
  },
  backBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 14,
    color: '#C8691A',
  },
  subCatList: {
    gap: 8,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E0D6C8',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  subRowSelected: {
    borderColor: '#C8691A',
    backgroundColor: '#FEF3E8',
  },
  subRowLeft: {
    flex: 1,
    gap: 3,
  },
  subRowText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 14,
    color: '#1C1C2E',
  },
  subRowTextSelected: {
    color: '#C8691A',
  },
  homeVisitBadge: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11,
    color: '#2E7D72',
  },
  subRowChevron: {
    fontSize: 22,
    color: '#C8C0B5',
    fontFamily: 'PlusJakartaSans-Light',
  },
  noSubCat: {
    backgroundColor: '#F5F2EC',
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
  },
  noSubCatText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13,
    color: '#1C1C2E',
    lineHeight: 20,
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
    backgroundColor: '#FAF7F0',
  },
  nextBtn: {
    backgroundColor: '#1C1C2E',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    gap: 2,
  },
  nextBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 16,
    color: '#FAF7F0',
  },
  nextBtnSub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    color: '#9B96A0',
  },
});
