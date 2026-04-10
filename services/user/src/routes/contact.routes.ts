// services/user/src/routes/contact.routes.ts
// Contact event routes — POST /contact-events, POST /contact-events/:id/no-show
// Auth: requireAuth (RS256 JWT) on all routes

import { Router } from 'express';
import { requireAuth } from '@satvaaah/middleware';
import { asyncHandler } from '@satvaaah/middleware';
import {
  createContactEvent,
  reportNoShow,
} from '../controllers/contact.controller';

const router = Router();

/**
 * POST /api/v1/contact-events
 * Consumer initiates contact with a provider.
 * ATOMIC: INSERT contact_event + deduct leads (cost read from system_config).
 * Sends FCM to provider via notification service.
 */
router.post('/', requireAuth, asyncHandler(createContactEvent));

/**
 * POST /api/v1/contact-events/:id/no-show
 * Consumer reports provider no-show.
 * ATOMIC: update status + refund leads.
 * Sends trust penalty to SQS trust-score-updates.
 * Sends FCM to consumer with nearest available provider reroute.
 */
router.post(
  '/:id/no-show',
  requireAuth,
  asyncHandler(reportNoShow),
);

export default router;
