/**
 * SatvAAh Mode Selection Screen
 * Two equal cards: Consumer | Provider
 * POST /api/v1/auth/firebase/verify — consent_given: true ALWAYS (Rule #21)
 * Mode persisted to MMKV via auth store
 */

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, TextInput,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { AuthScreenProps } from '../../navigation/types';

import { verifyFirebaseToken } from '../../api/auth.api';
import { useAuthStore } from '../../stores/auth.store';
import { COLORS } from '../../constants/colors';

type ModeRouteProps = AuthScreenProps<'ModeSelection'>['route'];

export function ModeSelectionScreen(): React.ReactElement {
  const route = useRoute<ModeRouteProps>();
  const { firebaseIdToken, phone } = route.params;

  const [selectedMode, setSelectedMode] = useState<'consumer' | 'provider' | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const [consumerName, setConsumerName] = useState('');
  const [showNameInput, setShowNameInput] = useState(false);
  const setMode = useAuthStore((s) => s.setMode);

  async function handleModeSelect(mode: 'consumer' | 'provider'): Promise<void> {
    if (isLoading) return;
    setSelectedMode(mode);
    setIsLoading(true);

    // For consumer mode — collect name if not set
    if (mode === 'consumer' && !consumerName.trim() && !showNameInput) {
      setShowNameInput(true);
      setIsLoading(false);
      return;
    }

    try {
      // Rule #21: consent_given ALWAYS true — DPDP Act 2023
      // This atomically creates the user + writes consent_record on first-time sign-in
      const result = await verifyFirebaseToken({
        firebaseIdToken,
        phone,
        mode,
        consent_given: true, // Non-negotiable. Never false.
      });

      // Persist to MMKV via Zustand store
      setTokens(result.access_token, result.refresh_token);
      setUser(result.userId, phone);
      setMode(mode);

      // RootNavigator re-renders automatically from Zustand state change
    } catch (error: unknown) { console.error("SATVAAAH_ERROR:", JSON.stringify(error), (error as any)?.message, (error as any)?.code);
      const apiError = error as { response?: { data?: { error?: { code?: string; message?: string } } } };
      const code = apiError?.response?.data?.error?.code;

      if (code === 'CONSENT_REQUIRED') {
        Alert.alert(
          'Consent Required',
          'You must agree to data processing to use SatvAAh.',
        );
      } else {
        Alert.alert(
          'Something went wrong',
          'Could not complete sign in. Please try again.',
        );
      }
      setSelectedMode(null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Wordmark */}
      <Text style={styles.wordmark}>SatvAAh</Text>
      <Text style={styles.headline}>Welcome to SatvAAh.</Text>
      <Text style={styles.sub}>How would you like to continue today?</Text>

      {/* Consumer Card */}
      <TouchableOpacity
        style={[
          styles.card,
          selectedMode === 'consumer' && styles.cardSelectedConsumer,
        ]}
        onPress={() => handleModeSelect('consumer')}
        disabled={isLoading}
        activeOpacity={0.88}
      >
        <Text style={styles.cardEmoji}>🔍</Text>
        <Text style={styles.cardHeadline}>I am looking for someone</Text>
        <Text style={styles.cardSub}>Find verified providers near you.</Text>

        {/* Decorative chips */}
        <View style={styles.chipRow}>
          {['Score ≥ 70', '< 2km', 'Available now'].map((chip) => (
            <View key={chip} style={styles.chip}>
              <Text style={styles.chipText}>{chip}</Text>
            </View>
          ))}
        </View>

        {isLoading && selectedMode === 'consumer' && (
          <ActivityIndicator
            style={styles.cardLoader}
            color={COLORS.saffron}
          />
        )}
      </TouchableOpacity>

      {/* Provider Card */}
      <TouchableOpacity
        style={[
          styles.card,
          selectedMode === 'provider' && styles.cardSelectedProvider,
        ]}
        onPress={() => handleModeSelect('provider')}
        disabled={isLoading}
        activeOpacity={0.88}
      >
        <Text style={styles.cardEmoji}>🛡️</Text>
        <Text style={styles.cardHeadline}>I offer a service or product</Text>
        <Text style={styles.cardSub}>Build your trust score. Manage leads.</Text>

        {/* Decorative chips */}
        <View style={styles.chipRow}>
          {['Aadhaar ✓', 'Geo-tag ✓', 'Credential ✓'].map((chip) => (
            <View key={chip} style={[styles.chip, styles.chipProvider]}>
              <Text style={[styles.chipText, styles.chipTextProvider]}>{chip}</Text>
            </View>
          ))}
        </View>

        {isLoading && selectedMode === 'provider' && (
          <ActivityIndicator
            style={styles.cardLoader}
            color={COLORS.verdigris}
          />
        )}
      </TouchableOpacity>

      <Text style={styles.footer}>
        You can switch modes anytime from Settings.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.ivory,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 48,
    alignItems: 'center',
  },
  wordmark: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontSize: 24,
    color: COLORS.saffron,
    marginBottom: 32,
  },
  headline: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 22,
    color: COLORS.deepInk,
    marginBottom: 6,
    textAlign: 'center',
  },
  sub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13,
    color: COLORS.textPrimary,
    marginBottom: 32,
    textAlign: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: COLORS.border,
    // Shadow
    shadowColor: '#1C1C2E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardSelectedConsumer: {
    borderColor: COLORS.saffron,
    shadowOpacity: 0.12,
  },
  cardSelectedProvider: {
    borderColor: COLORS.verdigris,
    shadowOpacity: 0.12,
  },
  cardEmoji: {
    fontSize: 36,
    marginBottom: 12,
  },
  cardHeadline: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 17,
    color: COLORS.deepInk,
    marginBottom: 4,
  },
  cardSub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13,
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#FFF3E8',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipProvider: {
    backgroundColor: '#E8F5F3',
  },
  chipText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 12,
    color: COLORS.saffron,
  },
  chipTextProvider: {
    color: COLORS.verdigris,
  },
  cardLoader: {
    marginTop: 12,
  },
  footer: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginTop: 8,
  },
});
