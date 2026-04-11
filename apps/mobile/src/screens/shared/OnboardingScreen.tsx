/**
 * SatvAAh Onboarding
 * Brand: #FAF7F0 ivory · #1C1C2E deep ink · #C8691A saffron
 * One palette. All screens identical in colour.
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

export function OnboardingScreen(): React.ReactElement {
  const navigation = useNavigation<Nav>();
  const [active, setActive] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const TOTAL = 4;

  function goTo(i: number) {
    scrollRef.current?.scrollTo({ x: i * W, animated: true });
    setActive(i);
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />

      {/* Progress bar — top of every screen */}
      <View style={s.progressRow}>
        {Array.from({ length: TOTAL }).map((_, i) => (
          <View key={i} style={[s.seg, i <= active && s.segActive]} />
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={s.scroller}
        onMomentumScrollEnd={e =>
          setActive(Math.round(e.nativeEvent.contentOffset.x / W))
        }
      >

        {/* ── SLIDE 1 ── */}
        <View style={[s.slide, { width: W }]}>
          {/* Top label */}
          <Text style={s.screenLabel}>THE PROBLEM</Text>

          {/* Big centred question */}
          <Text style={s.bigCentre}>
            Why pay{'\n'}10–30% commission{'\n'}to platforms{'\n'}on every purchase?
          </Text>

          <View style={s.spacer} />

          {/* Introducing */}
          <Text style={s.introducing}>Introducing …</Text>

          <View style={s.spacerSm} />

          {/* Brand — only appearance on this screen */}
          <Text style={s.brandName}>SatvAAh</Text>
          <Text style={s.brandTagline}>The Truth that travels</Text>

          <View style={s.spacer} />

          {/* 0% — same weight/size as the question */}
          <Text style={s.bigCentre}>0% Commission{'\n'}Guarantee</Text>
        </View>

        {/* ── SLIDE 2 ── */}
        <View style={[s.slide, { width: W }]}>
          <Text style={s.screenLabel}>ONE APP. EVERYTHING.</Text>
          <Text style={s.headline}>Explore at{'\n'}0% commission</Text>
          <View style={s.rule} />
          {['> 1000 products', '> 200 services', '> 100 Expertise', '> 100 establishments'].map((b, i) => (
            <View key={i} style={s.bulletRow}>
              <View style={s.dot} />
              <Text style={s.bulletText}>{b}</Text>
            </View>
          ))}
          <View style={s.spacerSm} />
          <Text style={s.foot}>For the first time in the world — on one app.</Text>
        </View>

        {/* ── SLIDE 3 ── */}
        <View style={[s.slide, { width: W }]}>
          <Text style={s.screenLabel}>TRUST THAT TRAVELS</Text>
          <Text style={s.headline}>Find {'>'} 12,000{'\n'}Providers near you</Text>
          <View style={s.rule} />
          {['Verified', 'Trust Score', 'Satisfaction rating', 'Scheduling facility'].map((b, i) => (
            <View key={i} style={s.bulletRow}>
              <View style={s.dot} />
              <Text style={s.bulletText}>{b}</Text>
            </View>
          ))}
          <View style={s.spacerSm} />
          <Text style={s.foot}>Directly… No commission.</Text>
        </View>

        {/* ── SLIDE 4 ── */}
        <View style={[s.slide, { width: W }]}>
          <Text style={s.screenLabel}>TWO IDENTITIES</Text>
          <Text style={s.headline}>On one app{'\n'}Two Identities</Text>
          <View style={s.rule} />
          {['Customer  ( or buyer )', 'Provider  ( or seller )'].map((b, i) => (
            <View key={i} style={s.bulletRow}>
              <View style={s.dot} />
              <Text style={s.bulletText}>{b}</Text>
            </View>
          ))}
          <View style={s.spacerSm} />
          <Text style={s.sub}>
            You can be a lawyer looking for a maid — or a maid looking for a lawyer.
          </Text>
          <View style={s.spacerSm} />
          <Text style={s.foot}>Let the world know about you with your Trust Score.</Text>
        </View>

      </ScrollView>

      {/* Bottom CTA */}
      <View style={s.bottom}>
        <TouchableOpacity
          style={s.btn}
          activeOpacity={0.85}
          onPress={() =>
            active < TOTAL - 1 ? goTo(active + 1) : navigation.replace('Login')
          }
        >
          <Text style={s.btnText}>
            {active === TOTAL - 1 ? 'Get Started →' : 'Next →'}
          </Text>
        </TouchableOpacity>
        {active < TOTAL - 1 && (
          <TouchableOpacity onPress={() => navigation.replace('Login')}>
            <Text style={s.skip}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: '#FAF7F0' },

  progressRow:  { flexDirection: 'row', gap: 6, paddingHorizontal: 28, paddingTop: 58, marginBottom: 8 },
  seg:          { flex: 1, height: 2, borderRadius: 1, backgroundColor: '#E8E0D5' },
  segActive:    { backgroundColor: '#C8691A' },

  scroller:     { flex: 1 },
  slide:        { paddingHorizontal: 28, paddingTop: 28 },

  // Slide 1 specific
  screenLabel:  { fontSize: 11, fontWeight: '700', color: '#C8691A', letterSpacing: 2.5, textAlign: 'center', marginBottom: 28 },
  bigCentre:    { fontSize: 30, fontWeight: '800', color: '#1C1C2E', lineHeight: 40, textAlign: 'center' },
  spacer:       { height: 32 },
  spacerSm:     { height: 16 },
  introducing:  { fontSize: 22, fontWeight: '600', color: '#1C1C2E', textAlign: 'center' },
  brandName:    { fontSize: 28, fontWeight: '800', color: '#1C1C2E', textAlign: 'center', marginTop: 8 },
  brandTagline: { fontSize: 13, color: '#C8691A', textAlign: 'center', letterSpacing: 1, marginTop: 4 },

  // Slides 2–4
  headline:     { fontSize: 30, fontWeight: '800', color: '#1C1C2E', lineHeight: 40, marginBottom: 20 },
  rule:         { width: 32, height: 2, backgroundColor: '#C8691A', marginBottom: 24 },
  bulletRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  dot:          { width: 6, height: 6, borderRadius: 3, backgroundColor: '#C8691A', marginRight: 14 },
  bulletText:   { fontSize: 17, color: '#1C1C2E', fontWeight: '500' },
  sub:          { fontSize: 15, color: '#6B6B7B', lineHeight: 24 },
  foot:         { fontSize: 15, color: '#C8691A', fontWeight: '600' },

  // Bottom
  bottom:       { paddingHorizontal: 28, paddingBottom: 52, gap: 14 },
  btn:          { backgroundColor: '#C8691A', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  btnText:      { fontSize: 16, fontWeight: '700', color: '#FAF7F0' },
  skip:         { textAlign: 'center', color: '#6B6B7B', fontSize: 14 },
});



