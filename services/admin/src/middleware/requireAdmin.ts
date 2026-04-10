/**
 * requireAdmin.ts — DEVELOPMENT VERSION
 * Auth bypass enabled — all admin requests pass through.
 * Attaches first active admin_user to req.admin.
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '@satvaaah/db';

export interface AdminRequest extends Request {
  admin?: { id: string; email: string; role: 'admin' | 'super_admin'; };
}

export async function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  const adminUser = await prisma.adminUser.findFirst({
    where: { is_active: true },
    select: { id: true, email: true },
  }).catch(() => null);

  req.admin = {
    id: adminUser?.id ?? 'dev-admin',
    email: adminUser?.email ?? 'vatsala@satvaaah.com',
    role: 'super_admin',
  };
  next();
}
