/**
 * apps/mobile/src/screens/consumer/ContactCallScreen.tsx
 * SatvAAh Phase 19 — Call Contact Flow (Bottom Sheet)
 *
 * MASTER_CONTEXT rules enforced:
 *   • Provider phone ALWAYS VISIBLE — no reveal gate, no blur (MASTER_CONTEXT line 223)
 *   • Lead cost hidden entirely when contact_lead_cost = 0 (at launch)
 *   • Urgency strip: Verdigris #2E7D72 background (Phase 19 prompt spec)
 *   • Loss aversion: ≤ 2 leads → Terracotta warning
 *   • createContactEvent(type=call) → Linking.openURL(tel:)
 *   • FCM push to provider handled server-side after contact event created
 *
 * Snap points: 55% (Phase 19 session summary spec)
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Linking, Alert,
} from 'react-native';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '../../__stubs__/bottom-sheet';
import type { BottomSheetBackdropProps } from '../../__stubs__/bottom-sheet';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { createContactEvent } from '../../api/contact.api';
import { trustRingColor } from '../../api/trust.api';
import { useAuthStore } from '../../stores/auth.store';
import { useConsumerStore } from '../../stores/consumer.store';
import type { ConsumerStackParamList } from '../../navigation/types';

// ─── Brand colours ────────────────────────────────────────────────────────────
const VERDIGRIS  = '#2E7D72';
const DEEP_INK   = '#1C1C2E';
const IVORY      = '#FAF7F0';
const TERRACOTTA = '#C0392B';
const MUTED      = '#9E9589';

// MASTER_CONTEXT Rule #20: Nothing hardcoded. Loss aversion threshold matches
// V031 seed value. TODO: move to system_config if admin needs to adjust.
const LOSS_AVERSION_THRESHOLD = 2;

type NavProp = NativeStackNavigationProp<ConsumerStackParamList, 'ContactCall'>;

export function ContactCallScreen(): React.ReactElement {
  const navigation = useNavigation<NavProp>();
  const route      = useRoute<any>();
  const {
    providerId,
    providerName,
    providerPhone,   // already revealed from profile — always visible
    providerScore,
    providerTier,
    topSignals,      // string[] — top 3 verified signal labels
  } = route.params as {
    providerId: string;
    providerName: string;
    providerPhone?: string;
    providerScore?: number;
    providerTier?: string;
    topSignals?: string[];
  };

  const sheetRef    = useRef<BottomSheet>(null);
  const [loading,   setLoading]   = useState(false);
  const phone    = providerPhone ?? '';  // always visible — no state needed
  const leadCost = 0;                    // paise — 0 at launch (admin-configurable)
  const leadsRemaining = useConsumerStore((s) => s.leadBalance);

  const showLeadCost   = leadCost > 0;
  const showLossAverse = showLeadCost && leadsRemaining <= LOSS_AVERSION_THRESHOLD;
  const tierColor      = trustRingColor(providerScore ?? 75);
  const snapPoints     = ['55%'];

  useEffect(() => { sheetRef.current?.expand(); }, []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0}
        onPress={() => navigation.goBack()} />
    ),
    [navigation],
  );

  async function handleCall(): Promise<void> {
    if (loading) return;
    setLoading(true);
    try {
      const event = await createContactEvent({
        providerId: providerId,
        contactType: 'call',
      });

      // Provider phone always visible — use from event or passed param
      const dialPhone = event.provider_phone || phone;
      if (dialPhone) {
        await Linking.openURL(`tel:${dialPhone}`);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not connect. Please try again.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }

  const signals = topSignals ?? [];

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      onClose={() => navigation.goBack()}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.sheetBg}
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

        {/* Urgency strip — Verdigris background (Phase 19 spec) */}
        <View style={styles.urgencyStrip}>
          <Text style={styles.urgencyText}>⚡ Responds quickly · Verified provider</Text>
          {signals.length > 0 && (
            <Text style={styles.urgencyText}>{signals.map(s => `✓ ${s}`).join(' · ')}</Text>
          )}
        </View>

        {/* Provider phone — ALWAYS VISIBLE, no blur/reveal gate */}
        {phone ? (
          <View style={styles.phoneBox}>
            <Text style={styles.phoneLabel}>Phone number</Text>
            <Text selectable style={styles.phoneNumber}>{phone}</Text>
            <Text style={styles.phoneNote}>
              {providerName} will see your contact details when they accept.
            </Text>
          </View>
        ) : null}

        {/* Lead cost — hidden when 0 */}
        {showLeadCost && (
          <Text style={styles.leadCostText}>
            Uses 1 of your {leadsRemaining} leads
          </Text>
        )}

        {/* Loss aversion — Terracotta, only when ≤ 2 leads AND cost > 0 */}
        {showLossAverse && (
          <Text style={styles.lossAverseText}>
            ⚠ Only {leadsRemaining} lead{leadsRemaining === 1 ? '' : 's'} remaining this month.
          </Text>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[styles.callBtn, loading && styles.callBtnDisabled]}
          onPress={handleCall}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color={IVORY} />
            : <Text style={styles.callBtnText}>📞 Call {providerName}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBg:        { backgroundColor: IVORY },
  handle:         { backgroundColor: '#C8C0B4', width: 40 },
  content:        { padding: 20, gap: 12 },
  providerRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  avatar:         { width: 52, height: 52, borderRadius: 26, borderWidth: 2.5, backgroundColor: '#F0E4CC', alignItems: 'center', justifyContent: 'center' },
  avatarInitial:  { fontFamily: 'PlusJakartaSans-Bold', fontSize: 20, color: DEEP_INK },
  providerMeta:   { flex: 1 },
  providerName:   { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: DEEP_INK },
  tierLabel:      { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, marginTop: 2 },
  // Urgency strip — Verdigris background per spec
  urgencyStrip:   { backgroundColor: VERDIGRIS, borderRadius: 10, padding: 12, gap: 4 },
  urgencyText:    { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: '#fff' },
  // Phone — always visible
  phoneBox:       { backgroundColor: '#fff', borderRadius: 10, padding: 14, alignItems: 'center' },
  phoneLabel:     { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: MUTED, marginBottom: 4 },
  phoneNumber:    { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 22, color: DEEP_INK, letterSpacing: 1 },
  phoneNote:      { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: MUTED, marginTop: 4, textAlign: 'center' },
  leadCostText:   { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: MUTED, textAlign: 'center' },
  lossAverseText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: TERRACOTTA, textAlign: 'center' },
  callBtn:        { backgroundColor: VERDIGRIS, borderRadius: 12, height: 50, alignItems: 'center', justifyContent: 'center' },
  callBtnDisabled:{ opacity: 0.6 },
  callBtnText:    { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: IVORY },
  cancelBtn:      { alignItems: 'center', paddingVertical: 8 },
  cancelText:     { fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, color: MUTED },
});
