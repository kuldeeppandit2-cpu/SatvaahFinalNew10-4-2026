import React, { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { getTrustHistory, trustRingColor } from '../../api/trust.api';
import type { TrustHistoryEntry } from '../../api/trust.api';
import { COLORS } from '../../constants/colors';

export function TrustHistoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const providerId = route.params?.providerId ?? '';
  const [entries, setEntries] = useState<TrustHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    getTrustHistory(providerId)
      .then(setEntries)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [providerId]);

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
  }

  function deltaLabel(pts: number): string {
    return pts >= 0 ? `+${pts} pts` : `${pts} pts`;
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Trust History" onBack={() => navigation.goBack()} />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={COLORS.saffron} size="large" /></View>
      ) : error ? (
        <View style={s.center}><Text style={s.errorText}>Could not load trust history.</Text></View>
      ) : entries.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyTitle}>No history yet</Text>
          <Text style={s.emptyBody}>Trust score changes will appear here as you build your profile.</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={s.list}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          renderItem={({ item }) => {
            const color = trustRingColor(item.new_display_score);
            const isPos = item.delta_pts >= 0;
            return (
              <View style={s.row}>
                <View style={[s.dot, { backgroundColor: color }]} />
                <View style={s.meta}>
                  <Text style={s.eventType}>{item.eventType.replace(/_/g, ' ')}</Text>
                  <Text style={s.date}>{formatDate(item.event_at)}</Text>
                </View>
                <View style={s.right}>
                  <Text style={[s.delta, { color: isPos ? COLORS.verdigris : COLORS.terracotta }]}>
                    {deltaLabel(item.delta_pts)}
                  </Text>
                  <Text style={s.score}>{item.new_display_score} pts</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.ivory },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: COLORS.muted, fontSize: 15 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: COLORS.deepInk, marginBottom: 8, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: COLORS.muted, textAlign: 'center', lineHeight: 20 },
  list: { padding: 16 },
  sep: { height: 1, backgroundColor: COLORS.border },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  meta: { flex: 1 },
  eventType: { fontSize: 14, fontWeight: '600', color: COLORS.deepInk, textTransform: 'capitalize' },
  date: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  delta: { fontSize: 14, fontWeight: '700' },
  score: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
});
