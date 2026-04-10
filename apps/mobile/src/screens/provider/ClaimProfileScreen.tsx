/**
 * SatvAAh — apps/mobile/src/screens/provider/ClaimProfileScreen.tsx
 * Phase 22 — Path A: Claim a scraped profile.
 *
 * Flow:
 *   Auth → checks phone against scraped DB → if found → this screen
 *   "Yes, this is me — Claim free" → is_claimed=true → trust_score=20 → hero
 *   "No, this isn't me" → CreateProfileStep1 (create new)
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  SafeAreaView,
  Image,
  Alert,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProviderOnboardingParamList } from '../../navigation/provider.navigator';
import { useProviderStore } from '../../stores/provider.store';
import { providerApi, type ScrapedProfile } from '../../api/provider.api';
import TrustRingHero from '../../components/TrustRingHero';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<ProviderOnboardingParamList, 'ClaimProfile'>;

const PLATFORM_LABELS: Record<string, string> = {
  google:   'Google',
  zomato:   'Zomato',
  practo:   'Practo',
  justdial: 'JustDial',
  sulekha:  'Sulekha',
};

const PLATFORM_COLORS: Record<string, string> = {
  google:   '#4285F4',
  zomato:   '#E23744',
  practo:   '#5BA4CF',
  justdial: '#FF6900',
  sulekha:  '#E3282B',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClaimProfileScreen({ route, navigation }: Props) {
  const { profile: scraped } = route.params as { profile: ScrapedProfile };

  const setProfile = useProviderStore((s) => s.setProfile);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);

  const handleClaim = async () => {
    setClaiming(true);
    try {
      const profile = await providerApi.claimProfile(scraped.id);
      setProfile(profile);
      setClaimed(true);
      // After 3s hero display, move to Step 3 geo
      setTimeout(() => {
        navigation.navigate('CreateProfileStep3Geo');
      }, 3200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Claim failed. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setClaiming(false);
    }
  };

  const handleNotMe = () => {
    navigation.navigate('EntityType');
  };

  if (claimed) {
    return (
      <SafeAreaView style={styles.safeHero}>
        <TrustRingHero
          fromScore={0}
          toScore={20}
          tier="basic"
          headline="🎉 You are live!"
          subline="Consumers can now find you on SatvAAh."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.eyebrow}>WE FOUND YOUR PROFILE</Text>
          <Text style={styles.title}>Is this you?</Text>
          <Text style={styles.subtitle}>
            We discovered this profile from the web. Claiming it is{' '}
            <Text style={styles.freeText}>completely free</Text> — your data, your profile.
          </Text>
        </View>

        {/* Profile card */}
        <View style={styles.profileCard}>
          {/* Avatar */}
          <View style={styles.avatarRow}>
            {scraped.photo_url ? (
              <Image
                source={{ uri: scraped.photo_url }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>
                  {scraped.displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.avatarInfo}>
              <Text style={styles.profileName}>{scraped.displayName}</Text>
              <Text style={styles.profileCategory}>
                {scraped.category}
                {scraped.sub_category ? ` · ${scraped.sub_category}` : ''}
              </Text>
              <Text style={styles.profileLocation}>
                📍 {scraped.area}, {scraped.city}
              </Text>
            </View>
          </View>

          {/* Divider */}
          {scraped.external_ratings.length > 0 && (
            <>
              <View style={styles.divider} />
              <Text style={styles.ratingsLabel}>External Ratings</Text>
              <View style={styles.ratingsList}>
                {scraped.external_ratings.map((r) => (
                  <View key={r.platform} style={styles.ratingChip}>
                    <View
                      style={[
                        styles.ratingDot,
                        { backgroundColor: PLATFORM_COLORS[r.platform] ?? '#888' },
                      ]}
                    />
                    <Text style={styles.ratingPlatform}>{PLATFORM_LABELS[r.platform]}</Text>
                    <Text style={styles.ratingStars}>★ {r.rating_avg != null ? r.rating_avg.toFixed(1) : '0.0'}</Text>
                    <Text style={styles.ratingCount}>({r.review_count})</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Scraped badge */}
          <View style={styles.scrapedBadge}>
            <Text style={styles.scrapedBadgeText}>
              🔍 Discovered from public web sources
            </Text>
          </View>
        </View>

        {/* Info note */}
        <View style={styles.infoNote}>
          <Text style={styles.infoNoteText}>
            Claiming takes{' '}
            <Text style={styles.bold}>less than 10 seconds</Text>. You stay in full control —
            edit or remove any time.
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.claimBtn, claiming && styles.claimBtnDisabled]}
            onPress={handleClaim}
            disabled={claiming}
            activeOpacity={0.85}
          >
            {claiming ? (
              <ActivityIndicator color="#FAF7F0" size="small" />
            ) : (
              <>
                <Text style={styles.claimBtnText}>✓ Yes, this is me — Claim free</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.notMeBtn}
            onPress={handleNotMe}
            disabled={claiming}
            activeOpacity={0.7}
          >
            <Text style={styles.notMeText}>No, this isn't me — Create new profile</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.legalNote}>
          By claiming, you confirm you are the person or business shown above.
          False claims may result in removal.
        </Text>
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
  safeHero: {
    flex: 1,
    backgroundColor: '#1C1C2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 48,
  },
  header: {
    marginBottom: 24,
  },
  eyebrow: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#2E7D72',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 28,
    color: '#1C1C2E',
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 14.5,
    color: '#4A4540',
    lineHeight: 22,
  },
  freeText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#2E7D72',
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#1C1C2E',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.09,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 16,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F0E4CC',
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#C8691A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 26,
    color: '#FAF7F0',
  },
  avatarInfo: {
    flex: 1,
    paddingTop: 2,
  },
  profileName: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 20,
    color: '#1C1C2E',
    marginBottom: 4,
  },
  profileCategory: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13,
    color: '#C8691A',
    marginBottom: 4,
  },
  profileLocation: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13,
    color: '#1C1C2E',
  },
  divider: {
    height: 1,
    backgroundColor: '#F0E4CC',
    marginVertical: 16,
  },
  ratingsLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
    color: '#1C1C2E',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  ratingsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF7F0',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 4,
  },
  ratingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  ratingPlatform: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
    color: '#1C1C2E',
  },
  ratingStars: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 12,
    color: '#1C1C2E',
  },
  ratingCount: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11,
    color: '#1C1C2E',
  },
  scrapedBadge: {
    marginTop: 16,
    backgroundColor: '#F0F4F3',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scrapedBadgeText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    color: '#4A6561',
  },
  infoNote: {
    backgroundColor: '#EDF5F4',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
  },
  infoNoteText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13.5,
    color: '#2E5C57',
    lineHeight: 20,
  },
  bold: {
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  actions: {
    gap: 12,
    marginBottom: 20,
  },
  claimBtn: {
    backgroundColor: '#C8691A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#C8691A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  claimBtnDisabled: {
    opacity: 0.7,
  },
  claimBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 16,
    color: '#FAF7F0',
    letterSpacing: 0.3,
  },
  notMeBtn: {
    borderWidth: 1.5,
    borderColor: '#C8691A40',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  notMeText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 14.5,
    color: '#C8691A',
  },
  legalNote: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11.5,
    color: '#9B9390',
    textAlign: 'center',
    lineHeight: 18,
  },
});
