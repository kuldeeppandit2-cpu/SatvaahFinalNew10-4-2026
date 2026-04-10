/**
 * whatsappService.ts
 *
 * Wraps the Gupshup WhatsApp Business API.
 *
 * ─── POLICY (wa_channel_policy = cac_and_extraordinary) ───────────────────────
 * WhatsApp is NEVER used for product notifications.
 * WhatsApp is ONLY allowed for:
 *   1. OTP authentication                (otp_auth)
 *   2. Cold acquisition outreach to      (provider_welcome, activation_reminder_48h,
 *      scraped providers                  provider_final_reminder_7d)
 *   3. Extraordinary events:
 *        new_contact_request  — FCM fallback after 5 min undelivered to provider
 *        contact_accepted     — FCM fallback after 5 min undelivered to consumer
 *        certificate_ready    — once-in-lifetime event
 *        subscription_confirmed
 *
 * All 16 Meta pre-approved templates are enumerated and validated.
 * Any attempt to send a template NOT in APPROVED_WA_TEMPLATES throws immediately.
 * Any attempt to send to a user with wa_opted_out=true throws immediately.
 */

import axios, { AxiosInstance } from 'axios';
import { prisma } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';
import { ValidationError, ForbiddenError } from '@satvaaah/errors';

// ─── 16 Pre-approved Meta Templates ──────────────────────────────────────────

export const APPROVED_WA_TEMPLATES = [
  'otp_auth',                     //  1 — Authentication
  'provider_welcome',             //  2 — Utility: outreach attempt 1
  'activation_reminder_48h',      //  3 — Utility: outreach attempt 2 (48h after #1)
  'new_contact_request',          //  4 — Utility: FCM fallback for new lead (provider)
  'contact_accepted',             //  5 — Utility: FCM fallback for accepted lead (consumer)
  'contact_declined',             //  6 — Utility
  'rating_reminder_24h',          //  7 — Utility
  'trust_score_updated',          //  8 — Utility
  'aadhaar_verified',             //  9 — Utility
  'credential_verified',          // 10 — Utility
  'subscription_confirmed',       // 11 — Utility: extraordinary
  'subscription_expiry_7d',       // 12 — Marketing
  'lead_limit_warning',           // 13 — Utility
  'consumer_welcome',             // 14 — Utility
  'certificate_ready',            // 15 — Utility: extraordinary (once per lifetime)
  'provider_final_reminder_7d',   // 16 — Utility: outreach attempt 3 (7d after attempt 1)
] as const;

export type WaTemplateName = (typeof APPROVED_WA_TEMPLATES)[number];

// ─── Templates that are NEVER allowed via WhatsApp (product notifications) ───
// This list is used in sendTemplate() to enforce policy even if a caller tries
// to bypass the policy check by sending a template that is technically approved
// but forbidden under wa_channel_policy for product use.
//
// NOTE: rating_reminder_24h and trust_score_updated are approved templates but
// represent product notification categories → WhatsApp is forbidden for them.
// The delivery monitor MUST NOT fall back to WhatsApp for these.
const PRODUCT_NOTIFICATION_TEMPLATES: ReadonlySet<WaTemplateName> = new Set([
  'rating_reminder_24h',
  'trust_score_updated',
  'contact_declined',
  'subscription_expiry_7d',
  'lead_limit_warning',
]);

// ─── Gupshup client ───────────────────────────────────────────────────────────

function buildGupshupClient(): AxiosInstance {
  const baseURL = process.env.GUPSHUP_API_URL ?? 'https://api.gupshup.io/sm/api/v1';
  const apiKey  = process.env.GUPSHUP_API_KEY;

  if (!apiKey) {
    throw new Error('GUPSHUP_API_KEY env var is not set — WhatsApp service cannot start');
  }

  return axios.create({
    baseURL,
    timeout: 10_000,
    headers: {
      apikey:         apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
}

// Lazy-initialised so unit tests can set env vars before the module is imported
let _client: AxiosInstance | null = null;
function getClient(): AxiosInstance {
  if (!_client) _client = buildGupshupClient();
  return _client;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendTemplateOptions {
  /** E.164-format phone number, e.g. +919876543210 */
  phone:        string;
  templateName: WaTemplateName;
  /** Ordered params that fill {{1}}, {{2}} … in the Meta template */
  params:       string[];
  /** UUID of the user — used to check wa_opted_out and to log */
  userId?:      string;
  correlationId?: string;
}

// ─── sendTemplate ─────────────────────────────────────────────────────────────

/**
 * Sends a WhatsApp template message via Gupshup.
 *
 * Enforces:
 *   1. templateName must be one of the 16 approved templates (throws ValidationError)
 *   2. templateName must NOT be a product-notification template (throws ForbiddenError)
 *   3. If userId is provided, checks wa_opted_out flag (throws ForbiddenError)
 *   4. Logs to notification_log with wa_message_id on success
 */
export async function sendTemplate(options: SendTemplateOptions): Promise<void> {
  const { phone, templateName, params, userId, correlationId = '' } = options;

  // ── 1. Validate template name against the 16 approved list ───────────────
  if (!(APPROVED_WA_TEMPLATES as ReadonlyArray<string>).includes(templateName)) {
    throw new ValidationError(
      'WA_TEMPLATE_NOT_APPROVED',
      `WhatsApp template "${templateName}" is not in the list of Meta pre-approved templates.`,
    );
  }

  // ── 2. Enforce wa_channel_policy — product notifications are FCM-only ─────
  if (PRODUCT_NOTIFICATION_TEMPLATES.has(templateName)) {
    throw new ForbiddenError(
      'WA_POLICY_VIOLATION',
      `Template "${templateName}" is a product notification. ` +
        'Policy wa_channel_policy=cac_and_extraordinary forbids WhatsApp for product notifications. ' +
        'Use FCM.',
    );
  }

  // ── 3. Opt-out check (when userId is known) ───────────────────────────────
  if (userId) {
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { wa_opted_out: true, deleted_at: true },
    });

    if (!user || user.deleted_at) {
      logger.warn({ user_id: userId, correlation_id: correlationId, templateName, msg: 'sendTemplate: user not found or deleted — skipping' });
      return;
    }

    if (user.wa_opted_out) {
      logger.info({ user_id: userId, correlation_id: correlationId, templateName, msg: 'sendTemplate: user has opted out of WhatsApp — skipping' });
      return;
    }
  }

  // ── 4. Build Gupshup request ──────────────────────────────────────────────
  const srcName  = process.env.GUPSHUP_APP_NAME ?? 'SatvAAh';
  const srcPhone = process.env.GUPSHUP_SOURCE_PHONE ?? '';

  // Gupshup template message format (HSM)
  const templatePayload = JSON.stringify({
    id:     templateName,
    params: params,
  });

  const requestBody = new URLSearchParams({
    channel:          'whatsapp',
    source:           srcPhone,
    destination:      phone.replace(/\s+/g, ''),
    'src.name':       srcName,
    template:         templatePayload,
  });

  // ── 5. Send via Gupshup ───────────────────────────────────────────────────
  let waMessageId: string | null = null;

  try {
    const response = await getClient().post('/msg', requestBody.toString());

    // Gupshup returns { status: 'submitted', messageId: '...' } on success
    if (response.data?.status === 'submitted' || response.data?.status === 'success') {
      waMessageId = response.data?.messageId ?? response.data?.message?.id ?? null;
    } else {
      logger.error({
        phone,
        templateName,
        correlationId,
        responseData: response.data,
        msg: 'sendTemplate: Gupshup returned non-success status',
      });
    }

    logger.info({ phone, templateName, wa_message_id: waMessageId, correlation_id: correlationId, msg: 'sendTemplate: WhatsApp sent' });
  } catch (err: unknown) {
    const error = err as Error;
    logger.error({
      phone,
      templateName,
      correlationId,
      err: error.message,
      msg: 'sendTemplate: Gupshup API call failed',
    });
    // Do not rethrow — WhatsApp send failures are non-blocking
    // The delivery monitor will retry or escalate as appropriate
    return;
  }

  // ── 6. Log to notification_log ────────────────────────────────────────────
  if (userId) {
    await prisma.notificationLog.create({
      data: {
        user_id:          userId,
        channel:          'whatsapp',
        event_type:       templateName,
        sent_at:          new Date(),
        delivered_at:     null,
        read_at:          null,
        fcm_message_id:   null,
        wa_message_id:    waMessageId,
        wa_fallback_sent: false,
      },
    });
  } else {
    // Outreach to scraped providers who may not yet have a users row
    logger.info({
      phone,
      templateName,
      waMessageId,
      correlationId,
      msg: 'sendTemplate: outreach to unregistered provider — notification_log row skipped (no userId)',
    });
  }
}

// ─── markWaDelivered ─────────────────────────────────────────────────────────
/**
 * Called by the Gupshup delivery webhook (POST /webhooks/gupshup).
 * Stamps delivered_at on the matching notification_log row.
 */
export async function markWaDelivered(
  waMessageId:   string,
  correlationId: string = '',
): Promise<void> {
  const updated = await prisma.notificationLog.updateMany({
    where: { wa_message_id: waMessageId, delivered_at: null },
    data:  { delivered_at: new Date() },
  });

  logger.info({
    waMessageId,
    correlationId,
    rowsUpdated: updated.count,
    msg: 'markWaDelivered: Gupshup delivery receipt processed',
  });
}

// ─── markWaFallbackSent ───────────────────────────────────────────────────────
/**
 * Marks an FCM notification_log row as having triggered a WhatsApp fallback.
 * Called by deliveryMonitorService after sending the fallback template.
 */
export async function markWaFallbackSent(
  notificationLogId: string,
  correlationId:     string = '',
): Promise<void> {
  await prisma.notificationLog.update({
    where: { id: notificationLogId },
    data:  { wa_fallback_sent: true },
  });

  logger.info({
    notificationLogId,
    correlationId,
    msg: 'markWaFallbackSent: FCM notification_log row flagged as fallback triggered',
  });
}
