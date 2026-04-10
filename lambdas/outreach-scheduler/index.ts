/**
 * lambdas/outreach-scheduler/index.ts
 * SatvAAh — Trust Layer for India's Informal Economy
 *
 * Trigger:  AWS EventBridge — rate(15 minutes)
 * Purpose:  Send 3-message WhatsApp outreach sequence to scraped providers
 *           who have not yet claimed their listing.
 *
 * Sequence:
 *   Attempt 1 → template: provider_welcome          (immediate on first schedule)
 *   Attempt 2 → template: activation_reminder_48h   (48h after attempt 1)
 *   Attempt 3 → template: provider_final_reminder_7d (7d after attempt 1)
 *
 * Stop conditions (checked BEFORE each send):
 *   - provider_profiles.is_claimed = true
 *   - users.wa_opted_out = true (if user record exists for the scraped provider)
 *   - attempt_number already at 3 and sent (sequence exhausted)
 *
 * Rate limiting:
 *   Meta WABA allows outreach_batch_size_per_hour messages/hour (system_config).
 *   Each 15-min run takes at most floor(limit / 4) records.
 *   FOR UPDATE SKIP LOCKED ensures no two concurrent Lambda instances double-send.
 *
 * outreach_schedule schema (V028):
 *   id UUID PK
 *   provider_id UUID FK → provider_profiles.id
 *   phone VARCHAR(15)           — E.164 scraped phone
 *   display_name VARCHAR(255)   — for template personalisation
 *   attempt_number INT          — 1 | 2 | 3
 *   status VARCHAR              — pending | sent | failed | opted_out | claimed | exhausted
 *   scheduled_at TIMESTAMPTZ    — when to fire this attempt
 *   sent_at TIMESTAMPTZ NULL
 *   wa_message_id VARCHAR NULL  — Gupshup response messageId
 *   error_message TEXT NULL
 *   correlation_id VARCHAR NULL
 *   created_at TIMESTAMPTZ DEFAULT NOW()
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 *
 * Lambda config: 256 MB | 5-min timeout | Concurrency: 1 (EventBridge scheduled)
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
  defaultMeta: { lambda: 'outreach-scheduler' },
  transports: [new transports.Console()],
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SystemConfig {
  outreach_batch_size_per_hour: number;
  outreach_attempt2_delay_hours: number;
  outreach_attempt3_delay_days: number;
  gupshup_api_key: string;
  gupshup_source_number: string;
  gupshup_app_name: string;
}

interface OutreachRecord {
  id:             string;
  providerId:     string;
  phone:          string;
  displayName:    string;
  attemptNumber:  number;
  status:         string;
  scheduledAt:    Date;
  correlationId:  string | null;
}

// WhatsApp pre-approved template names — must match Meta submission exactly
const OUTREACH_TEMPLATES: Record<number, string> = {
  1: 'provider_welcome',
  2: 'activation_reminder_48h',
  3: 'provider_final_reminder_7d',
};

// ─────────────────────────────────────────────────────────────────────────────
// Config loader — all values from system_config table (nothing hardcoded)
// ─────────────────────────────────────────────────────────────────────────────

async function loadSystemConfig(prisma: PrismaClient): Promise<SystemConfig> {
  const keys = [
    'outreach_batch_size_per_hour',
    'outreach_attempt2_delay_hours',
    'outreach_attempt3_delay_days',
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
    outreach_batch_size_per_hour: parseInt(cfg['outreach_batch_size_per_hour'] ?? '1000', 10),
    outreach_attempt2_delay_hours: parseInt(cfg['outreach_attempt2_delay_hours'] ?? '48', 10),
    outreach_attempt3_delay_days: parseInt(cfg['outreach_attempt3_delay_days'] ?? '7', 10),
    gupshup_api_key: cfg['gupshup_api_key'] ?? '',
    gupshup_source_number: cfg['gupshup_source_number'] ?? '',
    gupshup_app_name: cfg['gupshup_app_name'] ?? 'SatvAAh',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gupshup — send pre-approved WhatsApp template
// ─────────────────────────────────────────────────────────────────────────────

async function sendWhatsAppTemplate(
  config: SystemConfig,
  phone: string,
  templateName: string,
  templateParams: string[],
  correlationId: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const url = 'https://api.gupshup.io/sm/api/v1/template/msg';

  // Gupshup template body: id = template name, params = ordered variable substitutions
  const templateBody = JSON.stringify({ id: templateName, params: templateParams });

  const formData = new URLSearchParams({
    source: config.gupshup_source_number,
    destination: phone,
    template: templateBody,
    'src.name': config.gupshup_app_name,
  });

  logger.info('Sending WhatsApp template', {
    phonePrefix: phone.slice(0, 6),   // log first 6 chars only — not full phone
    template: templateName,
    correlationId,
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

    return { success: false, error: message ?? `Gupshup returned status: ${status}` };
  } catch (err: any) {
    const errorMsg: string =
      err?.response?.data?.message ?? err.message ?? 'Gupshup request failed';
    logger.error('Gupshup API error', { error: errorMsg, correlationId });
    return { success: false, error: errorMsg };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Check stop conditions — claimed or opted-out disqualify all future outreach
// ─────────────────────────────────────────────────────────────────────────────

async function shouldStop(
  prisma: PrismaClient,
  providerId: string,
): Promise<{ stop: boolean; reason?: string }> {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: { is_claimed: true, user_id: true },
  });

  if (!provider) {
    return { stop: true, reason: 'provider_not_found' };
  }

  if (provider.is_claimed) {
    return { stop: true, reason: 'claimed' };
  }

  // If the scraped provider has since created a user account, check opt-out
  if (provider.user_id) {
    const user = await prisma.user.findUnique({
      where: { id: provider.user_id },
      select: { wa_opted_out: true, deleted_at: true },
    });

    if (user?.deleted_at !== null && user?.deleted_at !== undefined) {
      return { stop: true, reason: 'user_deleted' };
    }

    if (user?.wa_opted_out === true) {
      return { stop: true, reason: 'wa_opted_out' };
    }
  }

  return { stop: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule next attempt — inserts a new outreach_schedule row
// ─────────────────────────────────────────────────────────────────────────────

async function scheduleNextAttempt(
  prisma: PrismaClient,
  record: OutreachRecord,
  config: SystemConfig,
  correlationId: string,
): Promise<void> {
  const nextAttempt = record.attemptNumber + 1;
  if (nextAttempt > 3) return; // sequence is complete after attempt 3

  const now = new Date();
  let scheduledAt: Date;

  if (nextAttempt === 2) {
    scheduledAt = new Date(now.getTime() + config.outreach_attempt2_delay_hours * 3_600_000);
  } else {
    // attempt 3
    scheduledAt = new Date(now.getTime() + config.outreach_attempt3_delay_days * 86_400_000);
  }

  const nextId = uuidv4();

  await prisma.$executeRaw`
    INSERT INTO outreach_schedule (
      id, provider_id, phone, display_name,
      attempt_number, status, scheduled_at,
      correlation_id, created_at, updated_at
    ) VALUES (
      ${nextId}::uuid,
      ${record.providerId}::uuid,
      ${record.phone},
      ${record.displayName},
      ${nextAttempt},
      'pending',
      ${scheduledAt},
      ${correlationId},
      NOW(),
      NOW()
    )
    ON CONFLICT DO NOTHING
  `;

  logger.info('Next outreach attempt scheduled', {
    nextRowId: nextId,
    providerId: record.providerId,
    nextAttempt,
    scheduledAt: scheduledAt.toISOString(),
    correlationId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Lambda handler
// ─────────────────────────────────────────────────────────────────────────────

export const handler = async (
  event: EventBridgeEvent<'Scheduled Event', Record<string, unknown>>,
): Promise<void> => {
  const runCorrelationId = uuidv4();

  logger.info('outreach-scheduler invoked', {
    correlationId: runCorrelationId,
    eventTime: event.time,
  });

  const prisma = new PrismaClient({
    log: ['error'],
    datasources: { db: { url: process.env['DATABASE_URL'] } },
  });

  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  try {
    // ── 1. Load all thresholds from system_config ───────────────────────────
    const config = await loadSystemConfig(prisma);

    if (!config.gupshup_api_key || !config.gupshup_source_number) {
      logger.error('Gupshup credentials missing from system_config — aborting', {
        correlationId: runCorrelationId,
      });
      return;
    }

    // ── 2. Per-window batch cap (Meta hourly rate limit / 4 windows/hour) ───
    const maxPerWindow = Math.floor(config.outreach_batch_size_per_hour / 4);

    logger.info('Rate-limit window', {
      hourlyLimit: config.outreach_batch_size_per_hour,
      windowLimit: maxPerWindow,
      correlationId: runCorrelationId,
    });

    // ── 3. Fetch pending records due for sending ────────────────────────────
    // FOR UPDATE SKIP LOCKED: concurrent Lambda executions won't double-process
    const pendingRecords = await prisma.$queryRaw<OutreachRecord[]>`
      SELECT
        os.id,
        os.provider_id     AS "providerId",
        os.phone,
        os.display_name    AS "displayName",
        os.attempt_number  AS "attemptNumber",
        os.status,
        os.scheduled_at    AS "scheduledAt",
        os.correlation_id  AS "correlationId"
      FROM outreach_schedule os
      WHERE
        os.status = 'pending'
        AND os.scheduled_at <= NOW()
      ORDER BY
        os.attempt_number ASC,
        os.scheduled_at ASC
      LIMIT ${maxPerWindow}
      FOR UPDATE SKIP LOCKED
    `;

    logger.info('Pending records fetched', {
      count: pendingRecords.length,
      correlationId: runCorrelationId,
    });

    if (pendingRecords.length === 0) {
      logger.info('No pending outreach — idle run', { correlationId: runCorrelationId });
      return;
    }

    // ── 4. Process each record ──────────────────────────────────────────────
    for (const record of pendingRecords) {
      const correlationId = record.correlationId ?? uuidv4();

      // ── 4a. Stop-condition check ──────────────────────────────────────────
      const { stop, reason } = await shouldStop(prisma, record.providerId);

      if (stop) {
        const finalStatus =
          reason === 'wa_opted_out' ? 'opted_out' :
          reason === 'claimed'      ? 'claimed'   :
          'failed';

        await prisma.$executeRaw`
          UPDATE outreach_schedule
          SET status = ${finalStatus}, updated_at = NOW()
          WHERE id = ${record.id}::uuid
        `;

        skippedCount++;
        logger.info('Outreach skipped', {
          recordId: record.id,
          providerId: record.providerId,
          reason,
          correlationId,
        });
        continue;
      }

      // ── 4b. Resolve template ──────────────────────────────────────────────
      const templateName = OUTREACH_TEMPLATES[record.attemptNumber];
      if (!templateName) {
        logger.warn('Unknown attempt_number — marking exhausted', {
          recordId: record.id,
          attemptNumber: record.attemptNumber,
          correlationId,
        });
        await prisma.$executeRaw`
          UPDATE outreach_schedule
          SET status = 'exhausted', updated_at = NOW()
          WHERE id = ${record.id}::uuid
        `;
        continue;
      }

      // Template params — {{1}} = first name, {{2}} = claim URL
      const firstName = (record.displayName ?? '').split(' ')[0] || 'there';
      const claimUrl = `https://satvaaah.com/claim?phone=${encodeURIComponent(record.phone)}`;
      const templateParams = [firstName, claimUrl];

      // ── 4c. Send WhatsApp ─────────────────────────────────────────────────
      const result = await sendWhatsAppTemplate(
        config,
        record.phone,
        templateName,
        templateParams,
        correlationId,
      );

      if (result.success) {
        // ── 4d. Mark sent ─────────────────────────────────────────────────
        await prisma.$executeRaw`
          UPDATE outreach_schedule
          SET
            status       = 'sent',
            sent_at      = NOW(),
            wa_message_id = ${result.messageId ?? null},
            updated_at   = NOW()
          WHERE id = ${record.id}::uuid
        `;

        sentCount++;

        // ── 4e. Schedule next attempt if sequence is not exhausted ────────
        if (record.attemptNumber < 3) {
          await scheduleNextAttempt(prisma, record, config, correlationId);
        } else {
          // All 3 attempts sent — sequence complete
          logger.info('Outreach sequence complete for provider', {
            providerId: record.providerId,
            correlationId,
          });
        }

        logger.info('WhatsApp outreach sent successfully', {
          recordId: record.id,
          providerId: record.providerId,
          template: templateName,
          attemptNumber: record.attemptNumber,
          waMessageId: result.messageId,
          correlationId,
        });
      } else {
        // ── 4f. Mark failed (do NOT auto-schedule next attempt on failure) ─
        await prisma.$executeRaw`
          UPDATE outreach_schedule
          SET
            status        = 'failed',
            error_message = ${result.error ?? 'send_failed'},
            updated_at    = NOW()
          WHERE id = ${record.id}::uuid
        `;

        failedCount++;
        logger.warn('WhatsApp outreach failed', {
          recordId: record.id,
          providerId: record.providerId,
          template: templateName,
          error: result.error,
          correlationId,
        });
      }
    }

    // ── 5. Run summary ──────────────────────────────────────────────────────
    logger.info('outreach-scheduler run complete', {
      total: pendingRecords.length,
      sent: sentCount,
      skipped: skippedCount,
      failed: failedCount,
      correlationId: runCorrelationId,
    });
  } catch (err: any) {
    logger.error('outreach-scheduler fatal error', {
      error: err.message,
      stack: err.stack,
      correlationId: runCorrelationId,
    });
    throw err; // Re-throw → CloudWatch alarm fires
  } finally {
    await prisma.$disconnect();
  }
};
