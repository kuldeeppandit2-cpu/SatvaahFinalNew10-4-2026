import React, { useState } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Linking, Alert, ScrollView, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createContactEvent } from '../../api/contact.api';
import { trustRingColor } from '../../api/trust.api';
import { useConsumerStore } from '../../stores/consumer.store';
import type { ConsumerStackParamList } from '../../navigation/types';

const VERDIGRIS  = '#2E7D72';
const DEEP_INK   = '#1C1C2E';
const IVORY      = '#FAF7F0';
const TERRACOTTA = '#C0392B';
const MUTED      = '#9E9589';
const WARM_SAND  = '#F0E4CC';

type NavProp = NativeStackNavigationProp<ConsumerStackParamList, 'ContactCall'>;

export function ContactCallScreen(): React.ReactElement {
  const navigation = useNavigation<NavProp>();
  const route      = useRoute<any>();
  const { providerId, providerName, providerPhone, providerScore, providerTier, topSignals } = route.params as {
    providerId: string; providerName: string; providerPhone?: string;
    providerScore?: number; providerTier?: string; topSignals?: string[];
  };

  const [loading, setLoading] = useState(false);
  const phone = (providerPhone && providerPhone !== 'null') ? providerPhone.trim() : '';
  const leadCost = 0;
  const leadsRemaining = useConsumerStore((s) => s.leadBalance);
  const tierColor = trustRingColor(providerScore ?? 75);
  const initial = providerName ? providerName.charAt(0).toUpperCase() : '?';

  async function handleCall() {
    if (loading) return;
    setLoading(true);
    try {
      const event = await createContactEvent({ providerId, contactType: 'call' });
      const rawPhone = event.provider_phone || phone;
      const dialPhone = (rawPhone && rawPhone !== 'null' && rawPhone.trim().length > 5)
        ? rawPhone.trim() : null;
      if (!dialPhone) {
        Alert.alert('Phone unavailable', 'This provider has not listed a phone number.',
          [{ text: 'OK', onPress: () => navigation.goBack() }]);
        return;
      }
      await Linking.openURL(`tel:${dialPhone}`);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not connect. Please try again.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }

  const signals = topSignals ?? [];

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={IVORY} />
      <ScreenHeader title="Call Provider" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Provider avatar + name */}
        <View style={s.heroBlock}>
          <View style={[s.avatar, { borderColor: tierColor }]}>
            <Text style={s.avatarInitial}>{initial}</Text>
          </View>
          <Text style={s.providerName}>{providerName}</Text>
          {providerTier && (
            <Text style={[s.tierLabel, { color: tierColor }]}>{providerTier}</Text>
          )}
        </View>

        {/* Trust signals */}
        <View style={s.signalCard}>
          <View style={s.signalRow}>
            <Ionicons name="flash" size={16} color={VERDIGRIS} />
            <Text style={s.signalText}>Responds quickly · Verified provider</Text>
          </View>
          {signals.map((sig, i) => (
            <View key={i} style={s.signalRow}>
              <Ionicons name="checkmark-circle" size={16} color={VERDIGRIS} />
              <Text style={s.signalText}>{sig}</Text>
            </View>
          ))}
        </View>

        {/* Phone number */}
        {phone ? (
          <View style={s.phoneCard}>
            <Text style={s.phoneLabel}>Phone number</Text>
            <Text selectable style={s.phoneNumber}>{phone}</Text>
            <Text style={s.phoneNote}>
              {providerName} will see your contact details when they accept.
            </Text>
          </View>
        ) : (
          <View style={s.phoneCard}>
            <Text style={s.phoneNote}>Phone number will be available after you initiate the call.</Text>
          </View>
        )}

        {/* Lead warning */}
        {leadCost > 0 && leadsRemaining <= 2 && (
          <View style={s.warningCard}>
            <Ionicons name="warning" size={16} color={TERRACOTTA} />
            <Text style={s.warningText}>
              Only {leadsRemaining} lead{leadsRemaining === 1 ? '' : 's'} remaining this month.
            </Text>
          </View>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[s.callBtn, loading && s.callBtnDisabled]}
          onPress={handleCall}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color={IVORY} />
            : <>
                <Ionicons name="call" size={22} color={IVORY} />
                <Text style={s.callBtnText}>Call {providerName}</Text>
              </>
          }
        </TouchableOpacity>

        <TouchableOpacity style={s.cancelBtn} onPress={() => navigation.goBack()}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: IVORY },
  scroll:         { paddingHorizontal: 24, paddingBottom: 40 },

  heroBlock:      { alignItems: 'center', paddingVertical: 32 },
  avatar:         { width: 88, height: 88, borderRadius: 44, borderWidth: 3,
                    backgroundColor: WARM_SAND, alignItems: 'center', justifyContent: 'center',
                    marginBottom: 16 },
  avatarInitial:  { fontSize: 36, fontWeight: '700', color: DEEP_INK },
  providerName:   { fontSize: 22, fontWeight: '700', color: DEEP_INK, marginBottom: 4 },
  tierLabel:      { fontSize: 13, fontWeight: '500', marginTop: 2 },

  signalCard:     { backgroundColor: VERDIGRIS, borderRadius: 14, padding: 16,
                    marginBottom: 16, gap: 8 },
  signalRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  signalText:     { fontSize: 14, color: '#fff', fontWeight: '500', flex: 1 },

  phoneCard:      { backgroundColor: '#fff', borderRadius: 14, padding: 20,
                    alignItems: 'center', marginBottom: 16,
                    borderWidth: 1, borderColor: '#E8E0D5' },
  phoneLabel:     { fontSize: 12, color: MUTED, marginBottom: 6 },
  phoneNumber:    { fontSize: 26, fontWeight: '800', color: DEEP_INK, letterSpacing: 1.5,
                    marginBottom: 8 },
  phoneNote:      { fontSize: 12, color: MUTED, textAlign: 'center', lineHeight: 18 },

  warningCard:    { flexDirection: 'row', alignItems: 'center', gap: 8,
                    backgroundColor: '#FFF4F4', borderRadius: 10, padding: 12,
                    marginBottom: 16 },
  warningText:    { fontSize: 13, color: TERRACOTTA, fontWeight: '500', flex: 1 },

  callBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 10, backgroundColor: VERDIGRIS, borderRadius: 14,
                    height: 56, marginBottom: 12 },
  callBtnDisabled:{ opacity: 0.6 },
  callBtnText:    { fontSize: 17, fontWeight: '700', color: IVORY },

  cancelBtn:      { alignItems: 'center', paddingVertical: 12 },
  cancelText:     { fontSize: 15, color: MUTED, fontWeight: '500' },
});
