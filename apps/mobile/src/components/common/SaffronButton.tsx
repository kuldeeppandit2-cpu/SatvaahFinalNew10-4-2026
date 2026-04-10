/**
 * SaffronButton.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Primary CTA button.
 * Full-width, 48 pt height, Saffron #C8691A.
 * States: default | loading (spinner) | disabled | success | destructive.
 * Haptic feedback on press.
 */

import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';

const SAFFRON     = '#C8691A';
const SAFFRON_DIM = '#A0561A';
const VERDIGRIS   = '#2E7D72';
const TERRACOTTA  = '#C0392B';
const IVORY       = '#FAF7F0';

// ─── Props ────────────────────────────────────────────────────────────────────
export type SaffronButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'success';

interface SaffronButtonProps {
  label:        string;
  onPress:      () => void;
  variant?:     SaffronButtonVariant;
  loading?:     boolean;
  disabled?:    boolean;
  icon?:        string;    // emoji prefix
  iconRight?:   string;    // emoji suffix
  style?:       ViewStyle;
  /** Override height (default 48) */
  height?:      number;
  fullWidth?:   boolean;   // default true
  haptic?:      boolean;   // default true
}

// ─── Variant config ───────────────────────────────────────────────────────────
function getVariantStyle(variant: SaffronButtonVariant) {
  switch (variant) {
    case 'primary':     return { bg: SAFFRON,     fg: '#FFFFFF', border: undefined };
    case 'secondary':   return { bg: 'transparent', fg: SAFFRON,  border: SAFFRON };
    case 'ghost':       return { bg: 'transparent', fg: SAFFRON,  border: undefined };
    case 'destructive': return { bg: TERRACOTTA,  fg: '#FFFFFF', border: undefined };
    case 'success':     return { bg: VERDIGRIS,   fg: '#FFFFFF', border: undefined };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
const SaffronButton: React.FC<SaffronButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  iconRight,
  style,
  height = 48,
  fullWidth = true,
  haptic = true,
}) => {
  const scaleAnim  = useRef(new Animated.Value(1)).current;
  const { bg, fg, border } = getVariantStyle(variant);

  const handlePress = () => {
    if (loading || disabled) return;
    if (haptic) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    // Press animation
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1,    duration: 80, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  const isDisabled = disabled || loading;

  return (
    <Animated.View
      style={[
        fullWidth && styles.fullWidth,
        { transform: [{ scale: scaleAnim }] },
        style,
      ]}
    >
      <TouchableOpacity
        onPress={handlePress}
        disabled={isDisabled}
        activeOpacity={0.88}
        style={[
          styles.button,
          {
            backgroundColor:  bg,
            height,
            borderRadius:     height / 2,
            borderWidth:      border ? 1.5 : 0,
            borderColor:      border ?? 'transparent',
            opacity:          isDisabled && !loading ? 0.5 : 1,
          },
          fullWidth && styles.fullWidth,
        ]}
      >
        {loading ? (
          <ActivityIndicator
            size="small"
            color={fg}
          />
        ) : (
          <View style={styles.inner}>
            {icon && <Text style={[styles.icon, { color: fg }]}>{icon}</Text>}
            <Text style={[styles.label, { color: fg }]}>{label}</Text>
            {iconRight && <Text style={[styles.icon, { color: fg }]}>{iconRight}</Text>}
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  fullWidth: {
    width: '100%',
  },
  button: {
    alignItems:     'center',
    justifyContent: 'center',
    flexDirection:  'row',
  },
  inner: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  label: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   16,
  },
  icon: {
    fontSize: 16,
  },
});

export default SaffronButton;
