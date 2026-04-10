/**
 * HeroMoment.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Full-screen Verdigris celebration modal.
 * Used for: first Highly Trusted tier, certificate issued, subscription activated.
 * Burst animation with confetti-like particles + scale-in card.
 * Auto-dismisses after 4s unless user taps CTA.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const VERDIGRIS    = '#2E7D72';
const VERDIGRIS_LT = '#6BA89E';
const IVORY        = '#FAF7F0';
const SAFFRON      = '#C8691A';

// ─── Particle config ──────────────────────────────────────────────────────────
const NUM_PARTICLES = 20;
const COLOURS = [SAFFRON, '#FAF7F0', VERDIGRIS_LT, '#FFFFFF', '#F0E4CC'];

interface Particle {
  x:     Animated.Value;
  y:     Animated.Value;
  opac:  Animated.Value;
  scale: Animated.Value;
  colour: string;
  size:  number;
}

function makeParticles(): Particle[] {
  return Array.from({ length: NUM_PARTICLES }, () => ({
    x:     new Animated.Value(SCREEN_W / 2),
    y:     new Animated.Value(SCREEN_H / 2),
    opac:  new Animated.Value(1),
    scale: new Animated.Value(1),
    colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
    size:  Math.random() * 12 + 6,
  }));
}

// ─── Props ────────────────────────────────────────────────────────────────────
export type HeroMomentEvent =
  | 'highly_trusted'
  | 'certificate_issued'
  | 'subscription_activated'
  | 'first_rating'
  | 'custom';

interface HeroMomentProps {
  visible:    boolean;
  event:      HeroMomentEvent;
  title?:     string;
  subtitle?:  string;
  ctaLabel?:  string;
  onCta?:     () => void;
  onDismiss:  () => void;
  /** Certificate ID for certificate events */
  certId?:    string;
}

// ─── Content map ──────────────────────────────────────────────────────────────
const EVENT_CONTENT: Record<HeroMomentEvent, { emoji: string; title: string; subtitle: string; cta: string }> = {
  highly_trusted: {
    emoji:    '🏆',
    title:    'Highly Trusted!',
    subtitle: "You've reached the highest trust tier. Your Certificate of Verification is ready.",
    cta:      'View Certificate',
  },
  certificate_issued: {
    emoji:    '📜',
    title:    'Certificate Issued',
    subtitle: 'Your SatvAAh Certificate of Verification is ready. Share it to build trust.',
    cta:      'View Certificate',
  },
  subscription_activated: {
    emoji:    '🎉',
    title:    "You're all set!",
    subtitle: 'Your subscription is active. Start connecting with trusted providers.',
    cta:      'Let\'s go',
  },
  first_rating: {
    emoji:    '⭐',
    title:    'First rating received!',
    subtitle: 'Your reputation is growing. Keep delivering great service.',
    cta:      'See my profile',
  },
  custom: {
    emoji:    '✨',
    title:    '',
    subtitle: '',
    cta:      'Continue',
  },
};

// ─── Component ────────────────────────────────────────────────────────────────
const HeroMoment: React.FC<HeroMomentProps> = ({
  visible,
  event,
  title,
  subtitle,
  ctaLabel,
  onCta,
  onDismiss,
  certId,
}) => {
  const particles    = useRef<Particle[]>(makeParticles()).current;
  const cardScale    = useRef(new Animated.Value(0.7)).current;
  const cardOpac     = useRef(new Animated.Value(0)).current;
  const bgOpac       = useRef(new Animated.Value(0)).current;
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const content = EVENT_CONTENT[event];
  const displayTitle    = title    ?? content.title;
  const displaySubtitle = subtitle ?? content.subtitle;
  const displayCta      = ctaLabel ?? content.cta;

  const animateIn = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // BG fade
    Animated.timing(bgOpac, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    // Card pop
    Animated.parallel([
      Animated.spring(cardScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.timing(cardOpac,  { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();

    // Particles burst
    particles.forEach((p) => {
      const angle = Math.random() * Math.PI * 2;
      const dist  = 80 + Math.random() * 200;
      p.x.setValue(SCREEN_W / 2);
      p.y.setValue(SCREEN_H / 2);
      p.opac.setValue(1);
      p.scale.setValue(1);

      Animated.parallel([
        Animated.timing(p.x, {
          toValue: SCREEN_W / 2 + Math.cos(angle) * dist,
          duration: 800 + Math.random() * 400,
          useNativeDriver: true,
        }),
        Animated.timing(p.y, {
          toValue: SCREEN_H / 2 + Math.sin(angle) * dist,
          duration: 800 + Math.random() * 400,
          useNativeDriver: true,
        }),
        Animated.timing(p.opac, {
          toValue: 0, duration: 900, delay: 200, useNativeDriver: true,
        }),
        Animated.timing(p.scale, {
          toValue: 0, duration: 900, delay: 300, useNativeDriver: true,
        }),
      ]).start();
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    if (visible) {
      animateIn();
      timerRef.current = setTimeout(() => onDismiss(), 5000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible]); // eslint-disable-line

  const handleCta = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onCta?.();
    onDismiss();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <Animated.View style={[styles.overlay, { opacity: bgOpac }]}>
        {/* Particles */}
        {particles.map((p, i) => (
          <Animated.View
            key={i}
            style={[
              styles.particle,
              {
                width:  p.size,
                height: p.size,
                borderRadius: p.size / 2,
                backgroundColor: p.colour,
                transform: [
                  { translateX: p.x },
                  { translateY: p.y },
                  { scale: p.scale },
                ],
                opacity: p.opac,
              },
            ]}
          />
        ))}

        {/* Card */}
        <Animated.View
          style={[
            styles.card,
            {
              transform: [{ scale: cardScale }],
              opacity:   cardOpac,
            },
          ]}
        >
          <Text style={styles.emoji}>{content.emoji}</Text>
          <Text style={styles.title}>{displayTitle}</Text>
          {certId && (
            <Text style={styles.certId}>ID: {certId}</Text>
          )}
          <Text style={styles.subtitle}>{displaySubtitle}</Text>

          <TouchableOpacity
            style={styles.cta}
            onPress={handleCta}
            activeOpacity={0.88}
          >
            <Text style={styles.ctaText}>{displayCta}</Text>
          </TouchableOpacity>

          <Pressable onPress={onDismiss} style={styles.dismiss}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: VERDIGRIS,
    alignItems:      'center',
    justifyContent:  'center',
  },
  particle: {
    position: 'absolute',
    top:      0,
    left:     0,
  },
  card: {
    backgroundColor: IVORY,
    borderRadius:    28,
    padding:         32,
    width:           SCREEN_W - 48,
    alignItems:      'center',
    gap:             12,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 12 },
    shadowOpacity:   0.25,
    shadowRadius:    24,
    elevation:       12,
  },
  emoji: {
    fontSize:   56,
    lineHeight: 68,
  },
  title: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   26,
    color:      VERDIGRIS,
    textAlign:  'center',
  },
  certId: {
    fontFamily:   'PlusJakartaSans-Regular',
    fontSize:     12,
    color:        '#9E9890',
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   15,
    color:      '#6B6560',
    textAlign:  'center',
    lineHeight: 22,
  },
  cta: {
    backgroundColor:  SAFFRON,
    borderRadius:     28,
    paddingHorizontal: 32,
    paddingVertical:   14,
    marginTop:        8,
  },
  ctaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   16,
    color:      '#FFFFFF',
  },
  dismiss: {
    paddingVertical: 6,
  },
  dismissText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      '#C4BCB4',
  },
});

export default HeroMoment;
