/**
 * ZeroCommissionCounter.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Displays total earnings saved (₹0 commission taken from all contact events).
 * Animates the rupee counter upwards on mount.
 * Brand differentiator — shown on home screen and provider dashboard.
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

const VERDIGRIS    = '#2E7D72';
const VERDIGRIS_BG = '#E8F4F2';
const DEEP_INK     = '#1C1C2E';
const SAFFRON      = '#C8691A';

// ─── Rupee formatter ──────────────────────────────────────────────────────────
function formatRupees(paise: number): string {
  const rupees = Math.floor(paise / 100);
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(1)} Cr`;
  if (rupees >= 100_000)    return `₹${(rupees / 100_000).toFixed(1)} L`;
  if (rupees >= 1_000)      return `₹${(rupees / 1_000).toFixed(1)} K`;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface ZeroCommissionCounterProps {
  /** Total value of contacts on platform (in paise) – drives the "saved" number */
  totalContactValuePaise?: number;
  /** Total contact events processed */
  totalContacts?:          number;
  variant?:                'compact' | 'full' | 'hero';
  style?:                  ViewStyle;
  animated?:               boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
const ZeroCommissionCounter: React.FC<ZeroCommissionCounterProps> = ({
  totalContactValuePaise = 0,
  totalContacts = 0,
  variant = 'full',
  style,
  animated: enableAnimation = true,
}) => {
  const countAnim  = useRef(new Animated.Value(0)).current;
  const countRef   = useRef(0);

  useEffect(() => {
    if (enableAnimation && totalContactValuePaise > 0) {
      Animated.timing(countAnim, {
        toValue:   totalContactValuePaise,
        duration:  1400,
        useNativeDriver: false,
      }).start();
    } else {
      countAnim.setValue(totalContactValuePaise);
    }
  }, [totalContactValuePaise]); // eslint-disable-line

  if (variant === 'compact') {
    return (
      <View style={[styles.compact, style]}>
        <View style={styles.zeroBadge}>
          <Text style={styles.zeroBadgeText}>0%</Text>
        </View>
        <Text style={styles.compactLabel}>Commission</Text>
      </View>
    );
  }

  if (variant === 'hero') {
    return (
      <View style={[styles.hero, style]}>
        <Text style={styles.heroLabel}>Commission we've charged</Text>
        <Text style={styles.heroAmount}>₹0</Text>
        <Text style={styles.heroSub}>
          Across {totalContacts.toLocaleString('en-IN')} connections. Ever.
        </Text>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>Zero commission. Always.</Text>
        </View>
      </View>
    );
  }

  // Full variant
  return (
    <View style={[styles.card, style]}>
      <View style={styles.leftCol}>
        <View style={styles.zeroCircle}>
          <Text style={styles.zeroText}>₹0</Text>
          <Text style={styles.zeroSub}>commission</Text>
        </View>
      </View>

      <View style={styles.rightCol}>
        <Text style={styles.title}>Zero commission</Text>
        <Text style={styles.desc}>
          We've processed{' '}
          <Text style={styles.accent}>
            {totalContacts.toLocaleString('en-IN')} contacts
          </Text>
          {' '}and never taken a single rupee.
        </Text>
        {totalContactValuePaise > 0 && (
          <Text style={styles.saved}>
            <Text style={styles.savedAmount}>
              {formatRupees(totalContactValuePaise)}
            </Text>
            {' '}worth of connections made
          </Text>
        )}
      </View>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Compact
  compact: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  zeroBadge: {
    backgroundColor:  VERDIGRIS,
    borderRadius:     6,
    paddingHorizontal: 7,
    paddingVertical:   3,
  },
  zeroBadgeText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   12,
    color:      '#FFFFFF',
  },
  compactLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      '#6B6560',
  },

  // Full card
  card: {
    flexDirection:    'row',
    backgroundColor:  VERDIGRIS_BG,
    borderRadius:     16,
    padding:          16,
    gap:              14,
    borderWidth:      1,
    borderColor:      VERDIGRIS + '30',
  },
  leftCol: {
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  zeroCircle: {
    width:           64,
    height:          64,
    borderRadius:    32,
    backgroundColor: VERDIGRIS,
    alignItems:      'center',
    justifyContent:  'center',
  },
  zeroText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   18,
    color:      '#FFFFFF',
    lineHeight: 22,
  },
  zeroSub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   8,
    color:      'rgba(255,255,255,0.80)',
    letterSpacing: 0.3,
  },
  rightCol: {
    flex: 1,
    gap:  4,
  },
  title: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      VERDIGRIS,
  },
  desc: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      '#4A6B65',
    lineHeight: 18,
  },
  accent: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color:      DEEP_INK,
  },
  saved: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#6B9490',
    marginTop:  2,
  },
  savedAmount: {
    fontFamily: 'PlusJakartaSans-Bold',
    color:      VERDIGRIS,
  },

  // Hero
  hero: {
    alignItems:      'center',
    gap:             8,
    paddingVertical: 24,
  },
  heroLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      VERDIGRIS,
    letterSpacing: 0.3,
  },
  heroAmount: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   64,
    color:      VERDIGRIS,
    lineHeight: 72,
  },
  heroSub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   14,
    color:      '#6B9490',
    textAlign:  'center',
  },
  heroBadge: {
    backgroundColor:  VERDIGRIS,
    borderRadius:     20,
    paddingHorizontal: 20,
    paddingVertical:   8,
    marginTop:         4,
  },
  heroBadgeText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   14,
    color:      '#FFFFFF',
    letterSpacing: 0.3,
  },
});

export default ZeroCommissionCounter;
