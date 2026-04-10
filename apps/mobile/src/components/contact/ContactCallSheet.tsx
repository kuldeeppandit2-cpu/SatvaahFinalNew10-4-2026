/**
 * ContactCallSheet.tsx
 * SatvAAh — Phase 25 · Shared UI Components
 *
 * Bottom sheet for initiating a call contact event.
 * POST /api/v1/contact-events { contactType: 'call', provider_id }
 * Provider phone revealed only on accept (BUSINESS RULE).
 * Until then shows "SatvAAh connects you" message.
 *
 * Uses @gorhom/bottom-sheet for gesture-driven sheet.
 */

import React, { useCallback, useRef } from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '../../__stubs__/bottom-sheet';
import Avatar from '../common/Avatar';
import TrustBadge from '../trust/TrustBadge';
import TrustRing from '../trust/TrustRing';

const VERDIGRIS = '#2E7D72';
const SAFFRON   = '#C8691A';
const DEEP_INK  = '#1C1C2E';
const IVORY     = '#FAF7F0';

// ─── Props ────────────────────────────────────────────────────────────────────
interface ContactCallSheetProps {
  /** BottomSheet ref exposed by parent */
  sheetRef:       React.RefObject<BottomSheet>;
  providerName:   string;
  providerCategory: string;
  providerPhotoUrl?: string;
  providerTrustScore: number;
  /** Phone revealed after accept — null before accept */
  revealedPhone?: string | null;
  leadsRemaining: number;
  onConfirm:      () => Promise<void>;   // POST contact-event
  onDismiss?:     () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
const ContactCallSheet: React.FC<ContactCallSheetProps> = ({
  sheetRef,
  providerName,
  providerCategory,
  providerPhotoUrl,
  providerTrustScore,
  revealedPhone,
  leadsRemaining,
  onConfirm,
  onDismiss,
}) => {
  const snapPoints = ['48%'];

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
      />
    ),
    []
  );

  const handleCall = () => {
    if (revealedPhone) {
      Linking.openURL(`tel:${revealedPhone}`);
    }
  };

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
    >
      <BottomSheetView style={styles.content}>
        {/* Provider header */}
        <View style={styles.providerRow}>
          <Avatar name={providerName} photoUrl={providerPhotoUrl} size={56} />
          <View style={styles.providerInfo}>
            <Text style={styles.providerName}>{providerName}</Text>
            <Text style={styles.providerCat}>{providerCategory}</Text>
            <TrustBadge score={providerTrustScore} variant="compact" />
          </View>
          <TrustRing score={providerTrustScore} size={60} animated={false} />
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* How it works note */}
        <View style={styles.infoBox}>
          <Text style={styles.infoIcon}>📞</Text>
          <Text style={styles.infoText}>
            {revealedPhone
              ? 'Phone number revealed. You can call directly.'
              : `SatvAAh will request ${providerName}'s contact. You'll be connected once they accept.`}
          </Text>
        </View>

        {/* Lead counter warning */}
        {leadsRemaining <= 5 && (
          <View style={styles.leadWarning}>
            <Text style={styles.leadWarningText}>
              ⚠️  {leadsRemaining} contact{leadsRemaining !== 1 ? 's' : ''} remaining this month
            </Text>
          </View>
        )}

        {/* CTA */}
        {revealedPhone ? (
          <TouchableOpacity style={styles.callCta} onPress={handleCall} activeOpacity={0.85}>
            <Text style={styles.callCtaText}>📞  Call {providerName}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.requestCta} onPress={onConfirm} activeOpacity={0.85}>
            <Text style={styles.requestCtaText}>Send Call Request</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.zeroCommission}>Zero commission. Always.</Text>
      </BottomSheetView>
    </BottomSheet>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  handle: {
    backgroundColor: '#D1C9BC',
    width:           40,
  },
  sheetBg: {
    backgroundColor: IVORY,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop:        8,
    paddingBottom:     32,
    gap:               14,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
  },
  providerInfo: {
    flex: 1,
    gap:  3,
  },
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
  divider: {
    height:          1,
    backgroundColor: '#E8E0D4',
  },
  infoBox: {
    flexDirection:    'row',
    alignItems:       'flex-start',
    backgroundColor:  VERDIGRIS + '0F',
    borderRadius:     12,
    padding:          12,
    gap:              10,
  },
  infoIcon: {
    fontSize: 20,
  },
  infoText: {
    flex:       1,
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      '#4A4642',
    lineHeight: 19,
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
  requestCta: {
    backgroundColor:   SAFFRON,
    borderRadius:      28,
    paddingVertical:   16,
    alignItems:        'center',
  },
  requestCtaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   16,
    color:      '#FFFFFF',
  },
  callCta: {
    backgroundColor:   VERDIGRIS,
    borderRadius:      28,
    paddingVertical:   16,
    alignItems:        'center',
  },
  callCtaText: {
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

export default ContactCallSheet;
