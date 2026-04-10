// services/user/src/routes/lead.routes.ts
// Lead management for providers — list + accept/decline
// Auth: requireAuth (RS256 JWT) on all routes

import { Router } from 'express';
import { requireAuth } from '@satvaaah/middleware';
import { asyncHandler } from '@satvaaah/middleware';
import { getLeads, updateLead } from '../controllers/lead.controller';

const router = Router();

/**
 * GET /api/v1/providers/me/leads?status=pending|accepted|declined|expired
 * Returns the authenticated provider's leads, optionally filtered by status.
 */
router.get('/providers/me/leads', requireAuth, asyncHandler(getLeads));

/**
 * PATCH /api/v1/providers/me/leads/:id
 * Provider accepts or declines a lead.
 * Body: { action: 'accept' | 'decline', decline_reason?: string }
 * On accept: reveals consumer phone, sends FCM to consumer, counts the lead.
 */
router.patch('/providers/me/leads/:id', requireAuth, asyncHandler(updateLead));

export default router;
