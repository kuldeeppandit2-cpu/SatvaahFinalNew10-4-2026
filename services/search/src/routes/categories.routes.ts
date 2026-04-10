// services/search/src/routes/categories.routes.ts
//
// Category browse and public provider profile routes:
//   GET /api/v1/categories?tab=products|services|expertise|establishments
//   GET /api/v1/providers/:id

import { Router, Request, Response } from 'express';
import { prisma } from '@satvaaah/db';
import { asyncHandler } from '@satvaaah/middleware';
import {
  getCategories,
  getProviderProfile,
  getCategoriesL2,
  getCategoriesL3,
} from '../controllers/search.controller';

const router = Router();

// ── GET /api/v1/categories ────────────────────────────────────────────────────
// No auth required.
// Param: tab (required) — products | services | expertise | establishments
// Response is Redis-cached for 24h per tab key.
// Cache is warmed on first request after deploy; no background warm-up needed.
router.get('/categories', asyncHandler(getCategories));

// ── GET /api/v1/categories/l2 ─────────────────────────────────────────────────
// No auth required.
// Params: tab (required), l1 (required)
// Returns distinct L2 groups with icon + child_count for CategoryBrowseScreen.
router.get('/categories/l2', asyncHandler(getCategoriesL2));

// ── GET /api/v1/categories/l3 ─────────────────────────────────────────────────
// No auth required.
// Params: tab (required), l1 (required), l2 (required)
// Returns distinct L3 groups with L4 leaf nodes + taxonomy characteristics.
// All raw DB values translated to human-readable labels before sending to mobile.
router.get('/categories/l3', asyncHandler(getCategoriesL3));

// ── GET /api/v1/providers/:id ─────────────────────────────────────────────────
// Public provider profile — no auth required.
// Joins provider_profiles + trust_scores.
// Used by the provider detail screen before a consumer initiates contact.
router.get('/providers/:id', asyncHandler(getProviderProfile));

// ── GET /api/v1/cities ───────────────────────────────────────────────────────
// Returns active launch cities. Used by provider registration and consumer profile.
// No auth required.
router.get('/cities', asyncHandler(async (req: Request, res: Response) => {
  const activeOnly = req.query.active !== 'false';
  const cities = await prisma.city.findMany({
    where:   activeOnly ? { is_launch_city: true } : {},
    select:  { id: true, name: true, slug: true, state: true },
    orderBy: { name: 'asc' },
  });
  res.json({ success: true, data: cities });
}));

export default router;
