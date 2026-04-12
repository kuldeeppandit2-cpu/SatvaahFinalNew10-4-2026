/**
 * NotificationsScreen.tsx
 * SatvAAh — Phase 21
 *
 * Features:
 *   - 6 notification types: contact_accepted | rating_reminder | push_discovery |
 *     saved_provider_update | lead_warning | new_message
 *   - Swipe right to dismiss (mark read + hide)
 *   - 90-day retention — client hides expired items (server also enforces)
 *   - Per-type opt-out accessible via settings icon in header
 *   - Pagination: 30 per page, load-more on scroll
 *   - Unread count badge
 *   - Tapping routes to the relevant screen based on notification type + data
 *
 * Endpoints:
 *   GET   /api/v1/notifications              (notification :3006)
 *   PATCH /api/v1/notifications/:id/read     (notification :3006)
 *   PATCH /api/v1/notifications/read-all     (notification :3006)
 *   PATCH /api/v1/consumers/me/settings      (user :3002) — notification prefs
 *
 * Policy:
 *   ALL notifications here are FCM in-app. WhatsApp is NEVER used for product
 *   notifications (Rule #17 — MASTER_CONTEXT).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  type AppNotification,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type NotificationType,
  NOTIFICATION_TYPE_META,
  fetchNotificationPreferences,
  fetchNotifications,
  formatNotificationTime,
  isNotificationActive,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationPreferences,
} from '../../api/notification.api';

// ─── Brand ───────────────────────────────────────────────────────────────────

const SAFFRON = '#C8691A';
const DEEP_INK = '#1C1C2E';
const IVORY = '#FAF7F0';
const VERDIGRIS = '#2E7D72';
const WARM_SAND = '#F0E4CC';
const GREY = '#6B6560';
const BORDER = '#E8E0D0';

// ─── Type-to-colour mapping ───────────────────────────────────────────────────

const TYPE_COLOUR: Record<NotificationType, string> = {
  contact_accepted: VERDIGRIS,
  rating_reminder: SAFFRON,
  push_discovery: '#5C6BC0',
  saved_provider_update: '#2196F3',
  lead_warning: '#E65100',
  new_message: DEEP_INK,
};

// ─── Deep-link routing helper ─────────────────────────────────────────────────

function routeNotification(
  notification: AppNotification,
  navigation: ReturnType<typeof useNavigation<any>>,
) {
  const { type, data } = notification;
  switch (type) {
    case 'contact_accepted':
      if (data.contact_event_id) navigation.navigate('Conversation', {
        contactEventId: data.contact_event_id,
        otherPartyName: data.provider_name ?? 'Provider',
        otherPartyId: data.provider_id ?? '',
      });
      break;
    case 'rating_reminder':
      if (data.provider_id)
        navigation.navigate('RateProvider', {
          providerId: data.provider_id,
          providerName: data.provider_name ?? 'Provider',
          contactEventId: data.contact_event_id ?? null,
          ratingType: 'verified',
        });
      break;
    case 'push_discovery':
      if (data.provider_id)
        navigation.navigate('ProviderProfile', { providerId: data.provider_id });
      break;
    case 'saved_provider_update':
      navigation.navigate('SavedProviders');
      break;
    case 'lead_warning':
      navigation.navigate('ConsumerSubscription');
      break;
    case 'new_message':
      if (data.event_id) navigation.navigate('Conversation', {
        contactEventId: data.event_id,
        otherPartyName: data.provider_name ?? 'Provider',
        otherPartyId: data.provider_id ?? '',
      });
      break;
  }
}

// ─── Notification Card ────────────────────────────────────────────────────────

function NotificationCard({
  notification,
  onDismiss,
  onPress,
}: {
  notification: AppNotification;
  onDismiss: (id: string) => void;
  onPress: (notification: AppNotification) => void;
}) {
  const swipeRef = useRef<Swipeable>(null);
  const meta = NOTIFICATION_TYPE_META[notification.type];
  const colour = TYPE_COLOUR[notification.type];
  const isUnread = notification.readAt === null;

  const handleDismiss = useCallback(() => {
    swipeRef.current?.close();
    onDismiss(notification.id);
  }, [notification.id, onDismiss]);

  const renderLeftActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [0, 80],
      outputRange: [0.8, 1],
      extrapolate: 'clamp',
    });
    return (
      <TouchableOpacity style={styles.swipeDismiss} onPress={handleDismiss}>
        <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
          <Ionicons name="checkmark-done-outline" size={22} color="#fff" />
          <Text style={styles.swipeDismissText}>Dismiss</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  return (
    <Swipeable
      ref={swipeRef}
      renderLeftActions={renderLeftActions}
      leftThreshold={50}
      friction={2}
    >
      <TouchableOpacity
        style={[styles.notifCard, isUnread && styles.notifCardUnread]}
        onPress={() => onPress(notification)}
        activeOpacity={0.85}
      >
        {/* Unread dot */}
        {isUnread && <View style={[styles.unreadDot, { backgroundColor: colour }]} />}

        {/* Icon */}
        <View style={[styles.notifIconBox, { backgroundColor: colour + '18' }]}>
          <Ionicons name={meta.icon as any} size={20} color={colour} />
        </View>

        {/* Content */}
        <View style={styles.notifContent}>
          <View style={styles.notifTopRow}>
            <Text style={styles.notifTitle} numberOfLines={1}>
              {notification.title}
            </Text>
            <Text style={styles.notifTime}>{formatNotificationTime(notification.sentAt)}</Text>
          </View>
          <Text style={styles.notifBody} numberOfLines={2}>
            {notification.body}
          </Text>
          {/* Type pill */}
          <View style={[styles.typePill, { backgroundColor: colour + '18' }]}>
            <Text style={[styles.typePillText, { color: colour }]}>{meta.label}</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
}

// ─── Preferences Modal ────────────────────────────────────────────────────────

function PreferencesModal({
  visible,
  prefs,
  onClose,
  onToggle,
}: {
  visible: boolean;
  prefs: NotificationPreferences;
  onClose: () => void;
  onToggle: (type: NotificationType, value: boolean) => void;
}) {
  const types = Object.keys(NOTIFICATION_TYPE_META) as NotificationType[];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Notification Settings</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={24} color={DEEP_INK} />
          </TouchableOpacity>
        </View>
        <Text style={styles.modalSubtitle}>
          All notifications are sent via in-app only. Toggle to opt out of specific types.
        </Text>
        {types.map((type) => {
          const meta = NOTIFICATION_TYPE_META[type];
          const colour = TYPE_COLOUR[type];
          return (
            <View key={type} style={styles.prefRow}>
              <View style={[styles.prefIconBox, { backgroundColor: colour + '18' }]}>
                <Ionicons name={meta.icon as any} size={18} color={colour} />
              </View>
              <View style={styles.prefContent}>
                <Text style={styles.prefLabel}>{meta.label}</Text>
                <Text style={styles.prefDesc}>{meta.description}</Text>
              </View>
              <Switch
                value={prefs[type]}
                onValueChange={(val) => onToggle(type, val)}
                trackColor={{ false: '#D0CCC5', true: VERDIGRIS + '88' }}
                thumbColor={prefs[type] ? VERDIGRIS : '#888'}
              />
            </View>
          );
        })}
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const navigation = useNavigation<any>();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [prefsModalVisible, setPrefsModalVisible] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────────

  const loadNotifications = useCallback(
    async (pageNum: number, append = false) => {
      try {
        const res = await fetchNotifications(pageNum);
        // Filter to active (client-side 90-day guard)
        const active = res.notifications.filter(isNotificationActive);
        if (append) {
          setNotifications((prev) => [...prev, ...active]);
        } else {
          setNotifications(active);
        }
        setUnreadCount(res.unread_count);
        setHasMore(active.length === 30);
      } catch (err) {
        console.error('[NotificationsScreen]', err);
      }
    },
    [],
  );

  const loadPrefs = useCallback(async () => {
    try {
      const p = await fetchNotificationPreferences();
      setPrefs(p);
    } catch {
      // Use defaults — non-critical
    }
  }, []);

  useEffect(() => {
    Promise.all([loadNotifications(1), loadPrefs()]).finally(() => setLoading(false));
  }, [loadNotifications, loadPrefs]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    await loadNotifications(1);
    setRefreshing(false);
  }, [loadNotifications]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    await loadNotifications(nextPage, true);
    setPage(nextPage);
    setLoadingMore(false);
  }, [hasMore, loadingMore, page, loadNotifications]);

  // ── Dismiss (swipe or tap) ─────────────────────────────────────────────────

  const handleDismiss = useCallback(async (id: string) => {
    // Optimistic update
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await markNotificationRead(id);
    } catch {
      // Silent — non-critical, server will mark on next open
    }
  }, []);

  const handleNotifPress = useCallback(
    async (notification: AppNotification) => {
      // Mark read
      if (!notification.readAt) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n,
          ),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
        markNotificationRead(notification.id).catch(() => {});
      }
      routeNotification(notification, navigation);
    },
    [navigation],
  );

  const handleMarkAllRead = useCallback(() => {
    Alert.alert('Mark All Read', 'Mark all notifications as read?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark All',
        onPress: async () => {
          setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
          setUnreadCount(0);
          markAllNotificationsRead().catch(() => {});
        },
      },
    ]);
  }, []);

  // ── Preferences toggle ─────────────────────────────────────────────────────

  const handlePrefToggle = useCallback(
    async (type: NotificationType, value: boolean) => {
      const updated = { ...prefs, [type]: value };
      setPrefs(updated);
      setPrefsSaving(true);
      try {
        const saved = await updateNotificationPreferences({ [type]: value });
        setPrefs(saved);
      } catch {
        // Revert on error
        setPrefs(prefs);
        Alert.alert('Error', 'Could not save preference. Please try again.');
      } finally {
        setPrefsSaving(false);
      }
    },
    [prefs],
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: AppNotification }) => (
      <NotificationCard
        notification={item}
        onDismiss={handleDismiss}
        onPress={handleNotifPress}
      />
    ),
    [handleDismiss, handleNotifPress],
  );

  const renderFooter = useCallback(
    () =>
      loadingMore ? (
        <View style={styles.footerLoader}>
          <ActivityIndicator color={SAFFRON} size="small" />
        </View>
      ) : null,
    [loadingMore],
  );

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={SAFFRON} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header controls */}
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={DEEP_INK} />
        </TouchableOpacity>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          )}
        </View>
        <View style={styles.headerActions}>
          {unreadCount > 0 && (
            <TouchableOpacity onPress={handleMarkAllRead} style={styles.headerBtn}>
              <Ionicons name="checkmark-done-outline" size={20} color={VERDIGRIS} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => setPrefsModalVisible(true)}
            style={styles.headerBtn}
          >
            <Ionicons name="settings-outline" size={20} color={DEEP_INK} />
            {prefsSaving && (
              <ActivityIndicator
                size="small"
                color={SAFFRON}
                style={StyleSheet.absoluteFill}
              />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Swipe hint */}
      <View style={styles.hintBar}>
        <Ionicons name="arrow-forward-outline" size={12} color={GREY} />
        <Text style={styles.hintText}>Swipe right on a notification to dismiss</Text>
      </View>

      {notifications.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="notifications-off-outline" size={44} color={GREY} />
          <Text style={styles.emptyTitle}>No notifications</Text>
          <Text style={styles.emptySubtitle}>You're all caught up.</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={SAFFRON}
            />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Preferences modal */}
      <PreferencesModal
        visible={prefsModalVisible}
        prefs={prefs}
        onClose={() => setPrefsModalVisible(false)}
        onToggle={handlePrefToggle}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: IVORY },
  loader: { flex: 1, backgroundColor: IVORY, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingBottom: 32 },

  backBtn: {
    padding: 4,
    marginRight: 4,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DEEP_INK,
    fontFamily: 'Plus Jakarta Sans',
  },
  unreadBadge: {
    backgroundColor: SAFFRON,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
  },
  unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: { padding: 4 },

  hintBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: WARM_SAND,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  hintText: { fontSize: 11, color: GREY, fontFamily: 'Plus Jakarta Sans' },

  // Notification card
  notifCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: 12,
    position: 'relative',
  },
  notifCardUnread: { backgroundColor: '#FDFAF5' },
  unreadDot: {
    position: 'absolute',
    left: 6,
    top: '50%',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  notifIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  notifContent: { flex: 1 },
  notifTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 2,
  },
  notifTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: DEEP_INK,
    fontFamily: 'Plus Jakarta Sans',
    marginRight: 8,
  },
  notifTime: { fontSize: 11, color: GREY, fontFamily: 'Plus Jakarta Sans' },
  notifBody: {
    fontSize: 13,
    color: GREY,
    fontFamily: 'Plus Jakarta Sans',
    lineHeight: 18,
    marginBottom: 6,
  },
  typePill: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  typePillText: { fontSize: 10, fontWeight: '600', fontFamily: 'Plus Jakarta Sans' },

  swipeDismiss: {
    backgroundColor: VERDIGRIS,
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeDismissText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
    fontFamily: 'Plus Jakarta Sans',
  },

  footerLoader: { paddingVertical: 16, alignItems: 'center' },

  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: DEEP_INK, fontFamily: 'Plus Jakarta Sans' },
  emptySubtitle: { fontSize: 14, color: GREY, fontFamily: 'Plus Jakarta Sans' },

  // Preferences modal
  modalContainer: {
    flex: 1,
    backgroundColor: IVORY,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: DEEP_INK, fontFamily: 'Plus Jakarta Sans' },
  modalSubtitle: {
    fontSize: 13,
    color: GREY,
    fontFamily: 'Plus Jakarta Sans',
    marginBottom: 16,
    lineHeight: 18,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: 12,
  },
  prefIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  prefContent: { flex: 1 },
  prefLabel: { fontSize: 14, fontWeight: '600', color: DEEP_INK, fontFamily: 'Plus Jakarta Sans' },
  prefDesc: { fontSize: 12, color: GREY, fontFamily: 'Plus Jakarta Sans' },
});
