import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, TextInput, Alert, ActivityIndicator,
  StatusBar,} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../../components/ScreenHeader';
import { apiClient } from '../../api/client';
import { COLORS } from '../../constants/colors';

const FAQS = [
  { q: 'Why are search results empty?', a: 'Results depend on your location. If no providers are found nearby, the search expands up to 150km. If still empty, no providers are listed in that category yet.' },
  { q: 'What is a Trust Score?', a: 'Trust Score (0–100) reflects how verified and community-rated a provider is. It combines identity verification, credentials, and customer ratings.' },
  { q: 'How do leads work?', a: 'Leads are contact credits. Each accepted contact uses 1 lead. At launch, leads are free (₹0 per contact). Unused leads do not roll over unless you have a Gold plan.' },
  { q: 'Can I switch between Consumer and Provider?', a: 'Yes. Go to Profile → Switch to Provider Mode (or Consumer Mode). Your data in both modes is preserved.' },
  { q: 'Is my phone number shared with providers?', a: 'Your phone is shared with a provider only after they accept your contact request. The provider\'s phone is always visible to you.' },
];

export function SupportScreen() {
  const navigation = useNavigation();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSubmit() {
    if (!subject.trim() || !message.trim()) {
      Alert.alert('Required', 'Please fill in both subject and message.');
      return;
    }
    setSending(true);
    try {
      await apiClient.post('/api/v1/support/ticket', { subject: subject.trim(), message: message.trim() });
      Alert.alert('Sent', 'We\'ll respond within 24 hours to your registered email.');
      setSubject(''); setMessage('');
    } catch {
      Alert.alert('Error', 'Could not send. Email us directly at support@satvaaah.com');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <ScreenHeader title="Help & Support" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <Text style={s.sectionTitle}>Frequently Asked Questions</Text>
        {FAQS.map((faq, i) => (
          <TouchableOpacity key={i} style={s.faqCard} onPress={() => setOpenFaq(openFaq === i ? null : i)} activeOpacity={0.8}>
            <View style={s.faqHeader}>
              <Text style={s.faqQ}>{faq.q}</Text>
              <Ionicons name={openFaq === i ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.muted} />
            </View>
            {openFaq === i && <Text style={s.faqA}>{faq.a}</Text>}
          </TouchableOpacity>
        ))}

        <Text style={s.sectionTitle}>Contact Us</Text>
        <View style={s.form}>
          <TextInput
            style={s.input}
            placeholder="Subject"
            placeholderTextColor={COLORS.muted}
            value={subject}
            onChangeText={setSubject}
          />
          <TextInput
            style={[s.input, s.textarea]}
            placeholder="Describe your issue..."
            placeholderTextColor={COLORS.muted}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={4}
          />
          <TouchableOpacity style={[s.submitBtn, sending && s.submitDisabled]} onPress={handleSubmit} disabled={sending}>
            {sending ? <ActivityIndicator color={COLORS.ivory} /> : <Text style={s.submitText}>Send Message</Text>}
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.emailRow} onPress={() => Linking.openURL('mailto:support@satvaaah.com')}>
          <Ionicons name="mail-outline" size={16} color={COLORS.saffron} />
          <Text style={s.emailText}>support@satvaaah.com</Text>
        </TouchableOpacity>
      </ScrollView>
    
      </KeyboardAvoidingView></SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.ivory },
  scroll: { padding: 16, paddingBottom: 48 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.deepInk, marginBottom: 10, marginTop: 8 },
  faqCard: { backgroundColor: COLORS.white, borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 0.5, borderColor: COLORS.border },
  faqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  faqQ: { fontSize: 13, fontWeight: '600', color: COLORS.deepInk, flex: 1, marginRight: 8 },
  faqA: { fontSize: 13, color: COLORS.muted, lineHeight: 19, marginTop: 8 },
  form: { backgroundColor: COLORS.white, borderRadius: 12, padding: 16, borderWidth: 0.5, borderColor: COLORS.border, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 12, fontSize: 14, color: COLORS.deepInk, marginBottom: 10, backgroundColor: COLORS.ivory },
  textarea: { height: 100, textAlignVertical: 'top' },
  submitBtn: { backgroundColor: COLORS.saffron, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: COLORS.ivory, fontSize: 15, fontWeight: '600' },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 8 },
  emailText: { color: COLORS.saffron, fontSize: 14, fontWeight: '500' },
});
