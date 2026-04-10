/**
 * TrustBadge.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Displays HIGHLY TRUSTED / TRUSTED / BASIC / UNVERIFIED
 * Tier-colour coded pill badge.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getTierColour, getTierKey } from './TrustRing';

// ─── Constants ────────────────────────────────────────────────────────────────
const TIER_LABEL: Record<string, string> = {
  highly:     'HIGHLY TRUSTED',
  trusted:    'TRUSTED',
  basic:      'BASIC',
  unverified: 'UNVERIFIED',
};

const TIER_BG_ALPHA: Record<string, string> = {
  highly:     '#2E7D721A',  // 10% opacity Verdigris
  trusted:    '#6BA89E1A',
  basic:      '#C8691A1A',
  unverified: '#6B65601A',
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface TrustBadgeProps {
  score: number;
  /** Override display label */
  label?: string;
  /** compact = small pill, default = full pill */
  variant?: 'default' | 'compact';
}

// ─── Component ────────────────────────────────────────────────────────────────
const TrustBadge: React.FC<TrustBadgeProps> = ({
  score,
  label,
  variant = 'default',
}) => {
  const tierKey   = getTierKey(score);
  const colour    = getTierColour(score);
  const bg        = TIER_BG_ALPHA[tierKey];
  const text      = label ?? TIER_LABEL[tierKey];
  const isCompact = variant === 'compact';

  return (
    <View
      style={[
        styles.pill,
        isCompact && styles.pillCompact,
        { backgroundColor: bg, borderColor: colour },
      ]}
    >
      {/* Indicator dot */}
      <View style={[styles.dot, { backgroundColor: colour }]} />
      <Text
        style={[
          styles.label,
          isCompact && styles.labelCompact,
          { color: colour },
        ]}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  pill: {
    flexDirection:  'row',
    alignItems:     'center',
    alignSelf:      'flex-start',
    paddingHorizontal: 10,
    paddingVertical:    4,
    borderRadius:   20,
    borderWidth:    1,
    gap:            5,
  },
  pillCompact: {
    paddingHorizontal: 7,
    paddingVertical:   2,
  },
  dot: {
    width:        5,
    height:       5,
    borderRadius: 3,
  },
  label: {
    fontFamily:  'PlusJakartaSans-SemiBold',
    fontSize:    11,
    letterSpacing: 0.6,
  },
  labelCompact: {
    fontSize: 9,
  },
});

export default TrustBadge;
