import { prisma } from '@satvaaah/db';
/**
 * admin.routes.ts — All 10 admin modules + provider analytics
 * services/admin/src/routes/admin.routes.ts
 *
 * Module map:
 *  1. Disputes          GET  /admin/disputes              open trust_flags queue
 *                       PATCH /admin/disputes/:id          resolve with outcome
 *  2. Credentials       GET  /admin/credentials           pending credential uploads
 *                       PATCH /admin/credentials/:id       approve/reject with reason
 *  3. Providers         GET  /admin/providers             full-text search all providers
 *                       GET  /admin/providers/:id         full provider detail
 *  4. Platform Analytics GET /admin/analytics/platform    MAU, contacts, claim rate
 *  5. System Config     GET  /admin/system-config/:key    read system_config key
 *                       PUT  /admin/system-config/:key    write system_config key
 *  6. Trust Config      GET  /admin/trust-config          all signal weights
 *                       PUT  /admin/trust-config          update weights (admin-editable)
 *  7. Notification Log  GET  /admin/notification-log      last 1000 FCM+WhatsApp events
 *  8. Scraping Status   GET  /admin/scraping/status       scraping_jobs status
 *  9. OpenSearch Resync POST /admin/opensearch/resync     trigger full-resync Lambda
 * 10. Provider Analytics GET /providers/me/analytics      (not admin-only — uses requireAuth)
 *
 * All admin routes protected by requireAdmin (admin_users table only).
 * Provider analytics uses standard requireAuth from packages/middleware.
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '@satvaaah/middleware';
import { requireAuth } from '@satvaaah/middleware';
import { logger } from '@satvaaah/logger';
import { requireAdmin, AdminRequest } from '../middleware/requireAdmin';
import { adminService } from '../services/adminService';
import { gaasService } from '../services/gaasService';

const router = Router();

// ===========================================================================
// MODULE 1 — DISPUTES (trust_flags queue)
// ===========================================================================

/**
 * GET /api/v1/admin/disputes
 * Returns open trust_flags, newest first.
 * Optional: ?status=open|resolved|dismissed  ?page=1  ?limit=50
 */
router.get(
  '/admin/disputes',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const status = (req.query.status as string) ?? 'open';
    const page   = Math.max(1, Number(req.query.page  ?? 1));
    const limit  = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));

    // TrustFlagStatus enum: open | under_review | resolved | dismissed
    const allowedStatuses = ['open', 'under_review', 'resolved', 'dismissed'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: `status must be one of: ${allowedStatuses.join(', ')}` },
      });
    }

    const result = await adminService.getDisputes({ status, page, limit });

    return res.json({
      success: true,
      data: result.disputes,
      meta: { total: result.total, page, pages: Math.ceil(result.total / limit), limit },
    });
  }),
);

/**
 * PATCH /api/v1/admin/disputes/:id
 * Resolve or dismiss a trust_flag.
 * Body: { outcome: 'under_review' | 'resolved' | 'dismissed', reason: string, penalty_applied?: boolean }
 */
router.patch(
  '/admin/disputes/:id',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { id } = req.params;
    const { outcome, reason, penalty_applied } = req.body;

    if (!outcome || !['under_review', 'resolved', 'dismissed'].includes(outcome)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_OUTCOME', message: 'outcome must be under_review, resolved, or dismissed' },
      });
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(400).json({
        success: false,
        error: { code: 'REASON_REQUIRED', message: 'reason must be at least 5 characters' },
      });
    }

    const dispute = await adminService.resolveDispute({
      id,
      outcome,
      reason: reason.trim(),
      penaltyApplied: penalty_applied === true,
      adminId: req.admin!.id,
      correlationId: req.headers['x-correlation-id'] as string,
    });

    return res.json({ success: true, data: dispute });
  }),
);

// ===========================================================================
// MODULE 2 — CREDENTIALS (verification queue)
// ===========================================================================

/**
 * GET /api/v1/admin/credentials
 * Returns pending credential uploads, oldest first (FIFO review queue).
 * Optional: ?status=pending|approved|rejected  ?page=1  ?limit=50
 */
router.get(
  '/admin/credentials',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const status = (req.query.status as string) ?? 'pending';
    const page   = Math.max(1, Number(req.query.page  ?? 1));
    const limit  = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));

    const allowedStatuses = ['pending', 'approved', 'rejected'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: `status must be one of: ${allowedStatuses.join(', ')}` },
      });
    }

    const result = await adminService.getPendingCredentials({ status, page, limit });

    return res.json({
      success: true,
      data: result.credentials,
      meta: { total: result.total, page, pages: Math.ceil(result.total / limit), limit },
    });
  }),
);

/**
 * PATCH /api/v1/admin/credentials/:id
 * Approve or reject a provider credential upload.
 * Body: { action: 'approve' | 'reject', reason?: string }
 */
router.patch(
  '/admin/credentials/:id',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { id } = req.params;
    const { action, reason } = req.body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ACTION', message: 'action must be approve or reject' },
      });
    }
    if (action === 'reject' && (!reason || reason.trim().length < 5)) {
      return res.status(400).json({
        success: false,
        error: { code: 'REASON_REQUIRED', message: 'reason is required when rejecting a credential' },
      });
    }

    const credential = await adminService.resolveCredential({
      id,
      action,
      reason: reason?.trim(),
      adminId: req.admin!.id,
      correlationId: req.headers['x-correlation-id'] as string,
    });

    return res.json({ success: true, data: credential });
  }),
);

// ===========================================================================
// MODULE 3 — PROVIDERS (search + detail)
// ===========================================================================

/**
 * GET /api/v1/admin/providers
 * Full-text search across all providers (claimed + unclaimed + scraped).
 * ?q=searchterm  ?page=1  ?limit=20  ?listing_type=  ?is_claimed=
 */
router.get(
  '/admin/providers',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const q            = (req.query.q as string) ?? '';
    const page         = Math.max(1, Number(req.query.page  ?? 1));
    const limit        = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const listingType  = req.query.listing_type as string | undefined;
    const isClaimed    = req.query.is_claimed === 'true' ? true
                       : req.query.is_claimed === 'false' ? false
                       : undefined;

    const result = await adminService.searchProviders({ q, page, limit, listingType, isClaimed });

    return res.json({
      success: true,
      data: result.providers,
      meta: { total: result.total, page, pages: Math.ceil(result.total / limit), limit, q },
    });
  }),
);

/**
 * GET /api/v1/admin/providers/:id
 * Full provider detail: profile + trust score + credentials + contact stats.
 */
router.get(
  '/admin/providers/:id',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { id } = req.params;
    const detail = await adminService.getProviderDetail(id);

    if (!detail) {
      return res.status(404).json({
        success: false,
        error: { code: 'PROVIDER_NOT_FOUND', message: `Provider ${id} not found` },
      });
    }

    return res.json({ success: true, data: detail });
  }),
);

// ===========================================================================
// MODULE 4 — PLATFORM ANALYTICS
// ===========================================================================

/**
 * GET /api/v1/admin/analytics/platform
 * Returns platform-wide KPIs: MAU, total contacts, claim rate, trust tiers.
 * Optional: ?period=7d|30d|90d  (default 30d)
 */
router.get(
  '/admin/analytics/platform',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const period = (req.query.period as string) ?? '30d';
    const allowedPeriods = ['7d', '30d', '90d', 'wtd', 'mtd', 'ytd', 'ltd'];
    const period_normalized = period;
    if (!allowedPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PERIOD', message: `period must be one of: ${allowedPeriods.join(', ')}` },
      });
    }

    const analytics = await adminService.getPlatformAnalytics(period);
    return res.json({ success: true, data: analytics });
  }),
);

// ===========================================================================
// MODULE 5 — SYSTEM CONFIG
// ===========================================================================

// ===========================================================================
// MODULE 5a — SYSTEM CONFIG (list all keys)
// ===========================================================================

/**
 * GET /api/v1/admin/system-config
 * Returns all system_config rows for the admin control panel.
 * Grouped by category for display.
 */
router.get(
  '/admin/system-config',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { prisma } = await import('@satvaaah/db');
    const configs = await prisma.systemConfig.findMany({
      orderBy: [{ key: 'asc' }],
    });
    return res.json({ success: true, data: configs });
  }),
);

// ===========================================================================
// MODULE 5b — TAXONOMY MANAGEMENT
// ===========================================================================

/**
 * GET /api/v1/admin/taxonomy
 * Returns all taxonomy_nodes for the admin portal category manager.
 */
router.get(
  '/admin/taxonomy',
  requireAdmin,
  asyncHandler(async (_req: AdminRequest, res: Response) => {
    const { prisma } = await import('@satvaaah/db');
    const nodes = await prisma.taxonomyNode.findMany({
      orderBy: [{ tab: 'asc' }, { l1: 'asc' }, { l2: 'asc' }, { l3: 'asc' }, { l4: 'asc' }],
    });
    return res.json({ success: true, data: nodes });
  }),
);

/**
 * POST /api/v1/admin/taxonomy
 * Create a new taxonomy node (add category or sub-category).
 * Body: { tab, l1, l2?, l3?, l4?, display_name, slug, icon_name?, is_active, search_intent_expiry_days? }
 */
router.post(
  '/admin/taxonomy',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { prisma } = await import('@satvaaah/db');
    const { tab, l1, l2, l3, l4, slug, is_active, search_intent_expiry_days, icon_name } = req.body;

    if (!tab || !l1 || !slug) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'tab, l1, and slug are required' },
      });
    }

    // Slug must be unique
    const existing = await prisma.taxonomyNode.findFirst({ where: { slug } });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { code: 'SLUG_EXISTS', message: `Slug '${slug}' is already in use` },
      });
    }

    const node = await prisma.taxonomyNode.create({
      data: {
        tab,
        l1,
        l2: l2 ?? null,
        l3: l3 ?? null,
        l4: l4 ?? null,
        slug,
        icon_name: icon_name ?? null,
        is_active: is_active !== false,
        search_intent_expiry_days: search_intent_expiry_days ?? null,
      },
    });

    logger.info({ adminId: req.admin!.id, nodeId: node.id, slug }, 'taxonomy_node.created');

    // Invalidate Redis taxonomy cache so next GET /categories reflects new node
    try {
      const { redisClient } = await import('../lib/redis');
      const keys = await redisClient.keys('taxonomy:*');
      if (keys.length) await redisClient.del(...keys);
    } catch { /* non-fatal */ }

    return res.status(201).json({ success: true, data: node });
  }),
);

/**
 * PATCH /api/v1/admin/taxonomy/:id
 * Update a taxonomy node (rename, toggle active, change expiry).
 */
router.patch(
  '/admin/taxonomy/:id',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { prisma } = await import('@satvaaah/db');
    const { id } = req.params;
    const { l4, display_name, is_active, search_intent_expiry_days, icon_name, rating_dimensions } = req.body;

    const node = await prisma.taxonomyNode.update({
      where: { id },
      data: {
        ...(l4 !== undefined && { l4 }),
        ...(is_active !== undefined && { is_active }),
        ...(search_intent_expiry_days !== undefined && { search_intent_expiry_days }),
        ...(icon_name !== undefined && { icon_name }),
        ...(rating_dimensions !== undefined && { rating_dimensions }),
      },
    });

    // Invalidate Redis cache
    try {
      const { redisClient } = await import('../lib/redis');
      const keys = await redisClient.keys('taxonomy:*');
      if (keys.length) await redisClient.del(...keys);
    } catch { /* non-fatal */ }

    logger.info({ adminId: req.admin!.id, nodeId: id }, 'taxonomy_node.updated');
    return res.json({ success: true, data: node });
  }),
);

/**
 * GET /api/v1/admin/system-config/:key
 * Read a single system_config row.
 */
router.get(
  '/admin/system-config/:key',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { key } = req.params;
    const config = await adminService.getSystemConfigKey(key);

    if (!config) {
      return res.status(404).json({
        success: false,
        error: { code: 'CONFIG_KEY_NOT_FOUND', message: `Config key '${key}' not found` },
      });
    }

    return res.json({ success: true, data: config });
  }),
);

/**
 * PUT /api/v1/admin/system-config/:key
 * Update a system_config value. Critical Rule #20: Nothing hardcoded.
 * Body: { value: string, description?: string }
 */
router.put(
  '/admin/system-config/:key',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { key } = req.params;
    const { value, description } = req.body;

    if (value === undefined || value === null) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALUE_REQUIRED', message: 'value is required' },
      });
    }

    const config = await adminService.setSystemConfigKey({
      key,
      value: String(value),
      description,
      updatedBy: req.admin!.id,
    });

    logger.info(
      { adminId: req.admin!.id, key, newValue: value },
      'system_config key updated',
    );

    return res.json({ success: true, data: config });
  }),
);

// ===========================================================================
// MODULE 6 — TRUST CONFIG
// ===========================================================================

/**
 * GET /api/v1/admin/trust-config
 * Returns all rows from trust_score_config (all listing types + signals).
 * Critical Rule #20: All signal weights in trust_score_config. Nothing hardcoded.
 */
router.get(
  '/admin/trust-config',
  requireAdmin,
  asyncHandler(async (_req: AdminRequest, res: Response) => {
    const config = await adminService.getTrustConfig();
    return res.json({ success: true, data: config });
  }),
);

/**
 * PUT /api/v1/admin/trust-config
 * Batch-update trust_score_config weights.
 * Body: { updates: [{ id: string, max_pts?: number, is_active?: boolean }] }
 * Requires super_admin role for safety.
 */
router.put(
  '/admin/trust-config',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    if (req.admin!.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: { code: 'SUPER_ADMIN_REQUIRED', message: 'Updating trust weights requires super_admin role' },
      });
    }

    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'UPDATES_REQUIRED', message: 'updates must be a non-empty array' },
      });
    }

    const result = await adminService.setTrustConfig({
      updates,
      adminId: req.admin!.id,
    });

    logger.info(
      { adminId: req.admin!.id, updateCount: updates.length },
      'trust_score_config weights updated',
    );

    return res.json({ success: true, data: result });
  }),
);

// ===========================================================================
// MODULE 7 — NOTIFICATION LOG
// ===========================================================================

/**
 * GET /api/v1/admin/notification-log
 * Last 1000 FCM + WhatsApp events, newest first.
 * Optional: ?channel=fcm|whatsapp  ?event_type=  ?user_id=  ?page=1
 */
router.get(
  '/admin/notification-log',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const channel   = req.query.channel as string | undefined;
    const eventType = req.query.event_type as string | undefined;
    const userId    = req.query.user_id as string | undefined;
    const page      = Math.max(1, Number(req.query.page ?? 1));
    const limit     = 50; // fixed page size for this endpoint

    if (channel && !['fcm', 'whatsapp'].includes(channel)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CHANNEL', message: 'channel must be fcm or whatsapp' },
      });
    }

    const result = await adminService.getNotificationLog({ channel, eventType, user_id: userId, page, limit });

    return res.json({
      success: true,
      data: result.logs,
      meta: { total: result.total, page, pages: Math.ceil(result.total / limit), limit },
    });
  }),
);

// ===========================================================================
// MODULE 8 — SCRAPING STATUS
// ===========================================================================

/**
 * GET /api/v1/admin/scraping/status
 * Returns scraping_jobs status: running, pending, failed, completed.
 * Optional: ?limit=50
 */
router.get(
  '/admin/scraping/status',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const status = await adminService.getScrapingStatus(limit);
    return res.json({ success: true, data: status });
  }),
);

/**
 * GET /api/v1/admin/scraping/sources
 * Returns all 63 scraper sources with enabled/disabled status,
 * last run time, and total records scraped.
 * Sources absent from system_config are ENABLED by default.
 */
router.get(
  '/admin/scraping/sources',
  requireAdmin,
  asyncHandler(async (_req: AdminRequest, res: Response) => {
    const sources = await adminService.getScrapingSources();
    return res.json({ success: true, data: sources });
  }),
);

/**
 * PATCH /api/v1/admin/scraping/sources/:source
 * Enable or disable a scraping source.
 * Body: { enabled: boolean }
 * Writes scraping_source_enabled_<source> to system_config.
 * Scraper reads this at startup via load_enabled_sources().
 */
router.patch(
  '/admin/scraping/sources/:source',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { source } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'enabled must be a boolean' },
      });
    }

    const result = await adminService.toggleScrapingSource({
      sourceKey: source,
      enabled,
      adminId:   req.admin!.id,
    });

    logger.info(
      { adminId: req.admin!.id, source, enabled },
      `Scraping source ${source} ${enabled ? 'enabled' : 'disabled'}`,
    );

    return res.json({ success: true, data: result });
  }),
);

// ===========================================================================
// MODULE 9 — OPENSEARCH RESYNC
// ===========================================================================

/**
 * POST /api/v1/admin/opensearch/resync
 * Triggers a full provider_profiles → OpenSearch resync via Lambda.
 * Body: { dry_run?: boolean }   (dry_run=true scans but does not write)
 */
router.post(
  '/admin/opensearch/resync',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    if (req.admin!.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: { code: 'SUPER_ADMIN_REQUIRED', message: 'Full resync requires super_admin role' },
      });
    }

    const dryRun = req.body.dry_run === true;
    const correlationId = req.headers['x-correlation-id'] as string;

    const invocation = await adminService.triggerOpenSearchResync({
      dryRun,
      adminId: req.admin!.id,
      correlationId,
    });

    logger.info(`OpenSearch full resync triggered: adminId=${req.admin!.id} dryRun=${dryRun}`);

    return res.json({
      success: true,
      data: {
        message: dryRun
          ? 'Dry-run resync Lambda invoked — no writes will occur'
          : 'Full OpenSearch resync Lambda invoked',
        invocationId: invocation.invocationId,
        dryRun,
        triggeredBy: req.admin!.email,
        triggeredAt: new Date().toISOString(),
      },
    });
  }),
);

// ===========================================================================
// MODULE 10 — PROVIDER ANALYTICS (not admin-only — requireAuth, not requireAdmin)
// ===========================================================================

/**
 * GET /api/v1/providers/me/analytics?period=7d|30d|year
 * Provider-facing analytics dashboard.
 * NOT admin-only — uses standard requireAuth (RS256 JWT from users table).
 * Includes AI-generated narration from gaasService (Claude Sonnet 4.6).
 * Narration cached once per provider per day in Redis.
 */
router.get(
  '/providers/me/analytics',
  requireAuth,                         // Standard consumer/provider JWT
  asyncHandler(async (req: Request, res: Response) => {
    // requireAuth attaches user to req.user
    const user = (req as any).user;
    const period = (req.query.period as string) ?? '30d';
    const allowedPeriods = ['7d', '30d', 'year', 'dashboard'];
    if (!allowedPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PERIOD', message: 'period must be 7d, 30d, year, or dashboard' },
      });
    }
    // 'dashboard' maps to 30d for analytics queries
    const period_normalized = period === 'dashboard' ? '30d' : period;

    // JWT has no providerId — look up from DB using userId (JWT sub)
    const providerProfile = await prisma.providerProfile.findFirst({
      where: { user_id: user.userId },
      select: { id: true },
    });
    if (!providerProfile) {
      return res.status(403).json({
        success: false,
        error: { code: 'PROVIDER_ONLY', message: 'Analytics is only available for provider accounts' },
      });
    }
    const providerId = providerProfile.id;
    const correlationId = req.headers['x-correlation-id'] as string;

    // Fetch raw analytics
    const analytics = await adminService.getProviderAnalytics({ providerId, period: period_normalized });

    // AI narration — cached once per provider per day. Non-blocking on error.
    let narration: string | null = null;
    try {
      narration = await gaasService.generateNarration(providerId, period);
    } catch (err) {
      logger.warn(`GaaS narration failed for providerId=${providerId}: ${(err as Error).message}`);
    }

    // Fetch provider profile + user data for dashboard fields
    const [providerInfo, userInfo] = await Promise.all([
      prisma.providerProfile.findUnique({
        where: { id: providerId },
        select: {
          display_name:       true,
          created_at:         true,
          availability:       true,
          trust_score_record: { select: { display_score: true, trust_tier: true, customer_voice_weight: true, rating_count: true } },
        },
      }),
      prisma.user.findUnique({
        where: { id: user.userId },
        select: { subscription_tier: true },
      }),
    ]);

    const trustScore   = providerInfo?.trust_score_record?.display_score ?? 0;
    const trustTier    = providerInfo?.trust_score_record?.trust_tier ?? 'unverified';
    const monthsJoined = providerInfo?.created_at
      ? Math.floor((Date.now() - providerInfo.created_at.getTime()) / (1000 * 60 * 60 * 24 * 30))
      : 0;

    return res.json({
      success: true,
      data: {
        period,
        // Dashboard identity fields (DashboardData interface)
        providerId,
        displayName:              providerInfo?.display_name ?? '',
        trustScore,
        trustTier:                trustTier as string,
        customerVoiceWeight:     providerInfo?.trust_score_record?.customer_voice_weight ?? 0,
        customerVoiceRatingCount: providerInfo?.trust_score_record?.rating_count ?? 0,
        monthsSinceJoin:          monthsJoined,
        initialScore:             20,
        availabilityStatus:       providerInfo?.availability ?? 'available',
        subscriptionTier:         userInfo?.subscription_tier ?? 'free',
        momentum:                 null,   // populated by trust history lambda
        nextAction:               null,   // populated by trust calculator
        earningsThisYearPaise:    0,      // future feature
        competitorCommissionRate: 0.25,
        // Period analytics (raw)
        ...analytics,
        // Mapped for AnalyticsScreen (mobile reads these keys)
        aiNarration:           narration,
        narrationGeneratedAt:  narration ? new Date().toISOString() : null,
        narration_cached:      narration !== null,
        // summary block (AnalyticsScreen reads data.summary.*)
        summary: {
          contacts:          analytics?.contacts?.total ?? 0,
          contactsDelta:     null,
          searchAppearances: null,
          conversion_rate:   analytics?.leads?.total > 0
                               ? (analytics.leads.accepted / analytics.leads.total)
                               : 0,
        },
        // Time-series arrays (AnalyticsScreen renders charts)
        // Populated as empty — real series require a separate time-bucketed query
        contactsSeries:          [],
        trustTrendSeries:        [],
        searchAppearancesSeries: [],
      },
    });
  }),
);

// ===========================================================================
// MODULE 10 — CITIES MANAGEMENT
// ===========================================================================

/** GET /api/v1/admin/cities — list all cities */
router.get(
  '/admin/cities',
  requireAdmin,
  asyncHandler(async (_req: AdminRequest, res: Response) => {
    const { prisma } = await import('@satvaaah/db');
    const cities = await prisma.city.findMany({
      select: {
        id: true, name: true, state: true, slug: true,
        country_code: true, is_active: true, is_launch_city: true,
        ring_1_km: true, ring_2_km: true, ring_3_km: true,
        ring_4_km: true, ring_5_km: true,
      },
      orderBy: { name: 'asc' },
    });
    return res.json({ success: true, data: cities });
  }),
);

/** POST /api/v1/admin/cities — create a new city */
router.post(
  '/admin/cities',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { prisma } = await import('@satvaaah/db');
    const { name, state, slug, country_code } = req.body;
    if (!name || !state || !slug) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'name, state, slug required' } });
    }
    const city = await prisma.city.create({
      data: { name, state, slug, country_code: country_code ?? 'IND' },
    });
    return res.status(201).json({ success: true, data: city });
  }),
);

/** PUT /api/v1/admin/cities/:id — update a city */
router.put(
  '/admin/cities/:id',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { prisma } = await import('@satvaaah/db');
    const { id } = req.params;
    const { name, state, slug, country_code, is_active, is_launch_city,
            ring_1_km, ring_2_km, ring_3_km, ring_4_km, ring_5_km } = req.body;
    const city = await prisma.city.update({
      where: { id },
      data: {
        ...(name           !== undefined && { name }),
        ...(state          !== undefined && { state }),
        ...(slug           !== undefined && { slug }),
        ...(country_code   !== undefined && { country_code }),
        ...(is_active      !== undefined && { is_active }),
        ...(is_launch_city !== undefined && { is_launch_city }),
        ...(ring_1_km      !== undefined && { ring_1_km }),
        ...(ring_2_km      !== undefined && { ring_2_km }),
        ...(ring_3_km      !== undefined && { ring_3_km }),
        ...(ring_4_km      !== undefined && { ring_4_km }),
        ...(ring_5_km      !== undefined && { ring_5_km }),
      },
    });
    return res.json({ success: true, data: city });
  }),
);

// ===========================================================================
// MODULE 11 — TSAAS API KEY MANAGEMENT
// ===========================================================================

/** GET /api/v1/admin/tsaas — list all TSaaS API keys */
router.get(
  '/admin/tsaas',
  requireAdmin,
  asyncHandler(async (_req: AdminRequest, res: Response) => {
    const { prisma } = await import('@satvaaah/db');
    const keys = await prisma.tsaasApiKey.findMany({
      select: {
        id: true, client_id: true, client_name: true, client_email: true,
        monthly_limit: true, calls_used: true, calls_month: true,
        is_active: true, last_used_at: true, requires_provider_consent: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
    return res.json({ success: true, data: keys });
  }),
);

/** POST /api/v1/admin/tsaas/:id/approve — activate a TSaaS key */
router.post(
  '/admin/tsaas/:id/approve',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { prisma } = await import('@satvaaah/db');
    const key = await prisma.tsaasApiKey.update({
      where: { id: req.params.id },
      data: { is_active: true },
    });
    return res.json({ success: true, data: key });
  }),
);

/** POST /api/v1/admin/tsaas/:id/revoke — deactivate a TSaaS key */
router.post(
  '/admin/tsaas/:id/revoke',
  requireAdmin,
  asyncHandler(async (req: AdminRequest, res: Response) => {
    const { prisma } = await import('@satvaaah/db');
    const key = await prisma.tsaasApiKey.update({
      where: { id: req.params.id },
      data: { is_active: false },
    });
    return res.json({ success: true, data: key });
  }),
);

export default router;

