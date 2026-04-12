/**
 * AvailabilityScreen.tsx
 * SatvAAh · Phase 23 · Provider Availability
 *
 * Simple mode (all tiers):     Available Now / By Appointment / Unavailable
 * Schedule mode (Bronze+ only): weekly grid Mon-Sun × 30min slots (8am–9:30pm)
 * Do Not Disturb:               10pm–8am default. OTP + trust alerts bypass always.
 *
 * PUT /api/v1/providers/me/availability broadcasts via /availability WS namespace.
 * Consumer sees status change within 1 second.
 */

import { ScreenHeader } from '../../components/ScreenHeader';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../stores/auth.store';
import {
  getAvailabilitySchedule,
  saveAvailabilitySchedule,
  updateAvailability,
  putMySchedule,
} from '../../api/provider.api';

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = {
  saffron:     '#C8691A',
  deepInk:     '#1C1C2E',
  ivory:       '#FAF7F0',
  verdigris:   '#2E7D72',
  ltVerdigris: '#6BA89E',
  warmSand:    '#F0E4CC',
  terracotta:  '#C0392B',
  grey:        '#6B6560',
  greyLight:   '#ABA4A0',
  white:       '#FFFFFF',
  border:      '#E8E0D0',
  bgSlot:      '#EAF4F2',
  bgSlotOff:   '#F5F2EC',
  bgDnd:       '#F5F5F5',
} as const;

type AvailabilityStatus  = 'available_now' | 'by_appointment' | 'unavailable';
type AvailabilityMode    = 'simple' | 'schedule';

// Days of week Mon–Sun
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
type Day = typeof DAYS[number];

// Grid: 8:00am → 9:30pm = 27 slots of 30min (8:00, 8:30, … 21:30)
function buildTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h <= 21; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    if (h < 22) slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots; // 28 slots: 08:00 … 21:30
}
const TIME_SLOTS = buildTimeSlots();

// Schedule: Record<Day, Set<slotIndex>>
type DaySchedule = Set<number>; // indices into TIME_SLOTS
type WeekSchedule = Record<Day, DaySchedule>;

function emptySchedule(): WeekSchedule {
  return Object.fromEntries(
    DAYS.map(d => [d, new Set<number>()]),
  ) as WeekSchedule;
}

// Subscription tiers that unlock schedule mode
const SCHEDULE_TIER_ALLOWED = new Set(['silver', 'gold']);

// ─── Simple Mode Selector ─────────────────────────────────────────────────────

interface SimpleOptionProps {
  status:    AvailabilityStatus;
  selected:  AvailabilityStatus;
  onSelect:  (s: AvailabilityStatus) => void;
}

const SIMPLE_OPTIONS: {
  status: AvailabilityStatus;
  label:  string;
  sub:    string;
  icon:   string;
  color:  string;
}[] = [
  {
    status: 'available_now',
    label:  'Available Now',
    sub:    'Consumers can contact you immediately',
    icon:   '🟢',
    color:  COLORS.verdigris,
  },
  {
    status: 'by_appointment',
    label:  'By Appointment',
    sub:    'Accept leads for scheduled times',
    icon:   '🟡',
    color:  COLORS.saffron,
  },
  {
    status: 'unavailable',
    label:  'Unavailable',
    sub:    'Not accepting any leads right now',
    icon:   '🔴',
    color:  COLORS.terracotta,
  },
];

function SimpleMode({
  selected,
  onSelect,
}: {
  selected:  AvailabilityStatus;
  onSelect:  (s: AvailabilityStatus) => void;
}) {
  return (
    <View style={styles.simpleModeContainer}>
      {SIMPLE_OPTIONS.map(opt => (
        <TouchableOpacity
          key={opt.status}
          style={[
            styles.simpleOption,
            selected === opt.status && { borderColor: opt.color, borderWidth: 2 },
          ]}
          onPress={() => onSelect(opt.status)}
          activeOpacity={0.8}
        >
          <View style={styles.simpleOptionLeft}>
            <Text style={styles.simpleOptionIcon}>{opt.icon}</Text>
            <View style={styles.simpleOptionText}>
              <Text style={[
                styles.simpleOptionLabel,
                selected === opt.status && { color: opt.color, fontFamily: 'PlusJakartaSans-Bold' },
              ]}>
                {opt.label}
              </Text>
              <Text style={styles.simpleOptionSub}>{opt.sub}</Text>
            </View>
          </View>
          <View style={[
            styles.simpleRadio,
            selected === opt.status && { borderColor: opt.color },
          ]}>
            {selected === opt.status && (
              <View style={[styles.simpleRadioDot, { backgroundColor: opt.color }]} />
            )}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Schedule Grid ────────────────────────────────────────────────────────────

interface ScheduleGridProps {
  schedule:  WeekSchedule;
  onToggle:  (day: Day, slotIdx: number) => void;
}

function ScheduleGrid({ schedule, onToggle }: ScheduleGridProps) {
  // Only render every 2 slots (1-hour labels on left) for readability
  const hourLabels = TIME_SLOTS.filter(s => s.endsWith(':00'));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.gridOuter}
    >
      {/* Time labels column */}
      <View style={styles.gridTimeCol}>
        <View style={styles.gridTimeHeader} />
        {TIME_SLOTS.map((slot, idx) => (
          <View key={slot} style={styles.gridTimeCell}>
            {slot.endsWith(':00') ? (
              <Text style={styles.gridTimeLabel}>
                {/* 14:00 → 2pm */}
                {formatHour(slot)}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {/* Day columns */}
      {DAYS.map(day => (
        <View key={day} style={styles.gridDayCol}>
          {/* Day header */}
          <View style={styles.gridDayHeader}>
            <Text style={styles.gridDayLabel}>{day}</Text>
          </View>

          {/* Slot cells */}
          {TIME_SLOTS.map((slot, idx) => {
            const isOn = schedule[day].has(idx);
            return (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.gridCell,
                  isOn && styles.gridCellOn,
                ]}
                onPress={() => onToggle(day, idx)}
                activeOpacity={0.7}
              />
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

function formatHour(slot: string): string {
  const [h] = slot.split(':').map(Number);
  if (h === 0)  return '12am';
  if (h < 12)  return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

// ─── DND Settings ─────────────────────────────────────────────────────────────

function DndSettings({
  enabled,
  onToggle,
}: {
  enabled:  boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <View style={styles.dndCard}>
      <View style={styles.dndRow}>
        <View style={styles.dndLeft}>
          <Text style={styles.dndTitle}>🌙 Do Not Disturb</Text>
          <Text style={styles.dndSub}>10pm – 8am (default)</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          trackColor={{ false: COLORS.border, true: COLORS.verdigris }}
          thumbColor={COLORS.white}
        />
      </View>
      <Text style={styles.dndNote}>
        OTP authentication and trust score alerts always bypass DND — you will
        never miss a critical security or trust event.
      </Text>
    </View>
  );
}

// ─── Upgrade Prompt ───────────────────────────────────────────────────────────

function ScheduleUpgradePrompt({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <View style={styles.upgradeCard}>
      <Text style={styles.upgradeEmoji}>📅</Text>
      <Text style={styles.upgradeTitle}>Weekly Schedule — Bronze plan</Text>
      <Text style={styles.upgradeSub}>
        Set precise availability for each day of the week. Consumers on the
        Gold plan can book your open slots directly.
      </Text>
      <TouchableOpacity style={styles.upgradeBtn} onPress={onUpgrade}>
        <Text style={styles.upgradeBtnText}>View Plans →</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Mode Tab ─────────────────────────────────────────────────────────────────

function ModeTab({
  mode,
  current,
  label,
  locked,
  onPress,
}: {
  mode:    AvailabilityMode;
  current: AvailabilityMode;
  label:   string;
  locked:  boolean;
  onPress: () => void;
}) {
  const isActive = mode === current && !locked;
  return (
    <TouchableOpacity
      style={[
        styles.modeTab,
        isActive && styles.modeTabActive,
        locked && styles.modeTabLocked,
      ]}
      onPress={onPress}
    >
      <Text style={[
        styles.modeTabText,
        isActive && styles.modeTabTextActive,
        locked && styles.modeTabTextLocked,
      ]}>
        {label}{locked ? '  🔒' : ''}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AvailabilityScreen() {
  const navigation    = useNavigation<any>();
  const subscriptionTier = useAuthStore((s) => s.subscriptionTier);

  const canUseSchedule = SCHEDULE_TIER_ALLOWED.has(subscriptionTier);

  const [mode,        setMode]        = useState<AvailabilityMode>('simple');
  const [simpleStatus, setSimpleStatus] = useState<AvailabilityStatus>('available_now');
  const [schedule,    setSchedule]    = useState<WeekSchedule>(emptySchedule());
  const [dndEnabled,  setDndEnabled]  = useState(true);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [dirty,       setDirty]       = useState(false);

  // ── Load current availability ───────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const resp = await getAvailabilitySchedule();
        setSimpleStatus(resp.status ?? 'available_now');
        setDndEnabled(resp.dnd_enabled ?? true);
        if (resp.schedule) {
          // Convert server schedule (Record<Day, number[]>) to Sets
          const parsed = emptySchedule();
          for (const day of DAYS) {
            const slots: number[] = resp.schedule[day] ?? [];
            parsed[day] = new Set(slots);
          }
          setSchedule(parsed);
        }
        if (resp.mode) setMode(resp.mode as AvailabilityMode);
      } catch (err) {
        console.error('[AvailabilityScreen] load error', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Toggle a schedule slot ──────────────────────────────────────────────────
  const toggleSlot = useCallback((day: Day, slotIdx: number) => {
    setSchedule(prev => {
      const next = emptySchedule();
      for (const d of DAYS) {
        next[d] = new Set(prev[d]);
      }
      if (next[day].has(slotIdx)) {
        next[day].delete(slotIdx);
      } else {
        next[day].add(slotIdx);
      }
      return next;
    });
    setDirty(true);
  }, []);

  // ── Simple status change ────────────────────────────────────────────────────
  const handleSimpleSelect = useCallback((s: AvailabilityStatus) => {
    setSimpleStatus(s);
    setDirty(true);
  }, []);

  // ── DND toggle ──────────────────────────────────────────────────────────────
  const handleDndToggle = useCallback((v: boolean) => {
    setDndEnabled(v);
    setDirty(true);
  }, []);

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (mode === 'simple') {
        await updateAvailability({
          status:      simpleStatus,
          mode:        'simple',
          dnd_enabled: dndEnabled,
        });
      } else {
        // Convert WeekSchedule (Day → Set<slotIndex>) → PUT /me/schedule format
        // Backend expects: { day_of_week: 0-6, start_time: 'HH:MM', end_time: 'HH:MM' }
        // day_of_week: 0=Mon … 6=Sun  |  TIME_SLOTS[idx] gives start_time, [idx+1] gives end
        const DAY_INDEX: Record<string, number> = {
          Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
        };
        const SLOT_DURATION_MIN = 30; // matches slot.controller default
        const slots: Array<{ day_of_week: number; start_time: string; end_time: string }> = [];
        for (const day of DAYS) {
          const dayIdx = DAY_INDEX[day];
          for (const slotIdx of Array.from(schedule[day]).sort((a, b) => a - b)) {
            const startTime = TIME_SLOTS[slotIdx];
            // Compute end time by adding SLOT_DURATION_MIN
            const [h, m] = startTime.split(':').map(Number);
            const endMins = h * 60 + m + SLOT_DURATION_MIN;
            const endTime = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
            slots.push({ day_of_week: dayIdx, start_time: startTime, end_time: endTime });
          }
        }
        // Use new V050 slot endpoint (writes to provider_availability_slots table)
        await putMySchedule(slots);
        // Also update simple availability flag so WS broadcasts updated status
        await updateAvailability({
          status:      simpleStatus,
          mode:        'schedule',
          dnd_enabled: dndEnabled,
        });
      }
      setDirty(false);
      navigation.goBack();
    } catch (err) {
      Alert.alert('Error', 'Could not save availability. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [mode, simpleStatus, schedule, dndEnabled, navigation]);

  // ── Schedule slot count summary ─────────────────────────────────────────────
  const totalSlots = useMemo(
    () => DAYS.reduce((sum, d) => sum + schedule[d].size, 0),
    [schedule],
  );

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScreenHeader title="Availability" onBack={() => navigation.goBack()} />
        <ActivityIndicator
          size="large"
          color={COLORS.saffron}
          style={{ marginTop: 60 }}
        />
      </SafeAreaView>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Availability</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={COLORS.verdigris} />
          ) : (
            <Text style={[
              styles.saveText,
              (!dirty) && styles.saveTextDisabled,
            ]}>
              Save
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Mode Selector ────────────────────────────────────────────────── */}
        <View style={styles.modeTabsRow}>
          <ModeTab
            mode="simple"
            current={mode}
            label="Simple"
            locked={false}
            onPress={() => setMode('simple')}
          />
          <ModeTab
            mode="schedule"
            current={mode}
            label="Schedule"
            locked={!canUseSchedule}
            onPress={() => {
              if (canUseSchedule) {
                setMode('schedule');
              } else {
                navigation.navigate('ProviderSubscription');
              }
            }}
          />
        </View>

        {/* ── Simple Mode ──────────────────────────────────────────────────── */}
        {(mode === 'simple' || !canUseSchedule) && (
          <>
            <Text style={styles.sectionTitle}>Quick Status</Text>
            <SimpleMode
              selected={simpleStatus}
              onSelect={handleSimpleSelect}
            />
          </>
        )}

        {/* ── Schedule Mode ────────────────────────────────────────────────── */}
        {mode === 'schedule' && canUseSchedule && (
          <>
            <View style={styles.scheduleHeader}>
              <Text style={styles.sectionTitle}>Weekly Schedule</Text>
              <Text style={styles.slotCount}>
                {totalSlots} slot{totalSlots !== 1 ? 's' : ''} set
              </Text>
            </View>
            <Text style={styles.scheduleHint}>
              Tap cells to toggle availability. Consumers on Gold plan can book
              your open slots.
            </Text>

            {/* Grid legend */}
            <View style={styles.gridLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: COLORS.bgSlot }]} />
                <Text style={styles.legendLabel}>Available</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: COLORS.bgSlotOff }]} />
                <Text style={styles.legendLabel}>Unavailable</Text>
              </View>
            </View>

            <ScheduleGrid
              schedule={schedule}
              onToggle={toggleSlot}
            />

            {/* Schedule quick-fill helpers */}
            <View style={styles.scheduleFillRow}>
              <TouchableOpacity
                style={styles.fillBtn}
                onPress={() => {
                  // Fill Mon–Fri 9am–6pm
                  const next = emptySchedule();
                  const workdays: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
                  TIME_SLOTS.forEach((slot, idx) => {
                    const h = parseInt(slot.split(':')[0], 10);
                    if (h >= 9 && h < 18) {
                      workdays.forEach(d => next[d].add(idx));
                    }
                  });
                  setSchedule(next);
                  setDirty(true);
                }}
              >
                <Text style={styles.fillBtnText}>Weekdays 9–6</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.fillBtn}
                onPress={() => {
                  setSchedule(emptySchedule());
                  setDirty(true);
                }}
              >
                <Text style={[styles.fillBtnText, { color: COLORS.terracotta }]}>
                  Clear all
                </Text>
              </TouchableOpacity>
            </View>

            {/* Simple status still applies when outside schedule */}
            <View style={styles.outsideScheduleNote}>
              <Text style={styles.outsideScheduleText}>
                Outside scheduled hours, your status shows as{' '}
                <Text style={{ fontFamily: 'PlusJakartaSans-SemiBold' }}>
                  By Appointment
                </Text>{' '}
                automatically.
              </Text>
            </View>
          </>
        )}

        {/* ── Upgrade prompt for Free tier ────────────────────────────────── */}
        {!canUseSchedule && (
          <ScheduleUpgradePrompt
            onUpgrade={() => navigation.navigate('ProviderSubscription')}
          />
        )}

        {/* ── Do Not Disturb ───────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>
          Do Not Disturb
        </Text>
        <DndSettings
          enabled={dndEnabled}
          onToggle={handleDndToggle}
        />

        {/* DND bypass info */}
        <View style={styles.dndBypassCard}>
          <Text style={styles.dndBypassTitle}>Always delivered during DND:</Text>
          <Text style={styles.dndBypassItem}>• OTP authentication codes</Text>
          <Text style={styles.dndBypassItem}>• Trust score milestone alerts</Text>
          <Text style={styles.dndBypassItem}>• Security and verification alerts</Text>
          <Text style={styles.dndBypassNote}>
            All other notifications are queued and delivered after 8am.
          </Text>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: COLORS.ivory,
  },

  // Header
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop:     12,
    paddingBottom:  8,
  },
  backText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      COLORS.saffron,
  },
  headerTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   17,
    color:      COLORS.deepInk,
  },
  saveText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   15,
    color:      COLORS.verdigris,
  },
  saveTextDisabled: {
    color: COLORS.greyLight,
  },

  // Scroll
  scroll: {
    paddingHorizontal: 16,
    paddingBottom:     24,
  },

  // Mode tabs
  modeTabsRow: {
    flexDirection:  'row',
    backgroundColor: COLORS.white,
    borderRadius:   12,
    padding:         4,
    marginBottom:   18,
    marginTop:       4,
  },
  modeTab: {
    flex:          1,
    paddingVertical: 10,
    alignItems:    'center',
    borderRadius:  10,
  },
  modeTabActive: {
    backgroundColor: COLORS.deepInk,
  },
  modeTabLocked: {
    opacity: 0.6,
  },
  modeTabText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   14,
    color:      COLORS.grey,
  },
  modeTabTextActive: {
    color: COLORS.ivory,
  },
  modeTabTextLocked: {
    color: COLORS.greyLight,
  },

  // Sections
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   14,
    color:      COLORS.grey,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom:  10,
  },

  // Simple Mode
  simpleModeContainer: {
    gap: 8,
    marginBottom: 16,
  },
  simpleOption: {
    flexDirection:  'row',
    alignItems:     'center',
    backgroundColor: COLORS.white,
    borderRadius:   12,
    padding:        14,
    borderWidth:    1.5,
    borderColor:    COLORS.border,
  },
  simpleOptionLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    flex:          1,
  },
  simpleOptionIcon: {
    fontSize:   22,
    marginRight: 12,
  },
  simpleOptionText: {
    flex: 1,
  },
  simpleOptionLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      COLORS.deepInk,
  },
  simpleOptionSub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
    marginTop:  2,
  },
  simpleRadio: {
    width:          22,
    height:         22,
    borderRadius:   11,
    borderWidth:     2,
    borderColor:    COLORS.border,
    justifyContent: 'center',
    alignItems:     'center',
    marginLeft:     12,
  },
  simpleRadioDot: {
    width:        10,
    height:       10,
    borderRadius:  5,
  },

  // Schedule
  scheduleHeader: {
    flexDirection:  'row',
    alignItems:     'baseline',
    justifyContent: 'space-between',
    marginBottom:   4,
  },
  slotCount: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   13,
    color:      COLORS.verdigris,
  },
  scheduleHint: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
    marginBottom: 10,
    lineHeight: 17,
  },

  // Grid legend
  gridLegend: {
    flexDirection: 'row',
    gap:           16,
    marginBottom:  8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  legendSwatch: {
    width:        16,
    height:       16,
    borderRadius:  3,
    borderWidth:   1,
    borderColor:   COLORS.border,
  },
  legendLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
  },

  // Grid
  gridOuter: {
    paddingBottom: 8,
  },
  gridTimeCol: {
    width:      44,
    marginRight: 2,
  },
  gridTimeHeader: {
    height: 28,
  },
  gridTimeCell: {
    height:         20,
    justifyContent: 'center',
  },
  gridTimeLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   9,
    color:      COLORS.greyLight,
    textAlign:  'right',
    paddingRight: 4,
  },
  gridDayCol: {
    width:       38,
    marginRight:  2,
  },
  gridDayHeader: {
    height:         28,
    justifyContent: 'center',
    alignItems:     'center',
  },
  gridDayLabel: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   11,
    color:      COLORS.deepInk,
  },
  gridCell: {
    height:           20,
    borderRadius:      2,
    marginVertical:    1,
    backgroundColor:  COLORS.bgSlotOff,
  },
  gridCellOn: {
    backgroundColor: COLORS.verdigris,
  },

  // Schedule helpers
  scheduleFillRow: {
    flexDirection:  'row',
    gap:            10,
    marginTop:      10,
    marginBottom:    6,
  },
  fillBtn: {
    paddingVertical:    8,
    paddingHorizontal: 14,
    borderRadius:      8,
    backgroundColor:   COLORS.white,
    borderWidth:       1,
    borderColor:       COLORS.border,
  },
  fillBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   13,
    color:      COLORS.deepInk,
  },
  outsideScheduleNote: {
    backgroundColor: COLORS.warmSand,
    borderRadius:    10,
    padding:         12,
    marginTop:       8,
  },
  outsideScheduleText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      COLORS.deepInk,
    lineHeight: 18,
  },

  // Upgrade
  upgradeCard: {
    backgroundColor: '#FDF8F2',
    borderRadius:    14,
    padding:         18,
    alignItems:      'center',
    marginTop:        8,
    borderWidth:     1,
    borderColor:     COLORS.warmSand,
  },
  upgradeEmoji: { fontSize: 32, marginBottom: 8 },
  upgradeTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   16,
    color:      COLORS.deepInk,
    marginBottom: 6,
    textAlign:  'center',
  },
  upgradeSub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      COLORS.grey,
    textAlign:  'center',
    lineHeight: 19,
    marginBottom: 14,
  },
  upgradeBtn: {
    backgroundColor: COLORS.saffron,
    paddingHorizontal: 24,
    paddingVertical:   10,
    borderRadius:     10,
  },
  upgradeBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize:   14,
    color:      COLORS.white,
  },

  // DND
  dndCard: {
    backgroundColor: COLORS.white,
    borderRadius:    14,
    padding:         16,
    marginBottom:    12,
    borderWidth:     1,
    borderColor:     COLORS.border,
  },
  dndRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:    8,
  },
  dndLeft: { flex: 1 },
  dndTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   15,
    color:      COLORS.deepInk,
  },
  dndSub: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
    marginTop:   2,
  },
  dndNote: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
    lineHeight: 17,
  },

  // DND Bypass
  dndBypassCard: {
    backgroundColor: COLORS.bgDnd,
    borderRadius:    12,
    padding:         14,
    marginBottom:    10,
  },
  dndBypassTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize:   13,
    color:      COLORS.deepInk,
    marginBottom: 6,
  },
  dndBypassItem: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   13,
    color:      COLORS.deepInk,
    lineHeight: 20,
  },
  dndBypassNote: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize:   12,
    color:      COLORS.grey,
    marginTop:   8,
    lineHeight:  17,
  },

  bottomSpacer: { height: 20 },

  // Missing reference from resetText
  terracotta: { color: COLORS.terracotta },
});
