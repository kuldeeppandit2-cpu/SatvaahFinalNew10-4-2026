/**
 * SatvAAh — apps/mobile/src/screens/provider/FCMPermissionScreen.tsx
 * Phase 22 — FCM + Background permission screen (Android only).
 *
 * Requirements:
 *   - Android only (not shown to iOS users, not shown to consumers)
 *   - Xiaomi / Realme / OPPO / Vivo / OnePlus — detect manufacturer → open device battery settings
 *   - "Allow SatvAAh to run in the background"
 *   - "Without this, you may miss leads — direct income impact"
 *   - Opens device battery settings on primary CTA
 *   - Shown ONCE only — tracks via AsyncStorage key 'fcm_permission_shown'
 *   - NOT shown to consumers
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  SafeAreaView,
  Platform,
  Linking,
  NativeModules,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProviderOnboardingParamList } from '../../navigation/provider.navigator';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<ProviderOnboardingParamList, 'FCMPermission'>;

type OEMConfig = {
  name: string;
  emoji: string;
  settingsHint: string;
  intentActivity: string | null;
  settingsAction: string;
};

// ─── OEM configurations ───────────────────────────────────────────────────────

const OEM_CONFIG: Record<string, OEMConfig> = {
  xiaomi: {
    name: 'MIUI',
    emoji: '📱',
    settingsHint: 'Battery Saver → SatvAAh → No restrictions',
    intentActivity: 'com.miui.powerkeeper/.PowerKeeperActivity',
    settingsAction: 'com.miui.powerkeeper',
  },
  redmi: {
    name: 'MIUI',
    emoji: '📱',
    settingsHint: 'Battery Saver → SatvAAh → No restrictions',
    intentActivity: 'com.miui.powerkeeper/.PowerKeeperActivity',
    settingsAction: 'com.miui.powerkeeper',
  },
  realme: {
    name: 'ColorOS',
    emoji: '⚡',
    settingsHint: 'Battery → Background Freeze → Unfreeze SatvAAh',
    intentActivity: 'com.coloros.oppoguardelf/.battery.BatteryActivity',
    settingsAction: 'com.coloros.oppoguardelf',
  },
  oppo: {
    name: 'ColorOS',
    emoji: '⚡',
    settingsHint: 'Battery → Background Freeze → Unfreeze SatvAAh',
    intentActivity: 'com.coloros.oppoguardelf/.battery.BatteryActivity',
    settingsAction: 'com.coloros.oppoguardelf',
  },
  vivo: {
    name: 'FuntouchOS',
    emoji: '🔋',
    settingsHint: 'i Manager → App Manager → SatvAAh → Background Power',
    intentActivity: 'com.vivo.abe/.MainABEActivity',
    settingsAction: 'com.vivo.abe',
  },
  oneplus: {
    name: 'OxygenOS',
    emoji: '🔴',
    settingsHint: 'Battery → Battery Optimisation → SatvAAh → Don\'t optimise',
    intentActivity: null,
    settingsAction: 'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  },
  samsung: {
    name: 'OneUI',
    emoji: '🌙',
    settingsHint: 'Battery → Background usage limits → Never sleeping apps → Add SatvAAh',
    intentActivity: null,
    settingsAction: 'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  },
};

const DEFAULT_OEM: OEMConfig = {
  name: 'Android',
  emoji: '🔋',
  settingsHint: 'Battery → Battery Optimisation → SatvAAh → Don\'t optimise',
  intentActivity: null,
  settingsAction: 'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
};

const SHOWN_KEY = 'fcm_permission_shown_v1';

// ─── Component ────────────────────────────────────────────────────────────────

export default function FCMPermissionScreen({
  navigation }: Props) {
  const [oem, setOem] = useState<OEMConfig>(DEFAULT_OEM);
  const [opening, setOpening] = useState(false);

  // Detect OEM on mount
  useEffect(() => {
    const manufacturer = (Device.manufacturer ?? '').toLowerCase();
    const model = (Device.modelName ?? '').toLowerCase();

    let matched = DEFAULT_OEM;
    for (const [key, config] of Object.entries(OEM_CONFIG)) {
      if (manufacturer.includes(key) || model.includes(key)) {
        matched = config;
        break;
      }
    }
    setOem(matched);
  }, []);

  const openBatterySettings = async () => {
    setOpening(true);
    try {
      // Try OEM-specific intent first
      if (oem.intentActivity && Platform.OS === 'android') {
        try {
          await IntentLauncher.startActivityAsync(
            'android.intent.action.MAIN',
            { className: oem.intentActivity }
          );
          await markShown();
          return;
        } catch {
          // Fall through to generic
        }
      }

      // Generic battery optimisation settings
      if (Platform.OS === 'android') {
        try {
          await IntentLauncher.startActivityAsync(
            'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
            // Pass package name so Android opens the specific app settings
            { data: 'package:com.satvaaah.app' }
          );
        } catch {
          // Last fallback
          await Linking.openSettings();
        }
      }

      await markShown();
    } catch (err) {
      // If everything fails, just proceed
      await markShown();
    } finally {
      setOpening(false);
    }
  };

  const markShown = async () => {
    await AsyncStorage.setItem(SHOWN_KEY, '1');
    navigation.replace('Dashboard');
  };

  const handleSkip = async () => {
    await markShown();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}
      >
        <Text style={{ fontSize: 16, color: '#C8691A', fontFamily: 'PlusJakartaSans-SemiBold' }}>← Back</Text>
      </TouchableOpacity>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Header illustration */}
        <View style={styles.illustrationWrap}>
          <View style={styles.notifIllustration}>
            {/* Simulated push notification card */}
            <View style={styles.notifCard}>
              <View style={styles.notifAppIcon}>
                <Text style={styles.notifAppIconText}>S</Text>
              </View>
              <View style={styles.notifContent}>
                <Text style={styles.notifTitle}>New lead from SatvAAh</Text>
                <Text style={styles.notifBody}>
                  Priya Sharma wants a plumber in Banjara Hills
                </Text>
              </View>
            </View>
            {/* Blocked version */}
            <View style={styles.blockedOverlay}>
              <Text style={styles.blockedText}>⛔ BLOCKED</Text>
            </View>
          </View>
        </View>

        {/* Headline */}
        <Text style={styles.eyebrow}>ONE LAST STEP</Text>
        <Text style={styles.title}>
          Allow SatvAAh to run in the background
        </Text>

        {/* Income impact note */}
        <View style={styles.incomeAlert}>
          <Text style={styles.incomeAlertIcon}>💸</Text>
          <View style={styles.incomeAlertBody}>
            <Text style={styles.incomeAlertHeadline}>Direct income impact</Text>
            <Text style={styles.incomeAlertText}>
              Without this, {oem.name} will kill the app in the background.
              You'll miss leads while sleeping, cooking, or working — and lose customers
              to the next provider who responds first.
            </Text>
          </View>
        </View>

        {/* OEM-specific instructions */}
        <View style={styles.oemCard}>
          <View style={styles.oemHeader}>
            <Text style={styles.oemEmoji}>{oem.emoji}</Text>
            <Text style={styles.oemName}>{oem.name} · Special step needed</Text>
          </View>
          <View style={styles.oemPath}>
            <Text style={styles.oemPathLabel}>Settings path:</Text>
            <Text style={styles.oemPathText}>{oem.settingsHint}</Text>
          </View>
          <Text style={styles.oemNote}>
            Tap the button below — we'll open the right settings page for your device.
          </Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatPill icon="⚡" value="3×" label="faster response" />
          <StatPill icon="📞" value="40%" label="more leads accepted" />
        </View>

        {/* Primary CTA */}
        <TouchableOpacity
          style={[styles.openBtn, opening && styles.openBtnLoading]}
          onPress={openBatterySettings}
          disabled={opening}
          activeOpacity={0.85}
        >
          <Text style={styles.openBtnText}>
            {opening ? 'Opening settings…' : 'Allow background activity →'}
          </Text>
        </TouchableOpacity>

        {/* Reassurance */}
        <View style={styles.reassurance}>
          <Text style={styles.reassuranceText}>
            🔒 SatvAAh will{' '}
            <Text style={styles.bold}>never</Text> drain your battery unnecessarily.
            We only run in the background to deliver leads instantly.
          </Text>
        </View>

        {/* Skip */}
        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
          <Text style={styles.skipBtnText}>Skip — I'll do this manually later</Text>
        </TouchableOpacity>

        <Text style={styles.legalNote}>
          This screen is shown only once. You can manage this in{' '}
          Settings › Apps › SatvAAh anytime.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatPill({
  icon,
  value,
  label,
}: {
  icon: string;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Helper: should this screen be shown? (call before mounting) ──────────────

export async function shouldShowFCMPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const shown = await AsyncStorage.getItem(SHOWN_KEY);
  return shown === null;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FAF7F0',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 48,
  },
  illustrationWrap: {
    alignItems: 'center',
    marginBottom: 24,
  },
  notifIllustration: {
    position: 'relative',
    width: '100%',
    maxWidth: 320,
  },
  notifCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    alignItems: 'flex-start',
    shadowColor: '#1C1C2E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  notifAppIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#C8691A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifAppIconText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 18,
    color: '#FAF7F0',
  },
  notifContent: {
    flex: 1,
  },
  notifTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13,
    color: '#1C1C2E',
    marginBottom: 2,
  },
  notifBody: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    color: '#4A4540',
    lineHeight: 18,
  },
  blockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1C1C2E90',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockedText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 16,
    color: '#FF4444',
    letterSpacing: 1,
  },
  eyebrow: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#C8691A',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 24,
    color: '#1C1C2E',
    lineHeight: 32,
    marginBottom: 20,
  },
  incomeAlert: {
    flexDirection: 'row',
    backgroundColor: '#FEF3E8',
    borderRadius: 14,
    padding: 16,
    gap: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#C8691A30',
  },
  incomeAlertIcon: {
    fontSize: 22,
    marginTop: 2,
  },
  incomeAlertBody: {
    flex: 1,
  },
  incomeAlertHeadline: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
    color: '#C8691A',
    marginBottom: 6,
  },
  incomeAlertText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13,
    color: '#5A3010',
    lineHeight: 20,
  },
  oemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#1C1C2E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  oemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  oemEmoji: {
    fontSize: 20,
  },
  oemName: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13.5,
    color: '#1C1C2E',
  },
  oemPath: {
    backgroundColor: '#F5F2EC',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  oemPathLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
    color: '#9B9390',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  oemPathText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13,
    color: '#4A4540',
    lineHeight: 20,
  },
  oemNote: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12.5,
    color: '#1C1C2E',
    lineHeight: 18,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  statPill: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: '#E0D6C8',
  },
  statIcon: {
    fontSize: 20,
  },
  statValue: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 22,
    color: '#1C1C2E',
  },
  statLabel: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    color: '#1C1C2E',
    textAlign: 'center',
  },
  openBtn: {
    backgroundColor: '#1C1C2E',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#1C1C2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  openBtnLoading: {
    opacity: 0.6,
  },
  openBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 15.5,
    color: '#FAF7F0',
    letterSpacing: 0.3,
  },
  reassurance: {
    backgroundColor: '#F0F4F3',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  reassuranceText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12.5,
    color: '#3A5C58',
    lineHeight: 20,
  },
  bold: {
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  skipBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  skipBtnText: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13.5,
    color: '#9B9390',
  },
  legalNote: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11.5,
    color: '#B0A9A0',
    textAlign: 'center',
    lineHeight: 18,
  },
});
