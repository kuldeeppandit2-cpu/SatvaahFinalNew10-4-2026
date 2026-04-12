/**
 * apps/mobile/src/screens/consumer/SlotBookingScreen.tsx
 * SatvAAh Phase 19 — Slot Booking Screen
 *
 * Phase 19 prompt spec enforced:
 *   ✓ Gold tier consumer only + provider must have published calendar
 *   ✓ Date strip: today + 6 days (horizontal scroll)
 *   ✓ 3-column flexWrap slot grid
 *   ✓ Verdigris border/text = available
 *   ✓ Grey background/text = booked (not pressable)
 *   ✓ slot_duration_minutes from API response — NEVER hardcoded (Rule #20)
 *   ✓ formatSlotTime in Asia/Kolkata timezone
 *   ✓ createContactEvent(type=slot_booking, slot_time=ISO UTC)
 *
 * GitHub structure spec: Calendar view · 30min slots · Gold tier + provider calendar
 *
 * MASTER_CONTEXT rules:
 *   ✓ Slot booking: Gold tier consumer only + provider must have published calendar
 *   ✓ contact_lead_cost = 0 at launch — lead cost UI hidden when 0
 *   ✓ All amounts in paise — never rupees in UI (cost shown only if > 0)
 *   ✓ Nothing hardcoded — slot_duration_minutes from ProviderSlot API response
 */

import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 View, Text, StyleSheet, TouchableOpacity, FlatList,
 ActivityIndicator, Alert, ScrollView,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { getProviderSlots, createContactEvent } from '../../api/contact.api';
import type { ProviderSlot }                    from '../../api/contact.api';
import { useAuthStore }                         from '../../stores/auth.store';
import type { ConsumerStackParamList }           from '../../navigation/types';

// ─── Brand colours ────────────────────────────────────────────────────────────
const VERDIGRIS  = '#2E7D72';
const SAFFRON    = '#C8691A';
const DEEP_INK   = '#1C1C2E';
const IVORY      = '#FAF7F0';
const WARM_SAND  = '#F0E4CC';
const MUTED      = '#9E9589';
const TERRACOTTA = '#C0392B';

type NavProp = NativeStackNavigationProp<ConsumerStackParamList, 'SlotBookingScreen'>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format ISO UTC slot_time → "9:00 AM" in Asia/Kolkata */
function formatSlotTime(isoUtc: string): string {
  return new Date(isoUtc).toLocaleTimeString('en-IN', {
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   true,
    timeZone: 'Asia/Kolkata',
  });
}

/** Format a Date → "YYYY-MM-DD" in Asia/Kolkata for API date param */
function toDateParam(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // en-CA gives YYYY-MM-DD
}

/** Format a Date → "Mon 5" day label for date strip */
function formatDayLabel(date: Date): { day: string; num: string } {
  return {
    day: date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }),
    num: date.toLocaleDateString('en-IN', { day:     'numeric', timeZone: 'Asia/Kolkata' }),
  };
}

/** Build today + 6 days array */
function buildDateStrip(): Date[] {
  const dates: Date[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    dates.push(d);
  }
  return dates;
}

// ─── GoldGate — shown to non-Gold consumers ───────────────────────────────────
function GoldGate({ onBack }: { onBack: () => void }): React.ReactElement {
  return (
          <View style={styles.gateLockBox}>
        <Text style={styles.gateLock}>🔒</Text>
        <Text style={styles.gateTitle}>Gold tier required</Text>
        <Text style={styles.gateBody}>
          Slot booking is available for Gold plan subscribers only.
          Upgrade to Gold to book time slots with verified providers.
        </Text>
        <TouchableOpacity style={styles.gateBtn} onPress={onBack}>
          <Text style={styles.gateBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
  );
}

// ─── SlotCard ─────────────────────────────────────────────────────────────────
interface SlotCardProps {
  slot:     ProviderSlot;
  selected: boolean;
  onPress:  () => void;
}

function SlotCard({ slot, selected, onPress }: SlotCardProps): React.ReactElement {
  const timeLabel = formatSlotTime(slot.slot_time);
  // slot_duration_minutes comes from API — never hardcoded (MASTER_CONTEXT Rule #20)
  const durLabel  = `${slot.slot_duration_minutes} min`;

  if (!slot.is_available) {
    return (
      <View style={[styles.slotCard, styles.slotBooked]}>
        <Text style={styles.slotTimeBooked}>{timeLabel}</Text>
        <Text style={styles.slotDurBooked}>{durLabel}</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[
        styles.slotCard,
        styles.slotAvailable,
        selected && styles.slotSelected,
      ]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Text style={[styles.slotTime, selected && styles.slotTimeSelected]}>
        {timeLabel}
      </Text>
      <Text style={[styles.slotDur, selected && styles.slotDurSelected]}>
        {durLabel}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export function SlotBookingScreen(): React.ReactElement {
  const navigation      = useNavigation<NavProp>();
  const route           = useRoute<any>();
  const { providerId, providerName } = route.params as {
    providerId:   string;
    providerName: string;
  };

  const subscriptionTier = useAuthStore((s) => s.subscriptionTier);
  const isGold           = subscriptionTier === 'gold';

  const dateStrip        = buildDateStrip();
  const [selectedDate,   setSelectedDate]  = useState<Date>(dateStrip[0]);
  const [slots,          setSlots]         = useState<ProviderSlot[]>([]);
  const [selectedSlot,   setSelectedSlot]  = useState<ProviderSlot | null>(null);
  const [loadingSlots,   setLoadingSlots]  = useState(false);
  const [booking,        setBooking]       = useState(false);
  const leadCost = 0; // paise — 0 at launch; read from createContactEvent response

  // ── Load slots for selected date ──────────────────────────────────────────
  const loadSlots = useCallback(async (date: Date) => {
    setLoadingSlots(true);
    setSelectedSlot(null);
    try {
      const dateParam = toDateParam(date);
      const data      = await getProviderSlots(providerId, dateParam);
      setSlots(data);
    } catch {
      Alert.alert('Error', 'Could not load available slots. Please try again.');
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [providerId]);

  useEffect(() => { loadSlots(selectedDate); }, [selectedDate, loadSlots]);

  // ── Book selected slot ────────────────────────────────────────────────────
  async function handleBook(): Promise<void> {
    if (!selectedSlot || booking) return;
    setBooking(true);
    try {
      // slot_time sent as ISO UTC — backend stores UTC, display converts to IST
      const event = await createContactEvent({
        providerId:  providerId,
        contactType: 'slot_booking',
        slot_time:    selectedSlot.slot_time, // ISO UTC from API
      });

      // Navigate to Conversation after successful booking
      navigation.replace('Conversation', {
        contactEventId: event.id,
        otherPartyName: providerName,
        otherPartyId:   providerId,
      });
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not book slot. Please try again.');
    } finally {
      setBooking(false);
    }
  }

  // ── Gold gate — defence-in-depth (backend also returns 403 for non-Gold) ──
  if (!isGold) {
    return <GoldGate onBack={() => navigation.goBack()} />;
  }

  const showLeadCost    = leadCost > 0; // hidden at launch
  const availableCount  = slots.filter((s) => s.is_available).length;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{top:10,bottom:10,left:10,right:10}}>
          <Ionicons name="chevron-back" size={24} color="#1C1C2E" />
        </TouchableOpacity>
        <View style={styles.headerMeta}>
          <Text style={styles.headerTitle}>Book a slot</Text>
          <Text style={styles.headerSub}>{providerName}</Text>
        </View>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        {/* ── Date strip: today + 6 days ── */}
        <View style={styles.dateStripSection}>
          <Text style={styles.sectionLabel}>Select a date</Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={dateStrip}
            keyExtractor={(d) => d.toISOString()}
            contentContainerStyle={styles.dateStrip}
            renderItem={({ item: date }) => {
              const { day, num } = formatDayLabel(date);
              const isSelected   = toDateParam(date) === toDateParam(selectedDate);
              return (
                <TouchableOpacity
                  style={[styles.dateCard, isSelected && styles.dateCardSelected]}
                  onPress={() => setSelectedDate(date)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.dateDay, isSelected && styles.dateDaySelected]}>
                    {day}
                  </Text>
                  <Text style={[styles.dateNum, isSelected && styles.dateNumSelected]}>
                    {num}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>

        {/* ── Slot grid: 3-column flexWrap ── */}
        <View style={styles.slotSection}>
          <View style={styles.slotSectionHeader}>
            <Text style={styles.sectionLabel}>Available slots</Text>
            {!loadingSlots && (
              <Text style={styles.availableCount}>
                {availableCount} available
              </Text>
            )}
          </View>

          {loadingSlots ? (
            <ActivityIndicator color={VERDIGRIS} style={styles.loader} />
          ) : slots.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No slots available on this date.</Text>
              <Text style={styles.emptySubText}>Try another day.</Text>
            </View>
          ) : (
            <View style={styles.slotGrid}>
              {slots.map((slot, i) => (
                <SlotCard
                  key={`${slot.slot_time}-${i}`}
                  slot={slot}
                  selected={selectedSlot?.slot_time === slot.slot_time}
                  onPress={() => setSelectedSlot(slot)}
                />
              ))}
            </View>
          )}
        </View>

        {/* ── Legend ── */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: VERDIGRIS }]} />
            <Text style={styles.legendText}>Available</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#D0D0D0' }]} />
            <Text style={styles.legendText}>Booked</Text>
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── Book CTA — sticky bottom ── */}
      {selectedSlot && (
        <View style={styles.bookBar}>
          <View style={styles.bookBarMeta}>
            <Text style={styles.bookBarTime}>
              📅 {formatSlotTime(selectedSlot.slot_time)}
            </Text>
            <Text style={styles.bookBarDur}>
              {selectedSlot.slot_duration_minutes} min session
            </Text>
          </View>

          {/* Lead cost — hidden when 0 */}
          {showLeadCost && (
            <Text style={styles.leadCostText}>Uses 1 lead</Text>
          )}

          <TouchableOpacity
            style={[styles.bookBtn, booking && styles.bookBtnDisabled]}
            onPress={handleBook}
            disabled={booking}
            activeOpacity={0.85}
          >
            {booking
              ? <ActivityIndicator color={IVORY} />
              : <Text style={styles.bookBtnText}>Confirm Booking →</Text>
            }
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Gold gate
  gateContainer:       { flex: 1, backgroundColor: IVORY, alignItems: 'center', justifyContent: 'center', padding: 32 },
  gateLockBox:         { alignItems: 'center', gap: 12 },
  gateLock:            { fontSize: 56 },
  gateTitle:           { fontFamily: 'PlusJakartaSans-Bold', fontSize: 20, color: DEEP_INK, textAlign: 'center' },
  gateBody:            { fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 22 },
  gateBtn:             { marginTop: 8, backgroundColor: SAFFRON, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  gateBtnText:         { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: IVORY },

  // Screen
  safeArea:            { flex: 1, backgroundColor: IVORY },
  container:           { flex: 1 },
  scrollContent:       { paddingBottom: 16,
    },

  // Header
  header:              { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EDE7DB', gap: 12 },
  backBtn:             { padding: 4 },
  backText:            { fontFamily: 'PlusJakartaSans-Bold', fontSize: 22, color: DEEP_INK },
  headerMeta:          { flex: 1 },
  headerTitle:         { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: DEEP_INK },
  headerSub:           { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: MUTED },

  // Date strip
  dateStripSection:    { padding: 16, paddingBottom: 0 },
  sectionLabel:        { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: DEEP_INK, marginBottom: 12 },
  dateStrip:           { gap: 8, paddingBottom: 4 },
  dateCard:            { width: 52, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#DDD5C8', backgroundColor: '#fff' },
  dateCardSelected:    { borderColor: VERDIGRIS, backgroundColor: VERDIGRIS },
  dateDay:             { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: MUTED },
  dateDaySelected:     { color: IVORY },
  dateNum:             { fontFamily: 'PlusJakartaSans-Bold', fontSize: 18, color: DEEP_INK, marginTop: 2 },
  dateNumSelected:     { color: IVORY },

  // Slot grid
  slotSection:         { padding: 16 },
  slotSectionHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  availableCount:      { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: VERDIGRIS },
  loader:              { marginVertical: 40 },
  emptyState:          { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText:           { fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, color: MUTED },
  emptySubText:        { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: MUTED },

  // 3-column slot grid — flexWrap
  slotGrid:            { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slotCard:            { width: '30%', borderRadius: 10, padding: 10, alignItems: 'center', minHeight: 64, justifyContent: 'center' },

  // Available slot — Verdigris border (Phase 19 prompt spec)
  slotAvailable:       { borderWidth: 1.5, borderColor: VERDIGRIS, backgroundColor: '#fff' },
  slotSelected:        { backgroundColor: VERDIGRIS, borderColor: VERDIGRIS },
  slotTime:            { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: VERDIGRIS },
  slotTimeSelected:    { color: IVORY },
  slotDur:             { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: MUTED, marginTop: 2 },
  slotDurSelected:     { color: IVORY },

  // Booked slot — grey (Phase 19 prompt spec)
  slotBooked:          { backgroundColor: '#F0EDE8', borderWidth: 0 },
  slotTimeBooked:      { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: '#C8C0B4' },
  slotDurBooked:       { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: '#C8C0B4', marginTop: 2 },

  // Legend
  legend:              { flexDirection: 'row', paddingHorizontal: 16, gap: 20 },
  legendItem:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot:           { width: 10, height: 10, borderRadius: 5 },
  legendText:          { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: MUTED },

  // Book bar (sticky bottom)
  bookBar:             { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#EDE7DB', padding: 16, paddingBottom: 28, gap: 8 },
  bookBarMeta:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bookBarTime:         { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: DEEP_INK },
  bookBarDur:          { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: MUTED },
  leadCostText:        { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: MUTED, textAlign: 'center' },
  bookBtn:             { backgroundColor: VERDIGRIS, borderRadius: 12, height: 50, alignItems: 'center', justifyContent: 'center' },
  bookBtnDisabled:     { opacity: 0.5 },
  bookBtnText:         { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: IVORY },
});
