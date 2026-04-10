/**
 * SatvAAh — Notification Client (used by User Service)
 *
 * Thin HTTP wrapper around the Notification Service (port 3006).
 * Sends notifications for:
 * - new_contact_request (provider receives lead)
 * - contact_accepted (consumer learns provider accepted)
 * - contact_declined (consumer learns provider declined)
 * - no_show_reroute (consumer rerouted after no-show)
 */

import { logger } from '@satvaaah/logger';

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL ?? 'http://notification:3006';

// Notification service uses x-internal-key, not Bearer token
function serviceHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-internal-key': process.env.INTERNAL_SERVICE_KEY ?? '',
  };
}

export interface FcmNotificationPayload {
  userId: string;       // user.id — notification service looks up fcm_token from DB
  eventType: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}

export async function sendFcmNotification(params: FcmNotificationPayload): Promise<void> {
  const { userId, eventType, payload, correlationId } = params;

  const response = await fetch(
    `${NOTIFICATION_SERVICE_URL}/api/v1/internal/notify/fcm`,
    {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({
        user_id:    userId,
        event_type: eventType,
        data:       payload,
      }),
    },
  );

  if (!response.ok) {
    logger.warn('notification_client.fcm.failed', {
      eventType,
      status: response.status,
      correlation_id: correlationId,
    });
    throw new Error(`FCM notification failed: ${response.status}`);
  }
}
