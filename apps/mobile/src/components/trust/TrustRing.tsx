/**
 * TrustRing.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * SVG animated ring showing trust score 0-100.
 * Tier colours:
 *   0-19   → Unverified  #6B6560
 *   20-39  → Basic       #C8691A  (Saffron)
 *   40-59  → Basic+      #C8691A  (Saffron, transitional)
 *   60-79  → Trusted     #6BA89E  (Light Verdigris)
 *   80-100 → Highly Trusted #2E7D72 (Verdigris)
 *
 * Smooth fill animation 1.5 s on mount and on score change.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

// ─── Brand ───────────────────────────────────────────────────────────────────
const TIER_COLOUR = {
  unverified: '#6B6560',
  basic:      '#C8691A',
  trusted:    '#6BA89E',
  highly:     '#2E7D72',
} as const;

const TRACK_COLOUR = '#E8E0D4'; // muted warm sand track

export type TrustTierKey = keyof typeof TIER_COLOUR;

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function getTierColour(score: number): string {
  if (score >= 80) return TIER_COLOUR.highly;
  if (score >= 60) return TIER_COLOUR.trusted;
  if (score >= 20) return TIER_COLOUR.basic;
  return TIER_COLOUR.unverified;
}

export function getTierKey(score: number): TrustTierKey {
  if (score >= 80) return 'highly';
  if (score >= 60) return 'trusted';
  if (score >= 20) return 'basic';
  return 'unverified';
}

// Animated circle wrapper so we can drive strokeDashoffset via Animated.Value
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ─── Props ────────────────────────────────────────────────────────────────────
interface TrustRingProps {
  score: number;          // 0-100
  size?: 60 | 120;        // dp
  animated?: boolean;     // defaults true
  strokeWidth?: number;   // defaults 4 (size=60) or 7 (size=120)
  showScore?: boolean;    // renders numeric score label inside ring
}

// ─── Component ────────────────────────────────────────────────────────────────
const TrustRing: React.FC<TrustRingProps> = ({
  score,
  size = 60,
  animated: enableAnimation = true,
  strokeWidth,
  showScore = false,
}) => {
  const sw        = strokeWidth ?? (size === 120 ? 7 : 4);
  const radius    = (size - sw) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre    = size / 2;

  // offset 0 = full ring filled; offset = circumference = empty ring
  const targetOffset = circumference * (1 - Math.min(100, Math.max(0, score)) / 100);

  const animatedOffset = useRef(new Animated.Value(circumference)).current; // starts empty

  useEffect(() => {
    if (enableAnimation) {
      // Reset to empty then fill to new score
      animatedOffset.setValue(circumference);
      Animated.timing(animatedOffset, {
        toValue:        targetOffset,
        duration:       1500,
        useNativeDriver: true,
      }).start();
    } else {
      animatedOffset.setValue(targetOffset);
    }
  }, [score]); // eslint-disable-line react-hooks/exhaustive-deps

  const colour = getTierColour(score);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* Track */}
        <Circle
          cx={centre}
          cy={centre}
          r={radius}
          stroke={TRACK_COLOUR}
          strokeWidth={sw}
          fill="none"
        />
        {/* Filled arc — rotated so fill starts at top */}
        <G rotation="-90" origin={`${centre}, ${centre}`}>
          <AnimatedCircle
            cx={centre}
            cy={centre}
            r={radius}
            stroke={colour}
            strokeWidth={sw}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={animatedOffset}
            strokeLinecap="round"
          />
        </G>
      </Svg>
    </View>
  );
};

export default TrustRing;
