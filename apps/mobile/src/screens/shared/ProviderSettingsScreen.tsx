import React, { useEffect, useState, useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, Alert, ActivityIndicator,
  StatusBar,} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../../components/ScreenHeader';
import { apiClient } from '../../api/client';
import { useAuthStore } from '../../stores/auth.store';
import { COLORS } from '../../constants/colors';

interface ProviderSettings {
  dnd_enabled: boolean;
  lead_alerts: boolean;
  rating_alerts: boolean;
  trust_alerts: boolean;
}

function SettingRow({ icon, label, desc, value, onChange, disabled }: {
  icon: any; label: string; desc: string; value: boolean;
  onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <View style={s.row}>
      <Ionicons name={icon} size={20} color={COLORS.deepInk} style={s.rowIcon} />
      <View style={s.rowText}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowDesc}>{desc}</Text>
      </View>
      <Switch
        value={value} onValueChange={onChange} disabled={disabled}
        trackColor={{ false: COLORS.border, true: COLORS.verdigris + '88' }}
        thumbColor={value ? COLORS.verdigris : COLORS.muted}
      />
    </View>
  );
}

export function ProviderSettingsScreen() {
  const navigation = useNavigation();
  const logout = useAuthStore((s) => s.logout);
  const [settings, setSettings] = useState<ProviderSettings>({ dnd_enabled: false, lead_alerts: true, rating_alerts: true, trust_alerts: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.get('/api/v1/providers/me')
      .then(res => {
        const d = res.data?.data;
        if (d?.notification_prefs) setSettings(s => ({ ...s, ...d.notification_prefs }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (patch: Partial<ProviderSettings>) => {
    setSaving(true);
    const updated = { ...settings, ...patch };
    setSettings(updated);
    try {
      await apiClient.patch('/api/v1/providers/me', { notification_prefs: updated });
    } catch {
      Alert.alert('Error', 'Could not save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const handleLogout = useCallback(() => {
    Alert.alert('Log Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: async () => {
        try { await apiClient.post('/api/v1/auth/logout'); } catch {}
        logout();
        (navigation as any).reset({ index: 0, routes: [{ name: 'Auth' }] });
      }},
    ]);
  }, [logout, navigation]);

  if (loading) return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <ScreenHeader title="Settings" onBack={() => navigation.goBack()} />
      <View style={s.center}><ActivityIndicator color={COLORS.saffron} /></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Settings" onBack={() => navigation.goBack()} right={saving ? <ActivityIndicator size="small" color={COLORS.saffron} /> : undefined} />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <Text style={s.section}>NOTIFICATIONS</Text>
        <View style={s.card}>
          <SettingRow icon="moon-outline" label="Do Not Disturb" desc="Silence all alerts (OTP and trust alerts bypass)" value={settings.dnd_enabled} onChange={v => save({ dnd_enabled: v })} />
          <View style={s.div} />
          <SettingRow icon="person-add-outline" label="New Lead Alerts" desc="When a consumer contacts you" value={settings.lead_alerts} onChange={v => save({ lead_alerts: v })} disabled={settings.dnd_enabled} />
          <View style={s.div} />
          <SettingRow icon="star-outline" label="Rating Alerts" desc="When a consumer rates your service" value={settings.rating_alerts} onChange={v => save({ rating_alerts: v })} disabled={settings.dnd_enabled} />
          <View style={s.div} />
          <SettingRow icon="shield-outline" label="Trust Score Alerts" desc="When your trust score changes" value={settings.trust_alerts} onChange={v => save({ trust_alerts: v })} disabled={settings.dnd_enabled} />
        </View>

        <Text style={s.section}>ACCOUNT</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={COLORS.terracotta} style={s.rowIcon} />
            <Text style={[s.rowLabel, { color: COLORS.terracotta }]}>Log Out</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
          </TouchableOpacity>
        </View>

        <Text style={s.footer}>SatvAAh Technologies · Truth that travels.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.ivory },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, paddingBottom: 48 },
  section: { fontSize: 11, fontWeight: '600', color: COLORS.muted, letterSpacing: 0.5, marginBottom: 8, marginTop: 8 },
  card: { backgroundColor: COLORS.white, borderRadius: 12, borderWidth: 0.5, borderColor: COLORS.border, overflow: 'hidden', marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  rowIcon: { marginRight: 12 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, color: COLORS.deepInk, fontWeight: '500' },
  rowDesc: { fontSize: 12, color: COLORS.muted, marginTop: 1 },
  div: { height: 1, backgroundColor: COLORS.border, marginLeft: 46 },
  footer: { textAlign: 'center', fontSize: 11, color: COLORS.muted, marginTop: 16 },
});
