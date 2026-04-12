/**
 * SatvAAh — apps/mobile/src/screens/provider/EntityTypeScreen.tsx
 * Phase 22 — Step 0: Choose what kind of provider you are.
 *
 * 3 Cards:
 *   Individual   → individual_service | individual_product | expertise  (refined in Step 1)
 *   Establishment → establishment
 *   New Brand     → product_brand
 */

import React, { useRef } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 View,
 Text,
 StyleSheet,
 TouchableOpacity,
 ScrollView,
 Animated,
 StatusBar,
 
 Dimensions,
 Image,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProviderOnboardingParamList } from '../../navigation/provider.navigator';
import { useProviderStore, type EntityClass } from '../../stores/provider.store';
import type { ListingType } from '../../api/provider.api';
import { ScreenHeader } from '../../components/ScreenHeader';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<ProviderOnboardingParamList, 'EntityType'>;

interface CardConfig {
  entityClass: EntityClass;
  listingType: ListingType | null; // null for individual (refined in Step1)
  title: string;
  subtitle: string;
  examples: string;
  emoji: string;
  accentColor: string;
  bgColor: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CARDS: CardConfig[] = [
  {
    entityClass: 'individual',
    listingType: null,
    title: 'Individual',
    subtitle: 'A person offering services, products, or expertise',
    examples: 'Plumber · Cook · Doctor · Electrician · Milkman · CA',
    emoji: '🧑‍🔧',
    accentColor: '#C8691A',
    bgColor: '#FEF3E8',
  },
  {
    entityClass: 'establishment',
    listingType: 'establishment',
    title: 'Establishment',
    subtitle: 'A named business or shop with a physical presence',
    examples: 'Ramu di Hatti · Sharma Mithai · Paradise Biryani · Clinic',
    emoji: '🏪',
    accentColor: '#2E7D72',
    bgColor: '#EDF5F4',
  },
  {
    entityClass: 'brand',
    listingType: 'product_brand',
    title: 'New Brand',
    subtitle: 'Building trust for a product brand before it becomes a household name',
    examples: 'A-Z Milk · Fresh Squeeze Co · Home Bakery Brand',
    emoji: '✨',
    accentColor: '#1C1C2E',
    bgColor: '#F0EFF7',
  },
];

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Component ────────────────────────────────────────────────────────────────

export default function EntityTypeScreen({
  navigation }: Props) {
  const setEntityClass = useProviderStore((s) => s.setEntityClass);

  // Per-card press scale animation
  const scales = useRef(CARDS.map(() => new Animated.Value(1))).current;

  const handlePressIn = (idx: number) => {
    Animated.spring(scales[idx], {
      toValue: 0.97,
      useNativeDriver: true,
      friction: 8,
    }).start();
  };

  const handlePressOut = (idx: number) => {
    Animated.spring(scales[idx], {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
    }).start();
  };

  const handleSelect = (card: CardConfig) => {
    setEntityClass(card.entityClass, card.listingType);
    navigation.navigate('CreateProfileStep1', { entityClass: card.entityClass });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Provider Type" onBack={() => navigation.goBack()} />
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.eyebrow}>PROVIDER ONBOARDING</Text>
          <Text style={styles.title}>What best describes{'\n'}what you offer?</Text>
          <Text style={styles.subtitle}>
            Choose the type that fits. You can update this later.
          </Text>
        </View>

        {/* Cards */}
        <View style={styles.cards}>
          {CARDS.map((card, idx) => (
            <Animated.View
              key={card.entityClass}
              style={{ transform: [{ scale: scales[idx] }] }}
            >
              <TouchableOpacity
                activeOpacity={1}
                onPressIn={() => handlePressIn(idx)}
                onPressOut={() => handlePressOut(idx)}
                onPress={() => handleSelect(card)}
                style={[styles.card, { backgroundColor: card.bgColor }]}
              >
                {/* Left accent bar */}
                <View style={[styles.cardAccent, { backgroundColor: card.accentColor }]} />

                {/* Card body */}
                <View style={styles.cardBody}>
                  <View style={styles.cardTopRow}>
                    <View style={[styles.emojiWrap, { backgroundColor: card.accentColor + '1A' }]}>
                      <Text style={styles.emoji}>{card.emoji}</Text>
                    </View>
                    <View style={styles.cardChevron}>
                      <Text style={[styles.chevronText, { color: card.accentColor }]}>›</Text>
                    </View>
                  </View>

                  <Text style={[styles.cardTitle, { color: card.accentColor }]}>
                    {card.title}
                  </Text>
                  <Text style={styles.cardSubtitle}>{card.subtitle}</Text>

                  <View style={[styles.examplesWrap, { borderColor: card.accentColor + '40' }]}>
                    <Text style={[styles.examplesLabel, { color: card.accentColor }]}>
                      Examples
                    </Text>
                    <Text style={styles.examplesText}>{card.examples}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </View>

        {/* Trust note */}
        <View style={styles.trustNote}>
          <Text style={styles.trustNoteIcon}>🔒</Text>
          <Text style={styles.trustNoteText}>
            Your profile will be live immediately after setup.{' '}
            <Text style={styles.trustNoteHighlight}>Zero commission. Always.</Text>
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FAF7F0',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 28,
  },
  eyebrow: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#C8691A',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 28,
    color: '#1C1C2E',
    lineHeight: 36,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 15,
    color: '#1C1C2E',
    lineHeight: 22,
  },
  cards: {
    gap: 16,
  },
  card: {
    borderRadius: 16,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#1C1C2E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  cardAccent: {
    width: 5,
  },
  cardBody: {
    flex: 1,
    padding: 20,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  emojiWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 24,
  },
  cardChevron: {
    alignSelf: 'center',
  },
  chevronText: {
    fontSize: 32,
    lineHeight: 36,
    fontFamily: 'PlusJakartaSans-Light',
  },
  cardTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 20,
    marginBottom: 6,
  },
  cardSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13.5,
    color: '#4A4540',
    lineHeight: 20,
    marginBottom: 14,
  },
  examplesWrap: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#FFFFFF60',
  },
  examplesLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  examplesText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12.5,
    color: '#4A4540',
    lineHeight: 18,
  },
  trustNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 28,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    shadowColor: '#1C1C2E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  trustNoteIcon: {
    fontSize: 16,
    marginTop: 1,
  },
  trustNoteText: {
    flex: 1,
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13,
    color: '#4A4540',
    lineHeight: 20,
  },
  trustNoteHighlight: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#2E7D72',
  },
});
