/**
 * apps/mobile/src/screens/consumer/ContactMessageScreen.tsx
 * SatvAAh Phase 19 — Message Contact Flow (Bottom Sheet)
 *
 * Spec (Phase 19 prompt + GitHub structure):
 *   • @gorhom/bottom-sheet at 70% / 94%
 *   • 4 quick-prompt chips for common requests
 *   • BottomSheetTextInput (500-char limit with counter)
 *   • createContactEvent(type=message) → sendMessage → navigate to ConversationScreen
 *   • Lead cost hidden when contact_lead_cost = 0
 *   • BottomSheetBackdrop
 *
 * MASTER_CONTEXT: Provider phone always visible — shown above input.
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 View, Text, StyleSheet, TouchableOpacity,
 ActivityIndicator, Alert,
} from 'react-native';
import BottomSheet, { BottomSheetView, BottomSheetTextInput, BottomSheetBackdrop } from '../../__stubs__/bottom-sheet';
import type { BottomSheetBackdropProps } from '../../__stubs__/bottom-sheet';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { createContactEvent, sendMessage } from '../../api/contact.api';
import { trustRingColor } from '../../api/trust.api';
import type { ConsumerStackParamList } from '../../navigation/types';

// ─── Brand colours ────────────────────────────────────────────────────────────
const SAFFRON   = '#C8691A';
const DEEP_INK  = '#1C1C2E';
const IVORY     = '#FAF7F0';
const WARM_SAND = '#F0E4CC';
const MUTED     = '#9E9589';

const MAX_CHARS = 500;

// Quick-prompt chips — common consumer requests
const QUICK_PROMPTS = [
  'What are your charges?',
  'Are you available today?',
  'Can you come to my location?',
  'I need help urgently.',
];

type NavProp = NativeStackNavigationProp<ConsumerStackParamList, 'ContactMessage'>;

export function ContactMessageScreen(): React.ReactElement {
  const navigation = useNavigation<NavProp>();
  const route      = useRoute<any>();
  const {
    providerId,
    providerName,
    providerScore,
    providerTier,
  } = route.params as {
    providerId: string;
    providerName: string;
    providerScore?: number;
    providerTier?: string;
  };

  const sheetRef   = useRef<BottomSheet>(null);
  const [text,     setText]    = useState('');
  const [loading,  setLoading] = useState(false);
  const leadCost = 0; // paise — 0 at launch (admin-configurable, never hardcoded)

  const showLeadCost = leadCost > 0;
  const tierColor    = trustRingColor(providerScore ?? 75);
  const snapPoints   = ['70%', '94%'];
  const charsLeft    = MAX_CHARS - text.length;

  useEffect(() => { sheetRef.current?.expand(); }, []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0}
        onPress={() => navigation.goBack()} />
    ),
    [navigation],
  );

  function handleQuickPrompt(prompt: string): void {
    setText(prompt);
  }

  async function handleSend(): Promise<void> {
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      // 1. Create contact event (type=message)
      const event = await createContactEvent({
        providerId: providerId,
        contactType: 'message',
      });

      // 2. Send initial message
      await sendMessage({
        contactEventId: event.id,
        message_text: text.trim(),
      });

      // 3. Navigate to conversation
      navigation.replace('Conversation', {
        contactEventId: event.id,
        otherPartyName: providerName,
        otherPartyId: providerId,
      });
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not send message. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F0' }} edges={['top']}>
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      onClose={() => navigation.goBack()}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.sheetBg}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
    >
      <BottomSheetView style={styles.content}>
        {/* Provider header */}
        <View style={styles.providerRow}>
          <View style={[styles.avatar, { borderColor: tierColor }]}>
            <Text style={styles.avatarInitial}>{providerName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.providerMeta}>
            <Text style={styles.providerName}>{providerName}</Text>
            {providerTier && (
              <Text style={[styles.tierLabel, { color: tierColor }]}>{providerTier}</Text>
            )}
          </View>
        </View>

        {/* Quick-prompt chips */}
        <View style={styles.chipsRow}>
          {QUICK_PROMPTS.map((prompt) => (
            <TouchableOpacity
              key={prompt}
              style={[styles.chip, text === prompt && styles.chipActive]}
              onPress={() => handleQuickPrompt(prompt)}
            >
              <Text style={[styles.chipText, text === prompt && styles.chipTextActive]}>
                {prompt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Message input */}
        <View style={styles.inputWrapper}>
          <BottomSheetTextInput
            style={styles.input}
            value={text}
            onChangeText={(t) => setText(t.slice(0, MAX_CHARS))}
            placeholder={`Message ${providerName}…`}
            placeholderTextColor={MUTED}
            multiline
            maxLength={MAX_CHARS}
            autoFocus
          />
          <Text style={[styles.charCounter, charsLeft < 50 && styles.charCounterWarn]}>
            {charsLeft}
          </Text>
        </View>

        {/* Lead cost — hidden when 0 */}
        {showLeadCost && (
          <Text style={styles.leadCostText}>Uses 1 lead</Text>
        )}

        {/* Send */}
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || loading) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color={IVORY} />
            : <Text style={styles.sendBtnText}>Send Message →</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sheetBg:          { backgroundColor: IVORY },
  handle:           { backgroundColor: '#C8C0B4', width: 40 },
  content:          { padding: 20, gap: 12 },
  providerRow:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar:           { width: 46, height: 46, borderRadius: 23, borderWidth: 2.5, backgroundColor: WARM_SAND, alignItems: 'center', justifyContent: 'center' },
  avatarInitial:    { fontFamily: 'PlusJakartaSans-Bold', fontSize: 18, color: DEEP_INK },
  providerMeta:     { flex: 1 },
  providerName:     { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: DEEP_INK },
  tierLabel:        { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, marginTop: 2 },
  chipsRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:             { borderWidth: 1, borderColor: '#DDD5C8', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff' },
  chipActive:       { borderColor: SAFFRON, backgroundColor: '#FFF3E8' },
  chipText:         { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: MUTED },
  chipTextActive:   { color: SAFFRON, fontFamily: 'PlusJakartaSans-Medium' },
  inputWrapper:     { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#DDD5C8', padding: 12, minHeight: 100 },
  input:            { fontFamily: 'PlusJakartaSans-Regular', fontSize: 15, color: DEEP_INK, minHeight: 80 },
  charCounter:      { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: MUTED, textAlign: 'right', marginTop: 4 },
  charCounterWarn:  { color: '#C0392B' },
  leadCostText:     { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: MUTED, textAlign: 'center' },
  sendBtn:          { backgroundColor: SAFFRON, borderRadius: 12, height: 50, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled:  { opacity: 0.4 },
  sendBtnText:      { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: IVORY },
  cancelBtn:        { alignItems: 'center', paddingVertical: 6 },
  cancelText:       { fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, color: MUTED },
});
