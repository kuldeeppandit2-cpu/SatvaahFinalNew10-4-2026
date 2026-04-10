/**
 * CustomerVoiceBar.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Dual-segment bar:
 *   Left  → Verification %  (Verdigris   #2E7D72)
 *   Right → Customer Voice % (Light Verdigris #6BA89E)
 * Updates dynamically via Animated width interpolation.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

const VERDIGRIS       = '#2E7D72';
const LIGHT_VERDIGRIS = '#6BA89E';
const TRACK           = '#E8E0D4';

// ─── Props ────────────────────────────────────────────────────────────────────
interface CustomerVoiceBarProps {
  verificationPct: number;   // 0-100
  customerVoicePct: number;  // 0-100
  /** Bar total width in dp */
  width?: number;
  height?: number;
  showLabels?: boolean;
  animated?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
const CustomerVoiceBar: React.FC<CustomerVoiceBarProps> = ({
  verificationPct,
  customerVoicePct,
  width = 240,
  height = 8,
  showLabels = true,
  animated: enableAnimation = true,
}) => {
  const verAnim  = useRef(new Animated.Value(0)).current;
  const voiceAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const verWidth   = (Math.min(100, verificationPct)   / 100) * width;
    const voiceWidth = (Math.min(100, customerVoicePct)  / 100) * width;

    if (enableAnimation) {
      Animated.parallel([
        Animated.timing(verAnim, {
          toValue: verWidth, duration: 900, useNativeDriver: false,
        }),
        Animated.timing(voiceAnim, {
          toValue: voiceWidth, duration: 900, useNativeDriver: false,
        }),
      ]).start();
    } else {
      verAnim.setValue(verWidth);
      voiceAnim.setValue(voiceWidth);
    }
  }, [verificationPct, customerVoicePct, width]); // eslint-disable-line

  return (
    <View style={{ width }}>
      {/* Labels row */}
      {showLabels && (
        <View style={styles.labelRow}>
          <View style={styles.labelItem}>
            <View style={[styles.legend, { backgroundColor: VERDIGRIS }]} />
            <Text style={styles.labelText}>Verification</Text>
            <Text style={[styles.pct, { color: VERDIGRIS }]}>
              {Math.round(verificationPct)}%
            </Text>
          </View>
          <View style={styles.labelItem}>
            <View style={[styles.legend, { backgroundColor: LIGHT_VERDIGRIS }]} />
            <Text style={styles.labelText}>Customer Voice</Text>
            <Text style={[styles.pct, { color: LIGHT_VERDIGRIS }]}>
              {Math.round(customerVoicePct)}%
            </Text>
          </View>
        </View>
      )}

      {/* Bar track */}
      <View
        style={[
          styles.track,
          { width, height, borderRadius: height / 2 },
        ]}
      >
        {/* Verification segment */}
        <Animated.View
          style={[
            styles.segment,
            {
              width:        verAnim,
              height,
              borderRadius: height / 2,
              backgroundColor: VERDIGRIS,
              zIndex: 2,
            },
          ]}
        />
        {/* Customer voice segment — positioned to start at verificationPct */}
        <Animated.View
          style={[
            styles.segment,
            {
              position:    'absolute',
              left:        verAnim,
              width:       voiceAnim,
              height,
              borderRadius: height / 2,
              backgroundColor: LIGHT_VERDIGRIS,
              opacity:     0.85,
              zIndex:      1,
            },
          ]}
        />
      </View>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  track: {
    backgroundColor: TRACK,
    overflow:       'hidden',
    position:       'relative',
  },
  segment: {
    position: 'absolute',
    top:      0,
    left:     0,
  },
  labelRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    marginBottom:   6,
  },
  labelItem: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
  },
  legend: {
    width:        7,
    height:       7,
    borderRadius: 2,
  },
  labelText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#6B6560',
  },
  pct: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   11,
  },
});

export default CustomerVoiceBar;
