/**
 * apps/mobile/src/screens/shared/NotificationSettingsScreen.tsx
 * SatvAAh — Notification preferences
 *
 * Storage:
 *   push_enabled  — MMKV client-side only (push permission managed by OS)
 *   whatsapp_enabled — PATCH /api/v1/consumers/me/settings → persists wa_opted_out to DB
 *
 * On mount: GET /api/v1/consumers/me/settings to hydrate server-side prefs.
 * On toggle: immediately update local state + fire PATCH (fire-and-forget, shows error toast).
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Switch, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiClient } from '../../api/client';
import { COLORS } from '../../constants/colors';

const PUSH_PREF_KEY = 'satvaaah_push_enabled';

// ─── Row component ────────────────────────────────────────────────────────────

interface PrefRowProps {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

function PrefRow({ label, description, value, onChange, disabled }: PrefRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: '#E8E0D0', true: COLORS.verdigris }}
        thumbColor={value ? '#fff' : '#C8C0B4'}
      />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export function NotificationSettingsScreen() {
  const navigation = useNavigation();

  const [loading,           setLoading]           = useState(true);
  const [saving,            setSaving]            = useState(false);
  const [pushEnabled,       setPushEnabled]       = useState(true);
  const [whatsappEnabled,   setWhatsappEnabled]   = useState(false);
  const [ratingsEnabled,    setRatingsEnabled]    = useState(true);
  const [leadsEnabled,      setLeadsEnabled]      = useState(true);

  // ── Load current prefs ────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        // Push pref from MMKV (AsyncStorage)
        const pushRaw = await AsyncStorage.getItem(PUSH_PREF_KEY);
        if (pushRaw !== null) setPushEnabled(pushRaw !== 'false');

        // Server prefs (whatsapp_enabled persisted in DB)
        const { data } = await apiClient.get<{
          success: true;
          data: { notification_prefs: { push_enabled?: boolean; whatsapp_enabled: boolean } };
        }>('/api/v1/consumers/me/settings');
        const prefs = data.data?.notification_prefs;
        if (prefs) {
          setWhatsappEnabled(prefs.whatsapp_enabled ?? false);
        }
      } catch {
        // Non-critical — defaults are safe
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Save helper — fire-and-forget with error toast ────────────────────────

  const saveToServer = useCallback(
    async (patch: { whatsapp_enabled?: boolean; push_enabled?: boolean }) => {
      setSaving(true);
      try {
        await apiClient.patch('/api/v1/consumers/me/settings', patch);
      } catch {
        Alert.alert('Error', 'Could not save settings. Please try again.');
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  // ── Toggle handlers ────────────────────────────────────────────────────────

  const onPushChange = useCallback(async (v: boolean) => {
    setPushEnabled(v);
    await AsyncStorage.setItem(PUSH_PREF_KEY, String(v));
    saveToServer({ push_enabled: v });
  }, [saveToServer]);

  const onWhatsappChange = useCallback((v: boolean) => {
    setWhatsappEnabled(v);
    saveToServer({ whatsapp_enabled: v });
  }, [saveToServer]);

  const onRatingsChange = useCallback(async (v: boolean) => {
    setRatingsEnabled(v);
    await AsyncStorage.setItem('satvaaah_ratings_notif', String(v));
  }, []);

  const onLeadsChange = useCallback(async (v: boolean) => {
    setLeadsEnabled(v);
    await AsyncStorage.setItem('satvaaah_leads_notif', String(v));
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.saffron} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.ivory} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{top:12,bottom:12,left:12,right:12}}>
          <Ionicons name="chevron-back" size={24} color={COLORS.deepInk} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notification Settings</Text>
        {saving && <ActivityIndicator color={COLORS.saffron} size="small" style={{ marginRight: 16 }} />}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* Push notifications section */}
        <Text style={styles.sectionHeader}>PUSH NOTIFICATIONS</Text>
        <View style={styles.card}>
          <PrefRow
            label="Push notifications"
            description="Alerts for leads, ratings, and updates"
            value={pushEnabled}
            onChange={onPushChange}
          />
          <View style={styles.divider} />
          <PrefRow
            label="Lead alerts"
            description="When a provider accepts or declines"
            value={leadsEnabled}
            onChange={onLeadsChange}
            disabled={!pushEnabled}
          />
          <View style={styles.divider} />
          <PrefRow
            label="Rating reminders"
            description="Reminded to rate providers after service"
            value={ratingsEnabled}
            onChange={onRatingsChange}
            disabled={!pushEnabled}
          />
        </View>

        {/* WhatsApp section */}
        <Text style={styles.sectionHeader}>WHATSAPP</Text>
        <View style={styles.card}>
          <PrefRow
            label="WhatsApp messages"
            description="Service updates via WhatsApp"
            value={whatsappEnabled}
            onChange={onWhatsappChange}
          />
        </View>

        <Text style={styles.footer}>
          Push notification delivery depends on your device's OS notification permissions.
          You can change OS-level permissions in your device Settings.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: COLORS.ivory },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D0',
    backgroundColor: COLORS.ivory,
  },
  backBtn:     { padding: 8, marginRight: 8 },
  backIcon:    { fontSize: 20, color: COLORS.deepInk },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: COLORS.deepInk,
  },
  scroll:       { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 60 },
  sectionHeader: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#9B8E7C',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8E0D5',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowText: { flex: 1, marginRight: 12 },
  rowLabel: {
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: COLORS.deepInk,
    marginBottom: 2,
  },
  rowDesc: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9B8E7C',
  },
  divider: {
    height: 1,
    backgroundColor: '#F0E8D8',
    marginLeft: 16,
  },
  footer: {
    marginTop: 24,
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9B8E7C',
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
