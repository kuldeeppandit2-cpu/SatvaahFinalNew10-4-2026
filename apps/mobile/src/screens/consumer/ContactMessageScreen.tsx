import React, { useState } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView,
  Platform, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createContactEvent, sendMessage } from '../../api/contact.api';
import { trustRingColor } from '../../api/trust.api';
import type { ConsumerStackParamList } from '../../navigation/types';

const SAFFRON   = '#C8691A';
const DEEP_INK  = '#1C1C2E';
const IVORY     = '#FAF7F0';
const WARM_SAND = '#F0E4CC';
const MUTED     = '#9E9589';

const MAX_CHARS = 500;
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
  const { providerId, providerName, providerScore, providerTier } = route.params as {
    providerId: string; providerName: string;
    providerScore?: number; providerTier?: string;
  };

  const [text,    setText]    = useState('');
  const [loading, setLoading] = useState(false);
  const tierColor = trustRingColor(providerScore ?? 75);
  const initial   = providerName ? providerName.charAt(0).toUpperCase() : '?';
  const charsLeft = MAX_CHARS - text.length;

  async function handleSend() {
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      const event = await createContactEvent({ providerId, contactType: 'message' });
      await sendMessage({ contactEventId: event.id, message_text: text.trim() });
      navigation.replace('Conversation', {
        contactEventId: event.id,
        otherPartyName: providerName,
        otherPartyId: providerId,
      });
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not send. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={IVORY} />
      <ScreenHeader title="Send Message" onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Provider identity */}
          <View style={s.heroBlock}>
            <View style={[s.avatar, { borderColor: tierColor }]}>
              <Text style={s.avatarInitial}>{initial}</Text>
            </View>
            <View style={s.providerMeta}>
              <Text style={s.providerName}>{providerName}</Text>
              {providerTier && (
                <Text style={[s.tierLabel, { color: tierColor }]}>{providerTier}</Text>
              )}
            </View>
          </View>

          {/* Quick prompts */}
          <Text style={s.sectionLabel}>Quick messages</Text>
          <View style={s.chipsRow}>
            {QUICK_PROMPTS.map((prompt) => (
              <TouchableOpacity
                key={prompt}
                style={[s.chip, text === prompt && s.chipActive]}
                onPress={() => setText(prompt)}
              >
                <Text style={[s.chipText, text === prompt && s.chipTextActive]}>
                  {prompt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Message input */}
          <Text style={s.sectionLabel}>Your message</Text>
          <View style={s.inputWrapper}>
            <TextInput
              style={s.input}
              value={text}
              onChangeText={(t) => setText(t.slice(0, MAX_CHARS))}
              placeholder={`Write to ${providerName}…`}
              placeholderTextColor={MUTED}
              multiline
              maxLength={MAX_CHARS}
              autoFocus={false}
              textAlignVertical="top"
            />
            <Text style={[s.charCounter, charsLeft < 50 && s.charCounterWarn]}>
              {charsLeft} chars left
            </Text>
          </View>

          {/* Send button */}
          <TouchableOpacity
            style={[s.sendBtn, (!text.trim() || loading) && s.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={IVORY} />
              : <>
                  <Ionicons name="send" size={18} color={IVORY} />
                  <Text style={s.sendBtnText}>Send Message</Text>
                </>
            }
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={() => navigation.goBack()}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: IVORY },
  scroll:           { paddingHorizontal: 24, paddingBottom: 40 },

  heroBlock:        { flexDirection: 'row', alignItems: 'center', gap: 14,
                      paddingVertical: 20 },
  avatar:           { width: 56, height: 56, borderRadius: 28, borderWidth: 2.5,
                      backgroundColor: WARM_SAND, alignItems: 'center',
                      justifyContent: 'center', flexShrink: 0 },
  avatarInitial:    { fontSize: 22, fontWeight: '700', color: DEEP_INK },
  providerMeta:     { flex: 1 },
  providerName:     { fontSize: 18, fontWeight: '700', color: DEEP_INK },
  tierLabel:        { fontSize: 13, fontWeight: '500', marginTop: 2 },

  sectionLabel:     { fontSize: 12, fontWeight: '600', color: MUTED,
                      textTransform: 'uppercase', letterSpacing: 0.5,
                      marginBottom: 8, marginTop: 4 },

  chipsRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip:             { borderWidth: 1, borderColor: '#DDD5C8', borderRadius: 20,
                      paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff' },
  chipActive:       { borderColor: SAFFRON, backgroundColor: '#FFF3E8' },
  chipText:         { fontSize: 13, color: MUTED },
  chipTextActive:   { color: SAFFRON, fontWeight: '600' },

  inputWrapper:     { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1,
                      borderColor: '#DDD5C8', padding: 14, marginBottom: 20,
                      minHeight: 130 },
  input:            { fontSize: 15, color: DEEP_INK, minHeight: 100 },
  charCounter:      { fontSize: 11, color: MUTED, textAlign: 'right', marginTop: 8 },
  charCounterWarn:  { color: '#C0392B' },

  sendBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      gap: 8, backgroundColor: SAFFRON, borderRadius: 14,
                      height: 56, marginBottom: 12 },
  sendBtnDisabled:  { opacity: 0.4 },
  sendBtnText:      { fontSize: 17, fontWeight: '700', color: IVORY },

  cancelBtn:        { alignItems: 'center', paddingVertical: 12 },
  cancelText:       { fontSize: 15, color: MUTED, fontWeight: '500' },
});
