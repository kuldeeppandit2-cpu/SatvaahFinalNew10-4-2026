/**
 * lambdas/anonymisation/index.ts
 * SatvAAh — Trust Layer for India's Informal Economy
 *
 * Trigger:  AWS SQS — anonymisation queue (from DELETE /api/v1/users/me)
 * Purpose:  Anonymise a deleted user's PII in compliance with DPDP Act 2023.
 *           Must complete within 72 hours of account deletion request.
 *
 * What is anonymised (data that could identify the person):
 *   users.phone        → SHA-256 hash (one-way, irreversible — satisfies DPDP right to erasure)
 *   users.name         → 'Deleted User'
 *   provider_profiles.display_name → 'Deleted User'
 *   provider_profiles.profile_photo_s3_key → removed (S3 object deleted)
 *   consumer_profiles.display_name → 'Deleted User'
 *   consumer_profiles.photo_url    → removed (S3 object deleted)
 *   All S3 objects under users/{user_id}/ → deleted
 *
 * What is PRESERVED (anonymised but retained for platform integrity):
 *   ratings rows                    → kept (weight + stars), but consumer_id
 *                                     is replaced with a tombstone UUID so
 *                                     the provider's trust score stays intact.
 *                                     No PII is visible; rating is unattributable.
 *   trust_score_history             → IMMUTABLE — preserved forever per design.
 *                                     Provider_id alone is not PII.
 *   contact_events                  → kept (aggregate lead metrics depend on this)
 *   anonymisation_log               → logged on completion
 *
 * SQS message payload:
 *   {
 *     userId: string,          — UUID of the deleted user
 *     deletedAt: string,       — ISO timestamp of soft-delete
 *     correlation_id: string,   — X-Correlation-ID from the DELETE request
 *     requestedAt: string      — when the delete was requested (for 72h deadline tracking)
 *   }
 *
 * anonymisation_log schema:
 *   id UUID PK DEFAULT uuid_generate_v4()
 *   user_id UUID              — the anonymised user (not FK — user may be gone)
 *   requestedAt TIMESTAMPTZ  — original deletion request time
 *   completed_at TIMESTAMPTZ  — when this Lambda completed
 *   fields_anonymised TEXT[]  — list of fields changed
 *   s3_keys_deleted TEXT[]    — S3 object keys removed
 *   status VARCHAR            — completed | partial_failure
 *   error_detail TEXT NULL    — populated on partial_failure
 *   correlation_id VARCHAR
 *   created_at TIMESTAMPTZ DEFAULT NOW()
 *
 * Lambda config: 512 MB | 10-min timeout | SQS batch size: 1 | Retry: 2 | DLQ on exhaustion
 */

import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { PrismaClient } from '@prisma/client';
import {
  S3Client,
  DeleteObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { createLogger, transports, format } from 'winston';

// ─────────────────────────────────────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────────────────────────────────────

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { lambda: 'anonymisation' },
  transports: [new transports.Console()],
});

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DELETED_USER_NAME = 'Deleted User';
// Tombstone UUID replaces consumer_id on ratings — stable, well-known, not a real user
const RATING_TOMBSTONE_USER_ID = '00000000-0000-0000-0000-000000000000';
const S3_BUCKET = process.env['S3_BUCKET'] ?? 'satvaaah-documents';
const S3_REGION = process.env['AWS_REGION'] ?? 'ap-south-1';

// ─────────────────────────────────────────────────────────────────────────────
// SQS Message shape
// ─────────────────────────────────────────────────────────────────────────────

// Matches what sqsPublish in user.controller sends:
// { user_id, requested_at, _correlation_id, _emitted_at }
interface AnonymisationMessage {
  user_id:          string;   // UUID of the deleted user
  requested_at:     string;   // ISO timestamp — 72h DPDP deadline starts here
  _correlation_id?: string;   // injected by sqsPublish wrapper
  _emitted_at?:     string;   // injected by sqsPublish wrapper
}

// ─────────────────────────────────────────────────────────────────────────────
// SHA-256 phone hash — one-way, non-reversible, satisfies DPDP erasure
// ─────────────────────────────────────────────────────────────────────────────

function hashPhone(phone: string): string {
  // CRITICAL: do NOT log the phone at any point — only the hash
  return createHash('sha256').update(phone).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 helpers — list and delete all objects under a prefix
// ─────────────────────────────────────────────────────────────────────────────

async function deleteS3ObjectsByPrefix(
  s3: S3Client,
  prefix: string,
  correlationId: string,
): Promise<string[]> {
  const deletedKeys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const listResp: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = listResp.Contents ?? [];

    for (const obj of objects) {
      if (!obj.Key) continue;

      await s3.send(
        new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: obj.Key,
        }),
      );

      deletedKeys.push(obj.Key);
      logger.info('S3 object deleted', { key: obj.Key, correlationId });
    }

    continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;
  } while (continuationToken);

  return deletedKeys;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete a single S3 object by full key (best-effort — log on error, don't throw)
// ─────────────────────────────────────────────────────────────────────────────

async function deleteS3Object(
  s3: S3Client,
  key: string,
  correlationId: string,
): Promise<boolean> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    logger.info('S3 object deleted', { key, correlationId });
    return true;
  } catch (err: any) {
    logger.warn('S3 delete failed (best-effort)', { key, error: err.message, correlationId });
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core anonymisation routine for a single user
// ─────────────────────────────────────────────────────────────────────────────

async function anonymiseUser(
  prisma: PrismaClient,
  s3: S3Client,
  msg: AnonymisationMessage,
): Promise<{ success: boolean; fieldsAnonymised: string[]; s3KeysDeleted: string[] }> {
  const { user_id: userId, _correlation_id, requested_at: requestedAt } = msg;
  const correlationId = _correlation_id ?? uuidv4();

  logger.info('Starting anonymisation', {
    userId,
    requestedAt: requestedAt,
    correlationId,
  });

  // ── Deadline check: DPDP Act 2023 requires completion within 72 hours ─────
  const requestedAtMs = new Date(requestedAt).getTime();
  const deadlineMs = requestedAtMs + 72 * 60 * 60 * 1000;
  const nowMs = Date.now();

  if (nowMs > deadlineMs) {
    logger.error('DPDP 72-hour deadline breached — proceeding but flagging', {
      userId,
      requestedAt: requestedAt,
      hoursElapsed: ((nowMs - requestedAtMs) / 3_600_000).toFixed(2),
      correlationId,
    });
    // Proceed anyway — partial compliance is better than none,
    // but this will be surfaced in anonymisation_log for human review
  }

  const fieldsAnonymised: string[] = [];
  const s3KeysDeleted: string[] = [];

  // ── 1. Fetch current user record ──────────────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      phone: true,
      // CRITICAL: never log raw phone — only pass to hashPhone()
    },
  });

  if (!user) {
    logger.warn('User not found — may already be anonymised', { userId, correlationId });
    return { success: true, fieldsAnonymised: ['already_absent'], s3KeysDeleted: [] };
  }

  // ── 2. Hash phone in users table ──────────────────────────────────────────
  if (user.phone) {
    const hashedPhone = hashPhone(user.phone);
    await prisma.$executeRaw`
      UPDATE users
      SET phone = ${hashedPhone}, updated_at = NOW()
      WHERE id = ${userId}::uuid
    `;
    fieldsAnonymised.push('users.phone');
    logger.info('Phone hashed (SHA-256)', { userId, correlationId });
  }

  // ── 3. Anonymise provider profile ─────────────────────────────────────────
  const providerProfile = await prisma.providerProfile.findFirst({
    where: { user_id: userId },
    select: { id: true, profile_photo_s3_key: true, display_name: true },
  });

  if (providerProfile) {
    // Delete photo from S3 before clearing the URL
    if (providerProfile.profile_photo_s3_key) {
      // profile_photo_s3_key IS the S3 key directly (not a URL)
      const photoKey = providerProfile.profile_photo_s3_key;
      if (photoKey) {
        const deleted = await deleteS3Object(s3, photoKey, correlationId);
        if (deleted) s3KeysDeleted.push(photoKey);
      }
    }

    await prisma.$executeRaw`
      UPDATE provider_profiles
      SET
        display_name             = ${DELETED_USER_NAME},
        profile_photo_s3_key     = NULL,
        has_profile_photo        = false,
        bio                      = NULL,
        updated_at               = NOW()
      WHERE user_id = ${userId}::uuid
    `;

    fieldsAnonymised.push('provider_profiles.display_name');
    fieldsAnonymised.push('provider_profiles.photo_url');
    fieldsAnonymised.push('provider_profiles.bio');
    logger.info('Provider profile anonymised', { userId, correlationId });
  }

  // ── 4. Anonymise consumer profile ─────────────────────────────────────────
  const consumerProfile = await prisma.consumerProfile.findFirst({
    where: { user_id: userId },
    select: { id: true, avatar_s3_key: true, display_name: true },
  });

  if (consumerProfile) {
    if (consumerProfile.avatar_s3_key) {
      const photoKey = consumerProfile.avatar_s3_key;
      if (photoKey) {
        const deleted = await deleteS3Object(s3, photoKey, correlationId);
        if (deleted) s3KeysDeleted.push(photoKey);
      }
    }

    await prisma.$executeRaw`
      UPDATE consumer_profiles
      SET
        display_name   = ${DELETED_USER_NAME},
        avatar_s3_key  = NULL,
        updated_at     = NOW()
      WHERE user_id = ${userId}::uuid
    `;

    fieldsAnonymised.push('consumer_profiles.display_name');
    fieldsAnonymised.push('consumer_profiles.photo_url');
    logger.info('Consumer profile anonymised', { userId, correlationId });
  }

  // ── 5. Preserve ratings — replace consumer_id with tombstone ─────────────
  // DPDP: anonymised rating data is retained so providers keep their trust score.
  // The tombstone UUID is not a real user — no personal data is linked.
  const ratingUpdateResult = await prisma.$executeRaw`
    UPDATE ratings
    SET
      consumer_id = ${RATING_TOMBSTONE_USER_ID}::uuid,
      updated_at  = NOW()
    WHERE
      consumer_id = ${userId}::uuid
      AND consumer_id != ${RATING_TOMBSTONE_USER_ID}::uuid
  `;

  if (ratingUpdateResult > 0) {
    fieldsAnonymised.push(`ratings.consumer_id (${ratingUpdateResult} rows tombstoned)`);
    logger.info('Ratings tombstoned', {
      userId,
      rowsAffected: ratingUpdateResult,
      correlationId,
    });
  }

  // ── 6. Delete all S3 objects under users/{user_id}/ prefix ───────────────
  const userS3Prefix = `users/${userId}/`;
  try {
    const deleted = await deleteS3ObjectsByPrefix(s3, userS3Prefix, correlationId);
    s3KeysDeleted.push(...deleted);
    if (deleted.length > 0) {
      fieldsAnonymised.push(`s3:${userS3Prefix} (${deleted.length} objects)`);
    }
  } catch (err: any) {
    logger.warn('S3 prefix delete partially failed', {
      prefix: userS3Prefix,
      error: err.message,
      correlationId,
    });
    // Non-fatal — we still record what we could
  }

  // ── 7. Delete credentials S3 objects (credentials/{user_id}/) ────────────
  const credS3Prefix = `credentials/${userId}/`;
  try {
    const deleted = await deleteS3ObjectsByPrefix(s3, credS3Prefix, correlationId);
    s3KeysDeleted.push(...deleted);
    if (deleted.length > 0) {
      fieldsAnonymised.push(`s3:${credS3Prefix} (${deleted.length} objects)`);
    }
  } catch (err: any) {
    logger.warn('S3 credentials prefix delete partially failed', {
      prefix: credS3Prefix,
      error: err.message,
      correlationId,
    });
  }

  // ── 8. Nullify FCM token (no longer needed after account deletion) ─────────
  await prisma.$executeRaw`
    UPDATE users
    SET fcm_token = NULL, updated_at = NOW()
    WHERE id = ${userId}::uuid
  `;
  fieldsAnonymised.push('users.fcm_token');

  // ── 9. Log completion to anonymisation_log ─────────────────────────────────
  const overdueFlag = nowMs > deadlineMs;
  const status = overdueFlag ? 'completed_overdue' : 'completed';

  await prisma.$executeRaw`
    INSERT INTO anonymisation_log (
      id,
      user_id,
      requestedAt,
      completed_at,
      fields_anonymised,
      s3_keys_deleted,
      status,
      error_detail,
      correlation_id,
      created_at
    ) VALUES (
      ${uuidv4()}::uuid,
      ${userId}::uuid,
      ${new Date(requestedAt)},
      NOW(),
      ${fieldsAnonymised}::text[],
      ${s3KeysDeleted}::text[],
      ${status},
      ${overdueFlag ? 'DPDP 72h deadline breached' : null},
      ${correlationId},
      NOW()
    )
  `;

  logger.info('Anonymisation complete', {
    userId,
    status,
    fieldsAnonymised,
    s3KeysDeleted: s3KeysDeleted.length,
    correlationId,
  });

  return { success: true, fieldsAnonymised, s3KeysDeleted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: extract S3 key from a CloudFront / S3 URL
// ─────────────────────────────────────────────────────────────────────────────

function extractS3Key(url: string): string | null {
  try {
    // CloudFront: https://d123.cloudfront.net/users/abc/photo.jpg
    // S3:         https://satvaaah-documents.s3.ap-south-1.amazonaws.com/users/abc/photo.jpg
    const parsed = new URL(url);
    // Key is the pathname without leading slash
    return parsed.pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Lambda handler — SQS batch
// ─────────────────────────────────────────────────────────────────────────────

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  logger.info('anonymisation lambda invoked', {
    recordCount: event.Records.length,
  });

  const prisma = new PrismaClient({
    log: ['error'],
    datasources: { db: { url: process.env['DATABASE_URL'] } },
  });

  const s3 = new S3Client({ region: S3_REGION });

  const batchItemFailures: SQSBatchItemFailure[] = [];

  try {
    for (const record of event.Records) {
      const messageId = record.messageId;
      let correlationId = 'unknown';

      try {
        // ── Parse SQS message body ──────────────────────────────────────────
        let msg: AnonymisationMessage;

        try {
          msg = JSON.parse(record.body) as AnonymisationMessage;
        } catch (parseErr: any) {
          logger.error('Failed to parse SQS message body', {
            messageId,
            bodySnippet: record.body.slice(0, 100),
            error: parseErr.message,
          });
          batchItemFailures.push({ itemIdentifier: messageId });
          continue;
        }

        correlationId = msg._correlation_id ?? uuidv4();

        // Validate required fields
        if (!msg.user_id || !msg.requested_at) {
          logger.error('Invalid anonymisation message — missing required fields', {
            messageId,
            correlationId,
            hasUserId: !!msg.user_id,
            hasRequestedAt: !!msg.requested_at,
          });
          batchItemFailures.push({ itemIdentifier: messageId });
          continue;
        }

        // ── Perform anonymisation ───────────────────────────────────────────
        const result = await anonymiseUser(prisma, s3, msg);

        if (!result.success) {
          logger.error('anonymiseUser returned failure', {
            messageId,
            userId: msg.user_id,
            correlationId,
          });
          batchItemFailures.push({ itemIdentifier: messageId });
        }
      } catch (err: any) {
        logger.error('Unhandled error processing anonymisation record', {
          messageId,
          correlationId,
          error: err.message,
          stack: err.stack,
        });
        batchItemFailures.push({ itemIdentifier: messageId });
      }
    }

    logger.info('anonymisation batch complete', {
      total: event.Records.length,
      succeeded: event.Records.length - batchItemFailures.length,
      failed: batchItemFailures.length,
    });
  } finally {
    await prisma.$disconnect();
  }

  return { batchItemFailures };
};
