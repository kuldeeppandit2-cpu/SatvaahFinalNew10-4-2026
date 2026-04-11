/**
 * SatvAAh Onboarding
 * Brand: #FAF7F0 ivory · #1C1C2E deep ink · #C8691A saffron
 * No deviations from brand palette. Saffron is the ONLY accent colour.
 */
import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Dimensions, ScrollView, StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Onboarding'>;
const { width: W } = Dimensions.get('window');

// Brand tokens — single source of truth
const B = {
  ivory:   '#FAF7F0',
  ink:     '#1C1C2E',
  saffron: '#C8691A',
  muted:   '#6B6B7B',
  rule:    '#E8E0D5',
};

const SLIDES = [
  {
    tag:      'WHY PAY COMMISSION?',
    number:   '01',
    headline: 'Why pay\n10–30% commission\nto platforms?',
    body:     'On every product or service purchase, platforms charge the provider a heavy commission cut.\n\nIntroducing SatvAAh — 0% Commission. Guaranteed.',
  },
  {
    tag:      'ONE APP. EVERYTHING.',
    number:   '02',
    headline: 'For the first time\nin the world —\non one app.',
    body:     'Over 1,000 products\n200+ services\n100+ expertise categories\n100+ establishments\n\nExplore at zero commission.',
  },
  {
    tag:      'TRUST THAT TRAVELS',
    number:   '03',
    headline: 'Find 12,000+\nverified providers\nnear you.',
    body:     'Verified · Trust Score · Satisfaction Rating · Scheduling\n\nDirectly. No commission.\n\nOne app. Two identities — Customer and Provider. You can be both.',
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

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={B.ivory} />

      {/* Top — brand name + progress */}
      <View style={s.topBar}>
        <View style={s.brandRow}>
          <Text style={s.brandName}>SatvAAh</Text>
          <Text style={s.brandTagline}>The Truth that travels</Text>
        </View>
        <View style={s.progressTrack}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[s.progressSeg, i <= active && s.progressActive]}
            />
          ))}
        </View>
      </View>

      {/* Slides */}
      <ScrollView
        ref={scrollRef}
        horizontal pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e =>
          setActive(Math.round(e.nativeEvent.contentOffset.x / W))
        }
        style={s.scroller}
      >
        {SLIDES.map((sl, i) => (
          <View key={i} style={[s.slide, { width: W }]}>

            {/* Slide number */}
            <Text style={s.number}>{sl.number}</Text>

            {/* Tag */}
            <View style={s.tagPill}>
              <Text style={s.tagText}>{sl.tag}</Text>
            </View>

            {/* Headline */}
            <Text style={s.headline}>{sl.headline}</Text>

            {/* Saffron rule */}
            <View style={s.rule} />

            {/* Body */}
            <Text style={s.body}>{sl.body}</Text>

          </View>
        ))}
      </ScrollView>

      {/* CTA */}
      <View style={s.bottom}>
        <TouchableOpacity
          style={s.btn}
          activeOpacity={0.85}
          onPress={() =>
            active < SLIDES.length - 1
              ? goTo(active + 1)
              : navigation.replace('Login')
          }
        >
          <Text style={s.btnText}>
            {active === SLIDES.length - 1 ? 'Get Started →' : 'Next →'}
          </Text>
        </TouchableOpacity>

        {active < SLIDES.length - 1 && (
          <TouchableOpacity onPress={() => navigation.replace('Login')}>
            <Text style={s.skip}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: B.ivory },

  // Top bar
  topBar:         { paddingHorizontal: 28, paddingTop: 60, paddingBottom: 8 },
  brandRow:       { marginBottom: 20 },
  brandName:      { fontSize: 22, fontWeight: '800', color: B.ink, letterSpacing: 0.3 },
  brandTagline:   { fontSize: 11, color: B.muted, letterSpacing: 1.5, marginTop: 2, textTransform: 'uppercase' },
  progressTrack:  { flexDirection: 'row', gap: 6 },
  progressSeg:    { flex: 1, height: 2, borderRadius: 1, backgroundColor: B.rule },
  progressActive: { backgroundColor: B.saffron },

  // Slide
  scroller:       { flex: 1 },
  slide:          { paddingHorizontal: 28, paddingTop: 32 },
  number:         { fontSize: 11, fontWeight: '700', color: B.saffron, letterSpacing: 3, marginBottom: 16 },
  tagPill:        {
    alignSelf: 'flex-start', backgroundColor: B.ink,
    borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 24,
  },
  tagText:        { fontSize: 10, fontWeight: '700', color: B.ivory, letterSpacing: 2 },
  headline:       { fontSize: 32, fontWeight: '800', color: B.ink, lineHeight: 40, marginBottom: 20 },
  rule:           { width: 32, height: 2, backgroundColor: B.saffron, marginBottom: 20 },
  body:           { fontSize: 15, color: B.muted, lineHeight: 26 },

  // Bottom CTA
  bottom:         { paddingHorizontal: 28, paddingBottom: 52, gap: 14 },
  btn:            { backgroundColor: B.saffron, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  btnText:        { fontSize: 16, fontWeight: '700', color: B.ivory, letterSpacing: 0.2 },
  skip:           { textAlign: 'center', color: B.muted, fontSize: 14 },
});

