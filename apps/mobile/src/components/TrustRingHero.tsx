/**
 * apps/mobile/src/components/TrustRingHero.tsx
 * Animated trust ring used in the claim profile hero moment.
 * Animates from 0 to target score over 900ms.
 * Ring colour from trustRingColor() — single source of truth.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { trustRingColor } from '../api/trust.api';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface TrustRingHeroProps {
  score: number;
  size?: number;
  label?: string;
}

export default function TrustRingHero({
  score,
  size = 120,
  label,
}: TrustRingHeroProps): React.ReactElement {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circ   = 2 * Math.PI * radius;
  const color  = trustRingColor(score);

  const animVal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animVal, {
      toValue: score,
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [score, animVal]);

  const dashOffset = animVal.interpolate({
    inputRange:  [0, 100],
    outputRange: [circ, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke="#E0D9CF" strokeWidth={stroke} fill="none"
        />
        <AnimatedCircle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${circ}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: size * 0.22, color }}>
          {score}
        </Text>
        {label && (
          <Text style={{ fontFamily: 'PlusJakartaSans-Medium', fontSize: size * 0.10, color }}>
            {label}
          </Text>
        )}
      </View>
    </View>
  );
}
