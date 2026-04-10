// services/user/src/controllers/lead.controller.ts
// Provider-facing lead management. Validates input; delegates to leadService.

import { Request, Response } from 'express';
import { logger } from '@satvaaah/logger';
import { getLeadsService, updateLeadService } from '../services/leadService';

const VALID_STATUSES = ['pending', 'accepted', 'declined', 'expired'] as const;
const VALID_ACTIONS = ['accept', 'decline'] as const;
type LeadStatus = (typeof VALID_STATUSES)[number];
type LeadAction = (typeof VALID_ACTIONS)[number];

// ─── GET /api/v1/providers/me/leads?status=pending|accepted|declined|expired ──

export const getLeads = async (req: Request, res: Response): Promise<void> => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const providerId = req.user!.userId;

  const rawStatus = req.query.status as string | undefined;

  if (rawStatus && !VALID_STATUSES.includes(rawStatus as LeadStatus)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_STATUS',
        message: `status must be one of: ${VALID_STATUSES.join(', ')}`,
      },
    });
    return;
  }

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(50, parseInt((req.query.limit as string) || '20', 10));

  const result = await getLeadsService({
    provider_id: providerId,
    status: rawStatus as LeadStatus | undefined,
    page,
    limit,
    correlationId,
  });

  res.status(200).json({
    success: true,
    data: result.leads,
    meta: { total: result.total, page, pages: Math.ceil(result.total / limit) },
    monthly_usage: result.monthly_usage ?? {
      allocated: 0,
      received:  result.total,
      accepted:  result.leads?.filter((l: any) => l.status === 'accepted').length ?? 0,
    },
  });
};

// ─── PATCH /api/v1/providers/me/leads/:id ────────────────────────────────────

export const updateLead = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const providerId = req.user!.userId;
  const eventId = req.params.id;

  const body = req.body as Record<string, string | undefined>;
  const action = body.action;
  const decline_reason = body.decline_reason ?? body.declineReason;

  if (!action || !VALID_ACTIONS.includes(action as LeadAction)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_ACTION',
        message: 'action must be accept or decline',
      },
    });
    return;
  }

  if (action === 'decline' && decline_reason && decline_reason.length > 500) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'decline_reason must not exceed 500 characters',
      },
    });
    return;
  }

  logger.info('lead.update.start');

  const result = await updateLeadService({
    eventId,
    provider_id: providerId,
    action: action as LeadAction,
    declineReason: decline_reason,
    correlationId,
  });

  logger.info('lead.update.success');

  res.status(200).json({ success: true, data: result });
};
