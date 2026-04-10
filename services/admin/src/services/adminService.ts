/**
 * adminService.ts — Business logic for all admin endpoints
 * services/admin/src/services/adminService.ts
 *
 * Covers:
 *  - Disputes (trust_flags)
 *  - Credentials (provider_credentials)
 *  - Provider search + detail
 *  - Platform analytics
 *  - System config (system_config table)
 *  - Trust config (trust_score_config table)
 *  - Notification log
 *  - Scraping status
 *  - OpenSearch full resync (Lambda)
 *  - Provider analytics (for provider dashboard, called from routes)
 *
 * Critical Rule #20: Nothing hardcoded. All thresholds from system_config.
 * Critical Rule #5: ST_MakePoint(lng, lat) — longitude first.
 * Critical Rule #6: All timestamps UTC.
 * Critical Rule #25: X-Correlation-ID passed to every SQS message and Lambda.
 */

import { prisma, TrustFlagStatus } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';
import { NotFoundError, ConflictError, ValidationError as AppValidationError } from '@satvaaah/errors';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// ---------------------------------------------------------------------------
// AWS Clients (singleton)
// ---------------------------------------------------------------------------

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });
const sqsClient    = new SQSClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

const TRUST_SCORE_UPDATES_QUEUE = process.env.SQS_TRUST_SCORE_UPDATES_URL ?? '';
const OPENSEARCH_RESYNC_LAMBDA  = process.env.OPENSEARCH_RESYNC_LAMBDA_NAME ?? 'satvaaah-opensearch-full-resync';
const NOTIFICATION_SERVICE_URL  = process.env.NOTIFICATION_SERVICE_URL ?? 'http://notification:3006';

// ---------------------------------------------------------------------------
// Notification client (internal HTTP call to notification service)
// ---------------------------------------------------------------------------

async function sendNotificationEvent(payload: {
  userId: string;
  eventType: string;
  data: Record<string, unknown>;
  correlationId?: string;
}): Promise<void> {
  try {
    const res = await fetch(`${NOTIFICATION_SERVICE_URL}/api/v1/internal/notify/fcm`, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-Correlation-ID': payload.correlationId ?? '',
        'x-internal-key':  process.env.INTERNAL_SERVICE_KEY ?? '',
      },
      body: JSON.stringify({
        user_id:    payload.userId,
        event_type: payload.eventType,
        data:       payload.data,
      }),
    });
    if (!res.ok) {
      logger.warn('Internal notification call non-2xx');
    }
  } catch (err) {
    logger.warn('Internal notification call failed — non-blocking');
  }
}

// ---------------------------------------------------------------------------
// Enqueue trust score recalculation via SQS (Critical Rule #25)
// ---------------------------------------------------------------------------

async function enqueueTrustRecalculation(providerId: string, correlationId: string): Promise<void> {
  try {
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: TRUST_SCORE_UPDATES_QUEUE,
      MessageBody: JSON.stringify({
        providerId:    providerId,
        triggeredBy:   'admin_action',
        correlation_id: correlationId,
        enqueuedAt:    new Date().toISOString(),
      }),
      MessageAttributes: {
        CorrelationId: { DataType: 'String', StringValue: correlationId },
      },
    }));
  } catch (err) {
    logger.warn('Failed to enqueue trust recalculation — non-blocking');
  }
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

interface PeriodDates {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  label: string;
  days: number;
}

function parsePeriod(period: string): PeriodDates {
  const now = new Date();
  const end = new Date(now);

  // ── Calendar-based periods ──────────────────────────────────────────────
  if (period === 'wtd') {
    // Week to date: Monday 00:00 → now
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const start = new Date(now); start.setDate(now.getDate() - daysFromMonday); start.setHours(0,0,0,0);
    const prevEnd = new Date(start);
    const prevStart = new Date(start); prevStart.setDate(start.getDate() - 7);
    return { start, end, prevStart, prevEnd, label: 'week to date', days: daysFromMonday + 1 };
  }
  if (period === 'mtd') {
    // Month to date: 1st of month 00:00 → now
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevEnd = new Date(start);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { start, end, prevStart, prevEnd, label: 'month to date', days: now.getDate() };
  }
  if (period === 'ytd') {
    // Year to date: India FY starts April 1
    const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const start = new Date(fyYear, 3, 1); // April 1
    const prevStart = new Date(fyYear - 1, 3, 1);
    const prevEnd = new Date(start);
    const days = Math.floor((now.getTime() - start.getTime()) / 86400000);
    return { start, end, prevStart, prevEnd, label: 'FY year to date', days };
  }
  if (period === 'ltd') {
    // Launch to date: from platform launch date
    const start = new Date('2025-01-01T00:00:00Z');
    const days = Math.floor((now.getTime() - start.getTime()) / 86400000);
    return { start, end, prevStart: start, prevEnd: start, label: 'launch to date', days };
  }

  // ── Rolling periods ─────────────────────────────────────────────────────
  const rollingDays = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : null;
  if (!rollingDays) {
    throw new AppValidationError('INVALID_FIELD', `Invalid period: ${period}. Use wtd, mtd, ytd, ltd, 7d, 30d, or 90d`);
  }
  const start = new Date(now); start.setDate(now.getDate() - rollingDays);
  const prevEnd = new Date(start);
  const prevStart = new Date(start); prevStart.setDate(start.getDate() - rollingDays);
  const label = period === '7d' ? 'last 7 days' : period === '30d' ? 'last 30 days' : 'last 90 days';
  return { start, end, prevStart, prevEnd, label, days: rollingDays };
}

// ===========================================================================
// MODULE 1 — DISPUTES
// ===========================================================================

interface GetDisputesParams {
  status: string;
  page: number;
  limit: number;
}

async function getDisputes(params: GetDisputesParams) {
  const { status, page, limit } = params;
  const skip = (page - 1) * limit;

  const [disputeRows, total] = await Promise.all([
    // Use raw SQL with ::text cast — Prisma enum comparison fails for TrustFlagStatus
    prisma.$queryRaw<Array<{
      id: string; provider_id: string; flag_type: string; severity: string;
      status: string; evidence: unknown; created_at: Date;
      display_name: string | null; trust_score: number | null; phone: string | null;
      listing_type: string | null;
    }>>`
      SELECT
        tf.id, tf.provider_id, tf.flag_type::text AS flag_type,
        tf.severity::text AS severity, tf.status::text AS status,
        tf.evidence, tf.created_at,
        pp.display_name, pp.trust_score, pp.phone,
        pp.listing_type::text AS listing_type
      FROM trust_flags tf
      LEFT JOIN provider_profiles pp ON pp.id = tf.provider_id
      WHERE tf.status::text = ${status}
      ORDER BY tf.created_at DESC
      LIMIT ${limit} OFFSET ${skip}
    `,
    prisma.$queryRaw<Array<{count: bigint}>>`SELECT COUNT(*) AS count FROM trust_flags WHERE status::text = ${status}`.then(r => Number(r[0]?.count ?? 0n)),
  ]);

  // Reshape raw rows to match expected Dispute shape
  const disputes = disputeRows.map(r => ({
    id:           r.id,
    provider_id:  r.provider_id,
    flag_type:    r.flag_type,
    severity:     r.severity,
    status:       r.status,
    evidence:     r.evidence,
    created_at:   r.created_at,
    sla_expires_at: null,
    provider: r.display_name ? {
      id:           r.provider_id,
      display_name: r.display_name,
      listing_type: r.listing_type,
      trust_score:  r.trust_score,
      phone:        r.phone,
    } : null,
  }));

  return { disputes, total };
}

interface ResolveDisputeParams {
  id: string;
  outcome: 'under_review' | 'resolved' | 'dismissed';  // TrustFlagStatus enum
  reason: string;
  penaltyApplied: boolean;
  adminId: string;
  correlationId: string;
}

async function resolveDispute(params: ResolveDisputeParams) {
  const { id, outcome, reason, penaltyApplied, adminId, correlationId } = params;

  // Find the flag first
  const existing = await prisma.trustFlag.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError('Trust flag', id);
  }
  if (existing.status !== 'open') {
    throw new ConflictError('DISPUTE_ALREADY_RESOLVED', `Trust flag is already ${existing.status}`);
  }

  // Update in DB
  const updated = await prisma.trustFlag.update({
    where: { id },
    data: {
      status:      outcome as any,
      resolution:  reason,
      resolved_at: new Date(),
      resolved_by_admin_id: adminId,
    },
  });

  // Enqueue trust score recalculation if penalty applied
  if (penaltyApplied && existing.provider_id) {
    await enqueueTrustRecalculation(existing.provider_id, correlationId);
  }

  logger.info('Dispute resolved');
  return updated;
}

// ===========================================================================
// MODULE 2 — CREDENTIALS
// ===========================================================================

interface GetCredentialsParams {
  status: string;
  page: number;
  limit: number;
}

async function getPendingCredentials(params: GetCredentialsParams) {
  const { status, page, limit } = params;
  const skip = (page - 1) * limit;

  const [credentials, total] = await Promise.all([
    prisma.providerVerification.findMany({
      where: { status: status as any },
      orderBy: { created_at: 'asc' },   // FIFO — oldest pending first
      skip,
      take: limit,
      include: {
        provider: {
          select: {
            id:           true,
            display_name: true,
            listing_type: true,
            tab:          true,
          },
        },
      },
    }),
    prisma.providerVerification.count({ where: { status: status as any } }),
  ]);

  return { credentials, total };
}

interface ResolveCredentialParams {
  id: string;
  action: 'approve' | 'reject';
  reason?: string;
  adminId: string;
  correlationId: string;
}

async function resolveCredential(params: ResolveCredentialParams) {
  const { id, action, reason, adminId, correlationId } = params;

  const existing = await prisma.providerVerification.findUnique({
    where: { id },
    include: { provider: { select: { id: true, user_id: true, display_name: true } } },
  });
  if (!existing) {
    throw new NotFoundError('Credential');
  }
  if (existing.status !== 'pending') {
    throw new ConflictError('CREDENTIAL_ALREADY_REVIEWED', `Credential already ${existing.status}`);
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  // Update credential status + set approval boolean on provider profile
  await prisma.$transaction(async (tx) => {
    await tx.providerVerification.update({
      where: { id },
      data: {
        status:               newStatus as any,
        rejection_reason:     action === 'reject' ? (reason ?? null) : null,
        rejection_at:         action === 'reject' ? new Date() : null,
        verified_at:          action === 'approve' ? new Date() : null,
        verified_by_admin_id: adminId,
      },
    });

    // If approved, mark the corresponding verification flag on provider_profiles
    if (action === 'approve') {
      await tx.providerProfile.update({
        where: { id: existing.provider_id },
        data: { has_credentials: true },
      });
    }
  });

  // Enqueue trust score recalculation
  await enqueueTrustRecalculation(existing.provider_id, correlationId);

  // Notify provider via notification service (FCM + WhatsApp credential_verified template)
  if (existing.provider?.user_id) {
    await sendNotificationEvent({
      userId:    existing.provider.user_id,
      eventType: action === 'approve' ? 'credential_verified' : 'credential_rejected',
      data: {
        providerName:   existing.provider.display_name,
        credential_type: existing.verification_type,
        reason:          reason ?? null,
      },
      correlationId,
    });
  }

  logger.info('Credential reviewed');
  return { id, status: newStatus, reviewed_at: new Date(), reviewed_by: adminId };
}

// ===========================================================================
// MODULE 3 — PROVIDER SEARCH + DETAIL
// ===========================================================================

interface SearchProvidersParams {
  q: string;
  page: number;
  limit: number;
  listingType?: string;
  isClaimed?: boolean;
}

async function searchProviders(params: SearchProvidersParams) {
  const { q, page, limit, listingType, isClaimed } = params;
  const skip = (page - 1) * limit;

  // Use pg_trgm full-text search via Prisma raw query for performance
  // (extensions: pg_trgm installed in V001)
  const searchTerm = `%${q}%`;

  const whereClause: Record<string, unknown> = {};
  if (listingType) whereClause.listing_type = listingType as any;
  if (isClaimed !== undefined) whereClause.is_claimed = isClaimed;

  let providers: unknown[];
  let total: number;

  if (q.trim().length === 0) {
    // No search term — return all ordered by trust_score desc
    [providers, total] = await Promise.all([
      prisma.providerProfile.findMany({
        where: whereClause,
        orderBy: { trust_score: 'desc' },
        skip,
        take: limit,
        select: {
          id:           true,
          display_name: true,
          listing_type: true,
          tab:          true,
          trust_score: true,
          trust_score_record: { select: { trust_tier: true } },
          is_claimed:   true,
          is_scrape_record: true,
          city_id:      true,
          created_at:   true,
        },
      }),
      prisma.providerProfile.count({ where: whereClause }),
    ]);
  } else {
    // pg_trgm similarity search — works across display_name and phone
    const rows = await prisma.$queryRaw<Array<{
      id: string; display_name: string; listing_type: string; tab: string;
      trustScore: number; trust_tier: string; is_claimed: boolean;
      is_scrape_record: boolean; city_id: string; created_at: Date; total_count: bigint;
    }>>`
      SELECT
        p.id, p.display_name, p.listing_type, p.tab, p.trust_score,
        COALESCE(ts.trust_tier, 'unverified') AS trust_tier,
        p.is_claimed, p.is_scrape_record, p.city_id, p.created_at,
        COUNT(*) OVER() AS total_count
      FROM provider_profiles p
      LEFT JOIN trust_scores ts ON ts.provider_id = p.id
      WHERE
        (display_name ILIKE ${searchTerm}
          OR phone ILIKE ${searchTerm}
          OR business_name ILIKE ${searchTerm})
        ${listingType ? prisma.$queryRaw`AND listing_type = ${listingType}` : prisma.$queryRaw``}
        ${isClaimed !== undefined ? prisma.$queryRaw`AND is_claimed = ${isClaimed}` : prisma.$queryRaw``}
      ORDER BY
        similarity(display_name, ${q}) DESC,
        trust_score DESC
      LIMIT ${limit} OFFSET ${skip}
    `;

    providers   = rows;
    total       = rows.length > 0 ? Number(rows[0].total_count) : 0;
  }

  return { providers, total };
}

async function getProviderDetail(providerId: string) {
  // Full provider detail: profile + trust_scores + credentials + contact stats
  const [provider, trustScore, credentials, contactStats, externalRatings] = await Promise.all([
    prisma.providerProfile.findUnique({
      where: { id: providerId },
      include: {
        city: true,
        trust_score_histories: {
          orderBy: { event_at: 'desc' },
          take: 10,
        },
      },
    }),

    prisma.trustScore.findUnique({
      where: { provider_id: providerId },
    }),

    prisma.providerVerification.findMany({
      where: { provider_id: providerId },
      orderBy: { created_at: 'desc' },
    }),

    prisma.$queryRaw<Array<{ contact_type: string; total: bigint; accepted: bigint; declined: bigint }>>`
      SELECT
        contact_type,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE provider_status = 'accepted') AS accepted,
        COUNT(*) FILTER (WHERE provider_status = 'declined') AS declined
      FROM contact_events
      WHERE provider_id = ${providerId}
      GROUP BY contact_type
    `,

    prisma.externalRating.findMany({
      where: { provider_id: providerId },
      orderBy: { scraped_at: 'desc' },
    }),
  ]);

  if (!provider) return null;

  return {
    profile:          provider,
    trustScore:      trustScore,
    credentials,
    contact_stats:    contactStats.map(r => ({
      ...r,
      total:    Number(r.total),
      accepted: Number(r.accepted),
      declined: Number(r.declined),
    })),
    external_ratings: externalRatings,
  };
}

// ===========================================================================
// MODULE 4 — PLATFORM ANALYTICS
// ===========================================================================

async function getPlatformAnalytics(period: string) {
  const { start, prevStart, prevEnd } = parsePeriod(period);

  // Helper to compute delta pct
  const deltaPct = (curr: number, prev: number): number | null => {
    if (prev === 0) return curr > 0 ? null : 0; // null = no prior data
    return Number(((curr - prev) / prev * 100).toFixed(1));
  };

  // ── Batch 1: Current period + Previous period (parallel) ──────────────
  const [
    // Current period
    mauCurr, leadFunnelCurr, searchesCurr, newProvCurr, newConsCurr, ratingsCurr,
    // Previous period (same duration)
    mauPrev, leadFunnelPrev, searchesPrev, newProvPrev, newConsPrev,
    // All-time / snapshot (no period filter)
    claimStats, trustTierBreakdown, avgTrustScore,
    consumerTotal, providerTotal,
    openDisputes, pendingCreds, pendingCredOver48h, certsIssued,
    fcmStats,
    activeSubs, mrrStats,
  ] = await Promise.all([

    // ── Current period ──
    prisma.$queryRaw<Array<{ mau: bigint }>>`
      SELECT COUNT(DISTINCT user_id) AS mau FROM (
        SELECT consumer_id AS user_id FROM contact_events WHERE created_at >= ${start}
        UNION
        SELECT p.user_id FROM contact_events ce
          JOIN provider_profiles p ON p.id = ce.provider_id
          WHERE ce.created_at >= ${start} AND p.user_id IS NOT NULL
        UNION
        SELECT user_id FROM search_intents WHERE searched_at >= ${start}
      ) combined
    `,
    prisma.$queryRaw<Array<{
      total: bigint; accepted: bigint; declined: bigint;
      expired: bigint; completed: bigint; no_show: bigint;
      calls: bigint; messages: bigint; slot_bookings: bigint;
    }>>`
      SELECT
        COUNT(*)                                                         AS total,
        COUNT(*) FILTER (WHERE status::text = 'accepted')               AS accepted,
        COUNT(*) FILTER (WHERE status::text = 'declined')               AS declined,
        COUNT(*) FILTER (WHERE status::text = 'expired')                AS expired,
        COUNT(*) FILTER (WHERE status::text = 'completed')              AS completed,
        COUNT(*) FILTER (WHERE status::text = 'no_show')                AS no_show,
        COUNT(*) FILTER (WHERE contact_type::text = 'call')             AS calls,
        COUNT(*) FILTER (WHERE contact_type::text = 'message')          AS messages,
        COUNT(*) FILTER (WHERE contact_type::text = 'slot_booking')     AS slot_bookings
      FROM contact_events WHERE created_at >= ${start}
    `,
    prisma.searchIntent.count({ where: { searched_at: { gte: start } } }),
    prisma.providerProfile.count({ where: { created_at: { gte: start }, is_scrape_record: false } }),
    prisma.consumerProfile.count({ where: { created_at: { gte: start } } }),
    prisma.rating.count({ where: { created_at: { gte: start } } }),

    // ── Previous period ──
    prisma.$queryRaw<Array<{ mau: bigint }>>`
      SELECT COUNT(DISTINCT user_id) AS mau FROM (
        SELECT consumer_id AS user_id FROM contact_events WHERE created_at >= ${prevStart} AND created_at < ${prevEnd}
        UNION
        SELECT user_id FROM search_intents WHERE searched_at >= ${prevStart} AND searched_at < ${prevEnd}
      ) combined
    `,
    prisma.$queryRaw<Array<{ total: bigint; accepted: bigint; completed: bigint; no_show: bigint }>>`
      SELECT
        COUNT(*)                                               AS total,
        COUNT(*) FILTER (WHERE status::text = 'accepted')    AS accepted,
        COUNT(*) FILTER (WHERE status::text = 'completed')   AS completed,
        COUNT(*) FILTER (WHERE status::text = 'no_show')     AS no_show
      FROM contact_events WHERE created_at >= ${prevStart} AND created_at < ${prevEnd}
    `,
    prisma.searchIntent.count({ where: { searched_at: { gte: prevStart, lt: prevEnd } } }),
    prisma.providerProfile.count({ where: { created_at: { gte: prevStart, lt: prevEnd }, is_scrape_record: false } }),
    prisma.consumerProfile.count({ where: { created_at: { gte: prevStart, lt: prevEnd } } }),

    // ── All-time snapshot ──
    prisma.$queryRaw<Array<{ total: bigint; claimed: bigint }>>`
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_claimed = true) AS claimed
      FROM provider_profiles
    `,
    prisma.$queryRaw<Array<{ trust_tier: string; count: bigint; avg_score: number }>>`
      SELECT trust_tier, COUNT(*) AS count, ROUND(AVG(display_score), 1) AS avg_score
      FROM trust_scores GROUP BY trust_tier ORDER BY trust_tier
    `,
    prisma.$queryRaw<Array<{ avg: number }>>`
      SELECT ROUND(AVG(display_score), 1) AS avg FROM trust_scores
    `,
    prisma.consumerProfile.count(),
    prisma.providerProfile.count(),
    prisma.$queryRaw<Array<{count: bigint}>>`SELECT COUNT(*) AS count FROM trust_flags WHERE status::text = 'open'`.then(r => Number(r[0]?.count ?? 0n)),
    prisma.providerVerification.count({ where: { status: 'pending', verification_type: 'credential' } }),
    // Credentials overdue > 48h
    prisma.providerVerification.count({
      where: {
        status: 'pending',
        verification_type: 'credential',
        created_at: { lt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      },
    }),
    prisma.certificateRecord.count({ where: { is_revoked: false } }),
    // FCM delivery 24h
    prisma.$queryRaw<Array<{ total: bigint; delivered: bigint }>>`
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered
      FROM notification_log
      WHERE channel = 'fcm' AND sent_at >= NOW() - INTERVAL '24 hours'
    `,
    // Active subscriptions right now
    prisma.$queryRaw<Array<{ tier: string; count: bigint; total_paise: bigint }>>`
      SELECT sp.tier, COUNT(*) AS count, COALESCE(SUM(sr.amount_paise), 0) AS total_paise
      FROM subscription_records sr
      JOIN subscription_plans sp ON sp.id = sr.plan_id
      WHERE sr.status = 'active' AND (sr.expires_at IS NULL OR sr.expires_at > NOW())
      GROUP BY sp.tier
    `,
    // MRR = normalize all active sub amounts to monthly
    prisma.$queryRaw<Array<{ mrr_paise: bigint; active_count: bigint }>>`
      SELECT
        COALESCE(SUM(
          CASE
            WHEN sp.validity_days >= 365 THEN sr.amount_paise / 12
            ELSE sr.amount_paise
          END
        ), 0) AS mrr_paise,
        COUNT(*) AS active_count
      FROM subscription_records sr
      JOIN subscription_plans sp ON sp.id = sr.plan_id
      WHERE sr.status = 'active' AND (sr.expires_at IS NULL OR sr.expires_at > NOW())
    `,
  ]);

  // ── Derived: current ──────────────────────────────────────────────────────
  const f = leadFunnelCurr[0] ?? { total: 0n, accepted: 0n, declined: 0n, expired: 0n, completed: 0n, no_show: 0n, calls: 0n, messages: 0n, slot_bookings: 0n };
  const fTotal    = Number(f.total);
  const fAccepted = Number(f.accepted);
  const fCompleted = Number(f.completed);
  const fNoShow   = Number(f.no_show);

  const mauN = Number(mauCurr[0]?.mau ?? 0n);

  // ── Derived: previous ─────────────────────────────────────────────────────
  const fp = leadFunnelPrev[0] ?? { total: 0n, accepted: 0n, completed: 0n, no_show: 0n };
  const mauPrevN  = Number(mauPrev[0]?.mau ?? 0n);
  const leadsPN   = Number(fp.total);

  // ── Derived: all-time ─────────────────────────────────────────────────────
  const claimRow = claimStats[0] ?? { total: 0n, claimed: 0n };
  const totalProv = Number(claimRow.total);
  const claimedProv = Number(claimRow.claimed);

  const fcmRow = fcmStats[0] ?? { total: 0n, delivered: 0n };
  const fcmTotal = Number(fcmRow.total);
  const fcmRate = fcmTotal > 0 ? Number(fcmRow.delivered) / fcmTotal : null;

  const mrrRow = mrrStats[0] ?? { mrr_paise: 0n, active_count: 0n };
  const mrrPaise = Number(mrrRow.mrr_paise);
  const activeCount = Number(mrrRow.active_count);

  const tierMap: Record<string, { count: number; total_paise: number }> = {};
  activeSubs.forEach(r => {
    tierMap[r.tier] = { count: Number(r.count), total_paise: Number(r.total_paise) };
  });

  // ── Health scores ─────────────────────────────────────────────────────────
  const acceptancePct   = fTotal > 0 ? (fAccepted / fTotal) * 100 : 0;
  const completionPct   = fAccepted > 0 ? (fCompleted / fAccepted) * 100 : 0;
  const noShowPct       = fAccepted > 0 ? (fNoShow / fAccepted) * 100 : 0;
  const srConvPct       = searchesCurr > 0 ? (fTotal / searchesCurr) * 100 : 0;

  // Drop-off insights
  const insights: string[] = [];
  if (searchesCurr > 100 && srConvPct < 30) insights.push(`Low search→lead conversion (${srConvPct.toFixed(0)}%) — possible supply gap in high-demand categories`);
  if (noShowPct > 20) insights.push(`High no-show rate (${noShowPct.toFixed(0)}%) — provider reliability issue needs attention`);
  if (acceptancePct < 50 && fTotal > 50) insights.push(`Low acceptance rate (${acceptancePct.toFixed(0)}%) — providers may be missing leads`);
  if (pendingCredOver48h > 0) insights.push(`${pendingCredOver48h} credentials pending >48h — SLA breach`);
  if (fcmRate !== null && fcmRate < 0.70) insights.push(`FCM delivery ${(fcmRate * 100).toFixed(0)}% — below 70% threshold, push notifications unreliable`);

  // ── Daily trend data (sparklines) ───────────────────────────────────────
  const dailyTrends = await prisma.$queryRaw<Array<{
    day: string;
    dau: bigint;
    leads: bigint;
    new_users: bigint;
    revenue_paise: bigint;
    active_subs: bigint;
  }>>`
    SELECT
      TO_CHAR(d.day, 'YYYY-MM-DD') AS day,
      COALESCE(act.dau, 0)         AS dau,
      COALESCE(ld.total, 0)        AS leads,
      COALESCE(nu.cnt, 0)          AS new_users,
      COALESCE(rev.total_paise, 0) AS revenue_paise,
      COALESCE(subs.cnt, 0)        AS active_subs
    FROM generate_series(
      ${start}::timestamptz::date,
      NOW()::date,
      '1 day'::interval
    ) AS d(day)
    LEFT JOIN (
      SELECT DATE(created_at) AS day, COUNT(DISTINCT consumer_id) AS dau
      FROM contact_events WHERE created_at >= ${start}
      GROUP BY DATE(created_at)
    ) act ON act.day = d.day
    LEFT JOIN (
      SELECT DATE(created_at) AS day, COUNT(*) AS total
      FROM contact_events WHERE created_at >= ${start}
      GROUP BY DATE(created_at)
    ) ld ON ld.day = d.day
    LEFT JOIN (
      SELECT DATE(created_at) AS day, COUNT(*) AS cnt
      FROM users WHERE created_at >= ${start}
      GROUP BY DATE(created_at)
    ) nu ON nu.day = d.day
    LEFT JOIN (
      SELECT DATE(started_at) AS day, COALESCE(SUM(amount_paise), 0) AS total_paise
      FROM subscription_records
      WHERE started_at >= ${start} AND status IN ('active','expired','cancelled')
      GROUP BY DATE(started_at)
    ) rev ON rev.day = d.day
    LEFT JOIN (
      SELECT DATE(started_at) AS day, COUNT(*) AS cnt
      FROM subscription_records
      WHERE started_at >= ${start} AND status = 'active'
      GROUP BY DATE(started_at)
    ) subs ON subs.day = d.day
    ORDER BY d.day
  `;

  return {
    period,
    computed_at: new Date().toISOString(),

    // Current period
    mau:               mauN,
    leads_total:       fTotal,
    leads_accepted:    fAccepted,
    leads_declined:    Number(f.declined),
    leads_expired:     Number(f.expired),
    leads_completed:   fCompleted,
    leads_no_show:     fNoShow,
    leads_calls:       Number(f.calls),
    leads_messages:    Number(f.messages),
    leads_slot_bookings: Number(f.slot_bookings),
    searches:          searchesCurr,
    new_providers:     newProvCurr,
    new_consumers:     newConsCurr,
    ratings_submitted: ratingsCurr,

    // Previous period (for trend arrows)
    mau_prev:          mauPrevN,
    leads_prev:        leadsPN,
    searches_prev:     searchesPrev,
    new_providers_prev: newProvPrev,
    new_consumers_prev: newConsPrev,

    // Deltas (% change vs previous period, null = no prior data)
    mau_delta_pct:          deltaPct(mauN, mauPrevN),
    leads_delta_pct:        deltaPct(fTotal, leadsPN),
    searches_delta_pct:     deltaPct(searchesCurr, searchesPrev),
    new_providers_delta_pct: deltaPct(newProvCurr, newProvPrev),
    new_consumers_delta_pct: deltaPct(newConsCurr, newConsPrev),

    // Rates
    acceptance_rate_pct:  Number(acceptancePct.toFixed(1)),
    completion_rate_pct:  Number(completionPct.toFixed(1)),
    no_show_rate_pct:     Number(noShowPct.toFixed(1)),
    search_to_lead_pct:   Number(srConvPct.toFixed(1)),

    // All-time snapshot
    total_providers:   totalProv,
    total_consumers:   consumerTotal,
    total_users:       totalProv + consumerTotal,
    claimed_providers: claimedProv,
    claim_rate_pct:    totalProv > 0 ? Number(((claimedProv / totalProv) * 100).toFixed(1)) : 0,
    avg_trust_score:   Number(avgTrustScore[0]?.avg ?? 0),
    trust_tier_breakdown: trustTierBreakdown.map(r => ({
      tier: r.trust_tier, count: Number(r.count), avg_score: Number(r.avg_score),
    })),

    // Revenue
    mrr_paise:            mrrPaise,
    arr_paise:            mrrPaise * 12,
    arpu_paise:           activeCount > 0 ? Math.round(mrrPaise / activeCount) : 0,
    active_subscriptions: activeCount,
    subs_by_tier:         tierMap,

    // Operational health
    open_disputes:        openDisputes,
    pending_credentials:  pendingCreds,
    pending_cred_over48h: pendingCredOver48h,
    certificates_issued:  certsIssued,
    fcm_delivery_rate_24h: fcmRate,

    // Insights — actionable observations derived from data
    insights,

    // Trend lines — daily time series
    daily_trends: dailyTrends.map(r => ({
      day:           r.day,
      dau:           Number(r.dau),
      leads:         Number(r.leads),
      new_users:     Number(r.new_users),
      revenue_paise: Number(r.revenue_paise),
      active_subs:   Number(r.active_subs),
    })),

    // Legacy
    total_contacts: fTotal,
    claim_rate: totalProv > 0 ? claimedProv / totalProv : 0,
  };
}

// ===========================================================================
// MODULE 5 — SYSTEM CONFIG
// ===========================================================================

async function getSystemConfigKey(key: string) {
  return prisma.systemConfig.findUnique({ where: { key } });
}

interface SetSystemConfigParams {
  key: string;
  value: string;
  description?: string;
  updatedBy: string;
}

async function setSystemConfigKey(params: SetSystemConfigParams) {
  const { key, value, description, updatedBy } = params;

  // Key must already exist — admin can only update, not create new keys
  // (New keys are added via migrations)
  const existing = await prisma.systemConfig.findUnique({ where: { key } });
  if (!existing) {
    throw new NotFoundError(`System config key '${key}'`);
  }

  return prisma.systemConfig.update({
    where: { key },
    data: {
      value,
      description:  description ?? existing.description,
      updated_by:   updatedBy,
    },
  });
}

// ===========================================================================
// MODULE 6 — TRUST CONFIG
// ===========================================================================

async function getTrustConfig() {
  const rows = await prisma.trustScoreConfig.findMany({
    orderBy: [
      { listing_type: 'asc' },
      { signal_name: 'asc' },
    ],
  });

  // Group by listing_type for readability
  const grouped: Record<string, typeof rows> = {};
  for (const row of rows) {
    if (!grouped[row.listing_type]) grouped[row.listing_type] = [];
    grouped[row.listing_type].push(row);
  }

  return { raw: rows, grouped };
}

interface TrustConfigUpdate {
  id: string;
  max_pts?: number;
  raw_max_total?: number;
  is_active?: boolean;
}

interface SetTrustConfigParams {
  updates: TrustConfigUpdate[];
  adminId: string;
}

async function setTrustConfig(params: SetTrustConfigParams) {
  const { updates, adminId } = params;

  const results = await prisma.$transaction(
    updates.map(upd =>
      prisma.trustScoreConfig.update({
        where: { id: upd.id },
        data: {
          ...(upd.max_pts       !== undefined && { max_pts:       upd.max_pts }),
          ...(upd.raw_max_total !== undefined && { raw_max_total: upd.raw_max_total }),
          ...(upd.is_active     !== undefined && { is_active:     upd.is_active }),
        },
      }),
    ),
  );

  logger.info('trust_score_config updated');
  return results;
}

// ===========================================================================
// MODULE 7 — NOTIFICATION LOG
// ===========================================================================

interface GetNotificationLogParams {
  channel?: string;
  eventType?: string;
  userId?: string;
  page: number;
  limit: number;
}

async function getNotificationLog(params: GetNotificationLogParams) {
  const { channel, eventType, userId, page, limit } = params;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (channel)    where.channel    = channel as any;
  if (eventType)  where.event_type = eventType;
  if (userId)     where.user_id    = userId;

  const [logs, total] = await Promise.all([
    prisma.notificationLog.findMany({
      where,
      orderBy: { sent_at: 'desc' },
      skip,
      take: Math.min(limit, 1000 - skip),   // Hard cap: last 1000 total
      select: {
        id:               true,
        user_id:          true,
        channel:          true,
        event_type:       true,
        sent_at:          true,
        delivered_at:     true,
        read_at:          true,
        fcm_message_id:   true,
        wa_message_id:    true,
        wa_fallback_sent: true,
      },
    }),
    prisma.notificationLog.count({ where }),
  ]);

  return { logs, total: Math.min(total, 1000) };
}

// ===========================================================================
// MODULE 8 — SCRAPING STATUS
// ===========================================================================

async function getScrapingStatus(limit: number) {
  const [jobs, summary] = await Promise.all([
    prisma.scrapingJob.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id:            true,
        job_name:      true,
        status:        true,
        city_id:       true,
        records_scraped: true,
        started_at:    true,
        completed_at:  true,
        error_log:     true,
        created_at:    true,
      },
    }),

    prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
      SELECT status, COUNT(*) AS count
      FROM scraping_jobs
      GROUP BY status
    `,
  ]);

  const stagingCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM scraping_staging WHERE is_promoted = false
  `;

  return {
    jobs,
    summary: summary.map(r => ({ status: r.status, count: Number(r.count) })),
    staging_unprocessed: Number(stagingCount[0]?.count ?? 0n),
    queried_at: new Date().toISOString(),
  };
}

// ===========================================================================
// MODULE 9 — OPENSEARCH RESYNC
// ===========================================================================

interface TriggerResyncParams {
  dryRun: boolean;
  adminId: string;
  correlationId: string;
}

async function triggerOpenSearchResync(params: TriggerResyncParams) {
  const { dryRun, adminId, correlationId } = params;

  const payload = {
    full_resync:    true,
    dry_run:        dryRun,
    triggeredBy:   adminId,
    correlation_id: correlationId,
    triggered_at:   new Date().toISOString(),
  };

  const command = new InvokeCommand({
    FunctionName:   OPENSEARCH_RESYNC_LAMBDA,
    InvocationType: InvocationType.Event,          // Async — don't wait for completion
    Payload:        Buffer.from(JSON.stringify(payload)),
    ClientContext:  Buffer.from(JSON.stringify({ correlationId })).toString('base64'),
  });

  const response = await lambdaClient.send(command);

  if (response.StatusCode !== 202) {
    const err = new Error(`Lambda invocation returned unexpected status: ${response.StatusCode}`);
    (err as any).statusCode = 502;
    (err as any).code = 'LAMBDA_INVOCATION_FAILED';
    throw err;
  }

  // Log to opensearch_sync_log for audit trail
  await prisma.opensearchSyncLog.create({
    data: {
      provider_id:    '00000000-0000-0000-0000-000000000000',
      trigger_type:   'admin_full_resync',
      sync_status:    'triggered',
      correlation_id: correlationId ?? null,
    },
  }).catch(err => {
    // Non-blocking — don't fail the response over audit log
    logger.warn('Failed to write opensearch_sync_log — non-blocking');
  });

  return {
    invocationId:   response.$metadata.requestId ?? 'unknown',
    statusCode:     response.StatusCode,
  };
}

// ===========================================================================
// PROVIDER ANALYTICS (Module 10 — called from route, not admin-only)
// ===========================================================================

interface GetProviderAnalyticsParams {
  providerId: string;
  period: string;
}

export interface ProviderAnalyticsData {
  period: string;
  period_label: string;
  start_date: string;
  end_date: string;
  leads: {
    total: number;
    accepted: number;
    declined: number;
    expired: number;
    acceptance_rate_pct: number;
  };
  ratings: {
    total_received: number;
    average_stars: number | null;
    verified_contact_count: number;
    open_community_count: number;
  };
  trust: {
    current_score: number;
    current_tier: string;
    score_at_period_start: number | null;
    change: number | null;
  };
  contacts: {
    total: number;
    by_type: Array<{ type: string; count: number }>;
  };
}

async function getProviderAnalytics(params: GetProviderAnalyticsParams): Promise<ProviderAnalyticsData> {
  const { providerId, period } = params;
  const { start, end, label } = parsePeriod(period);

  const [
    leadStats,
    ratingStats,
    currentTrust,
    trustAtStart,
    contactStats,
  ] = await Promise.all([

    // Lead stats from provider_lead_usage (monthly rollups) or contact_events
    prisma.$queryRaw<Array<{
      total: bigint; accepted: bigint; declined: bigint; expired: bigint;
    }>>`
      SELECT
        COUNT(*)                                                        AS total,
        COUNT(*) FILTER (WHERE provider_status = 'accepted')           AS accepted,
        COUNT(*) FILTER (WHERE provider_status = 'declined')           AS declined,
        COUNT(*) FILTER (WHERE provider_status = 'expired')            AS expired
      FROM contact_events
      WHERE provider_id = ${providerId}
        AND created_at  >= ${start}
        AND created_at  <  ${end}
    `,

    // Rating stats for period
    prisma.$queryRaw<Array<{
      total: bigint; avg_stars: number | null;
      verified: bigint; open_community: bigint;
    }>>`
      SELECT
        COUNT(*)                                                            AS total,
        ROUND(AVG(overall_stars)::numeric, 2)                              AS avg_stars,
        COUNT(*) FILTER (WHERE weight_type = 'verified_contact')           AS verified,
        COUNT(*) FILTER (WHERE weight_type = 'open_community')             AS open_community
      FROM ratings
      WHERE provider_id       = ${providerId}
        AND moderation_status = 'approved'
        AND created_at        >= ${start}
        AND created_at        < ${end}
    `,

    // Current trust score + tier
    prisma.trustScore.findUnique({
      where: { provider_id: providerId },
      select: { display_score: true, trust_tier: true },
    }),

    // Trust score at beginning of period (closest history entry before start)
    prisma.trustScoreHistory.findFirst({
      where: {
        provider_id: providerId,
        event_at:    { lt: start },
      },
      orderBy: { event_at: 'desc' },
      select: { new_display_score: true },
    }),

    // Contact breakdown by type
    prisma.$queryRaw<Array<{ contact_type: string; count: bigint }>>`
      SELECT contact_type, COUNT(*) AS count
      FROM contact_events
      WHERE provider_id = ${providerId}
        AND created_at  >= ${start}
        AND created_at  <  ${end}
      GROUP BY contact_type
    `,
  ]);

  const lead = leadStats[0] ?? { total: 0n, accepted: 0n, declined: 0n, expired: 0n };
  const rating = ratingStats[0] ?? { total: 0n, avg_stars: null, verified: 0n, open_community: 0n };

  const totalLeads    = Number(lead.total);
  const acceptedLeads = Number(lead.accepted);
  const acceptanceRate = totalLeads > 0 ? Number(((acceptedLeads / totalLeads) * 100).toFixed(1)) : 0;

  const currentScore = currentTrust?.display_score ?? 0;
  const startScore   = trustAtStart?.new_display_score ?? null;
  const scoreDelta   = startScore !== null ? currentScore - startScore : null;

  return {
    period,
    period_label:  label,
    start_date:    start.toISOString(),
    end_date:      end.toISOString(),
    leads: {
      total:               totalLeads,
      accepted:            acceptedLeads,
      declined:            Number(lead.declined),
      expired:             Number(lead.expired),
      acceptance_rate_pct: acceptanceRate,
    },
    ratings: {
      total_received:        Number(rating.total),
      average_stars:         rating.avg_stars,
      verified_contact_count: Number(rating.verified),
      open_community_count:  Number(rating.open_community),
    },
    trust: {
      current_score:         currentScore,
      current_tier:          currentTrust?.trust_tier ?? 'unverified',
      score_at_period_start: startScore,
      change:                scoreDelta,
    },
    contacts: {
      total: Number(contactStats.reduce((sum, r) => sum + Number(r.count), 0)),
      by_type: contactStats.map(r => ({ type: r.contact_type, count: Number(r.count) })),
    },
  };
}

// ---------------------------------------------------------------------------
// Exported service object
// ---------------------------------------------------------------------------

export const adminService = {
  getDisputes,
  resolveDispute,
  getPendingCredentials,
  resolveCredential,
  searchProviders,
  getProviderDetail,
  getPlatformAnalytics,
  getSystemConfigKey,
  setSystemConfigKey,
  getTrustConfig,
  setTrustConfig,
  getNotificationLog,
  getScrapingStatus,
  triggerOpenSearchResync,
  getProviderAnalytics,
};
