/**
 * TrustMomentumWidget.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Renders trust score momentum: sparkline of last N scores,
 * net delta from previous period, and contextual label.
 * Data from GET /api/v1/trust/me or trust history.
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import Svg, { Path, Polyline } from 'react-native-svg';

const VERDIGRIS  = '#2E7D72';
const SAFFRON    = '#C8691A';
const DEEP_INK   = '#1C1C2E';
const IVORY      = '#FAF7F0';
const TRACK      = '#E8E0D4';

// ─── Props ────────────────────────────────────────────────────────────────────
interface TrustMomentumWidgetProps {
  currentScore:  number;
  previousScore: number;
  /** Array of recent scores, oldest → newest (up to 10) */
  history:       number[];
  style?:        ViewStyle;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
const SPARK_W = 80;
const SPARK_H = 32;

function buildSparkPath(points: number[]): string {
  if (points.length < 2) return '';
  const min  = Math.min(...points);
  const max  = Math.max(...points);
  const range = max - min || 1;
  const xs   = points.map((_, i) => (i / (points.length - 1)) * SPARK_W);
  const ys   = points.map((v) => SPARK_H - ((v - min) / range) * SPARK_H);
  return xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
}

// ─── Component ────────────────────────────────────────────────────────────────
const TrustMomentumWidget: React.FC<TrustMomentumWidgetProps> = ({
  currentScore,
  previousScore,
  history,
  style,
}) => {
  const delta     = currentScore - previousScore;
  const isUp      = delta >= 0;
  const colour    = isUp ? VERDIGRIS : SAFFRON;
  const arrow     = isUp ? '↑' : '↓';
  const sparkPath = buildSparkPath(history);

  // Pulse animation on mount
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.06, duration: 300, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 200, useNativeDriver: true }),
    ]).start();
  }, [currentScore]); // eslint-disable-line

  const label = (() => {
    if (delta === 0) return 'Holding steady';
    if (Math.abs(delta) >= 10) return isUp ? 'Big jump! 🎉' : 'Needs attention';
    if (Math.abs(delta) >= 5)  return isUp ? 'Good progress' : 'Slight dip';
    return isUp ? 'Moving up' : 'Small dip';
  })();

  return (
    <View style={[styles.container, style]}>
      {/* Score + delta */}
      <View style={styles.left}>
        <Animated.Text
          style={[styles.score, { transform: [{ scale: pulseAnim }] }]}
        >
          {currentScore}
        </Animated.Text>
        <Text style={styles.scoreLabel}>Trust Score</Text>

        <View style={[styles.deltaPill, { backgroundColor: colour + '1A', borderColor: colour }]}>
          <Text style={[styles.deltaText, { color: colour }]}>
            {arrow} {Math.abs(delta)} pts
          </Text>
        </View>
        <Text style={styles.label}>{label}</Text>
      </View>

      {/* Sparkline */}
      {sparkPath !== '' && (
        <View style={styles.sparkContainer}>
          <Svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}>
            <Path
              d={sparkPath}
              stroke={colour}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text style={styles.sparkLabel}>Last {history.length} updates</Text>
        </View>
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
    backgroundColor:  IVORY,
    borderRadius:     16,
    padding:          16,
    borderWidth:      1,
    borderColor:      TRACK,
  },
  left: {
    gap: 4,
  },
  score: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   40,
    color:      DEEP_INK,
    lineHeight: 44,
  },
  scoreLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      '#9E9890',
  },
  deltaPill: {
    alignSelf:      'flex-start',
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:   12,
    borderWidth:    1,
    marginTop:      4,
  },
  deltaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
  },
  label: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#9E9890',
    marginTop:  2,
  },
  sparkContainer: {
    alignItems: 'flex-end',
    gap:        6,
  },
  sparkLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   9,
    color:      '#C4BCB4',
  },
});

export default TrustMomentumWidget;
