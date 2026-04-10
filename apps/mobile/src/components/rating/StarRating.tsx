/**
 * StarRating.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * 5 large Saffron star rating component.
 * Supports both tap (jump to star) and horizontal swipe.
 * Haptic feedback via expo-haptics on each star change.
 * Accessible: accessibilityLabel reflects current value.
 */

import React, { useRef, useState } from 'react';
import {
  Animated,
  GestureResponderEvent,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';

const SAFFRON = '#C8691A';
const EMPTY   = '#E8E0D4';

// ─── Single star ──────────────────────────────────────────────────────────────
interface StarProps {
  filled:   boolean;
  size:     number;
  onPress:  () => void;
  scaleAnim: Animated.Value;
}

const Star: React.FC<StarProps> = ({ filled, size, onPress, scaleAnim }) => (
  <TouchableWithoutFeedback onPress={onPress}>
    <Animated.Text
      style={[
        styles.star,
        { fontSize: size, color: filled ? SAFFRON : EMPTY },
        { transform: [{ scale: scaleAnim }] },
      ]}
    >
      ★
    </Animated.Text>
  </TouchableWithoutFeedback>
);

// ─── Props ────────────────────────────────────────────────────────────────────
interface StarRatingProps {
  value:        number;              // current rating 0-5
  onChange:     (v: number) => void;
  starSize?:    number;              // default 44
  gap?:         number;              // default 8
  readonly?:    boolean;
  style?:       ViewStyle;
  showLabel?:   boolean;
}

const LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

// ─── Component ────────────────────────────────────────────────────────────────
const StarRating: React.FC<StarRatingProps> = ({
  value,
  onChange,
  starSize = 44,
  gap = 8,
  readonly = false,
  style,
  showLabel = true,
}) => {
  const scaleAnims = useRef(
    Array.from({ length: 5 }, () => new Animated.Value(1))
  ).current;
  const containerRef  = useRef<View>(null);
  const containerLeft = useRef(0);
  const prevValue     = useRef(value);

  const animateStar = (idx: number) => {
    const anim = scaleAnims[idx];
    Animated.sequence([
      Animated.spring(anim, { toValue: 1.3, useNativeDriver: true, speed: 400, bounciness: 12 }),
      Animated.spring(anim, { toValue: 1,   useNativeDriver: true, speed: 200 }),
    ]).start();
  };

  const updateValue = (newVal: number) => {
    if (newVal === prevValue.current) return;
    prevValue.current = newVal;
    animateStar(newVal - 1);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(newVal);
  };

  // Swipe gesture
  const handleTouch = (e: GestureResponderEvent) => {
    if (readonly) return;
    const totalW = starSize * 5 + gap * 4;
    const x      = e.nativeEvent.pageX - containerLeft.current;
    const raw    = Math.ceil((x / totalW) * 5);
    const clamped = Math.min(5, Math.max(1, raw));
    updateValue(clamped);
  };

  return (
    <View style={style}>
      <View
        ref={containerRef}
        onLayout={(e) => {
          containerRef.current?.measure((_x, _y, _w, _h, px) => {
            containerLeft.current = px;
          });
        }}
        style={[styles.row, { gap }]}
        onStartShouldSetResponder={() => !readonly}
        onMoveShouldSetResponder={() => !readonly}
        onResponderMove={handleTouch}
        onResponderGrant={handleTouch}
        accessibilityLabel={`Rating: ${value} out of 5`}
        accessibilityRole="adjustable"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            filled={n <= value}
            size={starSize}
            scaleAnim={scaleAnims[n - 1]}
            onPress={() => !readonly && updateValue(n)}
          />
        ))}
      </View>

      {showLabel && value > 0 && (
        <Text style={styles.label}>{LABELS[value]}</Text>
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  star: {
    lineHeight: undefined,
  },
  label: {
    fontFamily:  'PlusJakartaSans-SemiBold',
    fontSize:    15,
    color:       SAFFRON,
    textAlign:   'center',
    marginTop:   8,
  },
});

export default StarRating;
