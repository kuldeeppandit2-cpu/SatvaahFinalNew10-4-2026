/**
 * fcmService.ts
 *
 * Wraps Firebase Admin SDK for FCM push delivery.
 *
 * Policy (wa_channel_policy = cac_and_extraordinary):
 *   ALL product notifications go through FCM.
 *   WhatsApp is NEVER used for product notifications.
 *   WhatsApp fallback for extraordinary events is handled exclusively by
 *   deliveryMonitorService after a 5-minute undelivered window.
 *
 * Critical rules enforced here:
 *   - Reads FCM token from users.fcm_token (never cache token in Redis — always fresh from DB)
 *   - Logs every attempt to notification_log
 *   - Does NOT call WhatsApp — that responsibility belongs to deliveryMonitorService
 */

import * as admin from 'firebase-admin';
import { prisma } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';

// ─── Firebase Admin initialisation ───────────────────────────────────────────
// Initialised once. In Docker the credentials are mounted via env var
// GOOGLE_APPLICATION_CREDENTIALS or injected as FIREBASE_SERVICE_ACCOUNT_JSON.
if (!admin.apps.length) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
    });
  } else {
    // Falls back to Application Default Credentials (ADC) in production (ECS task role / GCP)
    admin.initializeApp();
  }
}

const messaging = admin.messaging();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PushPayload {
  title: string;
  body:  string;
  /** Extra key-value pairs delivered in FCM data envelope (always string values). */
  data?: Record<string, string>;
}

// ─── sendPush ─────────────────────────────────────────────────────────────────

/**
 * Sends an FCM push notification to a user.
 *
 * @param userId   UUID of the user in the users table.
 * @param payload  { title, body, data }
 * @param eventType  event_type value stored in notification_log (e.g. 'new_contact_request')
 * @param correlationId  X-Correlation-ID for distributed tracing
 *
 * The function is void — callers do not need to await delivery confirmation.
 * Delivery status is tracked asynchronously via FCM delivery receipts written
 * to notification_log.delivered_at by the FCM webhook (if configured) or by
 * the delivery-monitor Lambda.
 */
export async function sendPush(
  userId:        string,
  payload:       PushPayload,
  eventType:     string,
  correlationId: string = '',
): Promise<void> {
  // ── 1. Fetch FCM token from DB (always fresh — tokens rotate) ────────────
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { fcm_token: true, wa_opted_out: true, deleted_at: true },
  });

  if (!user || user.deleted_at) {
    logger.warn({ user_id: userId, correlation_id: correlationId, msg: 'sendPush: user not found or deleted — skipping' });
    return;
  }

  const fcmToken = user.fcm_token;

  // ── 2. Create notification_log row immediately so the delivery monitor ────
  //       can detect the 5-minute window even if the send fails.
  const logRow = await prisma.notificationLog.create({
    data: {
      user_id:          userId,
      channel:          'fcm',
      event_type:       eventType,
      sent_at:          new Date(),
      delivered_at:     null,
      read_at:          null,
      fcm_message_id:   null,        // filled in after successful send
      wa_message_id:    null,
      wa_fallback_sent: false,
    },
  });

  if (!fcmToken) {
    logger.warn({
      user_id: userId,
      correlationId,
      notificationLogId: logRow.id,
      msg: 'sendPush: no FCM token on record — notification logged, no push sent',
    });
    return;
  }

  // ── 3. Send via Firebase Admin SDK ───────────────────────────────────────
  try {
    const message: admin.messaging.Message = {
      token: fcmToken,
      notification: {
        title: payload.title,
        body:  payload.body,
      },
      data: payload.data ?? {},
      android: {
        priority: 'high',
        notification: {
          channelId: 'satvaaah_alerts',
          sound:     'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound:            'default',
            badge:            1,
            contentAvailable: true,
          },
        },
      },
    };

    const fcmMessageId = await messaging.send(message);

    // ── 4. Stamp fcm_message_id in the log row ────────────────────────────
    await prisma.notificationLog.update({
      where: { id: logRow.id },
      data:  { fcm_message_id: fcmMessageId },
    });

    logger.info({
      user_id: userId,
      eventType,
      fcmMessageId,
      correlationId,
      notificationLogId: logRow.id,
      msg: 'sendPush: FCM message sent',
    });
  } catch (err: unknown) {
    const error = err as Error & { code?: string };

    // INVALID_ARGUMENT or UNREGISTERED means the token is stale → clear it
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      await prisma.user.update({
        where: { id: userId },
        data:  { fcm_token: null },
      });
      logger.warn({
        user_id: userId,
        correlationId,
        notificationLogId: logRow.id,
        errorCode: error.code,
        msg: 'sendPush: stale FCM token cleared from users table',
      });
    } else {
      logger.error({
        user_id: userId,
        eventType,
        correlationId,
        notificationLogId: logRow.id,
        err: error.message,
        msg: 'sendPush: FCM send failed',
      });
    }
    // Do not rethrow — push failures are non-blocking for the calling service
  }
}

// ─── markFcmDelivered ─────────────────────────────────────────────────────────
/**
 * Called by the FCM delivery receipt webhook (if configured in Firebase Console
 * for data messages on Android). Stamps delivered_at so the delivery monitor
 * knows it does not need to fire a WhatsApp fallback.
 */
export async function markFcmDelivered(
  fcmMessageId:  string,
  correlationId: string = '',
): Promise<void> {
  const updated = await prisma.notificationLog.updateMany({
    where: { fcm_message_id: fcmMessageId, delivered_at: null },
    data:  { delivered_at: new Date() },
  });

  logger.info({
    fcmMessageId,
    correlationId,
    rowsUpdated: updated.count,
    msg: 'markFcmDelivered: delivery receipt processed',
  });
}
