// services/user/src/routes/message.routes.ts
// In-app messaging routes — tied to contact_events
// Auth: requireAuth (RS256 JWT) on all routes

import { Router } from 'express';
import { requireAuth, asyncHandler, rateLimiter } from '@satvaaah/middleware';
import { getMessages, sendMessage } from '../controllers/message.controller';

const router = Router();

/**
 * GET /api/v1/messages/:event_id
 * Returns all in-app messages for a given contact event.
 * Both the consumer and provider on that event may access.
 */
const readLimiter = rateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'rl:messages-read' });
router.get('/messages/:event_id', requireAuth, readLimiter, asyncHandler(getMessages));

/**
 * POST /api/v1/messages
 * Send a new in-app message.
 * Body: { event_id: string, text: string, photo_url?: string }
 * Triggers FCM to the recipient.
 */
router.post('/messages', requireAuth, asyncHandler(sendMessage));

export default router;
