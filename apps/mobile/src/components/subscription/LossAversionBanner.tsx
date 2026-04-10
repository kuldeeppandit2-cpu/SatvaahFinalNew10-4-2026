/**
 * LossAversionBanner.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Shown when consumer has ≤5 leads remaining.
 * Uses loss-aversion framing: "Don't lose access to trusted providers."
 * Terracotta accent, prominent upgrade CTA.
 * Dismissable once per session (state managed by parent / Zustand).
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';

const TERRACOTTA    = '#C0392B';
const TERRACOTTA_BG = '#FDF2F1';
const SAFFRON       = '#C8691A';
const DEEP_INK      = '#1C1C2E';

// ─── Copy variations based on leads remaining ─────────────────────────────────
function getBannerCopy(remaining: number): { headline: string; sub: string } {
  if (remaining === 0) {
    return {
      headline: "You've used all your contacts this month",
      sub:      "Upgrade now to keep contacting trusted providers near you.",
    };
  }
  if (remaining === 1) {
    return {
      headline: 'Only 1 contact left this month',
      sub:      "Make it count — or upgrade to keep going without interruption.",
    };
  }
  return {
    headline: `Only ${remaining} contacts left this month`,
    sub:      "Don't lose access to trusted providers. Upgrade before you run out.",
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface LossAversionBannerProps {
  leadsRemaining:  number;   // ≤5 to show this banner
  planName?:       string;   // e.g. "Gold" for "Upgrade to Gold"
  onUpgrade:       () => void;
  onDismiss?:      () => void;
  dismissable?:    boolean;
  style?:          ViewStyle;
}

// ─── Component ────────────────────────────────────────────────────────────────
const LossAversionBanner: React.FC<LossAversionBannerProps> = ({
  leadsRemaining,
  planName,
  onUpgrade,
  onDismiss,
  dismissable = true,
  style,
}) => {
  const slideAnim = useRef(new Animated.Value(-8)).current;
  const opacAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0, tension: 70, friction: 9, useNativeDriver: true,
      }),
      Animated.timing(opacAnim, {
        toValue: 1, duration: 300, useNativeDriver: true,
      }),
    ]).start();
  }, []); // eslint-disable-line

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: -8, duration: 200, useNativeDriver: true }),
      Animated.timing(opacAnim,  { toValue: 0,  duration: 180, useNativeDriver: true }),
    ]).start(() => onDismiss?.());
  };

  const { headline, sub } = getBannerCopy(leadsRemaining);

  return (
    <Animated.View
      style={[
        styles.banner,
        style,
        {
          transform: [{ translateY: slideAnim }],
          opacity:   opacAnim,
        },
      ]}
    >
      {/* Left accent */}
      <View style={styles.accentBar} />

      <View style={styles.inner}>
        {/* Alert icon */}
        <Text style={styles.alertIcon}>🚨</Text>

        <View style={styles.body}>
          {/* Headline */}
          <View style={styles.headlineRow}>
            <Text style={styles.headline}>{headline}</Text>
            {dismissable && onDismiss && (
              <Pressable
                onPress={handleDismiss}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.closeIcon}>✕</Text>
              </Pressable>
            )}
          </View>

          <Text style={styles.sub}>{sub}</Text>

          {/* Leads remaining dots */}
          <View style={styles.dotsRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <View
                key={n}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      n <= leadsRemaining ? TERRACOTTA : '#E8E0D4',
                  },
                ]}
              />
            ))}
            <Text style={styles.dotsLabel}>{leadsRemaining}/5 left</Text>
          </View>

          {/* Upgrade CTA */}
          <TouchableOpacity
            style={styles.upgradeCta}
            onPress={onUpgrade}
            activeOpacity={0.85}
          >
            <Text style={styles.upgradeText}>
              {planName ? `Upgrade to ${planName}` : 'Upgrade now'}
              {'  →'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  banner: {
    backgroundColor: TERRACOTTA_BG,
    borderRadius:    14,
    overflow:        'hidden',
    borderWidth:     1,
    borderColor:     TERRACOTTA + '30',
    shadowColor:     TERRACOTTA,
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.10,
    shadowRadius:    8,
    elevation:       3,
  },
  accentBar: {
    position:    'absolute',
    left:        0,
    top:         0,
    bottom:      0,
    width:       4,
    backgroundColor: TERRACOTTA,
  },
  inner: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    padding:       14,
    paddingLeft:   18,
    gap:           10,
  },
  alertIcon: {
    fontSize:  20,
    flexShrink: 0,
    marginTop:  1,
  },
  body: {
    flex: 1,
    gap:  8,
  },
  headlineRow: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            8,
  },
  headline: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   14,
    color:      DEEP_INK,
    flex:       1,
    lineHeight: 20,
  },
  closeIcon: {
    fontSize:   13,
    color:      '#C4BCB4',
    flexShrink: 0,
  },
  sub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      '#6B6560',
    lineHeight: 17,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  dot: {
    width:        8,
    height:       8,
    borderRadius: 4,
  },
  dotsLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#9E9890',
    marginLeft: 4,
  },
  upgradeCta: {
    alignSelf:        'flex-start',
    backgroundColor:  TERRACOTTA,
    borderRadius:     20,
    paddingHorizontal: 16,
    paddingVertical:   9,
  },
  upgradeText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   13,
    color:      '#FFFFFF',
  },
});

export default LossAversionBanner;
