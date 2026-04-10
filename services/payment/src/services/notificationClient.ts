import { ExternalServiceError } from '@satvaaah/errors';
/**
 * SatvAAh — Notification Client (used by Payment Service)
 *
 * Calls the notification service internal endpoint after subscription activation.
 * subscription_confirmed is an Extraordinary event — WhatsApp fallback is allowed.
 */

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL ?? 'http://notification:3006';

// Notification service requires x-internal-key (NOT Authorization Bearer)
function serviceHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-internal-key': process.env.INTERNAL_SERVICE_KEY ?? '',
  };
}

// ─── FCM ──────────────────────────────────────────────────────────────────────
export async function sendSubscriptionConfirmedFCM(
  userId: string,
  data: { plan_name: string; amountPaise: number; lead_credits: number },
): Promise<void> {
  const response = await fetch(
    `${NOTIFICATION_SERVICE_URL}/api/v1/internal/notify/fcm`,
    {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({
        user_id:    userId,
        event_type: 'subscription_confirmed',
        data: {
          plan_name:      data.plan_name,
          amount_display: `₹${Math.round(data.amountPaise / 100)}`,  // amountPaise not amount_paise
          lead_credits:   String(data.lead_credits),
        },
      }),
    },
  );

  if (!response.ok) {
    throw new ExternalServiceError('notification', `FCM service returned ${response.status}`);
  }
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
export async function sendSubscriptionConfirmedWhatsApp(
  userId: string,
  data: { plan_name: string; amountPaise: number; lead_credits?: number },
): Promise<void> {
  const response = await fetch(
    `${NOTIFICATION_SERVICE_URL}/api/v1/internal/notify/whatsapp`,
    {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({
        user_id:       userId,
        template_name: 'subscription_confirmed',
        data: {
          plan_name:      data.plan_name,
          amount_display: `₹${Math.round(data.amountPaise / 100)}`,
          lead_credits:   String(data.lead_credits),
        },
      }),
    },
  );

  if (!response.ok) {
    // WhatsApp fallback failure is non-fatal — FCM is primary
    console.warn(`WhatsApp notification failed: ${response.status}`);
  }
}
