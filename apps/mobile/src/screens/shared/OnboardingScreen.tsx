/**
 * SatvAAh Onboarding
 * Brand: #FAF7F0 ivory · #1C1C2E deep ink · #C8691A saffron
 * One palette. All screens identical in colour. Text exact from spec.
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

const SLIDES = [
  {
    headline: 'Why pay\n10–30% commission\nto platforms\non every purchase?',
    sub:      'Introducing …',
    cta:      'SatvAAh — 0% Commission Guarantee.',
  },
  {
    headline: 'Explore at\n0% commission',
    bullets:  ['> 1000 products', '> 200 services', '> 100 Expertise', '> 100 establishments'],
    cta:      'For the first time in the world — on one app.',
  },
  {
    headline: 'Find > 12,000\nProviders near you',
    bullets:  ['Verified', 'Trust Score', 'Satisfaction rating', 'Scheduling facility'],
    cta:      'Directly… No commission.',
  },
  {
    headline: 'Two Identities\non one app',
    bullets:  ['Customer  ( or buyer )', 'Provider  ( or seller )'],
    sub:      'You can be a lawyer looking for a maid — or a maid looking for a lawyer.',
    cta:      'Let the world know about you with your Trust Score.',
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
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />

      {/* Brand — top of every screen */}
      <View style={s.topBar}>
        <Text style={s.brand}>SatvAAh</Text>
        <Text style={s.tagline}>The Truth that travels</Text>
        {/* Progress */}
        <View style={s.progressRow}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[s.seg, i <= active && s.segActive]} />
          ))}
        </View>
      </View>

      {/* Slides */}
      <ScrollView
        ref={scrollRef}
        horizontal pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={s.scroller}
        onMomentumScrollEnd={e =>
          setActive(Math.round(e.nativeEvent.contentOffset.x / W))
        }
      >
        {SLIDES.map((sl, i) => (
          <View key={i} style={[s.slide, { width: W }]}>

            <Text style={s.headline}>{sl.headline}</Text>
            <View style={s.rule} />

            {sl.bullets && sl.bullets.map((b, j) => (
              <View key={j} style={s.bulletRow}>
                <View style={s.dot} />
                <Text style={s.bulletText}>{b}</Text>
              </View>
            ))}

            {sl.sub && <Text style={s.sub}>{sl.sub}</Text>}

            <Text style={s.ctaText}>{sl.cta}</Text>

          </View>
        ))}
      </ScrollView>

      {/* Bottom */}
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
  root:        { flex: 1, backgroundColor: '#FAF7F0' },

  topBar:      { paddingHorizontal: 28, paddingTop: 58, paddingBottom: 4 },
  brand:       { fontSize: 24, fontWeight: '800', color: '#1C1C2E' },
  tagline:     { fontSize: 12, color: '#C8691A', letterSpacing: 1, marginTop: 2, marginBottom: 20 },
  progressRow: { flexDirection: 'row', gap: 6 },
  seg:         { flex: 1, height: 2, borderRadius: 1, backgroundColor: '#E8E0D5' },
  segActive:   { backgroundColor: '#C8691A' },

  scroller:    { flex: 1 },
  slide:       { paddingHorizontal: 28, paddingTop: 36 },
  headline:    { fontSize: 32, fontWeight: '800', color: '#1C1C2E', lineHeight: 42, marginBottom: 20 },
  rule:        { width: 32, height: 2, backgroundColor: '#C8691A', marginBottom: 24 },

  bulletRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  dot:         { width: 6, height: 6, borderRadius: 3, backgroundColor: '#C8691A', marginRight: 12 },
  bulletText:  { fontSize: 16, color: '#1C1C2E', fontWeight: '500' },

  sub:         { fontSize: 15, color: '#6B6B7B', lineHeight: 24, marginTop: 8, marginBottom: 8 },
  ctaText:     { fontSize: 14, color: '#C8691A', fontWeight: '600', marginTop: 20 },

  bottom:      { paddingHorizontal: 28, paddingBottom: 52, gap: 14 },
  btn:         { backgroundColor: '#C8691A', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  btnText:     { fontSize: 16, fontWeight: '700', color: '#FAF7F0' },
  skip:        { textAlign: 'center', color: '#6B6B7B', fontSize: 14 },
});


