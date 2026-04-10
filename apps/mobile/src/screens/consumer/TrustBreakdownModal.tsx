/**
 * apps/mobile/src/screens/consumer/TrustBreakdownModal.tsx
 * SatvAAh Phase 19 — Trust Score Breakdown Bottom Sheet
 *
 * Spec (Phase 19 prompt + GitHub structure):
 *   • @gorhom/bottom-sheet at 65% / 92% snap points
 *   • Signal table: signal / max pts / earned / status
 *   • Raw score vs display score (raw ÷ max × 100)
 *   • Customer voice bar (verification% / voice%)
 *   • Peer context percentage
 *   • BottomSheetBackdrop
 *
 * MASTER_CONTEXT: Trust tiers from trust.api.ts (single source of truth)
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import BottomSheet, { BottomSheetScrollView, BottomSheetBackdrop } from '../../__stubs__/bottom-sheet';
import type { BottomSheetBackdropProps } from '../../__stubs__/bottom-sheet';
import Svg, { Circle } from 'react-native-svg';

import { trustRingColor, trustTierLabel } from '../../api/trust.api';
import type { TrustScore, TrustSignal } from '../../api/trust.api';

// ─── Brand colours ────────────────────────────────────────────────────────────
const SAFFRON   = '#C8691A';
const VERDIGRIS = '#2E7D72';
const DEEP_INK  = '#1C1C2E';
const IVORY     = '#FAF7F0';
const MUTED     = '#9E9589';

interface Props {
  trust: TrustScore;
  providerName: string;
  onClose: () => void;
}

// ─── Static trust ring (100px) — used in breakdown modal ────────────────────────
function StaticRingWithTrust({ score, tier }: { score: number; tier: string }): React.ReactElement {
  const size   = 100;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circ   = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;
  const color  = trustRingColor(score);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size/2} cy={size/2} r={radius} stroke="#E0D9CF" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size/2} cy={size/2} r={radius}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${circ}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size/2}, ${size/2}`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.ringCenter]}>
        <Text style={[styles.ringScore, { color }]}>{score}</Text>
        <Text style={styles.ringLabel}>{tier}</Text>
      </View>
    </View>
  );
}

// ─── Signal row ───────────────────────────────────────────────────────────────
function SignalRow({ signal }: { signal: TrustSignal }): React.ReactElement {
  return (
    <View style={styles.signalRow}>
      <Text style={[styles.signalName, { flex: 2 }]}>{signal.displayName}</Text>
      <Text style={[styles.signalCell, { flex: 1, textAlign: 'center' }]}>{signal.max_pts}</Text>
      <Text style={[styles.signalCell, { flex: 1, textAlign: 'center', color: signal.is_verified ? VERDIGRIS : MUTED }]}>
        {signal.earned_pts}
      </Text>
      <Text style={[styles.signalStatus, { flex: 1, textAlign: 'right' }]}>
        {signal.is_verified ? '✓' : '○'}
      </Text>
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export function TrustBreakdownModal({ trust, providerName, onClose }: Props): React.ReactElement {
  const sheetRef  = useRef<BottomSheet>(null);
  const snapPoints = ['65%', '92%'];

  useEffect(() => {
    sheetRef.current?.expand();
  }, []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} onPress={onClose} />
    ),
    [onClose],
  );

  // Sort signals: verified first
  const sortedSignals = [...(trust.signals ?? [])].sort(
    (a, b) => Number(b.is_verified) - Number(a.is_verified),
  );

  // Raw max is sum of all signal max_pts
  const rawMax = sortedSignals.reduce((sum, s) => sum + s.max_pts, 0);

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      onClose={onClose}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.sheetBg}
    >
      <BottomSheetScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <Text style={styles.title}>How {providerName} earned {trust.displayScore}</Text>
        <Text style={styles.subtitle}>Each signal independently verified. Cannot be faked or purchased.</Text>

        {/* Ring */}
        <View style={styles.ringRow}>
          <StaticRingWithTrust score={trust.displayScore} tier={trustTierLabel(trust.trustTier)} />
        </View>

        {/* Score decomposition */}
        <View style={styles.scoreBox}>
          <View style={styles.scoreItem}>
            <Text style={styles.scoreValue}>{trust.raw_score}</Text>
            <Text style={styles.scoreCaption}>Raw total</Text>
          </View>
          <Text style={styles.scoreDivider}>÷ {rawMax} × 100</Text>
          <View style={styles.scoreItem}>
            <Text style={[styles.scoreValue, { color: trustRingColor(trust.displayScore) }]}>
              {trust.displayScore}
            </Text>
            <Text style={styles.scoreCaption}>Display score</Text>
          </View>
        </View>

        {/* Signal table */}
        <View style={styles.tableSection}>
          {/* Header row */}
          <View style={[styles.signalRow, styles.tableHeader]}>
            <Text style={[styles.tableHeaderText, { flex: 2 }]}>Signal</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'center' }]}>Max</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'center' }]}>Earned</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' }]}>Status</Text>
          </View>
          {sortedSignals.map((s, i) => (
            <SignalRow key={`${s.signalName}-${i}`} signal={s} />
          ))}
          {/* Totals row */}
          <View style={[styles.signalRow, styles.totalRow]}>
            <Text style={[styles.signalName, { flex: 2, fontWeight: '700' }]}>Total</Text>
            <Text style={[styles.signalCell, { flex: 1, textAlign: 'center', fontWeight: '700' }]}>{rawMax}</Text>
            <Text style={[styles.signalCell, { flex: 1, textAlign: 'center', fontWeight: '700', color: trustRingColor(trust.displayScore) }]}>
              {trust.raw_score}
            </Text>
            <Text style={{ flex: 1 }} />
          </View>
        </View>

        {/* Customer voice bar */}
        <View style={styles.cvSection}>
          <Text style={styles.sectionTitle}>Customer Voice Blend</Text>
          <Text style={styles.cvCaption}>
            {trust.rating_count} ratings · Customer voice grows to 70% maximum
          </Text>
          <View style={styles.cvBarTrack}>
            <View style={[styles.cvBarVerif, { flex: trust.verification_weight }]} />
            <View style={[styles.cvBarVoice, { flex: trust.customerVoiceWeight }]} />
          </View>
          <View style={styles.cvLegend}>
            <Text style={styles.cvLegendText}>
              Verification {Math.round(trust.verification_weight * 100)}%
            </Text>
            <Text style={[styles.cvLegendText, { color: VERDIGRIS }]}>
              Customer Voice {Math.round(trust.customerVoiceWeight * 100)}%
            </Text>
          </View>
        </View>

        {/* Peer context */}
        {trust.peer_context_percentage > 0 && (
          <View style={styles.peerSection}>
            <Text style={styles.peerText}>
              Scores higher than{' '}
              <Text style={{ fontWeight: '700', color: trustRingColor(trust.displayScore) }}>
                {trust.peer_context_percentage}%
              </Text>
              {' '}of providers in this category.
            </Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBg:         { backgroundColor: IVORY },
  handle:          { backgroundColor: '#C8C0B4', width: 40 },
  content:         { padding: 20 },
  title:           { fontFamily: 'PlusJakartaSans-Bold', fontSize: 18, color: DEEP_INK, marginBottom: 4 },
  subtitle:        { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: MUTED, marginBottom: 16, lineHeight: 18 },
  ringRow:         { alignItems: 'center', marginBottom: 16 },
  ringCenter:      { alignItems: 'center', justifyContent: 'center' },
  ringScore:       { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 22 },
  ringLabel:       { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: MUTED, marginTop: 2 },
  scoreBox:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 20, backgroundColor: '#fff', borderRadius: 10, padding: 14 },
  scoreItem:       { alignItems: 'center' },
  scoreValue:      { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 24, color: DEEP_INK },
  scoreCaption:    { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: MUTED, marginTop: 2 },
  scoreDivider:    { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: MUTED },
  tableSection:    { backgroundColor: '#fff', borderRadius: 10, marginBottom: 16, overflow: 'hidden' },
  tableHeader:     { backgroundColor: DEEP_INK },
  tableHeaderText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: '#fff', padding: 10 },
  signalRow:       { flexDirection: 'row', padding: 10, borderBottomWidth: 1, borderBottomColor: '#F0EDE8', alignItems: 'center' },
  signalName:      { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: DEEP_INK },
  signalCell:      { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: DEEP_INK },
  signalStatus:    { fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, color: VERDIGRIS },
  totalRow:        { backgroundColor: '#F5F5F5', borderBottomWidth: 0 },
  cvSection:       { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 12 },
  sectionTitle:    { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: DEEP_INK, marginBottom: 6 },
  cvCaption:       { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: MUTED, marginBottom: 8 },
  cvBarTrack:      { height: 10, borderRadius: 5, flexDirection: 'row', overflow: 'hidden', backgroundColor: '#EDE7DB' },
  cvBarVerif:      { backgroundColor: SAFFRON },
  cvBarVoice:      { backgroundColor: VERDIGRIS },
  cvLegend:        { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  cvLegendText:    { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: MUTED },
  peerSection:     { backgroundColor: '#E8F5F3', borderRadius: 8, padding: 12, marginBottom: 12 },
  peerText:        { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: DEEP_INK, lineHeight: 20 },
});
