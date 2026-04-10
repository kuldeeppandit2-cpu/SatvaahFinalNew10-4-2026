/**
 * ProviderCardSkeleton.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Shimmer skeleton matching ProviderCard layout exactly.
 * Uses Animated loop for shimmer highlight sweep.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

const BONE_BG = '#EDE5D8';
const SHIMMER = '#F5EFE6';

// ─── Shimmer bone ─────────────────────────────────────────────────────────────
interface BoneProps {
  width: number | string;
  height: number;
  borderRadius?: number;
  shimmerAnim: Animated.Value;
}

const Bone: React.FC<BoneProps> = ({ width, height, borderRadius = 6, shimmerAnim }) => {
  const shimmerStyle = {
    opacity: shimmerAnim.interpolate({
      inputRange:  [0, 0.5, 1],
      outputRange: [0, 1, 0],
    }),
  };

  return (
    <View style={[styles.bone, { width: width as any, height, borderRadius }]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.shimmer, shimmerStyle]} />
    </View>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────
const ProviderCardSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
      ])
    ).start();
    return () => shimmerAnim.stopAnimation();
  }, []); // eslint-disable-line

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.card}>
          {/* Photo */}
          <Bone width={80} height={80} borderRadius={12} shimmerAnim={shimmerAnim} />

          {/* Details column */}
          <View style={styles.details}>
            <Bone width={140} height={14} shimmerAnim={shimmerAnim} />
            <Bone width={90}  height={11} borderRadius={4} shimmerAnim={shimmerAnim} />
            <Bone width={110} height={11} borderRadius={4} shimmerAnim={shimmerAnim} />
            <Bone width={80}  height={9}  borderRadius={4} shimmerAnim={shimmerAnim} />
            <Bone width={60}  height={18} borderRadius={9} shimmerAnim={shimmerAnim} />
          </View>

          {/* CTA */}
          <Bone width={72} height={34} borderRadius={17} shimmerAnim={shimmerAnim} />
        </View>
      ))}
    </>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    flexDirection:    'row',
    alignItems:       'center',
    backgroundColor:  '#FFFFFF',
    borderRadius:     16,
    padding:          14,
    marginHorizontal: 16,
    marginVertical:   6,
    gap:              12,
    shadowColor:      '#1C1C2E',
    shadowOffset:     { width: 0, height: 1 },
    shadowOpacity:    0.05,
    shadowRadius:     6,
    elevation:        2,
  },
  details: {
    flex: 1,
    gap:  7,
  },
  bone: {
    backgroundColor: BONE_BG,
    overflow:        'hidden',
  },
  shimmer: {
    backgroundColor: SHIMMER,
  },
});

export default ProviderCardSkeleton;
