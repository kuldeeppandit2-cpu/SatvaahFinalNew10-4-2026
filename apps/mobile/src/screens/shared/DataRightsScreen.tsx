import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
  StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../../components/ScreenHeader';
import { COLORS } from '../../constants/colors';

const RIGHTS = [
  {
    icon: 'eye-outline' as const,
    title: 'Right to Access',
    body: 'You can request a copy of all personal data SatvAAh holds about you. We will respond within 30 days as required by the DPDP Act 2023.',
  },
  {
    icon: 'create-outline' as const,
    title: 'Right to Correction',
    body: 'You can request correction of inaccurate or incomplete personal data. Update your profile directly or contact us.',
  },
  {
    icon: 'trash-outline' as const,
    title: 'Right to Erasure',
    body: 'You can request deletion of your personal data. Note: ratings and trust events are anonymised, not deleted, as they form part of the trust layer.',
  },
  {
    icon: 'shield-checkmark-outline' as const,
    title: 'Consent Withdrawal',
    body: 'You consented to data processing when you joined. You may withdraw consent at any time by deleting your account. Withdrawal does not affect processing before withdrawal.',
  },
  {
    icon: 'document-text-outline' as const,
    title: 'DPDP Act 2023',
    body: 'SatvAAh complies with India\'s Digital Personal Data Protection Act 2023. Your consent record is stored atomically with your account creation.',
  },
];

export function DataRightsScreen() {
  const navigation = useNavigation();

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <ScreenHeader title="Privacy & Data Rights" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.intro}>
          SatvAAh is committed to your data privacy under the Digital Personal Data Protection Act 2023 (India).
        </Text>
        {RIGHTS.map((r, i) => (
          <View key={i} style={s.card}>
            <View style={s.cardHeader}>
              <Ionicons name={r.icon} size={20} color={COLORS.verdigris} />
              <Text style={s.cardTitle}>{r.title}</Text>
            </View>
            <Text style={s.cardBody}>{r.body}</Text>
          </View>
        ))}
        <TouchableOpacity
          style={s.contactBtn}
          onPress={() => Linking.openURL('mailto:privacy@satvaaah.com')}
        >
          <Ionicons name="mail-outline" size={16} color={COLORS.ivory} />
          <Text style={s.contactBtnText}>Contact Privacy Team</Text>
        </TouchableOpacity>
        <Text style={s.footer}>privacy@satvaaah.com · Response within 30 days</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.ivory },
  scroll: { padding: 16, paddingBottom: 48 },
  intro: { fontSize: 14, color: COLORS.muted, lineHeight: 21, marginBottom: 16 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: COLORS.deepInk },
  cardBody: { fontSize: 13, color: COLORS.muted, lineHeight: 19 },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: COLORS.verdigris, borderRadius: 12,
    paddingVertical: 14, marginTop: 8, marginBottom: 12,
  },
  contactBtnText: { color: COLORS.ivory, fontSize: 15, fontWeight: '600' },
  footer: { textAlign: 'center', fontSize: 12, color: COLORS.muted },
});
