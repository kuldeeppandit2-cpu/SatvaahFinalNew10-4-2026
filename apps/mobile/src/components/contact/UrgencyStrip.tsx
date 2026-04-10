/**
 * UrgencyStrip.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Verdigris background horizontal strip showing urgency context:
 *   — "X others also viewing", real-time availability signal, etc.
 * Slides down from top on mount.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, type ViewStyle } from 'react-native';

const VERDIGRIS    = '#2E7D72';
const VERDIGRIS_BG = '#E8F4F2';

// ─── Props ────────────────────────────────────────────────────────────────────
export type UrgencyVariant =
  | 'viewing'        // "X others viewing"
  | 'availability'   // "Available until 6 PM"
  | 'leads'          // "Only X slots this week"
  | 'custom';

interface UrgencyStripProps {
  variant:   UrgencyVariant;
  count?:    number;       // used by 'viewing' and 'leads'
  timeLabel?: string;      // used by 'availability'
  message?:  string;       // used by 'custom'
  style?:    ViewStyle;
  animated?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
const UrgencyStrip: React.FC<UrgencyStripProps> = ({
  variant,
  count,
  timeLabel,
  message,
  style,
  animated: enableAnimation = true,
}) => {
  const slideAnim = useRef(new Animated.Value(-44)).current;
  const opacAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (enableAnimation) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0, tension: 70, friction: 9, useNativeDriver: true,
        }),
        Animated.timing(opacAnim, {
          toValue: 1, duration: 250, useNativeDriver: true,
        }),
      ]).start();
    } else {
      slideAnim.setValue(0);
      opacAnim.setValue(1);
    }
  }, []); // eslint-disable-line

  const { icon, text } = getContent(variant, count, timeLabel, message);

  return (
    <Animated.View
      style={[
        styles.strip,
        style,
        { transform: [{ translateY: slideAnim }], opacity: opacAnim },
      ]}
    >
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.text}>{text}</Text>
    </Animated.View>
  );
};

function getContent(
  variant: UrgencyVariant,
  count?: number,
  timeLabel?: string,
  message?: string,
): { icon: string; text: string } {
  switch (variant) {
    case 'viewing':
      return {
        icon: '👀',
        text: `${count ?? '?'} other${(count ?? 0) !== 1 ? 's' : ''} also viewing this provider`,
      };
    case 'availability':
      return {
        icon: '🕐',
        text: `Available${timeLabel ? ` until ${timeLabel}` : ' now'}`,
      };
    case 'leads':
      return {
        icon: '📅',
        text: `Only ${count ?? '?'} slot${(count ?? 0) !== 1 ? 's' : ''} remaining this week`,
      };
    case 'custom':
    default:
      return { icon: 'ℹ️', text: message ?? '' };
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  strip: {
    flexDirection:    'row',
    alignItems:       'center',
    backgroundColor:  VERDIGRIS_BG,
    borderLeftWidth:  3,
    borderLeftColor:  VERDIGRIS,
    paddingHorizontal: 14,
    paddingVertical:   9,
    borderRadius:     8,
    gap:              8,
  },
  icon: {
    fontSize: 14,
  },
  text: {
    flex:       1,
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
    color:      VERDIGRIS,
    lineHeight: 17,
  },
});

export default UrgencyStrip;
