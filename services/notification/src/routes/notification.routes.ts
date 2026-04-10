import { Router, Request, Response } from 'express';
import { asyncHandler } from '@satvaaah/middleware';
import { prisma } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';
import { NotFoundError, ValidationError } from '@satvaaah/errors';

// Notification copy — title + body for each product event type
// All strings are final consumer-facing copy. Changes here = deploy required.
const NOTIFICATION_COPY: Record<string, { title: string; body: string }> = {
  new_contact_request:   { title: 'New lead 💼',              body: 'Someone wants to hire you. Tap to respond.' },
  contact_accepted:      { title: 'Provider accepted ✅',      body: 'Your contact request was accepted.' },
  contact_declined:      { title: 'Provider unavailable',      body: "They're busy right now. Try another provider." },
  no_show_reroute:       { title: "Provider didn't show up",  body: 'Here are other available providers nearby.' },
  new_message:           { title: 'New message 💬',            body: 'You have a new message.' },
  subscription_confirmed:{ title: 'Subscription activated 🎉', body: 'Your plan is now active. Leads are waiting.' },
  rating_reminder:       { title: 'How was the service?',      body: 'Rate your experience and help others choose.' },
  certificate_ready:     { title: 'Certificate ready 🏆',      body: 'Your SatvAAh Trust Certificate is ready.' },
  push_discovery:        { title: 'New provider near you 🌟',  body: 'A highly trusted provider is available in your area.' },
};

const router = Router();

// ─── GET /api/v1/notifications ────────────────────────────────────────────────
// Returns the authenticated user's notification log, newest first.
// Supports optional ?unread_only=true and pagination via ?page=&limit=
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;                       // injected by requireAuth (RS256 JWT)
    const correlationId = res.locals.correlationId as string;

    const page  = Math.max(1, parseInt((req.query.page  as string) ?? '1',  10));
    const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) ?? '20', 10)));
    const skip  = (page - 1) * limit;

    const unreadOnly = req.query.unread_only === 'true';

    const where = {
      userId:  userId,
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [total, unreadCount, rows] = await Promise.all([
      prisma.notificationLog.count({ where }),
      prisma.notificationLog.count({ where: { userId: userId, readAt: null } }),
      prisma.notificationLog.findMany({
        where,
        orderBy: { sent_at: 'desc' },
        skip,
        take: limit,
        select: {
          id:               true,
          channel:          true,
          event_type:       true,
          sent_at:          true,
          delivered_at:     true,
          read_at:          true,
          wa_fallback_sent: true,
          // fcm_message_id and wa_message_id are internal — not exposed to the app
        },
      }),
    ]);

    logger.info('GET /notifications');

    // Reconstruct title/body from event_type — notification_log has no title/body columns
    // FCM sends copy at push time but does not persist it — we rebuild it here from the copy map
    const DEFAULT_COPY = { title: 'SatvAAh', body: 'You have a new notification.' };
    const mappedRows = rows.map((row) => {
      const copy = NOTIFICATION_COPY[row.event_type] ?? DEFAULT_COPY;
      return {
        ...row,
        title: copy.title,
        body:  copy.body,
        type:  row.event_type,
        sentAt:      row.sent_at,
        readAt:      row.read_at,
        expiresAt:   null,
        data:        {},
      };
    });

    return res.json({
      success: true,
      data: mappedRows,
      meta: {
        total,
        page,
        pages: Math.ceil(total / limit),
        unread_count: unreadCount,
      },
    });
  }),
);

// ─── PATCH /api/v1/notifications/:id/read ─────────────────────────────────────
// Marks a single notification as read (sets read_at = NOW()).
// Idempotent: already-read notifications return 200 without re-stamping.
router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const userId        = req.user!.userId;
    const correlationId = res.locals.correlationId as string;
    const { id }        = req.params;

    if (!id || typeof id !== 'string' || id.trim() === '') {
      throw new ValidationError('INVALID_NOTIFICATION_ID', 'Notification ID is required.');
    }

    // Confirm ownership before updating — prevents IDOR
    const existing = await prisma.notificationLog.findFirst({
      where: { id, user_id: userId },
      select: { id: true, read_at: true },
    });

    if (!existing) {
      throw new NotFoundError('NOTIFICATION_NOT_FOUND', 'Notification not found.');
    }

    // Idempotent: only stamp once
    if (!existing.read_at) {
      await prisma.notificationLog.update({
        where: { id },
        data:  { read_at: new Date() },
      });
      logger.info('Notification marked read');
    }

    return res.json({ success: true, data: { id, read: true } });
  }),
);


// ─── PATCH /api/v1/notifications/read-all ─────────────────────────────────────
// Marks ALL unread notifications as read for the authenticated user.

router.patch(
  '/read-all',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user!.userId;
    const result = await prisma.notificationLog.updateMany({
      where: { user_id: userId, read_at: null },
      data: { read_at: new Date() },
    });
    logger.info(`Notifications marked all read: userId=${userId} count=${result.count}`);
    res.json({ success: true, data: { updated: result.count } });
  }),
);

export default router;

// ─── POST /api/v1/internal/notify/fcm ────────────────────────────────────────
// Internal endpoint — called by user/payment/admin services to send FCM push.
// Auth: x-internal-key header.
import { timingSafeEqual } from 'crypto';
import { sendPush } from '../services/fcmService';

function requireInternalKey(req: Request, res: Response, next: any): void {
  const key      = req.headers['x-internal-key'] as string | undefined;
  const expected = process.env.INTERNAL_SERVICE_KEY;
  if (!expected) { res.status(503).json({ error: 'INTERNAL_SERVICE_KEY not set' }); return; }
  const keyBuf = Buffer.from(key ?? '');
  const expBuf = Buffer.from(expected);
  if (!key || keyBuf.length !== expBuf.length || !timingSafeEqual(keyBuf, expBuf)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  next();
}

router.post(
  '/internal/notify/fcm',
  requireInternalKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { user_id, event_type, data } = req.body ?? {};
    if (!user_id || !event_type) {
      res.status(400).json({ error: 'user_id and event_type are required' }); return;
    }

    const correlationId = req.headers['x-correlation-id'] as string ?? '';
    const copy = NOTIFICATION_COPY[event_type] ?? {
      title: 'SatvAAh',
      body:  'You have a new notification.',
    };

    // Convert payload values to string — FCM data envelope requires string values
    const fcmData: Record<string, string> = {};
    if (data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data)) {
        fcmData[k] = String(v ?? '');
      }
    }
    fcmData['event_type'] = event_type;

    await sendPush(user_id, { title: copy.title, body: copy.body, data: fcmData }, event_type, correlationId);
    res.status(202).json({ success: true });
  }),
);

router.post(
  '/internal/notify/whatsapp',
  requireInternalKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { user_id, template_name, data } = req.body ?? {};
    if (!user_id || !template_name) {
      res.status(400).json({ error: 'user_id and template_name are required' }); return;
    }
    // WhatsApp sends via whatsappService — Rule #17 check happens inside
    const { whatsappService } = await import('../services/whatsappService');
    await whatsappService.sendTemplate({ user_id: user_id, templateName: template_name, data: data ?? {} });
    res.status(202).json({ success: true });
  }),
);
