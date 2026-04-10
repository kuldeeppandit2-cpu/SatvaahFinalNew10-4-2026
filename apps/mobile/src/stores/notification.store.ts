/**
 * SatvAAh Notification Store — Zustand
 * FCM token registration · notification list · unread count
 * Rule: WhatsApp NEVER for product notifications — FCM only
 */

import { create } from 'zustand';

export type NotificationChannel = 'fcm' | 'whatsapp';
export type NotificationEventType =
  | 'new_lead'
  | 'lead_accepted'
  | 'lead_declined'
  | 'trust_score_updated'
  | 'rating_reminder'
  | 'push_discovery'
  | 'certificate_ready'
  | 'subscription_confirmed'
  | 'message_received';

export interface AppNotification {
  notificationId: string;
  eventType: NotificationEventType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  readAt: string | null;
  sentAt: string;
  // Deep link target
  deepLinkUrl?: string;
}

export interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  fcmToken: string | null;

  // Actions
  setNotifications: (notifications: AppNotification[]) => void;
  addNotification: (notification: AppNotification) => void;
  markRead: (notificationId: string) => void;
  markAllRead: () => void;
  setFcmToken: (token: string) => void;
  reset: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  fcmToken: null,

  setNotifications: (notifications): void =>
    set({
      notifications,
      unreadCount: notifications.filter((n) => n.readAt === null).length,
    }),

  addNotification: (notification): void => {
    const current = get().notifications;
    const updated = [notification, ...current];
    set({
      notifications: updated,
      unreadCount: updated.filter((n) => n.readAt === null).length,
    });
  },

  markRead: (notificationId): void => {
    const updated = get().notifications.map((n) =>
      n.notificationId === notificationId
        ? { ...n, readAt: new Date().toISOString() }
        : n,
    );
    set({
      notifications: updated,
      unreadCount: updated.filter((n) => n.readAt === null).length,
    });
  },

  markAllRead: (): void => {
    const now = new Date().toISOString();
    const updated = get().notifications.map((n) => ({ ...n, readAt: n.readAt ?? now }));
    set({ notifications: updated, unreadCount: 0 });
  },

  setFcmToken: (token): void => set({ fcmToken: token }),

  reset: (): void => set({ notifications: [], unreadCount: 0, fcmToken: null }),
}));
