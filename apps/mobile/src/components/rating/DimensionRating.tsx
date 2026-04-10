/**
 * DimensionRating.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Renders per-category rating dimensions from taxonomy_nodes.ratingDimensions JSONB.
 * Each dimension gets a 1-5 star mini-rating.
 * Driven entirely by the taxonomy schema — no hardcoded dimensions.
 *
 * Example rating_dimensions JSONB:
 * [
 *   { "key": "punctuality",   "label": "Punctuality",    "weight": 1.0 },
 *   { "key": "cleanliness",   "label": "Cleanliness",    "weight": 0.8 },
 *   { "key": "communication", "label": "Communication",  "weight": 0.9 }
 * ]
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import StarRating from './StarRating';

const SAFFRON  = '#C8691A';
const DEEP_INK = '#1C1C2E';
const TRACK    = '#E8E0D4';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface RatingDimension {
  key:    string;
  label:  string;
  weight: number;
}

export type DimensionValues = Record<string, number>;  // key → 1-5 star value

interface DimensionRatingProps {
  dimensions:  RatingDimension[];
  values:      DimensionValues;
  onChange?:   (key: string, value: number) => void;
  readonly?:   boolean;
  style?:      ViewStyle;
  /** Compact renders smaller stars inline */
  variant?:    'default' | 'compact' | 'summary';
}

// ─── Component ────────────────────────────────────────────────────────────────
const DimensionRating: React.FC<DimensionRatingProps> = ({
  dimensions,
  values,
  onChange,
  readonly = false,
  style,
  variant = 'default',
}) => {
  if (dimensions.length === 0) return null;

  const isCompact = variant === 'compact';
  const isSummary = variant === 'summary';
  const starSize  = isCompact ? 20 : isSummary ? 16 : 28;
  const starGap   = isCompact ? 4  : isSummary ? 3  : 6;

  if (isSummary) {
    // Horizontal scrollable chips showing avg per dimension
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.summaryRow, style]}
      >
        {dimensions.map((dim) => {
          const v = values[dim.key] ?? 0;
          return (
            <View key={dim.key} style={styles.summaryChip}>
              <Text style={styles.summaryLabel}>{dim.label}</Text>
              <StarRating
                value={v}
                onChange={() => {}}
                starSize={starSize}
                gap={starGap}
                readonly
                showLabel={false}
              />
              {v > 0 && <Text style={styles.summaryVal}>{v.toFixed(1)}</Text>}
            </View>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {dimensions.map((dim, idx) => (
        <View key={dim.key}>
          <View style={styles.row}>
            {/* Label + weight indicator */}
            <View style={styles.labelWrap}>
              <Text style={styles.dimLabel}>{dim.label}</Text>
              {dim.weight < 1 && (
                <Text style={styles.weight}>×{dim.weight.toFixed(1)}</Text>
              )}
            </View>

            {/* Stars */}
            <StarRating
              value={values[dim.key] ?? 0}
              onChange={(v) => onChange?.(dim.key, v)}
              starSize={starSize}
              gap={starGap}
              readonly={readonly}
              showLabel={false}
            />
          </View>

          {/* Separator (not after last) */}
          {idx < dimensions.length - 1 && <View style={styles.sep} />}
        </View>
      ))}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    gap: 0,
  },
  row: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  labelWrap: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    flex:          1,
  },
  dimLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   14,
    color:      DEEP_INK,
  },
  weight: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   10,
    color:      '#A89E92',
  },
  sep: {
    height:          1,
    backgroundColor: TRACK,
    marginHorizontal: 0,
  },
  // Summary variant
  summaryRow: {
    flexDirection: 'row',
    gap:           10,
    paddingHorizontal: 2,
  },
  summaryChip: {
    alignItems:     'center',
    gap:            3,
    backgroundColor: '#FFFFFF',
    borderRadius:   10,
    borderWidth:    1,
    borderColor:    TRACK,
    paddingHorizontal: 10,
    paddingVertical:   8,
  },
  summaryLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   10,
    color:      '#9E9890',
    letterSpacing: 0.2,
  },
  summaryVal: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   11,
    color:      SAFFRON,
  },
});

export default DimensionRating;
