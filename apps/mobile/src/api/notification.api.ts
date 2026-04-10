/**
 * notification.api.ts
 * SatvAAh — Phase 21
 *
 * Endpoints:
 *   GET   /api/v1/notifications                      (notification :3006)
 *   PATCH /api/v1/notifications/:id/read             (notification :3006)
 *   PATCH /api/v1/consumers/me/settings              (user :3002)
 *
 * Notification policy:
 *   - 6 types: contact_accepted | rating_reminder | push_discovery |
 *     saved_provider_update | lead_warning | new_message
 *   - 90-day retention (expires_at enforced server-side, also checked client-side).
 *   - WhatsApp is NEVER used for product notifications (Rule #17).
 *     All notifications here are FCM in-app only.
 *   - Per-type opt-out stored in consumer_profiles.notification_prefs JSONB
 *     via PATCH /api/v1/consumers/me/settings.
 */

import { apiClient } from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'contact_accepted'
  | 'rating_reminder'
  | 'push_discovery'
  | 'saved_provider_update'
  | 'lead_warning'
  | 'new_message';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Structured payload for routing (provider_id, event_id, etc.) */
  data: Record<string, string>;
  readAt: string | null; // ISO 8601 UTC; null = unread
  sentAt: string; // ISO 8601 UTC
  /** 90 days from sent_at. Server enforces; client hides expired items. */
  expiresAt: string; // ISO 8601 UTC
}

export interface NotificationsListResponse {
  notifications: AppNotification[];
  unread_count: number;
  total: number;
}

/**
 * Per-type opt-out preferences.
 * true  = notifications enabled (default for all types)
 * false = user has opted out of this type
 */
export interface NotificationPreferences {
  contact_accepted: boolean;
  rating_reminder: boolean;
  push_discovery: boolean;
  saved_provider_update: boolean;
  lead_warning: boolean;
  new_message: boolean;
}

// Default preferences — all enabled
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  contact_accepted: true,
  rating_reminder: true,
  push_discovery: true,
  saved_provider_update: true,
  lead_warning: true,
  new_message: true,
};

// ─── Human-readable metadata per notification type ────────────────────────────

export interface NotificationTypeMeta {
  label: string;
  description: string;
  icon: string; // Ionicons name
}

export const NOTIFICATION_TYPE_META: Record<NotificationType, NotificationTypeMeta> = {
  contact_accepted: {
    label: 'Contact Accepted',
    description: 'When a provider accepts your contact request',
    icon: 'checkmark-circle-outline',
  },
  rating_reminder: {
    label: 'Rating Reminders',
    description: 'Prompts to rate providers after a contact',
    icon: 'star-outline',
  },
  push_discovery: {
    label: 'Provider Discovery',
    description: 'New providers matching your past searches',
    icon: 'search-outline',
  },
  saved_provider_update: {
    label: 'Saved Provider Updates',
    description: 'Trust score changes for providers you saved',
    icon: 'bookmark-outline',
  },
  lead_warning: {
    label: 'Lead Warnings',
    description: 'Alerts when your lead balance is running low',
    icon: 'warning-outline',
  },
  new_message: {
    label: 'New Messages',
    description: 'Incoming messages from providers',
    icon: 'chatbubble-outline',
  },
};

// ─── API Functions ────────────────────────────────────────────────────────────

/**
 * Fetch paginated notification log for the authenticated user.
 * Notifications older than 90 days are excluded server-side.
 * Default: most recent first, page size 30.
 */
export async function fetchNotifications(page = 1): Promise<NotificationsListResponse> {
  const response = await apiClient.get<{
    success: true;
    data: AppNotification[];
    meta: { total: number; page: number; pages: number; unread_count: number };
  }>(`/api/v1/notifications?page=${page}`);

  return {
    notifications: response.data.data,
    unread_count: response.data.meta.unread_count,
    total: response.data.meta.total,
  };
}

/**
 * Mark a single notification as read.
 * PATCH /api/v1/notifications/:id/read
 * Idempotent — safe to call multiple times.
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  await apiClient.patch(`/api/v1/notifications/${notificationId}/read`);
}

/**
 * Mark ALL unread notifications as read.
 * PATCH /api/v1/notifications/read-all
 */
export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.patch('/api/v1/notifications/read-all');
}

/**
 * Update notification opt-out preferences for the consumer.
 * Partial update — only include keys to change.
 * Stored in consumer_profiles.notification_prefs JSONB via user service.
 */
export async function updateNotificationPreferences(
  prefs: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const response = await apiClient.patch<{
    success: true;
    data: { notification_prefs: NotificationPreferences };
  }>('/api/v1/consumers/me/settings', { notification_prefs: prefs });
  return response.data.data.notification_prefs;
}

/**
 * Fetch the current notification preferences for the consumer.
 * Part of GET /api/v1/consumers/me response — extracted here for clarity.
 */
export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const response = await apiClient.get<{
    success: true;
    data: { notification_prefs: NotificationPreferences };
  }>('/api/v1/consumers/me/settings');
  return response.data.data.notification_prefs ?? DEFAULT_NOTIFICATION_PREFERENCES;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true if a notification has not yet expired (within 90-day window).
 * Client-side guard; server already filters but belt-and-suspenders.
 */
export function isNotificationActive(notification: AppNotification): boolean {
  return new Date(notification.expiresAt) > new Date();
}

/**
 * Format a sent_at ISO timestamp for display in the notification list.
 * Uses Asia/Kolkata (IST) locale.
 * < 1 min → "Just now"
 * < 60 min → "X min ago"
 * < 24 h → "X hr ago"
 * < 7 days → "X days ago"
 * else → "DD MMM" (e.g. "2 Apr")
 */
export function formatNotificationTime(isoUtc: string): string {
  const now = Date.now();
  const ms = now - new Date(isoUtc).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(isoUtc).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}
