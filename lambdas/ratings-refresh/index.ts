/**
 * lambdas/ratings-refresh/index.ts
 * SatvAAh — Trust Layer for India's Informal Economy
 *
 * Trigger:  AWS EventBridge — cron(0 2 * * ? *)  (02:00 IST = 20:30 UTC daily)
 * Purpose:  Re-fetch external ratings from Google Places API, Practo, Zomato.
 *           Update external_ratings table.
 *           Mark ratings older than scraping_stale_threshold_days (90) as is_stale=true.
 *           Trigger trust recalculation via SQS for providers whose ratings changed.
 *
 * external_ratings schema (V029):
 *   id UUID PK | provider_id UUID FK | platform ENUM | rating_avg DECIMAL(3,2)
 *   review_count INT | place_id VARCHAR NULL (Google Place ID) | scraped_at TIMESTAMPTZ
 *   is_stale BOOLEAN DEFAULT false | created_at | updated_at
 *
 * Platform handling:
 *   google   — Google Places API v1 (official, direct from Lambda)
 *   practo   — delegated to services/scraping port 3010 (no public API)
 *   zomato   — delegated to services/scraping port 3010
 *   justdial — delegated to services/scraping port 3010
 *   sulekha  — delegated to services/scraping port 3010
 *
 * System config keys used (all from system_config table — nothing hardcoded):
 *   scraping_stale_threshold_days    (default 90)
 *   ratings_refresh_batch_size       (default 50)
 *   ratings_refresh_google_delay_ms  (default 200 — delay between Places API calls)
 *   google_places_api_key
 *   scraping_service_url
 *   trust_score_updates_queue_url
 *
 * Lambda config: 256 MB | 10-min timeout | Concurrency: 1 (EventBridge scheduled)
 */

import { EventBridgeEvent } from 'aws-lambda';
import { PrismaClient } from '@prisma/client';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { createLogger, transports, format } from 'winston';

// ─────────────────────────────────────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────────────────────────────────────

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { lambda: 'ratings-refresh' },
  transports: [new transports.Console()],
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SystemConfig {
  scraping_stale_threshold_days: number;
  ratings_refresh_batch_size: number;
  ratings_refresh_google_delay_ms: number;
  google_places_api_key: string;
  scraping_service_url: string;
  trust_score_updates_queue_url: string;
}

interface ExternalRatingRecord {
  id: string;
  providerId: string;
  platform: string;
  rating_avg: number;
  review_count: number;
  place_id: string | null;
  scraped_at: Date;
  is_stale: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config loader — reads from system_config table exclusively (CRITICAL RULE #20)
// ─────────────────────────────────────────────────────────────────────────────

async function loadSystemConfig(prisma: PrismaClient): Promise<SystemConfig> {
  const keys = [
    'scraping_stale_threshold_days',
    'ratings_refresh_batch_size',
    'ratings_refresh_google_delay_ms',
    'google_places_api_key',
    'scraping_service_url',
    'trust_score_updates_queue_url',
  ];

  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });

  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return {
    scraping_stale_threshold_days: parseInt(cfg['scraping_stale_threshold_days'] ?? '90', 10),
    ratings_refresh_batch_size: parseInt(cfg['ratings_refresh_batch_size'] ?? '50', 10),
    ratings_refresh_google_delay_ms: parseInt(cfg['ratings_refresh_google_delay_ms'] ?? '200', 10),
    google_places_api_key: cfg['google_places_api_key'] ?? '',
    scraping_service_url: cfg['scraping_service_url'] ?? 'http://localhost:3010',
    // SQS URLs come from env vars (infrastructure), not system_config (thresholds)
    trust_score_updates_queue_url: process.env.SQS_TRUST_SCORE_UPDATES_URL ?? cfg['trust_score_updates_queue_url'] ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Places API v1 — fetch rating + review count for a place_id
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGooglePlaceRating(
  placeId: string,
  apiKey: string,
  correlationId: string,
): Promise<{ rating: number; reviewCount: number } | null> {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;

  try {
    const response = await axios.get<{ rating?: number; userRatingCount?: number }>(url, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'rating,userRatingCount',
        'X-Correlation-ID': correlationId,
      },
      timeout: 8_000,
    });

    const { rating, userRatingCount } = response.data;

    if (typeof rating !== 'number') {
      logger.warn('Google Places: no rating in response', { placeId, correlationId });
      return null;
    }

    return {
      rating: Math.round(rating * 10) / 10,    // 1 decimal place
      reviewCount: userRatingCount ?? 0,
    };
  } catch (err: any) {
    const status: number | undefined = err?.response?.status;
    if (status === 404) {
      logger.warn('Google Place not found (possibly removed or incorrect ID)', {
        placeId,
        correlationId,
      });
    } else if (status === 429) {
      logger.warn('Google Places API rate limited', { placeId, correlationId });
    } else {
      logger.error('Google Places API error', {
        placeId,
        httpStatus: status,
        error: err.message,
        correlationId,
      });
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delegate non-Google rating refresh to services/scraping (port 3010)
// ─────────────────────────────────────────────────────────────────────────────

async function triggerScrapingRefresh(
  scrapingServiceUrl: string,
  providerId: string,
  platform: string,
  correlationId: string,
): Promise<boolean> {
  const url = `${scrapingServiceUrl}/api/internal/scrape/ratings`;

  try {
    await axios.post(
      url,
      { providerId: providerId, platform, triggered_by: 'ratings-refresh-lambda' },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Key': process.env['INTERNAL_SERVICE_KEY'] ?? '',
          'X-Correlation-ID': correlationId,
        },
        timeout: 5_000,
      },
    );
    logger.info('Scraping job triggered', { providerId, platform, correlationId });
    return true;
  } catch (err: any) {
    logger.warn('Failed to trigger scraping job', {
      providerId,
      platform,
      error: err.message,
      correlationId,
    });
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SQS — publish trust-score-updates for a provider
// ─────────────────────────────────────────────────────────────────────────────

async function queueTrustRecalculation(
  sqs: SQSClient,
  queueUrl: string,
  providerId: string,
  correlationId: string,
): Promise<void> {
  const messageBody = JSON.stringify({
    provider_id: providerId,
    triggered_by: 'external_rating_refresh',
    correlation_id: correlationId,
    triggered_at: new Date().toISOString(),
  });

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: messageBody,
      // FIFO queue: one message per provider per run — dedup by provider+trigger+date
      MessageGroupId: providerId,
      MessageDeduplicationId: `${providerId}:ratings_refresh:${new Date().toISOString().slice(0, 10)}`,
      MessageAttributes: {
        correlation_id: {
          DataType: 'String',
          StringValue: correlationId,
        },
        trigger: {
          DataType: 'String',
          StringValue: 'external_rating_refresh',
        },
      },
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rating-change detection (avoid noisy trust recalc for unchanged ratings)
// ─────────────────────────────────────────────────────────────────────────────

function ratingMateriallyChanged(
  existingAvg: number,
  existingCount: number,
  newAvg: number,
  newCount: number,
): boolean {
  // Changed if avg differs by ≥ 0.1 stars OR review count differs by ≥ 5
  return Math.abs(existingAvg - newAvg) >= 0.1 || Math.abs(existingCount - newCount) >= 5;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sleep helper for inter-call rate limiting
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Main Lambda handler
// ─────────────────────────────────────────────────────────────────────────────

export const handler = async (
  event: EventBridgeEvent<'Scheduled Event', Record<string, unknown>>,
): Promise<void> => {
  const runCorrelationId = uuidv4();

  logger.info('ratings-refresh lambda invoked', {
    correlationId: runCorrelationId,
    eventTime: event.time,
  });

  const prisma = new PrismaClient({
    log: ['error'],
    datasources: { db: { url: process.env['DATABASE_URL'] } },
  });

  const sqs = new SQSClient({ region: process.env['AWS_REGION'] ?? 'ap-south-1' });

  let markedStaleCount = 0;
  let googleRefreshedCount = 0;
  let scrapingQueuedCount = 0;
  let trustRecalcCount = 0;
  let errorCount = 0;

  // Deduplicate trust recalc SQS publishes within the same run
  const trustRecalcQueued = new Set<string>();

  try {
    // ── 1. Load system config ───────────────────────────────────────────────
    const config = await loadSystemConfig(prisma);

    if (!config.trust_score_updates_queue_url) {
      logger.error('trust_score_updates_queue_url not configured in system_config — aborting', {
        correlationId: runCorrelationId,
      });
      return;
    }

    const staleCutoff = new Date(
      Date.now() - config.scraping_stale_threshold_days * 86_400_000,
    );

    logger.info('Configuration loaded', {
      staleThresholdDays: config.scraping_stale_threshold_days,
      staleCutoff: staleCutoff.toISOString(),
      batchSize: config.ratings_refresh_batch_size,
      googleApiConfigured: !!config.google_places_api_key,
      correlationId: runCorrelationId,
    });

    // ── 2. Mark ratings older than threshold as stale ───────────────────────
    // is_stale = true → trust formula halves the weight (0.3 → 0.15, per MASTER_CONTEXT)
    const staleUpdateCount = await prisma.$executeRaw`
      UPDATE external_ratings
      SET
        is_stale   = true,
        updated_at = NOW()
      WHERE
        scraped_at < ${staleCutoff}
        AND is_stale = false
    `;

    markedStaleCount = Number(staleUpdateCount);

    if (markedStaleCount > 0) {
      logger.info('External ratings marked stale', {
        count: markedStaleCount,
        correlationId: runCorrelationId,
      });
    }

    // ── 3. Collect all providers affected by newly-stale ratings ───────────
    // These need trust recalculation so the halved weight takes effect
    if (markedStaleCount > 0) {
      const staleProviders = await prisma.$queryRaw<{ providerId: string }[]>`
        SELECT DISTINCT provider_id AS "providerId"
        FROM external_ratings
        WHERE scraped_at < ${staleCutoff}
        LIMIT 500
      `;

      for (const { providerId: provider_id } of staleProviders) {
        if (trustRecalcQueued.has(provider_id)) continue;

        const correlationId = `${runCorrelationId}:stale:${provider_id}`;
        try {
          await queueTrustRecalculation(sqs, config.trust_score_updates_queue_url, provider_id, correlationId);
          trustRecalcQueued.add(provider_id);
          trustRecalcCount++;
        } catch (err: any) {
          errorCount++;
          logger.warn('Failed to queue trust recalc for newly-stale provider', {
            providerId: provider_id,
            error: err.message,
            correlationId,
          });
        }
      }
    }

    // ── 4. Refresh Google ratings via Places API ────────────────────────────
    if (!config.google_places_api_key) {
      logger.warn('google_places_api_key not set — skipping Google Places refresh', {
        correlationId: runCorrelationId,
      });
    } else {
      const googleRecords = await prisma.$queryRaw<ExternalRatingRecord[]>`
        SELECT
          er.id,
          er.provider_id,
          er.platform,
          er.rating_avg::FLOAT   AS rating_avg,
          er.review_count,
          er.place_id,
          er.scraped_at,
          er.is_stale
        FROM external_ratings er
        WHERE
          er.platform  = 'google'
          AND er.place_id IS NOT NULL
          AND er.place_id != ''
        ORDER BY er.scraped_at ASC    -- refresh the most stale first
        LIMIT ${config.ratings_refresh_batch_size}
      `;

      logger.info('Google ratings to refresh', {
        count: googleRecords.length,
        correlationId: runCorrelationId,
      });

      for (const record of googleRecords) {
        const correlationId = `${runCorrelationId}:google:${record.provider_id}`;

        // Rate-limit: delay between consecutive Google Places API calls
        if (googleRefreshedCount > 0) {
          await sleep(config.ratings_refresh_google_delay_ms);
        }

        try {
          const fresh = await fetchGooglePlaceRating(
            record.place_id!,
            config.google_places_api_key,
            correlationId,
          );

          if (fresh === null) {
            errorCount++;
            continue;
          }

          const changed = ratingMateriallyChanged(
            record.rating_avg,
            record.review_count,
            fresh.rating,
            fresh.reviewCount,
          );

          // Always update scraped_at to reset the stale clock (even if unchanged)
          await prisma.$executeRaw`
            UPDATE external_ratings
            SET
              rating_avg   = ${fresh.rating},
              review_count = ${fresh.reviewCount},
              scraped_at   = NOW(),
              is_stale     = false,
              updated_at   = NOW()
            WHERE id = ${record.id}::uuid
          `;

          googleRefreshedCount++;

          logger.info('Google rating refreshed', {
            providerId: record.provider_id,
            placeId: record.place_id,
            oldRating: record.rating_avg,
            newRating: fresh.rating,
            changed,
            correlationId,
          });

          // Only queue trust recalculation if the rating changed materially
          if (changed && !trustRecalcQueued.has(record.provider_id)) {
            await queueTrustRecalculation(
              sqs,
              config.trust_score_updates_queue_url,
              record.provider_id,
              correlationId,
            );
            trustRecalcQueued.add(record.provider_id);
            trustRecalcCount++;

            logger.info('Trust recalculation queued (rating changed)', {
              providerId: record.provider_id,
              ratingDelta: Math.abs(record.rating_avg - fresh.rating).toFixed(2),
              correlationId,
            });
          }
        } catch (err: any) {
          errorCount++;
          logger.error('Error processing Google rating record', {
            recordId: record.id,
            providerId: record.provider_id,
            error: err.message,
            correlationId,
          });
        }
      }
    }

    // ── 5. Queue scraping jobs for non-Google platforms ────────────────────
    // Practo, Zomato, Justdial, Sulekha are scraped by services/scraping (port 3010).
    // Lambda triggers an async scraping job; the scraping service updates
    // external_ratings and publishes its own SQS message for trust recalc.
    if (config.scraping_service_url) {
      const nonGooglePlatforms = ['practo', 'zomato', 'justdial', 'sulekha'];

      // Get one representative row per (provider, platform) to trigger a job
      const nonGoogleRecords = await prisma.$queryRaw<
        { id: string; providerId: string; platform: string }[]
      >`
        SELECT DISTINCT ON (er.provider_id, er.platform)
          er.id,
          er.provider_id AS "providerId",
          er.platform
        FROM external_ratings er
        WHERE
          er.platform = ANY(${nonGooglePlatforms}::text[])
          AND er.scraped_at < NOW() - INTERVAL '24 hours'
        ORDER BY er.provider_id, er.platform, er.scraped_at ASC
        LIMIT ${config.ratings_refresh_batch_size}
      `;

      logger.info('Non-Google rating refresh jobs to trigger', {
        count: nonGoogleRecords.length,
        correlationId: runCorrelationId,
      });

      for (const record of nonGoogleRecords) {
        const correlationId = `${runCorrelationId}:${record.platform}:${record.provider_id}`;

        const triggered = await triggerScrapingRefresh(
          config.scraping_service_url,
          record.provider_id,
          record.platform,
          correlationId,
        );

        if (triggered) {
          scrapingQueuedCount++;
        } else {
          errorCount++;
        }
      }
    } else {
      logger.warn('scraping_service_url not configured — skipping non-Google refresh', {
        correlationId: runCorrelationId,
      });
    }

    // ── 6. Run summary ──────────────────────────────────────────────────────
    logger.info('ratings-refresh run complete', {
      markedStale: markedStaleCount,
      googleRefreshed: googleRefreshedCount,
      scrapingJobsQueued: scrapingQueuedCount,
      trustRecalcsQueued: trustRecalcCount,
      errors: errorCount,
      correlationId: runCorrelationId,
    });
  } catch (err: any) {
    logger.error('ratings-refresh fatal error', {
      error: err.message,
      stack: err.stack,
      correlationId: runCorrelationId,
    });
    throw err;   // Re-throw → CloudWatch alarm fires
  } finally {
    await prisma.$disconnect();
  }
};
