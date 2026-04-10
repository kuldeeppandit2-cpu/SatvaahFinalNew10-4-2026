/**
 * CategoryGrid.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * 4-column icon + label grid of top-level taxonomy categories.
 * Data from GET /api/v1/categories?tab= (taxonomy_nodes, l1 nodes).
 * Horizontal scroll optional; default is wrapping 4-col grid.
 * Tapping a category → navigates to SearchScreen with node pre-filled.
 */

import React from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

const SAFFRON  = '#C8691A';
const VERDIGRIS = '#2E7D72';
const DEEP_INK  = '#1C1C2E';
const IVORY     = '#FAF7F0';
const WARM_SAND = '#F0E4CC';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TaxonomyNode {
  id:          string;
  name:        string;
  icon?:       string;    // emoji
  l1?:         string;
  l2?:         string;
  tab:         'products' | 'services' | 'expertise' | 'establishments';
  providerCount?: number;
}

interface CategoryGridProps {
  categories:   TaxonomyNode[];
  onPress:      (node: TaxonomyNode) => void;
  /** 'grid' = 4-col wrap, 'scroll' = horizontal row */
  layout?:      'grid' | 'scroll';
  columns?:     number;      // default 4
  showCount?:   boolean;
  title?:       string;
  style?:       ViewStyle;
  loading?:     boolean;
}

// ─── Skeleton tile ────────────────────────────────────────────────────────────
const SkeletonTile = () => (
  <View style={styles.skeleTile}>
    <View style={styles.skeleIcon} />
    <View style={styles.skeleName} />
  </View>
);

// ─── Category tile ────────────────────────────────────────────────────────────
interface TileProps {
  node:     TaxonomyNode;
  onPress:  () => void;
  showCount?: boolean;
  tileWidth?: number;
}

const CategoryTile: React.FC<TileProps> = ({ node, onPress, showCount, tileWidth }) => (
  <Pressable
    style={({ pressed }) => [
      styles.tile,
      tileWidth ? { width: tileWidth } : undefined,
      pressed && styles.tilePressed,
    ]}
    onPress={onPress}
    android_ripple={{ color: SAFFRON + '20' }}
  >
    {/* Icon circle */}
    <View style={styles.iconCircle}>
      <Text style={styles.icon}>{node.icon ?? '🔧'}</Text>
    </View>

    {/* Label */}
    <Text style={styles.tileName} numberOfLines={2}>{node.name}</Text>

    {/* Provider count */}
    {showCount && node.providerCount !== undefined && (
      <Text style={styles.count}>{node.providerCount}+</Text>
    )}
  </Pressable>
);

// ─── Component ────────────────────────────────────────────────────────────────
const CategoryGrid: React.FC<CategoryGridProps> = ({
  categories,
  onPress,
  layout = 'grid',
  columns = 4,
  showCount = false,
  title,
  style,
  loading = false,
}) => {
  const skeleCount = columns * 2;

  if (layout === 'scroll') {
    return (
      <View style={style}>
        {title && <Text style={styles.title}>{title}</Text>}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollRow}
        >
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <SkeletonTile key={i} />)
            : categories.map((node) => (
                <CategoryTile
                  key={node.id}
                  node={node}
                  onPress={() => onPress(node)}
                  showCount={showCount}
                  tileWidth={80}
                />
              ))}
        </ScrollView>
      </View>
    );
  }

  // Grid layout
  return (
    <View style={style}>
      {title && <Text style={styles.title}>{title}</Text>}
      <FlatList
        data={loading ? Array.from({ length: skeleCount }) : categories}
        keyExtractor={(_, i) => String(i)}
        numColumns={columns}
        scrollEnabled={false}
        columnWrapperStyle={columns > 1 ? styles.row : undefined}
        renderItem={({ item, index }) => {
          if (loading) return <SkeletonTile key={index} />;
          const node = item as TaxonomyNode;
          return (
            <CategoryTile
              key={node.id}
              node={node}
              onPress={() => onPress(node)}
              showCount={showCount}
            />
          );
        }}
      />
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  title: {
    fontFamily:   'PlusJakartaSans-SemiBold',
    fontSize:     16,
    color:        DEEP_INK,
    marginBottom: 12,
  },
  row: {
    justifyContent: 'space-around',
    marginBottom:   8,
  },
  scrollRow: {
    flexDirection: 'row',
    gap:           10,
    paddingHorizontal: 2,
  },
  tile: {
    flex:           1,
    alignItems:     'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius:   12,
    maxWidth:       90,
    gap:            5,
  },
  tilePressed: {
    backgroundColor: WARM_SAND,
  },
  iconCircle: {
    width:          52,
    height:         52,
    borderRadius:   16,
    backgroundColor: WARM_SAND,
    alignItems:     'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 26,
  },
  tileName: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      DEEP_INK,
    textAlign:  'center',
    lineHeight: 15,
  },
  count: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   9,
    color:      '#9E9890',
  },

  // Skeleton
  skeleTile: {
    flex:           1,
    alignItems:     'center',
    paddingVertical: 10,
    gap:            8,
    maxWidth:       90,
  },
  skeleIcon: {
    width:           52,
    height:          52,
    borderRadius:    16,
    backgroundColor: '#EDE5D8',
  },
  skeleName: {
    width:           48,
    height:          10,
    borderRadius:    5,
    backgroundColor: '#EDE5D8',
  },
});

export default CategoryGrid;
