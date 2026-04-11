/**
 * SatvAAh Onboarding — 4 screens
 * Brand: #FAF7F0 ivory · #1C1C2E deep ink · #C8691A saffron
 * Approved design — session 38-cont
 *
 * Layout principle:
 *   Content (small, tight) — top zone
 *   Brand (SatvAAh) — centre, dominant, surrounded by silence
 *   CTA (Next / Get Started) — bottom zone
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
const { width: W, height: SLIDE_H } = Dimensions.get('window');
// Slide height = full screen minus progress bar zone (80) + CTA zone (112) + status bar (44)
const SLIDE_H = H - 236;

// Brand component — used identically on all 4 screens
function Brand() {
  return (
    <View style={b.wrap}>
      {/* SatvAAh — Satv + [AA box] + h */}
      <View style={b.nameRow}>
        <Text style={b.ink}>Satv</Text>
        <View style={b.aaBox}><Text style={b.aaText}>AA</Text></View>
        <Text style={b.ink}>h</Text>
      </View>
      {/* Tagline — single line, spaced to ~90% of brand width */}
      <Text style={b.tagline}>Truth that travels</Text>
    </View>
  );
}

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

      {/* Progress bar */}
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

        {/* ── SLIDE 1 — THE PROBLEM ── */}
        <View style={[s.slide, { width: W, height: SLIDE_H }]}>

          {/* Label */}
          <View style={s.labelBox}>
            <Text style={s.labelText}>THE PROBLEM</Text>
          </View>

          {/* Question — left-aligned, small */}
          <Text style={s.s1Question}>
            Why pay 10–30% commission{'\n'}to platforms on every purchase?
          </Text>

          <View style={s.flex1} />

          {/* Introducing */}
          <Text style={s.introducing}>Introducing …</Text>

          {/* Brand — dominant centre */}
          <Brand />

          <View style={s.flex1} />

          {/* 0% punchline */}
          <Text style={s.s1Zero}>0% Commission Guarantee</Text>

        </View>

        {/* ── SLIDE 2 — ONE APP ── */}
        <View style={[s.slide, { width: W, height: SLIDE_H }]}>

          <View style={s.labelBox}>
            <Text style={s.labelText}>ONE APP. EVERYTHING.</Text>
          </View>

          <Text style={s.headline}>
            Explore at <Text style={s.saffron}>0% commission</Text>
          </Text>
          <View style={s.rule} />

          {[
            ['> 1000', 'Products'],
            ['> 200',  'Services'],
            ['> 100',  'Expertise'],
            ['> 100',  'Establishments'],
          ].map(([num, label], i) => (
            <View key={i} style={s.statRow}>
              <Text style={s.statNum}>{num}</Text>
              <Text style={s.statLabel}>{label}</Text>
            </View>
          ))}

          <View style={s.flex1} />

          <Brand />

          <View style={s.flex1} />

          <Text style={s.footInk}>
            For the first time in the world — on one app.
          </Text>

        </View>

        {/* ── SLIDE 3 — TRUST ── */}
        <View style={[s.slide, { width: W, height: SLIDE_H }]}>

          <View style={s.labelBox}>
            <Text style={s.labelText}>TRUST THAT TRAVELS</Text>
          </View>

          <Text style={s.headline}>
            Find <Text style={s.saffron}>&gt; 12,000</Text> Providers near you
          </Text>
          <View style={s.rule} />

          {['Verified', 'Trust Score', 'Satisfaction Rating', 'Scheduling Facility'].map((item, i) => (
            <View key={i} style={s.bulletRow}>
              <View style={s.dotSaffron} />
              <Text style={s.bulletText}>{item}</Text>
            </View>
          ))}

          <View style={s.flex1} />

          <Brand />

          <View style={s.flex1} />

          {/* Bottom two bullets in ink */}
          <View style={s.bulletRow}>
            <View style={s.dotInk} />
            <Text style={s.bulletInk}>Connect Directly</Text>
          </View>
          <View style={s.bulletRow}>
            <View style={s.dotInk} />
            <Text style={s.bulletInk}>0% Commission</Text>
          </View>

        </View>

        {/* ── SLIDE 4 — TWO IDENTITIES ── */}
        <View style={[s.slide, { width: W, height: SLIDE_H }]}>

          <View style={s.labelBox}>
            <Text style={s.labelText}>TWO IDENTITIES</Text>
          </View>

          <Text style={s.headline}>On one app{'\n'}Two Identities</Text>

          <View style={s.flex1} />

          {/* Customer box */}
          <View style={s.identityBox}>
            <Text style={s.identityTitle}>Customer</Text>
            <Text style={s.identitySub}>Find &amp; connect with providers</Text>
          </View>

          {/* Provider box */}
          <View style={[s.identityBox, s.identityBoxSaffron]}>
            <Text style={[s.identityTitle, s.identityTitleSaffron]}>Provider</Text>
            <Text style={s.identitySub}>List services, earn your Trust Score</Text>
          </View>

          <View style={s.flex1} />

          <Brand />

          <View style={s.flex1} />

          <Text style={s.footInk}>
            Let the world know about you with your Trust Score.
          </Text>

        </View>

      </ScrollView>

      {/* Bottom CTA — always visible, ink Skip */}
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

// ── Brand styles ──────────────────────────────────────────────────────────────
const b = StyleSheet.create({
  wrap:    { alignItems: 'center', paddingVertical: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  ink:     { fontSize: 44, fontWeight: '800', color: '#1C1C2E' },
  aaBox:   { backgroundColor: '#C8691A', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, marginHorizontal: 1 },
  aaText:  { fontSize: 38, fontWeight: '800', color: '#FAF7F0' },
  tagline: { fontSize: 11, fontWeight: '700', fontStyle: 'italic', color: '#C8691A', letterSpacing: 5, marginTop: 10, textAlign: 'center' },
});

// ── Screen styles ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#FAF7F0' },

  progressRow: { flexDirection: 'row', gap: 5, paddingHorizontal: 24, paddingTop: 56, marginBottom: 4 },
  seg:         { flex: 1, height: 2, borderRadius: 1, backgroundColor: '#E8E0D5' },
  segActive:   { backgroundColor: '#C8691A' },

  scroller:    { flex: 1 },
  slide:       { paddingHorizontal: 24, paddingTop: 20, justifyContent: 'space-between', paddingBottom: 8 },
  flex1:       { flex: 1 },

  // Label pill — black box, white text, left-aligned
  labelBox:    { alignSelf: 'flex-start', backgroundColor: '#1C1C2E', borderRadius: 3, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 16 },
  labelText:   { fontSize: 9, fontWeight: '700', color: '#FAF7F0', letterSpacing: 2.5 },

  // Slide 1
  s1Question:  { fontSize: 11, fontWeight: '700', color: '#1C1C2E', lineHeight: 18 },
  introducing: { fontSize: 10, fontStyle: 'italic', color: '#6B6B7B', textAlign: 'center', marginBottom: 2 },
  s1Zero:      { fontSize: 11, fontWeight: '700', color: '#1C1C2E', textAlign: 'center', marginBottom: 4 },

  // Slides 2–4 shared
  headline:    { fontSize: 13, fontWeight: '800', color: '#1C1C2E', lineHeight: 19, marginBottom: 8 },
  saffron:     { color: '#C8691A' },
  rule:        { width: 20, height: 1.5, backgroundColor: '#C8691A', marginBottom: 14 },

  // Slide 2 stat rows
  statRow:     { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 7 },
  statNum:     { fontSize: 12, fontWeight: '800', color: '#C8691A', minWidth: 38 },
  statLabel:   { fontSize: 11, fontWeight: '600', color: '#1C1C2E' },

  // Slide 3 bullets
  bulletRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
  dotSaffron:  { width: 4, height: 4, borderRadius: 2, backgroundColor: '#C8691A', marginRight: 10 },
  dotInk:      { width: 4, height: 4, borderRadius: 2, backgroundColor: '#1C1C2E', marginRight: 10 },
  bulletText:  { fontSize: 11, fontWeight: '600', color: '#1C1C2E' },
  bulletInk:   { fontSize: 11, fontWeight: '700', color: '#1C1C2E' },

  // Slide 4 identity boxes
  identityBox:          { borderWidth: 1.5, borderColor: '#1C1C2E', borderRadius: 10, padding: 12, marginBottom: 10 },
  identityBoxSaffron:   { borderColor: '#C8691A' },
  identityTitle:        { fontSize: 14, fontWeight: '700', color: '#1C1C2E', marginBottom: 3 },
  identityTitleSaffron: { color: '#C8691A' },
  identitySub:          { fontSize: 10, color: '#9a9a9a' },

  // Footer text
  footInk:     { fontSize: 10, fontWeight: '600', color: '#1C1C2E', textAlign: 'center', marginBottom: 4 },

  // Bottom CTA
  bottom:      { paddingHorizontal: 24, paddingBottom: 44, gap: 12 },
  btn:         { backgroundColor: '#C8691A', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  btnText:     { fontSize: 15, fontWeight: '700', color: '#FAF7F0' },
  skip:        { textAlign: 'center', color: '#1C1C2E', fontSize: 13, fontWeight: '500' },
});



