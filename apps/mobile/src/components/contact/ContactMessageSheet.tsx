/**
 * ContactMessageSheet.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Bottom sheet for sending a message contact event.
 * POST /api/v1/contact-events { contactType: 'message', provider_id, initial_message? }
 * Includes optional message compose area for initial message text.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from '../../__stubs__/bottom-sheet';
import Avatar from '../common/Avatar';
import TrustBadge from '../trust/TrustBadge';

const VERDIGRIS = '#2E7D72';
const SAFFRON   = '#C8691A';
const DEEP_INK  = '#1C1C2E';
const IVORY     = '#FAF7F0';
const WARM_SAND = '#F0E4CC';

const QUICK_MESSAGES = [
  'What are your rates?',
  'Are you available today?',
  'Can you visit my home?',
  'Please send me a quote',
];

// ─── Props ────────────────────────────────────────────────────────────────────
interface ContactMessageSheetProps {
  sheetRef:           React.RefObject<BottomSheet>;
  providerName:       string;
  providerCategory:   string;
  providerPhotoUrl?:  string;
  providerTrustScore: number;
  leadsRemaining:     number;
  onConfirm:          (message?: string) => Promise<void>;
  onDismiss?:         () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
const ContactMessageSheet: React.FC<ContactMessageSheetProps> = ({
  sheetRef,
  providerName,
  providerCategory,
  providerPhotoUrl,
  providerTrustScore,
  leadsRemaining,
  onConfirm,
  onDismiss,
}) => {
  const [message, setMessage]   = useState('');
  const [loading, setLoading]   = useState(false);
  const snapPoints = Platform.OS === 'ios' ? ['62%'] : ['68%'];

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ),
    []
  );

  const handleSend = async () => {
    setLoading(true);
    try {
      await onConfirm(message.trim() || undefined);
    } finally {
      setLoading(false);
    }
  };

  const selectQuick = (q: string) => setMessage(q);

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onClose={onDismiss}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.sheetBg}
      keyboardBehavior="extend"
    >
      <BottomSheetScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Provider row */}
        <View style={styles.providerRow}>
          <Avatar name={providerName} photoUrl={providerPhotoUrl} size={52} />
          <View style={styles.providerInfo}>
            <Text style={styles.providerName}>{providerName}</Text>
            <Text style={styles.providerCat}>{providerCategory}</Text>
            <TrustBadge score={providerTrustScore} variant="compact" />
          </View>
        </View>

        <View style={styles.divider} />

        {/* Quick messages */}
        <Text style={styles.sectionLabel}>Quick message</Text>
        <View style={styles.quickWrap}>
          {QUICK_MESSAGES.map((q) => (
            <TouchableOpacity
              key={q}
              style={[styles.quickPill, message === q && styles.quickPillActive]}
              onPress={() => selectQuick(q)}
            >
              <Text
                style={[styles.quickText, message === q && styles.quickTextActive]}
              >
                {q}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom message */}
        <Text style={styles.sectionLabel}>Or write your own</Text>
        <TextInput
          style={styles.textInput}
          value={message}
          onChangeText={setMessage}
          placeholder={`Hi ${providerName.split(' ')[0]}, I'd like to…`}
          placeholderTextColor="#A89E92"
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          maxLength={500}
        />
        <Text style={styles.charCount}>{message.length}/500</Text>

        {/* Lead warning */}
        {leadsRemaining <= 5 && (
          <View style={styles.leadWarning}>
            <Text style={styles.leadWarningText}>
              ⚠️  {leadsRemaining} contact{leadsRemaining !== 1 ? 's' : ''} remaining this month
            </Text>
          </View>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[styles.sendCta, loading && styles.sendCtaDisabled]}
          onPress={handleSend}
          disabled={loading}
          activeOpacity={0.85}
        >
          <Text style={styles.sendCtaText}>
            {loading ? 'Sending…' : `Message ${providerName.split(' ')[0]}`}
          </Text>
        </TouchableOpacity>

        <Text style={styles.zeroCommission}>Zero commission. Always.</Text>
      </BottomSheetScrollView>
    </BottomSheet>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  handle: { backgroundColor: '#D1C9BC', width: 40 },
  sheetBg: {
    backgroundColor:      IVORY,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop:        10,
    paddingBottom:     40,
    gap:               12,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
  },
  providerInfo: { flex: 1, gap: 3 },
  providerName: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   16,
    color:      DEEP_INK,
  },
  providerCat: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      '#9E9890',
  },
  divider: { height: 1, backgroundColor: '#E8E0D4' },
  sectionLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
    color:      '#9E9890',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  quickWrap: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           8,
  },
  quickPill: {
    borderWidth:      1,
    borderColor:      '#D1C9BC',
    borderRadius:     20,
    paddingHorizontal: 12,
    paddingVertical:   7,
  },
  quickPillActive: {
    backgroundColor: SAFFRON,
    borderColor:     SAFFRON,
  },
  quickText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      DEEP_INK,
  },
  quickTextActive: {
    color:      '#FFFFFF',
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  textInput: {
    backgroundColor:  WARM_SAND,
    borderRadius:     12,
    padding:          12,
    fontFamily:       'PlusJakartaSans-Regular',
    fontSize:         14,
    color:            DEEP_INK,
    minHeight:        88,
  },
  charCount: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#C4BCB4',
    alignSelf:  'flex-end',
  },
  leadWarning: {
    backgroundColor: '#FEF3C7',
    borderRadius:    10,
    padding:         10,
  },
  leadWarningText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   12,
    color:      '#92400E',
  },
  sendCta: {
    backgroundColor: SAFFRON,
    borderRadius:    28,
    paddingVertical: 16,
    alignItems:      'center',
  },
  sendCtaDisabled: { opacity: 0.6 },
  sendCtaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   16,
    color:      '#FFFFFF',
  },
  zeroCommission: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   11,
    color:      '#C4BCB4',
    textAlign:  'center',
  },
});

export default ContactMessageSheet;
