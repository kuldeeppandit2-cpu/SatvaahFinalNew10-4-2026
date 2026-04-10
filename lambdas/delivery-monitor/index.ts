/**
 * lambdas/delivery-monitor/index.ts
 * SatvAAh — Trust Layer for India's Informal Economy
 *
 * Trigger:  AWS EventBridge — rate(15 minutes)
 * Purpose:  Detect FCM push notifications that were sent but not delivered
 *           within the configured timeout window, and trigger WhatsApp fallback
 *           for high-priority events only.
 *
 * Logic:
 *   1. Query notification_log WHERE:
 *        channel = 'fcm'
 *        AND sent_at <= NOW() - fcm_fallback_timeout_minutes_lead (default 5 min)
 *        AND sent_at >= NOW() - 30 min  (avoid re-processing very old undelivered)
 *        AND delivered_at IS NULL
 *        AND wa_fallback_sent = false
 *        AND event_type IN ('NEW_LEAD', 'CONTACT_ACCEPTED')
 *
 *   2. For each undelivered notification:
 *        Resolve recipient phone number
 *        Determine WhatsApp template:
 *          NEW_LEAD        → template: new_contact_request  (provider receives)
 *          CONTACT_ACCEPTED → template: contact_accepted    (consumer receives)
 *
 *   3. Send via Gupshup
 *   4. UPDATE notification_log SET wa_fallback_sent = true, wa_message_id = ...
 *
 * CRITICAL: Do NOT fallback for:
 *   - rating_reminder_24h
 *   - discovery notifications (push_discovery)
 *   - Any other event type
 *   Only NEW_LEAD and CONTACT_ACCEPTED are extraordinary enough to warrant WA fallback.
 *
 * notification_log schema (V020):
 *   id UUID PK
 *   user_id UUID FK → users.id
 *   channel ENUM('fcm', 'whatsapp')
 *   event_type VARCHAR           — e.g. 'NEW_LEAD', 'CONTACT_ACCEPTED', 'RATING_REMINDER'
 *   sent_at TIMESTAMPTZ
 *   delivered_at TIMESTAMPTZ NULL
 *   read_at TIMESTAMPTZ NULL
 *   fcm_message_id VARCHAR NULL
 *   wa_message_id VARCHAR NULL
 *   wa_fallback_sent BOOLEAN DEFAULT false
 *   payload JSONB NULL           — { contact_event_id, provider_name, consumer_name, ... }
 *   created_at TIMESTAMPTZ DEFAULT NOW()
 *
 * Lambda config: 256 MB | 3-min timeout | Concurrency: 1 (EventBridge scheduled)
 */

import { EventBridgeEvent } from 'aws-lambda';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { createLogger, transports, format } from 'winston';

// ─────────────────────────────────────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────────────────────────────────────

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { lambda: 'delivery-monitor' },
  transports: [new transports.Console()],
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SystemConfig {
  fcm_fallback_timeout_minutes_lead: number;
  fcm_fallback_lookback_minutes: number;
  gupshup_api_key: string;
  gupshup_source_number: string;
  gupshup_app_name: string;
}

interface UndeliveredNotification {
  id: string;
  userId: string;
  eventType: string;
  sentAt: Date;
  fcmMessageId: string | null;
  payload: Record<string, unknown> | null;
}

interface RecipientInfo {
  phone: string;
  displayName: string;
  userId: string;
}

// Fallback-eligible event types — ONLY these two. Do not expand without code review.
const FALLBACK_EVENT_TYPES = ['new_contact_request', 'contact_accepted'] as const;
type FallbackEventType = (typeof FALLBACK_EVENT_TYPES)[number];

// WhatsApp template mapping (Meta pre-approved template names)
const FALLBACK_TEMPLATES: Record<FallbackEventType, string> = {
  new_contact_request: 'new_contact_request',         // template #4 in master template list
  contact_accepted: 'contact_accepted',    // template #5 in master template list
};

// ─────────────────────────────────────────────────────────────────────────────
// Config loader
// ─────────────────────────────────────────────────────────────────────────────

async function loadSystemConfig(prisma: PrismaClient): Promise<SystemConfig> {
  const keys = [
    'fcm_fallback_timeout_minutes_lead',
    'fcm_fallback_lookback_minutes',
    'gupshup_api_key',
    'gupshup_source_number',
    'gupshup_app_name',
  ];

  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });

  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return {
    fcm_fallback_timeout_minutes_lead: parseInt(
      cfg['fcm_fallback_timeout_minutes_lead'] ?? '5',
      10,
    ),
    // Look-back window prevents re-processing very old stuck notifications
    fcm_fallback_lookback_minutes: parseInt(cfg['fcm_fallback_lookback_minutes'] ?? '30', 10),
    gupshup_api_key: cfg['gupshup_api_key'] ?? '',
    gupshup_source_number: cfg['gupshup_source_number'] ?? '',
    gupshup_app_name: cfg['gupshup_app_name'] ?? 'SatvAAh',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve the recipient for the WhatsApp fallback
// ─────────────────────────────────────────────────────────────────────────────

async function resolveRecipient(
  prisma: PrismaClient,
  userId: string,
): Promise<RecipientInfo | null> {
  // user_id maps to users table; get phone and display name from associated profile
  const user = await prisma.user.findUnique({
    where: { id: userId, deleted_at: null },
    select: {
      id: true,
      phone: true,
      wa_opted_out: true,
      provider_profile: {
        select: { display_name: true },
      },
      consumer_profile: {
        select: { display_name: true },
      },
    },
  });

  if (!user) {
    logger.warn('User not found or deleted for fallback', { userId });
    return null;
  }

  if (user.wa_opted_out) {
    logger.info('User has opted out of WhatsApp — skipping fallback', { userId });
    return null;
  }

  if (!user.phone) {
    logger.warn('User has no phone number — cannot send fallback', { userId });
    return null;
  }

  const displayName =
    (user.provider_profile?.display_name || undefined) ??
    (user.consumer_profile?.display_name || undefined) ??
    'User';

  return {
    phone: user.phone,
    displayName: displayName,
    userId: userId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build WhatsApp template params from notification payload
// ─────────────────────────────────────────────────────────────────────────────

async function buildTemplateParams(
  prisma: PrismaClient,
  notification: UndeliveredNotification,
  recipient: RecipientInfo,
): Promise<string[]> {
  const firstName = (recipient.displayName ?? '').split(' ')[0] || 'there';
  const payload = notification.payload ?? {};

  if (notification.eventType === 'new_contact_request') {
    // Provider receives: "You have a new contact request from {consumer_name}"
    const consumerName = (payload['consumer_name'] as string | undefined) ?? 'a consumer';
    const contactType = (payload['contact_type'] as string | undefined) ?? 'message';
    return [firstName, consumerName, contactType];
  }

  if (notification.eventType === 'contact_accepted') {
    // Consumer receives: "Your contact request to {provider_name} has been accepted"
    const providerName = (payload['provider_name'] as string | undefined) ?? 'the provider';
    const providerPhone = (payload['provider_phone'] as string | undefined) ?? '';
    return [firstName, providerName, providerPhone];
  }

  return [firstName];
}

// ─────────────────────────────────────────────────────────────────────────────
// Gupshup — send WhatsApp template
// ─────────────────────────────────────────────────────────────────────────────

async function sendWhatsAppFallback(
  config: SystemConfig,
  phone: string,
  templateName: string,
  templateParams: string[],
  correlationId: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const url = 'https://api.gupshup.io/sm/api/v1/template/msg';

  const formData = new URLSearchParams({
    source: config.gupshup_source_number,
    destination: phone,
    template: JSON.stringify({ id: templateName, params: templateParams }),
    'src.name': config.gupshup_app_name,
  });

  try {
    const response = await axios.post<{ status: string; messageId?: string; message?: string }>(
      url,
      formData,
      {
        headers: {
          apikey: config.gupshup_api_key,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Correlation-ID': correlationId,
        },
        timeout: 10_000,
      },
    );

    const { status, messageId, message } = response.data;

    if (status === 'submitted' || status === 'queued') {
      return { success: true, messageId };
    }

    return { success: false, error: message ?? `Unexpected Gupshup status: ${status}` };
  } catch (err: any) {
    const errorMsg: string =
      err?.response?.data?.message ?? err.message ?? 'Gupshup request error';
    return { success: false, error: errorMsg };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Lambda handler
// ─────────────────────────────────────────────────────────────────────────────

export const handler = async (
  event: EventBridgeEvent<'Scheduled Event', Record<string, unknown>>,
): Promise<void> => {
  const runCorrelationId = uuidv4();

  logger.info('delivery-monitor invoked', {
    correlationId: runCorrelationId,
    eventTime: event.time,
  });

  const prisma = new PrismaClient({
    log: ['error'],
    datasources: { db: { url: process.env['DATABASE_URL'] } },
  });

  let fallbackSentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  try {
    // ── 1. Load config ──────────────────────────────────────────────────────
    const config = await loadSystemConfig(prisma);

    if (!config.gupshup_api_key || !config.gupshup_source_number) {
      logger.error('Gupshup credentials not configured — aborting', {
        correlationId: runCorrelationId,
      });
      return;
    }

    const timeoutMinutes = config.fcm_fallback_timeout_minutes_lead;     // default 5
    const lookbackMinutes = config.fcm_fallback_lookback_minutes;         // default 30

    logger.info('Delivery-monitor config', {
      timeoutMinutes,
      lookbackMinutes,
      correlationId: runCorrelationId,
    });

    // ── 2. Query undelivered FCM notifications in the fallback window ───────
    //
    //  sent_at BETWEEN (NOW - lookback) AND (NOW - timeout)
    //  → Notifications older than `timeout` minutes but younger than `lookback` minutes
    //  → channel = 'fcm', event_type IN ('NEW_LEAD', 'CONTACT_ACCEPTED')
    //  → delivered_at IS NULL
    //  → wa_fallback_sent = false (never already sent WA for this)
    //
    const undelivered = await prisma.$queryRaw<UndeliveredNotification[]>`
      SELECT
        nl.id,
        nl.user_id       AS "userId",
        nl.event_type    AS "eventType",
        nl.sent_at       AS "sentAt",
        nl.fcm_message_id AS "fcmMessageId",
        nl.payload
      FROM notification_log nl
      WHERE
        nl.channel = 'fcm'
        AND nl.event_type = ANY(ARRAY['new_contact_request','contact_accepted'])
        AND nl.sent_at <= NOW() - (${timeoutMinutes} || ' minutes')::INTERVAL
        AND nl.sent_at >= NOW() - (${lookbackMinutes} || ' minutes')::INTERVAL
        AND nl.delivered_at IS NULL
        AND nl.wa_fallback_sent = false
      ORDER BY nl.sent_at ASC
      LIMIT 200
      FOR UPDATE SKIP LOCKED
    `;

    logger.info('Undelivered FCM notifications found', {
      count: undelivered.length,
      correlationId: runCorrelationId,
    });

    if (undelivered.length === 0) {
      logger.info('No undelivered notifications — idle run', {
        correlationId: runCorrelationId,
      });
      return;
    }

    // ── 3. Process each undelivered notification ────────────────────────────
    for (const notification of undelivered) {
      const correlationId = uuidv4();

      // Guard: ensure only fallback-eligible events are processed
      // (belt-and-suspenders — the SQL already filters, but this is explicit)
      if (!FALLBACK_EVENT_TYPES.includes(notification.eventType as FallbackEventType)) {
        logger.warn('Non-fallback event slipped through query filter — skipping', {
          notificationId: notification.id,
          eventType: notification.eventType,
          correlationId,
        });
        skippedCount++;
        continue;
      }

      const eventType = notification.eventType as FallbackEventType;

      // ── 3a. Resolve recipient ─────────────────────────────────────────────
      const recipient = await resolveRecipient(prisma, notification.userId);

      if (!recipient) {
        // Cannot send — mark as handled to avoid infinite retries
        await prisma.$executeRaw`
          UPDATE notification_log
          SET wa_fallback_sent = true, updated_at = NOW()
          WHERE id = ${notification.id}::uuid
        `;
        skippedCount++;
        continue;
      }

      // ── 3b. Resolve template + params ─────────────────────────────────────
      const templateName = FALLBACK_TEMPLATES[eventType];
      const templateParams = await buildTemplateParams(prisma, notification, recipient);

      // ── 3c. Send WhatsApp fallback ────────────────────────────────────────
      logger.info('Sending WhatsApp fallback', {
        notificationId: notification.id,
        userId: notification.userId,
        eventType,
        template: templateName,
        originalFcmId: notification.fcmMessageId,
        sentAt: notification.sentAt.toISOString(),
        correlationId,
      });

      const result = await sendWhatsAppFallback(
        config,
        recipient.phone,
        templateName,
        templateParams,
        correlationId,
      );

      if (result.success) {
        // ── 3d. Mark fallback sent in notification_log ────────────────────
        await prisma.$executeRaw`
          UPDATE notification_log
          SET
            wa_fallback_sent = true,
            wa_message_id    = ${result.messageId ?? null},
            updated_at       = NOW()
          WHERE id = ${notification.id}::uuid
        `;

        fallbackSentCount++;

        logger.info('WhatsApp fallback sent', {
          notificationId: notification.id,
          userId: notification.userId,
          eventType,
          waMessageId: result.messageId,
          correlationId,
        });
      } else {
        // Log the failure but do NOT mark wa_fallback_sent=true
        // so it can be retried on the next Lambda execution (within lookback window)
        failedCount++;
        logger.warn('WhatsApp fallback failed', {
          notificationId: notification.id,
          userId: notification.userId,
          eventType,
          error: result.error,
          correlationId,
        });
      }
    }

    // ── 4. Run summary ──────────────────────────────────────────────────────
    logger.info('delivery-monitor run complete', {
      total: undelivered.length,
      fallbackSent: fallbackSentCount,
      skipped: skippedCount,
      failed: failedCount,
      correlationId: runCorrelationId,
    });
  } catch (err: any) {
    logger.error('delivery-monitor fatal error', {
      error: err.message,
      stack: err.stack,
      correlationId: runCorrelationId,
    });
    throw err;
  } finally {
    await prisma.$disconnect();
  }
};
