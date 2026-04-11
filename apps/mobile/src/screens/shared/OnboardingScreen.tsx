/**
 * SatvAAh Onboarding — 4 screens
 * Brand: #FAF7F0 ivory · #1C1C2E deep ink · #C8691A saffron
 * Font sizes matched to approved mockup at iPhone 15 Pro scale (393pt wide)
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
const { width: W, height: H } = Dimensions.get('window');
const SLIDE_H = H - 236;

function Brand() {
  return (
    <View style={b.wrap}>
      <View style={b.row}>
        <Text style={b.ink}>Satv</Text>
        <View style={b.aaBox}><Text style={b.aaText}>AA</Text></View>
        <Text style={b.ink}>h</Text>
      </View>
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

      <View style={s.prog}>
        {Array.from({ length: TOTAL }).map((_, i) => (
          <View key={i} style={[s.seg, i <= active && s.segOn]} />
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

        {/* S1 */}
        <View style={[s.slide, { width: W, height: SLIDE_H }]}>
          <View style={s.tag}><Text style={s.tagTxt}>THE PROBLEM</Text></View>
          <Text style={s.s1q}>
            Why pay{'\n'}10–30% commission{'\n'}to platforms{'\n'}on every purchase?
          </Text>
          <View style={s.sp} />
          <Text style={s.intro}>Introducing …</Text>
          <Brand />
          <View style={s.sp} />
          <Text style={s.s1zero}>0% Commission Guarantee</Text>
        </View>

        {/* S2 */}
        <View style={[s.slide, { width: W, height: SLIDE_H }]}>
          <View style={s.tag}><Text style={s.tagTxt}>ONE APP. EVERYTHING.</Text></View>
          <Text style={s.hl}>Explore at <Text style={s.sf}>0% commission</Text></Text>
          <View style={s.rule} />
          {([['> 1000','Products'],['> 200','Services'],['> 100','Expertise'],['> 100','Establishments']] as [string,string][]).map(([n,l],i) => (
            <View key={i} style={s.statRow}>
              <Text style={s.statN}>{n}</Text>
              <Text style={s.statL}>{l}</Text>
            </View>
          ))}
          <View style={s.sp} />
          <Brand />
          <View style={s.sp} />
          <Text style={s.foot}>For the first time in the world — on one app.</Text>
        </View>

        {/* S3 */}
        <View style={[s.slide, { width: W, height: SLIDE_H }]}>
          <View style={s.tag}><Text style={s.tagTxt}>TRUST THAT TRAVELS</Text></View>
          <Text style={s.hl}>Find <Text style={s.sf}>&gt; 12,000</Text> Providers near you</Text>
          <View style={s.rule} />
          {['Verified','Trust Score','Satisfaction Rating','Scheduling Facility'].map((item,i) => (
            <View key={i} style={s.brow}>
              <View style={s.dotSf} />
              <Text style={s.btxt}>{item}</Text>
            </View>
          ))}
          <View style={s.sp} />
          <Brand />
          <View style={s.sp} />
          <View style={s.brow}><View style={s.dotInk} /><Text style={s.bink}>Connect Directly</Text></View>
          <View style={s.brow}><View style={s.dotInk} /><Text style={s.bink}>0% Commission</Text></View>
        </View>

        {/* S4 */}
        <View style={[s.slide, { width: W, height: SLIDE_H }]}>
          <View style={s.tag}><Text style={s.tagTxt}>TWO IDENTITIES</Text></View>
          <Text style={s.hl}>On one app{'\n'}Two Identities</Text>
          <View style={s.sp} />
          <View style={s.idBox}>
            <Text style={s.idTitle}>Customer</Text>
            <Text style={s.idSub}>Find &amp; connect with providers</Text>
          </View>
          <View style={[s.idBox, s.idBoxSf]}>
            <Text style={[s.idTitle, s.idTitleSf]}>Provider</Text>
            <Text style={s.idSub}>List services, earn your Trust Score</Text>
          </View>
          <View style={s.sp} />
          <Brand />
          <View style={s.sp} />
          <Text style={s.foot}>Let the world know about you with your Trust Score.</Text>
        </View>

      </ScrollView>

      <View style={s.bottom}>
        <TouchableOpacity
          style={s.btn} activeOpacity={0.85}
          onPress={() => active < TOTAL - 1 ? goTo(active + 1) : navigation.replace('Login')}
        >
          <Text style={s.btnTxt}>{active === TOTAL - 1 ? 'Get Started →' : 'Next →'}</Text>
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

const b = StyleSheet.create({
  wrap:   { alignItems: 'center', paddingVertical: 24 },
  row:    { flexDirection: 'row', alignItems: 'center' },
  ink:    { fontSize: 52, fontWeight: '800', color: '#1C1C2E' },
  aaBox:  { backgroundColor: '#C8691A', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 2, marginHorizontal: 1 },
  aaText: { fontSize: 46, fontWeight: '800', color: '#FAF7F0' },
  tagline:{ fontSize: 13, fontWeight: '700', fontStyle: 'italic', color: '#C8691A', letterSpacing: 5, marginTop: 12, textAlign: 'center' },
});

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#FAF7F0' },
  prog:     { flexDirection: 'row', gap: 5, paddingHorizontal: 28, paddingTop: 56, marginBottom: 4 },
  seg:      { flex: 1, height: 2, borderRadius: 1, backgroundColor: '#E8E0D5' },
  segOn:    { backgroundColor: '#C8691A' },
  scroller: { flex: 1 },
  slide:    { paddingHorizontal: 28, paddingTop: 20, justifyContent: 'space-between', paddingBottom: 8 },
  sp:       { flex: 1 },
  tag:      { alignSelf: 'flex-start', backgroundColor: '#1C1C2E', borderRadius: 4, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 18 },
  tagTxt:   { fontSize: 10, fontWeight: '700', color: '#FAF7F0', letterSpacing: 2 },
  s1q:      { fontSize: 17, fontWeight: '700', color: '#1C1C2E', lineHeight: 26 },
  intro:    { fontSize: 14, fontStyle: 'italic', color: '#6B6B7B', textAlign: 'center', marginBottom: 0 },
  s1zero:   { fontSize: 17, fontWeight: '700', color: '#1C1C2E', textAlign: 'center', marginBottom: 0 },
  hl:       { fontSize: 20, fontWeight: '800', color: '#1C1C2E', lineHeight: 28, marginBottom: 0 },
  sf:       { color: '#C8691A' },
  rule:     { width: 28, height: 2, backgroundColor: '#C8691A', marginTop: 12, marginBottom: 18 },
  statRow:  { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginBottom: 12 },
  statN:    { fontSize: 17, fontWeight: '800', color: '#C8691A', minWidth: 48 },
  statL:    { fontSize: 15, fontWeight: '600', color: '#1C1C2E' },
  brow:     { flexDirection: 'row', alignItems: 'center', marginBottom: 11 },
  dotSf:    { width: 5, height: 5, borderRadius: 3, backgroundColor: '#C8691A', marginRight: 12 },
  dotInk:   { width: 5, height: 5, borderRadius: 3, backgroundColor: '#1C1C2E', marginRight: 12 },
  btxt:     { fontSize: 15, fontWeight: '600', color: '#1C1C2E' },
  bink:     { fontSize: 14, fontWeight: '700', color: '#1C1C2E' },
  idBox:    { borderWidth: 2, borderColor: '#1C1C2E', borderRadius: 14, padding: 16, marginBottom: 12 },
  idBoxSf:  { borderColor: '#C8691A' },
  idTitle:  { fontSize: 17, fontWeight: '700', color: '#1C1C2E', marginBottom: 4 },
  idTitleSf:{ color: '#C8691A' },
  idSub:    { fontSize: 13, color: '#9a9a9a' },
  foot:     { fontSize: 13, fontWeight: '600', color: '#1C1C2E', textAlign: 'center', marginBottom: 4 },
  bottom:   { paddingHorizontal: 28, paddingBottom: 44, gap: 12 },
  btn:      { backgroundColor: '#C8691A', borderRadius: 14, paddingVertical: 17, alignItems: 'center' },
  btnTxt:   { fontSize: 16, fontWeight: '700', color: '#FAF7F0' },
  skip:     { textAlign: 'center', color: '#1C1C2E', fontSize: 14, fontWeight: '500' },
});
