/**
 * SatvAAh Onboarding — Brand identity: Ivory bg, Deep Ink text, Saffron CTA
 */
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, ScrollView, StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Onboarding'>;
const { width: W } = Dimensions.get('window');

const SLIDES = [
  {
    tag: 'THE PROBLEM',
    headline: 'They take 30%.\nEvery. Single. Job.',
    sub: 'Swiggy. Urban Company. Every platform takes a cut from the person doing the actual work. SatvAAh takes 0%. Written into our company constitution. No fine print.',
    emoji: '✊',
  },
  {
    tag: 'THE SCORE',
    headline: 'A number that\ncannot be faked.',
    sub: 'Aadhaar verified. Geo-confirmed. Rated by real customers. Your SatvAAh Trust Score is yours forever — it follows you, not the platform.',
    emoji: '🛡️',
  },
  {
    tag: 'THE FREEDOM',
    headline: 'One login.\nTwo worlds.',
    sub: 'The electrician who also hires a cook. Switch between customer and provider anytime. Zero commission. Always.',
    emoji: '⚡',
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

      <ScrollView
        ref={scrollRef}
        horizontal pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => setActive(Math.round(e.nativeEvent.contentOffset.x / W))}
      >
        {SLIDES.map((slide, i) => (
          <View key={i} style={[s.slide, { width: W }]}>
            <View style={s.tagRow}>
              <View style={s.tagPill}>
                <Text style={s.tagText}>{slide.tag}</Text>
              </View>
            </View>
            <Text style={s.emoji}>{slide.emoji}</Text>
            <Text style={s.headline}>{slide.headline}</Text>
            <Text style={s.sub}>{slide.sub}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={s.dots}>
        {SLIDES.map((_, i) => (
          <TouchableOpacity key={i} onPress={() => goTo(i)}>
            <View style={[s.dot, active === i && s.dotActive]} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.bottom}>
        <TouchableOpacity
          style={s.btn}
          onPress={() => active < SLIDES.length - 1 ? goTo(active + 1) : navigation.replace('Login')}
        >
          <Text style={s.btnText}>{active === SLIDES.length - 1 ? 'Get Started →' : 'Next →'}</Text>
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
  root:      { flex: 1, backgroundColor: '#FAF7F0' },
  slide:     { flex: 1, paddingHorizontal: 32, paddingTop: 80, justifyContent: 'center' },
  tagRow:    { marginBottom: 24 },
  tagPill:   { backgroundColor: '#1C1C2E', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start' },
  tagText:   { color: '#FAF7F0', fontSize: 11, fontWeight: '700', letterSpacing: 2, fontFamily: 'PlusJakartaSans-Bold' },
  emoji:     { fontSize: 56, marginBottom: 24 },
  headline:  { fontSize: 36, fontWeight: '800', color: '#1C1C2E', lineHeight: 44, marginBottom: 20, fontFamily: 'PlusJakartaSans-ExtraBold' },
  sub:       { fontSize: 15, color: '#1C1C2E', lineHeight: 24, fontFamily: 'PlusJakartaSans-Regular' },
  dots:      { flexDirection: 'row', justifyContent: 'center', paddingBottom: 16, gap: 8 },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E8E0D5' },
  dotActive: { width: 28, backgroundColor: '#C8691A' },
  bottom:    { paddingHorizontal: 32, paddingBottom: 52, gap: 14 },
  btn:       { backgroundColor: '#C8691A', borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  btnText:   { fontSize: 16, fontWeight: '700', color: '#FAF7F0', fontFamily: 'PlusJakartaSans-Bold' },
  skip:      { textAlign: 'center', color: '#1C1C2E', fontSize: 14, fontFamily: 'PlusJakartaSans-Regular' },
});
