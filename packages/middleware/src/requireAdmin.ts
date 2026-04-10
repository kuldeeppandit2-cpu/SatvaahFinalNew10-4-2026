/**
 * @package @satvaaah/middleware
 * requireAdmin.ts — Admin-only middleware
 *
 * RULES:
 *   - Extends requireAuth (RS256 JWT verification runs first).
 *   - Checks payload.role === 'admin'. Returns 403 if not.
 *   - Admin portal users come from admin_users table ONLY.
 *   - Phone users (consumer/provider) can NEVER escalate to admin.
 *   - Admin auth is email+password Firebase — separate from consumer phone OTP.
 *   - Admin portal is port 3099 (Next.js), VPN-only in production.
 *
 * Usage:
 *   router.get('/admin/disputes', requireAdmin, handler);
 */

import { Request, Response, NextFunction } from 'express';
import { requireAuth } from './requireAuth';
import { AdminRequiredError } from '@satvaaah/errors';
import { logger } from '@satvaaah/logger';

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Await the async requireAuth (has JTI blocklist Redis check since S71)
  let authError: unknown = null;
  await requireAuth(req, res, (err) => { authError = err ?? null; });
  if (authError) return next(authError);

  if (!req.user) return next(new AdminRequiredError());

  if (req.user.role !== 'admin') {
    logger.warn(`Non-admin on admin endpoint: userId=${req.user.userId} mode=${req.user.mode} path=${req.path}`);
    return next(new AdminRequiredError());
  }

  logger.debug(`Admin access granted: userId=${req.user.userId} path=${req.path}`);
  next();
}
