/**
 * LeadCounterPill.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Shows remaining monthly leads for consumer.
 * Colour-coded urgency: healthy → warning → critical.
 * Data from provider_lead_usage / consumer_lead_usage tables.
 * Animates count on change.
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';

const VERDIGRIS = '#2E7D72';
const SAFFRON   = '#C8691A';
const TERRACOTTA = '#C0392B';

// ─── Urgency thresholds ───────────────────────────────────────────────────────
function getUrgency(remaining: number, total: number) {
  const pct = remaining / total;
  if (pct > 0.4)       return { colour: VERDIGRIS, bg: VERDIGRIS + '15',  label: 'leads left' };
  if (remaining > 5)   return { colour: SAFFRON,   bg: SAFFRON + '15',    label: 'leads left' };
  if (remaining > 0)   return { colour: TERRACOTTA, bg: TERRACOTTA + '12', label: 'leads left!' };
  return               { colour: TERRACOTTA, bg: TERRACOTTA + '12',        label: 'leads — upgrade' };
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface LeadCounterPillProps {
  remaining:   number;
  total:       number;
  onPress?:    () => void;   // → subscription screen
  showBar?:    boolean;      // show thin progress bar below pill
  style?:      ViewStyle;
  size?:       'sm' | 'md' | 'lg';
}

// ─── Component ────────────────────────────────────────────────────────────────
const LeadCounterPill: React.FC<LeadCounterPillProps> = ({
  remaining,
  total,
  onPress,
  showBar = false,
  style,
  size = 'md',
}) => {
  const scaleAnim  = useRef(new Animated.Value(1)).current;
  const prevRef    = useRef(remaining);

  useEffect(() => {
    if (remaining !== prevRef.current) {
      prevRef.current = remaining;
      Animated.sequence([
        Animated.spring(scaleAnim, { toValue: 1.15, useNativeDriver: true, speed: 500 }),
        Animated.spring(scaleAnim, { toValue: 1,    useNativeDriver: true, speed: 300 }),
      ]).start();
    }
  }, [remaining]); // eslint-disable-line

  const { colour, bg, label } = getUrgency(remaining, total || 1);
  const barPct = Math.max(0, Math.min(1, remaining / (total || 1)));

  const fontSize = size === 'sm' ? 11 : size === 'lg' ? 15 : 13;
  const numSize  = size === 'sm' ? 14 : size === 'lg' ? 22 : 18;
  const padding  = size === 'sm'
    ? { paddingHorizontal: 8,  paddingVertical: 4  }
    : size === 'lg'
    ? { paddingHorizontal: 16, paddingVertical: 10 }
    : { paddingHorizontal: 12, paddingVertical: 6  };

  const pill = (
    <Animated.View
      style={[
        styles.pill,
        { backgroundColor: bg, borderColor: colour + '40' },
        padding,
        { transform: [{ scale: scaleAnim }] },
        style,
      ]}
    >
      <Text style={[styles.count, { color: colour, fontSize: numSize }]}>
        {remaining}
      </Text>
      <Text style={[styles.label, { color: colour, fontSize }]}>{label}</Text>
    </Animated.View>
  );

  return (
    <View>
      {onPress ? (
        <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
          {pill}
        </TouchableOpacity>
      ) : pill}

      {showBar && (
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${barPct * 100}%` as any, backgroundColor: colour }]} />
        </View>
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  pill: {
    flexDirection:  'row',
    alignItems:     'center',
    alignSelf:      'flex-start',
    borderRadius:   20,
    borderWidth:    1,
    gap:            5,
  },
  count: {
    fontFamily: 'PlusJakartaSans-Bold',
  },
  label: {
    fontFamily: 'PlusJakartaSans-Regular',
  },
  barTrack: {
    height:          3,
    backgroundColor: '#E8E0D4',
    borderRadius:    2,
    marginTop:       6,
    overflow:        'hidden',
  },
  barFill: {
    height:       3,
    borderRadius: 2,
  },
});

export default LeadCounterPill;
