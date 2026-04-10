/**
 * lambdas/ai-narration/index.ts
 * SatvAAh — Trust Layer for India's Informal Economy
 *
 * Trigger:  AWS EventBridge — cron(0 1 * * ? *)  (01:00 IST = 19:30 UTC nightly)
 * Purpose:  For each active provider, generate plain-language analytics insights
 *           using Claude Sonnet 4.6 (Anthropic API) and cache in Redis for 24h.
 *
 * Analytics gathered per provider:
 *   - Profile views (last 7d vs prior 7d — % change)
 *   - New contact events (leads received this week)
 *   - Accepted vs declined lead ratio
 *   - Current trust score + tier
 *   - Rating count + average (this month)
 *   - Top search query that surfaced the provider
 *
 * Output: plain-language narration like:
 *   "Your profile views increased 34% this week. You received 5 new lead
 *    requests — 3 were accepted. Your trust score is 74 (Trusted tier)."
 *
 * Redis cache key:  ai_narration:{provider_id}
 * TTL:             86400 seconds (24 hours)
 *
 * Batching: providers are processed in batches of 10 to avoid Anthropic API
 *           rate limits. Delay between batches: narration_batch_delay_ms (config).
 *
 * System config keys:
 *   narration_batch_size            (default 10 providers per batch)
 *   narration_batch_delay_ms        (default 2000 ms inter-batch delay)
 *   narration_active_threshold_days (only providers active in last N days, default 90)
 *   narration_min_trust_score       (skip providers below threshold, default 20)
 *
 * Lambda config: 512 MB | 15-min timeout | Concurrency: 1 (EventBridge scheduled)
 *
 * IMPORTANT: Never include PII (phone numbers, real names) in Anthropic API calls.
 *            Only aggregate analytics data is sent. Provider ID is an opaque UUID.
 */

import { EventBridgeEvent } from 'aws-lambda';
import { PrismaClient } from '@prisma/client';
import { createClient, RedisClientType } from 'redis';
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { createLogger, transports, format } from 'winston';

// ─────────────────────────────────────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────────────────────────────────────

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { lambda: 'ai-narration' },
  transports: [new transports.Console()],
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SystemConfig {
  narration_batch_size: number;
  narration_batch_delay_ms: number;
  narration_active_threshold_days: number;
  narration_min_trust_score: number;
  anthropic_api_key: string;
}

interface ProviderAnalytics {
  providerId: string;
  displayName: string;                   // used only for prompt context, NOT sent raw
  trustScore: number;
  trustTier: string;
  profile_views_this_week: number;
  profile_views_last_week: number;
  leads_received_this_week: number;
  leads_accepted_this_week: number;
  leads_declined_this_week: number;
  ratings_this_month: number;
  avg_rating_this_month: number | null;
  top_search_query: string | null;
  listingType: string;
}

interface NarrationResult {
  providerId: string;
  narration: string;
  generated_at: string;
  data_snapshot: {
    trustScore: number;
    trustTier: string;
    views_this_week: number;
    leads_this_week: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Config loader
// ─────────────────────────────────────────────────────────────────────────────

async function loadSystemConfig(prisma: PrismaClient): Promise<SystemConfig> {
  const keys = [
    'narration_batch_size',
    'narration_batch_delay_ms',
    'narration_active_threshold_days',
    'narration_min_trust_score',
    'anthropic_api_key',
  ];

  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });

  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return {
    narration_batch_size: parseInt(cfg['narration_batch_size'] ?? '10', 10),
    narration_batch_delay_ms: parseInt(cfg['narration_batch_delay_ms'] ?? '2000', 10),
    narration_active_threshold_days: parseInt(
      cfg['narration_active_threshold_days'] ?? '90',
      10,
    ),
    narration_min_trust_score: parseInt(cfg['narration_min_trust_score'] ?? '20', 10),
    anthropic_api_key: cfg['anthropic_api_key'] ?? process.env['ANTHROPIC_API_KEY'] ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch active providers for narration
// ─────────────────────────────────────────────────────────────────────────────

async function fetchActiveProviders(
  prisma: PrismaClient,
  config: SystemConfig,
): Promise<{ id: string; displayName: string; listingType: string; trustScore: number }[]> {
  const cutoffDate = new Date(
    Date.now() - config.narration_active_threshold_days * 86_400_000,
  );

  // Active = claimed + not deleted + trust score above minimum + seen activity recently
  return prisma.$queryRaw<
    { id: string; displayName: string; listingType: string; trustScore: number }[]
  >`
    SELECT
      pp.id,
      pp.display_name   AS "displayName",
      pp.listing_type   AS "listingType",
      COALESCE(ts.display_score, 0) AS "trustScore"
    FROM provider_profiles pp
    LEFT JOIN trust_scores ts ON ts.provider_id = pp.id
    JOIN users u ON u.id = pp.user_id
    WHERE
      pp.is_claimed = true
      AND u.deleted_at IS NULL
      AND COALESCE(ts.display_score, 0) >= ${config.narration_min_trust_score}
      AND pp.updated_at >= ${cutoffDate}
    ORDER BY pp.updated_at DESC
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gather analytics for a single provider
// ─────────────────────────────────────────────────────────────────────────────

async function gatherProviderAnalytics(
  prisma: PrismaClient,
  provider: { id: string; displayName: string; listingType: string; trustScore: number },
): Promise<ProviderAnalytics> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

  // Trust score + tier
  const trustData = await prisma.trustScore.findUnique({
    where: { provider_id: provider.id },
    select: { display_score: true, trust_tier: true },
  });

  // Contact events this week (all leads received)
  const leadsThisWeek = await prisma.$queryRaw<
    { total: bigint; accepted: bigint; declined: bigint }[]
  >`
    SELECT
      COUNT(*)                                                        AS total,
      COUNT(*) FILTER (WHERE provider_status = 'accepted')            AS accepted,
      COUNT(*) FILTER (WHERE provider_status = 'declined')            AS declined
    FROM contact_events
    WHERE
      provider_id = ${provider.id}::uuid
      AND created_at >= ${weekAgo}
  `;

  const leads = leadsThisWeek[0] ?? { total: 0n, accepted: 0n, declined: 0n };

  // Ratings this month
  const ratingsThisMonth = await prisma.$queryRaw<
    { count: bigint; avg_stars: number | null }[]
  >`
    SELECT
      COUNT(*)          AS count,
      AVG(overall_stars)::FLOAT AS avg_stars
    FROM ratings
    WHERE
      provider_id = ${provider.id}::uuid
      AND created_at >= ${monthAgo}
      AND moderation_status = 'approved'
  `;

  const ratingData = ratingsThisMonth[0] ?? { count: 0n, avg_stars: null };

  // Profile views — proxy: count search_intents that surfaced this provider
  // (true view tracking would require a separate analytics table)
  // Using contact_events as a proxy for engagement this week vs last week
  const viewsThisWeek = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count
    FROM contact_events
    WHERE provider_id = ${provider.id}::uuid
      AND created_at >= ${weekAgo}
  `;

  const viewsLastWeek = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count
    FROM contact_events
    WHERE provider_id = ${provider.id}::uuid
      AND created_at >= ${twoWeeksAgo}
      AND created_at < ${weekAgo}
  `;

  // Top search query that recently matched this provider's taxonomy
  const topQuery = await prisma.$queryRaw<{ search_query: string | null }[]>`
    SELECT si.search_query
    FROM search_intents si
    JOIN provider_profiles pp ON (
      si.taxonomy_node_id = pp.taxonomy_node_id
    )
    WHERE pp.id = ${provider.id}::uuid
      AND si.searched_at >= ${monthAgo}
    GROUP BY si.search_query
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `;

  return {
    providerId: provider.id,
    displayName: provider.displayName,
    trustScore: Number(trustData?.display_score ?? provider.trustScore),
    trustTier: trustData?.trust_tier ?? 'basic',
    profile_views_this_week: Number(viewsThisWeek[0]?.count ?? 0n),
    profile_views_last_week: Number(viewsLastWeek[0]?.count ?? 0n),
    leads_received_this_week: Number(leads.total),
    leads_accepted_this_week: Number(leads.accepted),
    leads_declined_this_week: Number(leads.declined),
    ratings_this_month: Number(ratingData.count),
    avg_rating_this_month:
      ratingData.avg_stars != null ? Number(ratingData.avg_stars.toFixed(1)) : null,
    top_search_query: (topQuery[0]?.search_query as string | undefined) ?? null,
    listingType: provider.listingType,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the Claude prompt from analytics data
// IMPORTANT: Do not include raw phone or PII. Only aggregate numbers.
// ─────────────────────────────────────────────────────────────────────────────

function buildNarrationPrompt(analytics: ProviderAnalytics): string {
  const viewsChange =
    analytics.profile_views_last_week > 0
      ? Math.round(
          ((analytics.profile_views_this_week - analytics.profile_views_last_week) /
            analytics.profile_views_last_week) *
            100,
        )
      : analytics.profile_views_this_week > 0
      ? 100
      : 0;

  const viewsTrend =
    viewsChange > 0 ? `increased ${viewsChange}%` :
    viewsChange < 0 ? `decreased ${Math.abs(viewsChange)}%` :
    'stayed the same';

  const tierFriendly: Record<string, string> = {
    unverified:    'Unverified',
    basic:         'Basic',
    trusted:       'Trusted',
    highly_trusted: 'Highly Trusted',
  };

  const tierLabel = tierFriendly[analytics.trustTier] ?? analytics.trustTier;

  const dataContext = `
Provider Analytics Data (this week):
- Listing type: ${analytics.listingType}
- Trust score: ${analytics.trustScore}/100 (${tierLabel} tier)
- Profile engagement this week vs last week: ${viewsTrend}
  (this week: ${analytics.profile_views_this_week}, last week: ${analytics.profile_views_last_week})
- New contact requests (leads) this week: ${analytics.leads_received_this_week}
- Accepted: ${analytics.leads_accepted_this_week}, Declined: ${analytics.leads_declined_this_week}
- Ratings this month: ${analytics.ratings_this_month}${analytics.avg_rating_this_month !== null ? ` (avg ${analytics.avg_rating_this_month}/5)` : ''}
${analytics.top_search_query ? `- Consumers most often found you by searching: "${analytics.top_search_query}"` : ''}
`.trim();

  return `You are writing a brief, friendly analytics summary for a service provider on SatvAAh, India's trust platform for informal economy professionals. Write in a warm, encouraging, and actionable tone. Address the provider as "you". Keep the total narration under 4 sentences. Be specific about numbers. If there's something positive to highlight, lead with it. If something needs attention, mention it gently. Do not mention Anthropic, AI, or that this was generated by a model.

${dataContext}

Generate the narration now:`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Call Claude Sonnet 4.6 for a single provider
// ─────────────────────────────────────────────────────────────────────────────

async function generateNarration(
  anthropic: Anthropic,
  analytics: ProviderAnalytics,
  correlationId: string,
): Promise<string> {
  const prompt = buildNarrationPrompt(analytics);

  logger.info('Calling Claude API for narration', {
    providerId: analytics.providerId,
    trustScore: analytics.trustScore,
    correlationId,
  });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',     // Claude Sonnet 4.6 per MASTER_CONTEXT
    max_tokens: 300,                 // ~4 sentences is ~60-100 tokens; 300 is generous cap
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const narration = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('')
    .trim();

  logger.info('Narration generated', {
    providerId: analytics.providerId,
    narrationLength: narration.length,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    correlationId,
  });

  return narration;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache narration in Redis
// Key: ai_narration:{provider_id}
// TTL: 24 hours (86400 seconds)
// ─────────────────────────────────────────────────────────────────────────────

async function cacheNarration(
  redis: RedisClientType,
  result: NarrationResult,
): Promise<void> {
  const key = `ai_narration:${result.providerId}`;
  const value = JSON.stringify(result);
  const ttlSeconds = 86_400; // 24 hours

  await redis.set(key, value, { EX: ttlSeconds });

  logger.info('Narration cached in Redis', {
    key,
    ttlSeconds,
    providerId: result.providerId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sleep helper for inter-batch rate-limiting
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Lambda handler
// ─────────────────────────────────────────────────────────────────────────────

export const handler = async (
  event: EventBridgeEvent<'Scheduled Event', Record<string, unknown>>,
): Promise<void> => {
  const runCorrelationId = uuidv4();

  logger.info('ai-narration lambda invoked', {
    correlationId: runCorrelationId,
    eventTime: event.time,
  });

  const prisma = new PrismaClient({
    log: ['error'],
    datasources: { db: { url: process.env['DATABASE_URL'] } },
  });

  // Connect Redis
  const redis = createClient({
    url: process.env['REDIS_URL'] ?? 'redis://satvaaah-redis:6379',
  }) as RedisClientType;

  let generatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  try {
    await redis.connect();
    logger.info('Redis connected', { correlationId: runCorrelationId });

    // ── 1. Load config ──────────────────────────────────────────────────────
    const config = await loadSystemConfig(prisma);

    if (!config.anthropic_api_key) {
      logger.error('Anthropic API key not in system_config — aborting', {
        correlationId: runCorrelationId,
      });
      return;
    }

    const anthropic = new Anthropic({ apiKey: config.anthropic_api_key });

    // ── 2. Fetch active providers ───────────────────────────────────────────
    const providers = await fetchActiveProviders(prisma, config);

    logger.info('Active providers fetched for narration', {
      count: providers.length,
      batchSize: config.narration_batch_size,
      correlationId: runCorrelationId,
    });

    if (providers.length === 0) {
      logger.info('No active providers — idle run', { correlationId: runCorrelationId });
      return;
    }

    // ── 3. Process in batches ───────────────────────────────────────────────
    const batches: typeof providers[] = [];
    for (let i = 0; i < providers.length; i += config.narration_batch_size) {
      batches.push(providers.slice(i, i + config.narration_batch_size));
    }

    logger.info('Processing batches', {
      totalProviders: providers.length,
      totalBatches: batches.length,
      batchSize: config.narration_batch_size,
      correlationId: runCorrelationId,
    });

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]!;
      const batchCorrelationId = `${runCorrelationId}:batch${batchIndex}`;

      logger.info('Processing batch', {
        batchIndex: batchIndex + 1,
        totalBatches: batches.length,
        batchSize: batch.length,
        correlationId: batchCorrelationId,
      });

      // Process each provider in the batch sequentially
      // (parallel calls to Anthropic risk rate-limit errors)
      for (const provider of batch) {
        const providerCorrelationId = `${batchCorrelationId}:${provider.id}`;

        try {
          // ── 3a. Gather analytics ──────────────────────────────────────────
          const analytics = await gatherProviderAnalytics(prisma, provider);

          // ── 3b. Generate narration via Claude ─────────────────────────────
          const narration = await generateNarration(
            anthropic,
            analytics,
            providerCorrelationId,
          );

          if (!narration || narration.length < 10) {
            logger.warn('Empty or very short narration returned — skipping cache', {
              providerId: provider.id,
              narration,
              correlationId: providerCorrelationId,
            });
            skippedCount++;
            continue;
          }

          // ── 3c. Cache result in Redis ─────────────────────────────────────
          const result: NarrationResult = {
            providerId: provider.id,
            narration,
            generated_at: new Date().toISOString(),
            data_snapshot: {
              trustScore: analytics.trustScore,
              trustTier: analytics.trustTier,
              views_this_week: analytics.profile_views_this_week,
              leads_this_week: analytics.leads_received_this_week,
            },
          };

          await cacheNarration(redis, result);
          generatedCount++;
        } catch (err: any) {
          errorCount++;
          logger.error('Failed to generate/cache narration for provider', {
            providerId: provider.id,
            error: err.message,
            correlationId: providerCorrelationId,
          });
          // Continue to next provider — don't let one failure stop the batch
        }
      }

      // ── 3d. Inter-batch delay to respect Anthropic rate limits ───────────
      if (batchIndex < batches.length - 1) {
        logger.info('Inter-batch delay', {
          delayMs: config.narration_batch_delay_ms,
          correlationId: batchCorrelationId,
        });
        await sleep(config.narration_batch_delay_ms);
      }
    }

    // ── 4. Run summary ──────────────────────────────────────────────────────
    logger.info('ai-narration run complete', {
      totalProviders: providers.length,
      generated: generatedCount,
      skipped: skippedCount,
      errors: errorCount,
      correlationId: runCorrelationId,
    });
  } catch (err: any) {
    logger.error('ai-narration fatal error', {
      error: err.message,
      stack: err.stack,
      correlationId: runCorrelationId,
    });
    throw err;
  } finally {
    await prisma.$disconnect();
    try {
      await redis.quit();
    } catch {
      // Redis disconnect errors are non-fatal
    }
  }
};
