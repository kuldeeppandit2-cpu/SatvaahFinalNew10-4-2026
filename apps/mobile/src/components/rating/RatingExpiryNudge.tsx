/**
 * RatingExpiryNudge.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Shown when a rating prompt is on its last skip (skip 3 of 3).
 * After rating_expiry_after_skips=3 skips the prompt expires permanently.
 * Gentle but urgent — explains the +2 leads bonus.
 * Slides up from bottom; auto-dismisses after 8s if no interaction.
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

const SAFFRON   = '#C8691A';
const VERDIGRIS = '#2E7D72';
const DEEP_INK  = '#1C1C2E';
const IVORY     = '#FAF7F0';

// ─── Props ────────────────────────────────────────────────────────────────────
interface RatingExpiryNudgeProps {
  providerName:   string;
  skipsUsed:      number;   // 0-2; show when >= 2 (last chance)
  maxSkips?:      number;   // default 3 from system_config
  leadBonus?:     number;   // default 2 from rating_bonus_leads
  onRate:         () => void;
  onDismiss:      () => void;
  style?:         ViewStyle;
}

// ─── Component ────────────────────────────────────────────────────────────────
const RatingExpiryNudge: React.FC<RatingExpiryNudgeProps> = ({
  providerName,
  skipsUsed,
  maxSkips = 3,
  leadBonus = 2,
  onRate,
  onDismiss,
  style,
}) => {
  const slideAnim  = useRef(new Animated.Value(100)).current;
  const opacAnim   = useRef(new Animated.Value(0)).current;
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Progress bar — how many skips used
  const skipPct = (skipsUsed / maxSkips) * 100;
  const isLastChance = skipsUsed >= maxSkips - 1;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0, tension: 60, friction: 10, useNativeDriver: true,
      }),
      Animated.timing(opacAnim, {
        toValue: 1, duration: 250, useNativeDriver: true,
      }),
    ]).start();

    // Auto-dismiss after 8s
    timerRef.current = setTimeout(() => {
      handleDismiss();
    }, 8000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []); // eslint-disable-line

  const handleDismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 100, duration: 220, useNativeDriver: true }),
      Animated.timing(opacAnim,  { toValue: 0,   duration: 200, useNativeDriver: true }),
    ]).start(() => onDismiss());
  };

  return (
    <Animated.View
      style={[
        styles.card,
        style,
        {
          transform: [{ translateY: slideAnim }],
          opacity:   opacAnim,
        },
      ]}
    >
      {/* Skip progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${skipPct}%` as any }]} />
      </View>

      {/* Header row */}
      <View style={styles.header}>
        <Text style={styles.emoji}>{isLastChance ? '⏰' : '⭐'}</Text>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            {isLastChance ? 'Last chance to rate!' : 'How was your experience?'}
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {isLastChance
              ? `This rating prompt expires after this. Rate ${providerName} and earn +${leadBonus} free leads.`
              : `Rate ${providerName} — takes 10 seconds. Earn +${leadBonus} leads.`}
          </Text>
        </View>
        <Pressable onPress={handleDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      {/* Lead bonus badge */}
      <View style={styles.bonusRow}>
        <View style={styles.bonusBadge}>
          <Text style={styles.bonusText}>🎁  +{leadBonus} free leads on rating</Text>
        </View>
        <Text style={styles.skipCounter}>
          Skip {skipsUsed}/{maxSkips}
        </Text>
      </View>

      {/* CTAs */}
      <View style={styles.ctaRow}>
        <TouchableOpacity
          style={styles.rateCta}
          onPress={onRate}
          activeOpacity={0.85}
        >
          <Text style={styles.rateCtaText}>Rate now</Text>
        </TouchableOpacity>

        {!isLastChance && (
          <TouchableOpacity
            style={styles.skipCta}
            onPress={handleDismiss}
            activeOpacity={0.7}
          >
            <Text style={styles.skipCtaText}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    backgroundColor: IVORY,
    borderRadius:    20,
    overflow:        'hidden',
    padding:         16,
    borderWidth:     1,
    borderColor:     '#E8E0D4',
    shadowColor:     DEEP_INK,
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.10,
    shadowRadius:    12,
    elevation:       6,
    gap:             12,
  },
  progressTrack: {
    height:          3,
    backgroundColor: '#E8E0D4',
    borderRadius:    2,
    overflow:        'hidden',
    marginHorizontal: -16,
    marginTop:       -16,
  },
  progressFill: {
    height:          3,
    backgroundColor: SAFFRON,
    borderRadius:    2,
  },
  header: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           10,
    marginTop:     4,
  },
  emoji: {
    fontSize: 22,
    flexShrink: 0,
  },
  headerText: {
    flex: 1,
    gap:  3,
  },
  title: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      DEEP_INK,
  },
  sub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      '#6B6560',
    lineHeight: 17,
  },
  close: {
    fontSize:   13,
    color:      '#C4BCB4',
    flexShrink: 0,
  },
  bonusRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  bonusBadge: {
    backgroundColor:  VERDIGRIS + '15',
    borderRadius:     10,
    paddingHorizontal: 10,
    paddingVertical:   5,
  },
  bonusText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
    color:      VERDIGRIS,
  },
  skipCounter: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#C4BCB4',
  },
  ctaRow: {
    flexDirection: 'row',
    gap:           10,
  },
  rateCta: {
    flex:            1,
    backgroundColor: SAFFRON,
    borderRadius:    24,
    paddingVertical: 12,
    alignItems:      'center',
  },
  rateCtaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   14,
    color:      '#FFFFFF',
  },
  skipCta: {
    borderWidth:     1,
    borderColor:     '#D1C9BC',
    borderRadius:    24,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems:      'center',
  },
  skipCtaText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   14,
    color:      '#9E9890',
  },
});

export default RatingExpiryNudge;
