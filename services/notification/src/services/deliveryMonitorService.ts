/**
 * deliveryMonitorService.ts
 *
 * Called by the delivery-monitor Lambda (lambdas/delivery-monitor/)
 * via EventBridge every 15 minutes.
 *
 * ─── Responsibility ────────────────────────────────────────────────────────
 * Detects FCM notifications that were sent > 5 minutes ago but have
 * delivered_at = NULL (i.e. undelivered).
 *
 * ─── Fallback matrix ───────────────────────────────────────────────────────
 *  event_type                | WhatsApp fallback?  | Template
 * ──────────────────────────┼────────────────────┼──────────────────────────
 *  new_contact_request       | YES                | new_contact_request
 *  contact_accepted          | YES                | contact_accepted
 *  certificate_ready         | YES                | certificate_ready
 *  subscription_confirmed    | YES                | subscription_confirmed
 *  rating_reminder_24h       | NO  ← HARD RULE    | —
 *  trust_score_updated       | NO  ← HARD RULE    | —
 *  contact_declined          | NO                 | —
 *  subscription_expiry_7d    | NO                 | —
 *  lead_limit_warning        | NO                 | —
 *  (all others)              | NO                 | —
 *
 * This policy implements wa_channel_policy = cac_and_extraordinary.
 * Rating reminders are explicitly excluded from WhatsApp fallback even though
 * rating_reminder_24h exists as an approved template — the policy forbids it.
 *
 * ─── Idempotency ───────────────────────────────────────────────────────────
 * wa_fallback_sent flag prevents duplicate WhatsApp messages if the Lambda
 * runs multiple times for the same window.
 */

import { prisma } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';
import { sendTemplate, markWaFallbackSent, WaTemplateName } from './whatsappService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UndeliveredRow {
  id:          string;
  userId:     string;
  eventType:  string;
  sentAt:     Date;
}

// ─── Fallback rules ───────────────────────────────────────────────────────────
// Map from event_type → WhatsApp template name.
// Only event_types listed here trigger a fallback. All others are silently skipped.
const FALLBACK_RULES: ReadonlyMap<string, WaTemplateName> = new Map([
  ['new_contact_request',   'new_contact_request'],
  ['contact_accepted',      'contact_accepted'],
  ['certificate_ready',     'certificate_ready'],
  ['subscription_confirmed','subscription_confirmed'],
]);

// ─── checkUndeliveredLeads ────────────────────────────────────────────────────

/**
 * Entry point called by the delivery-monitor Lambda.
 *
 * Steps:
 *  1. Query notification_log for FCM rows: sent > 5 min ago, not delivered, no fallback yet
 *  2. For each row: look up the user's phone number
 *  3. Apply fallback rules — send WhatsApp only for the allowed extraordinary events
 *  4. Mark wa_fallback_sent = true to prevent double-sends
 *
 * @param correlationId  X-Correlation-ID from the Lambda invocation
 */
export async function checkUndeliveredLeads(correlationId: string = ''): Promise<void> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1_000);

  // ── 1. Find all undelivered FCM notifications older than 5 minutes ───────
  const undelivered: UndeliveredRow[] = await prisma.notificationLog.findMany({
    where: {
      channel:          'fcm',
      sent_at:          { lt: fiveMinutesAgo },   // sent more than 5 min ago
      delivered_at:     null,                      // not confirmed delivered
      wa_fallback_sent: false,                     // no fallback sent yet
    },
    select: {
      id:         true,
      user_id:    true,
      event_type: true,
      sent_at:    true,
    },
    orderBy: { sent_at: 'asc' },
    take: 500,  // process in batches of 500 per Lambda invocation
  });

  if (undelivered.length === 0) {
    logger.info({ correlation_id: correlationId, msg: 'deliveryMonitor: no undelivered FCM notifications found' });
    return;
  }

  logger.info({
    correlationId,
    count: undelivered.length,
    msg: 'deliveryMonitor: found undelivered FCM notifications',
  });

  // ── 2. Process each undelivered notification ─────────────────────────────
  let fallbackSent    = 0;
  let fallbackSkipped = 0;
  let errors          = 0;

  for (const row of undelivered) {
    const waTemplate = FALLBACK_RULES.get(row.event_type);

    // ── 2a. No fallback rule → skip silently ─────────────────────────────
    if (!waTemplate) {
      // IMPORTANT: rating_reminder_24h explicitly falls here.
      // DO NOT add it to FALLBACK_RULES even if the template exists.
      logger.debug({
        notificationLogId: row.id,
        event_type:         row.event_type,
        correlationId,
        msg: 'deliveryMonitor: no WhatsApp fallback rule for this event_type — skipping',
      });
      fallbackSkipped++;
      continue;
    }

    try {
      // ── 2b. Look up user phone number ────────────────────────────────
      const user = await prisma.user.findUnique({
        where:  { id: row.user_id },
        select: { phone: true, wa_opted_out: true, deleted_at: true },
      });

      if (!user || user.deleted_at) {
        logger.warn({
          user_id:            row.user_id,
          notificationLogId: row.id,
          correlationId,
          msg: 'deliveryMonitor: user not found or deleted — skipping fallback',
        });
        fallbackSkipped++;
        continue;
      }

      if (user.wa_opted_out) {
        logger.info({
          user_id:            row.user_id,
          notificationLogId: row.id,
          correlationId,
          msg: 'deliveryMonitor: user opted out of WhatsApp — skipping fallback',
        });
        // Still mark as fallback_sent so we do not re-attempt every 15 min
        await markWaFallbackSent(row.id, correlationId);
        fallbackSkipped++;
        continue;
      }

      // ── 2c. Build template params ─────────────────────────────────────
      const params = await buildFallbackParams(row.event_type as WaTemplateName, row.user_id);

      // ── 2d. Send WhatsApp fallback ────────────────────────────────────
      await sendTemplate({
        phone:        user.phone,
        templateName: waTemplate,
        params,
        user_id:       row.user_id,
        correlationId,
      });

      // ── 2e. Mark fallback as sent on the original FCM log row ─────────
      await markWaFallbackSent(row.id, correlationId);

      logger.info({
        user_id:            row.user_id,
        notificationLogId: row.id,
        event_type:         row.event_type,
        waTemplate,
        correlationId,
        msg: 'deliveryMonitor: WhatsApp fallback sent',
      });

      fallbackSent++;
    } catch (err: unknown) {
      const error = err as Error;
      logger.error({
        notificationLogId: row.id,
        user_id:            row.user_id,
        event_type:         row.event_type,
        correlationId,
        err:               error.message,
        msg: 'deliveryMonitor: error processing fallback for notification',
      });
      errors++;
      // Continue processing remaining rows — do not abort the entire batch
    }
  }

  logger.info({
    correlationId,
    total:          undelivered.length,
    fallbackSent,
    fallbackSkipped,
    errors,
    msg: 'deliveryMonitor: batch complete',
  });
}

// ─── buildFallbackParams ──────────────────────────────────────────────────────
/**
 * Builds the ordered parameter list for each extraordinary WhatsApp template.
 *
 * Template parameters match the Meta-approved template bodies. The exact
 * parameter order must match what was submitted to Meta during template approval.
 *
 * If a required entity (e.g. contact_event, certificate) is not found, we fall
 * back to generic but safe strings rather than throwing — the WhatsApp message
 * should always go out, even if with degraded personalisation.
 */
async function buildFallbackParams(
  eventType: WaTemplateName,
  userId:    string,
): Promise<string[]> {
  switch (eventType) {
    case 'new_contact_request': {
      // Template: "You have a new lead on SatvAAh. Open the app to view and respond."
      // Params: [provider_display_name]
      const provider = await prisma.providerProfile.findFirst({
        where:  { user_id: userId },
        select: { display_name: true },
      });
      return [provider?.display_name ?? 'Provider'];
    }

    case 'contact_accepted': {
      // Template: "Your contact request has been accepted. Check the app for provider details."
      // Params: [consumer_display_name]
      const consumer = await prisma.consumerProfile.findFirst({
        where:  { user_id: userId },
        select: { display_name: true },
      });
      return [consumer?.display_name ?? 'User'];
    }

    case 'certificate_ready': {
      // Template: "Your SatvAAh Certificate of Verification is ready. You've reached Highly Trusted status."
      // Params: [provider_display_name, certificate_id, verification_url]
      const provider = await prisma.providerProfile.findFirst({
        where:  { user_id: userId },
        select: { display_name: true },
      });
      const cert = await prisma.certificateRecord.findFirst({
        where:  { provider: { user_id: userId } },
        select: { certificate_id: true, verification_url: true },
        orderBy: { issued_at: 'desc' },
      });
      return [
        provider?.display_name ?? 'Provider',
        cert?.certificate_id   ?? '',
        cert?.verification_url ?? 'https://satvaaah.com/verify',
      ];
    }

    case 'subscription_confirmed': {
      // Template: "Your SatvAAh subscription is now active. Welcome aboard!"
      // Params: [user_display_name, plan_name]
      const consumer = await prisma.consumerProfile.findFirst({
        where:  { user_id: userId },
        select: { display_name: true },
      });
      const sub = await prisma.subscriptionRecord.findFirst({
        where:   { user_id: userId, status: 'active' },
        select:  { plan: { select: { tier: true } } },
        orderBy: { created_at: 'desc' },
      });
      return [
        consumer?.display_name ?? 'User',
        sub?.plan?.tier        ?? 'Gold',
      ];
    }

    default:
      // Should never be reached because FALLBACK_RULES only maps the 4 cases above
      return [];
  }
}
