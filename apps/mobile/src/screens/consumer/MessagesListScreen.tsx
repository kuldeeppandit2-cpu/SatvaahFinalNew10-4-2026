/**
 * MessagesListScreen — root of MessagesStack
 * Shows all conversations (contact events with message type).
 * Tapping one opens ConversationScreen with correct params.
 * Uses GET /api/v1/contact-events (via contact.api.ts apiClient)
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, StatusBar, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { apiClient } from '../../api/client';

type Nav = NativeStackNavigationProp<any>;

interface ContactEvent {
  id: string;
  providerId: string;
  providerDisplayName: string;
  provider_primary_taxonomy: string;
  contactType: 'call' | 'message' | 'slot_booking';
  status: string;
  createdAt: string;
}

export function MessagesListScreen(): React.ReactElement {
  const navigation = useNavigation<Nav>();
  const [events, setEvents] = useState<ContactEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/consumers/me/contacts');
      setEvents(data.data ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function onRefresh() { setRefreshing(true); load(); }

  function openConversation(event: ContactEvent) {
    // Call-type contacts have no chat messages — opening ConversationScreen shows
    // an empty chat which confuses users (audit item 24).
    // Route call contacts to ProviderProfile instead.
    if (event.contactType === 'call') {
      navigation.navigate('ProviderProfile', { providerId: event.providerId });
      return;
    }
    navigation.navigate('Conversation', {
      contactEventId: event.id,
      otherPartyName: event.providerDisplayName,
      otherPartyId: event.providerId,
    });
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86400000) {
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  const typeIcon: Record<string, string> = {
    call: '📞', message: '💬', slot_booking: '📅',
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <View style={s.header}>
        <Text style={s.title}>Messages</Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#C8691A" style={s.loader} />
      ) : events.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>💬</Text>
          <Text style={s.emptyTitle}>No conversations yet</Text>
          <Text style={s.emptySub}>
            When you contact a provider, your conversation will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#C8691A"
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.row}
              onPress={() => openConversation(item)}
              activeOpacity={0.8}
            >
              <View style={s.avatar}>
                <Text style={s.avatarText}>
                  {item.providerDisplayName.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={s.info}>
                <View style={s.infoTop}>
                  <Text style={s.name} numberOfLines={1}>
                    {item.providerDisplayName}
                  </Text>
                  <Text style={s.time}>{formatDate(item.createdAt)}</Text>
                </View>
                <View style={s.infoBottom}>
                  <Text style={s.taxonomy} numberOfLines={1}>
                    {item.provider_primary_taxonomy}
                  </Text>
                  <View style={[s.statusBadge,
                    item.status === 'accepted' && s.statusAccepted,
                    item.status === 'pending' && s.statusPending,
                    item.status === 'declined' && s.statusDeclined,
                  ]}>
                    <Text style={s.statusText}>{item.status}</Text>
                  </View>
                </View>
              </View>
              <Text style={s.typeIcon}>{typeIcon[item.contactType] ?? '💬'}</Text>
            </TouchableOpacity>
          )}
          ListFooterComponent={<View style={{ height: 80 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#FAF7F0' },
  header:  { paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#E8E0D0' },
  title:   { fontFamily: 'PlusJakartaSans-Bold', fontSize: 22, color: '#1C1C2E' },
  loader:  { marginTop: 48 },
  list:    { paddingTop: 8 },
  empty:   { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyIcon:  { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 18, color: '#1C1C2E', marginBottom: 8, textAlign: 'center' },
  emptySub:   { fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: '#1C1C2E', textAlign: 'center', lineHeight: 22 },
  row:     {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#F0E8DF',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 12, marginVertical: 3, borderRadius: 12,
  },
  avatar:  { width: 48, height: 48, borderRadius: 24, backgroundColor: '#C8691A', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 18, color: '#FAF7F0' },
  info:    { flex: 1 },
  infoTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  infoBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name:    { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 15, color: '#1C1C2E', flex: 1 },
  time:    { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: '#9B8E7C', marginLeft: 8 },
  taxonomy: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: '#1C1C2E', flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: '#E8E0D0' },
  statusAccepted: { backgroundColor: '#EDF5F4' },
  statusPending:  { backgroundColor: '#FEF3E8' },
  statusDeclined: { backgroundColor: '#FDE8E8' },
  statusText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: '#1C1C2E' },
  typeIcon: { fontSize: 20, marginLeft: 8 },
});
