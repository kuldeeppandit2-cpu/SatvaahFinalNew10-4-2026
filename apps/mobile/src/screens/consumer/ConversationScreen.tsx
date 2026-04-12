/**
 * apps/mobile/src/screens/consumer/ConversationScreen.tsx
 * SatvAAh Phase 19 — In-App Messaging
 *
 * MASTER_CONTEXT WebSocket /messages spec (enforced):
 *   • Namespace: /messages on user :3002
 *   • Auth: { auth: { token: accessToken } } — RS256 JWT (Rule #15 — never HS256)
 *   • Room: conversation:{event_id}
 *   • Events: message_received · message_read · typing_start · typing_stop
 *   • Reconnect: exponential backoff 1s→30s, Infinity retries
 *   • REST catchup: getMessages(eventId) on every connect after first
 *
 * Phase 19 spec:
 *   • FlashList estimatedItemSize=72, inverted
 *   • Read ticks: ✓ sent / ✓✓ grey=delivered / ✓✓ Verdigris=read
 *   • Animated 3-dot typing indicator (staggered Animated.loop)
 *   • Photo: expo-image-picker → S3 presigned PUT → sendMessage(photo_url)
 *   • Message deduplication by id
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 View, Text, StyleSheet, TouchableOpacity,
 TextInput, Animated, Alert,
 KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { FlashList } from '../../__stubs__/flash-list';
import * as ImagePicker from 'expo-image-picker';
import { io, type Socket } from 'socket.io-client';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ENV } from '../../config/env';

import {
  getMessages, sendMessage,
  getPhotoUploadUrl, uploadPhotoToS3,
} from '../../api/contact.api';
import type { InAppMessage } from '../../api/contact.api';
import { useAuthStore } from '../../stores/auth.store';

// ─── Brand colours ────────────────────────────────────────────────────────────
const SAFFRON   = '#C8691A';
const VERDIGRIS = '#2E7D72';
const DEEP_INK  = '#1C1C2E';
const IVORY     = '#FAF7F0';
const WARM_SAND = '#F0E4CC';
const MUTED     = '#9E9589';

// Use canonical ENV.WS_BASE_URL — routes through nginx gateway (fix-17)
// nginx now has WebSocket upgrade headers (Fix-03), so port 3000 works for WS.
const WS_BASE = ENV.WS_BASE_URL;
const MAX_CHARS = 500;

// ─── Typing indicator (staggered 3-dot animation) ─────────────────────────────
function TypingIndicator(): React.ReactElement {
  const dots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(480 - i * 160),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, []);

  return (
    <View style={styles.typingContainer}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[styles.typingDot, { opacity: dot, transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]}
        />
      ))}
    </View>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
interface BubbleProps {
  message: InAppMessage;
  myId: string;
}

function MessageBubble({ message, myId }: BubbleProps): React.ReactElement {
  const isMine = message.sender_id === myId;

  // Read ticks: ✓ sent / ✓✓ grey=delivered / ✓✓ Verdigris=read
  function renderTicks(): React.ReactElement | null {
    if (!isMine) return null;
    if (message.readAt)      return <Text style={[styles.tick, { color: VERDIGRIS }]}>✓✓</Text>;
    if (message.deliveredAt) return <Text style={[styles.tick, { color: MUTED }]}>✓✓</Text>;
    return <Text style={[styles.tick, { color: MUTED }]}>✓</Text>;
  }

  return (
    <View style={[styles.bubbleWrapper, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
      <View style={[styles.bubble, isMine ? styles.bubbleBgMine : styles.bubbleBgTheirs]}>
        {message.message_text ? (
          <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
            {message.message_text}
          </Text>
        ) : null}
        {message.photo_url ? (
          <Text style={styles.photoPlaceholder}>📷 Photo</Text>
        ) : null}
        <View style={styles.bubbleMeta}>
          <Text style={styles.bubbleTime}>
            {new Date(message.sentAt).toLocaleTimeString('en-IN', {
              hour: '2-digit', minute: '2-digit',
              timeZone: 'Asia/Kolkata',
            })}
          </Text>
          {renderTicks()}
        </View>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export function ConversationScreen(): React.ReactElement {
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();
  const {
    contactEventId,
    otherPartyName,
    otherPartyId,
  } = route.params as {
    contactEventId: string;
    otherPartyName: string;
    otherPartyId: string;
  };

  const accessToken = useAuthStore((s) => s.accessToken);
  const userId      = useAuthStore((s) => s.userId);

  const [messages,   setMessages]  = useState<InAppMessage[]>([]);
  const [text,       setText]      = useState('');
  const [sending,    setSending]   = useState(false);
  const [typing,     setTyping]    = useState(false);
  const [connected,  setConnected] = useState(false);
  const [uploading,  setUploading] = useState(false);

  const socketRef       = useRef<Socket | null>(null);
  const isFirstConnect  = useRef(true);
  const typingTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── REST load ──────────────────────────────────────────────────────────────
  const loadMessages = useCallback(async () => {
    try {
      const msgs = await getMessages(contactEventId);
      setMessages(msgs);
    } catch { /* graceful — WS will deliver live */ }
  }, [contactEventId]);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken) return;

    const socket = io(`${WS_BASE}/messages`, {
      auth: { token: accessToken }, // RS256 JWT — Rule #15
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,  // 30s cap — MASTER_CONTEXT
      randomizationFactor: 0.3,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_conversation', contactEventId);

      if (isFirstConnect.current) {
        isFirstConnect.current = false;
        loadMessages();
      } else {
        // REST catchup — fetch messages missed during disconnect
        getMessages(contactEventId)
          .then((msgs) => {
            setMessages((prev) => {
              const ids = new Set(prev.map((m) => m.id));
              const fresh = msgs.filter((m) => !ids.has(m.id));
              return [...prev, ...fresh].sort(
                (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
              );
            });
          })
          .catch(() => {});
      }
    });

    socket.on('disconnect', () => setConnected(false));

    // Deduplication by id
    socket.on('message_received', (msg: InAppMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    socket.on('message_read', ({ message_id, read_at }: { message_id: string; read_at: string }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === message_id ? { ...m, readAt: read_at } : m)),
      );
    });

    socket.on('typing_start', () => setTyping(true));
    socket.on('typing_stop',  () => setTyping(false));

    return () => { socket.disconnect(); };
  }, [accessToken, contactEventId, loadMessages]);

  // ── Typing events ──────────────────────────────────────────────────────────
  function handleTextChange(t: string): void {
    setText(t.slice(0, MAX_CHARS));
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('typing_start');
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socketRef.current?.emit('typing_stop');
    }, 1500);
  }

  // ── Send text ──────────────────────────────────────────────────────────────
  async function handleSend(): Promise<void> {
    if (!text.trim() || sending) return;
    const outgoing = text.trim();
    setText('');
    setSending(true);
    try {
      await sendMessage({ contactEventId: contactEventId, message_text: outgoing });
    } catch {
      Alert.alert('Error', 'Message not sent. Please try again.');
      setText(outgoing);
    } finally {
      setSending(false);
    }
  }

  // ── Photo send ─────────────────────────────────────────────────────────────
  async function handlePhoto(): Promise<void> {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
    });
    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    try {
      const asset    = result.assets[0];
      const mime     = (asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg') as 'image/jpeg' | 'image/png';
      const presign  = await getPhotoUploadUrl(mime, 'message');
      await uploadPhotoToS3(presign.upload_url, asset.uri, mime);
      await sendMessage({ contactEventId: contactEventId, photo_url: presign.photo_url });
    } catch {
      Alert.alert('Error', 'Could not upload photo. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerMeta}>
          <Text style={styles.headerName}>{otherPartyName}</Text>
          <Text style={styles.headerStatus}>
            {connected ? '🟢 Online' : '⚪ Connecting…'}
          </Text>
        </View>
      </View>

      {/* Messages — FlashList inverted, estimatedItemSize=72 */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
      >
        <FlashList
          data={[...messages].reverse()}
          inverted
          estimatedItemSize={72}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageBubble message={item} myId={userId ?? ''} />
          )}
          ListHeaderComponent={typing ? <TypingIndicator /> : null}
          contentContainerStyle={styles.listContent}
        />

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={handlePhoto}
            disabled={uploading}
          >
            {uploading
              ? <ActivityIndicator size="small" color={SAFFRON} />
              : <Text style={styles.photoBtnText}>📷</Text>
            }
          </TouchableOpacity>

          <TextInput
            style={styles.textInput}
            value={text}
            onChangeText={handleTextChange}
            placeholder={`Message ${otherPartyName}…`}
            placeholderTextColor={MUTED}
            multiline
            maxLength={MAX_CHARS}
            returnKeyType="default"
          />

          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnOff]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
          >
            <Text style={styles.sendBtnText}>→</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea:       { flex: 1, backgroundColor: IVORY },
  flex:           { flex: 1 },
  header:         { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EDE7DB', gap: 12 },
  backBtn:        { padding: 4 },
  backText:       { fontFamily: 'PlusJakartaSans-Bold', fontSize: 20, color: DEEP_INK },
  headerMeta:     { flex: 1 },
  headerName:     { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: DEEP_INK },
  headerStatus:   { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: MUTED },
  listContent:    { padding: 12 },
  bubbleWrapper:  { marginVertical: 3, maxWidth: '80%' },
  bubbleMine:     { alignSelf: 'flex-end' },
  bubbleTheirs:   { alignSelf: 'flex-start' },
  bubble:         { borderRadius: 16, padding: 10, paddingBottom: 6 },
  bubbleBgMine:   { backgroundColor: SAFFRON },
  bubbleBgTheirs: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#EDE7DB' },
  bubbleText:     { fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: DEEP_INK, lineHeight: 20 },
  bubbleTextMine: { color: IVORY },
  photoPlaceholder:{ fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: DEEP_INK },
  bubbleMeta:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 3 },
  bubbleTime:     { fontFamily: 'PlusJakartaSans-Regular', fontSize: 10, color: MUTED },
  tick:           { fontSize: 12, fontWeight: '700' },
  typingContainer:{ flexDirection: 'row', alignItems: 'center', padding: 8, gap: 4 },
  typingDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: MUTED },
  inputBar:       { flexDirection: 'row', alignItems: 'flex-end', padding: 8, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#EDE7DB', gap: 8 },
  photoBtn:       { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  photoBtnText:   { fontSize: 22 },
  textInput:      { flex: 1, backgroundColor: WARM_SAND, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: DEEP_INK, maxHeight: 100 },
  sendBtn:        { width: 40, height: 40, borderRadius: 20, backgroundColor: SAFFRON, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff:     { opacity: 0.35 },
  sendBtnText:    { fontFamily: 'PlusJakartaSans-Bold', fontSize: 18, color: IVORY },
});
