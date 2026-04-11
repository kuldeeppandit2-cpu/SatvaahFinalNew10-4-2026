/**
 * SatvAAh Onboarding — Brand identity: Ivory bg, Deep Ink text, Saffron CTA
 */
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, ScrollView, StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Onboarding'>;
const { width: W, height: H } = Dimensions.get('window');

const SLIDES = [
  {
    tag: 'WHY PAY COMMISSION?',
    headline: 'Apps take 10–30%\nof every job.',
    sub: 'Swiggy. Urban Company. Every platform cuts into the earnings of the person doing the actual work.\n\nSatvAAh charges 0% commission — permanently. Written into our company constitution.',
    emoji: '✊',
    accent: '#C8691A',
  },
  {
    tag: 'ONE APP. EVERYTHING.',
    headline: 'India\'s first\nzero-commission\nmarketplace.',
    sub: 'Over 1,000 products · 200+ services · 100+ expertise categories · 100+ establishments.\n\nFor the first time in the world — all on one app.',
    emoji: '🇮🇳',
    accent: '#1C6B3A',
  },
  {
    tag: 'TRUST THAT TRAVELS',
    headline: 'Find 12,000+\nverified providers\nnear you.',
    sub: 'Every provider is Aadhaar-verified, geo-confirmed, and rated by real customers.\n\nYour Trust Score follows you — not the platform. Switch between buyer and seller anytime.',
    emoji: '🛡️',
    accent: '#1C4B8E',
  },
];

export function OnboardingScreen(): React.ReactElement {
  const navigation = useNavigation<Nav>();
  const [active, setActive] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  function goTo(i: number) {
    scrollRef.current?.scrollTo({ x: i * W, animated: true });
    setActive(i);
  }

  const slide = SLIDES[active];

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />

      {/* Progress bar at top */}
      <View style={s.progressBar}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[s.progressSegment, i <= active && { backgroundColor: slide.accent }]} />
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => setActive(Math.round(e.nativeEvent.contentOffset.x / W))}
      >
        {SLIDES.map((sl, i) => (
          <View key={i} style={[s.slide, { width: W }]}>

            {/* Tag pill */}
            <View style={[s.tagPill, { backgroundColor: sl.accent }]}>
              <Text style={s.tagText}>{sl.tag}</Text>
            </View>

            {/* Big emoji */}
            <Text style={s.emoji}>{sl.emoji}</Text>

            {/* Headline */}
            <Text style={s.headline}>{sl.headline}</Text>

            {/* Divider */}
            <View style={[s.divider, { backgroundColor: sl.accent }]} />

            {/* Body */}
            <Text style={s.sub}>{sl.sub}</Text>

          </View>
        ))}
      </ScrollView>

      {/* Brand lock-up */}
      <View style={s.brand}>
        <Text style={s.brandName}>SatvAAh</Text>
        <Text style={s.brandTagline}>The Truth that travels</Text>
      </View>

      {/* CTA */}
      <View style={s.bottom}>
        <TouchableOpacity
          style={[s.btn, { backgroundColor: slide.accent }]}
          activeOpacity={0.85}
          onPress={() => active < SLIDES.length - 1 ? goTo(active + 1) : navigation.replace('Login')}
        >
          <Text style={s.btnText}>
            {active === SLIDES.length - 1 ? 'Get Started  →' : 'Next  →'}
          </Text>
        </TouchableOpacity>

        {active < SLIDES.length - 1 && (
          <TouchableOpacity onPress={() => navigation.replace('Login')}>
            <Text style={s.skip}>Skip intro</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:            { flex: 1, backgroundColor: '#FAF7F0' },

  // Progress bar
  progressBar:     { flexDirection: 'row', paddingHorizontal: 24, paddingTop: 56, gap: 6 },
  progressSegment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#E8E0D5' },

  // Slide
  slide:           { paddingHorizontal: 28, paddingTop: 36, justifyContent: 'flex-start' },
  tagPill:         { borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start', marginBottom: 28 },
  tagText:         { color: '#FAF7F0', fontSize: 10, fontWeight: '700', letterSpacing: 2.5 },
  emoji:           { fontSize: 52, marginBottom: 20 },
  headline:        { fontSize: 34, fontWeight: '800', color: '#1C1C2E', lineHeight: 42, marginBottom: 16 },
  divider:         { width: 40, height: 3, borderRadius: 2, marginBottom: 20 },
  sub:             { fontSize: 15, color: '#4A4A5A', lineHeight: 25 },

  // Brand
  brand:           { alignItems: 'center', paddingVertical: 12 },
  brandName:       { fontSize: 20, fontWeight: '800', color: '#1C1C2E', letterSpacing: 0.5 },
  brandTagline:    { fontSize: 12, color: '#8A8A9A', letterSpacing: 1, marginTop: 2 },

  // Bottom
  bottom:          { paddingHorizontal: 24, paddingBottom: 48, gap: 12 },
  btn:             { borderRadius: 14, paddingVertical: 17, alignItems: 'center' },
  btnText:         { fontSize: 16, fontWeight: '700', color: '#FAF7F0', letterSpacing: 0.3 },
  skip:            { textAlign: 'center', color: '#8A8A9A', fontSize: 14 },
});
