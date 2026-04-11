import { prisma } from '@satvaaah/db';
// services/user/src/controllers/contact.controller.ts
// Validates requests and delegates to contactService.
// Never contains business logic — that lives in services/.

import { Request, Response } from 'express';
import { logger } from '@satvaaah/logger';
import {
  createContactEventService,
  reportNoShowService,
} from '../services/contactService';

// Valid contact types as defined in Prisma ContactType enum
const VALID_CONTACT_TYPES = ['call', 'message', 'slot_booking'] as const;
type ContactType = (typeof VALID_CONTACT_TYPES)[number];

// ─── POST /api/v1/contact-events ──────────────────────────────────────────────

export const createContactEvent = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const consumerId = req.user!.userId;

  // Accept both camelCase (mobile) and snake_case for backwards compatibility
  const body = req.body as Record<string, string | undefined>;
  const provider_id  = body.provider_id  ?? body.providerId;
  const contact_type = body.contact_type ?? body.contactType;
  const message      = body.message      ?? body.message_text;
  const slot_time    = body.slot_time    ?? body.slotTime;  // ISO UTC for slot_booking

  // ── Input validation ─────────────────────────────────────────────────────
  if (!provider_id || typeof provider_id !== 'string') {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'provider_id is required' },
    });
    return;
  }

  if (
    !contact_type ||
    !VALID_CONTACT_TYPES.includes(contact_type as ContactType)
  ) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_CONTACT_TYPE',
        message: 'contact_type must be call, message, or slot_booking',
      },
    });
    return;
  }

  if (contact_type === 'message' && (!message || !message.trim())) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'message body is required for contact_type=message',
      },
    });
    return;
  }

  logger.info('contact_event.create.start');

  const event = await createContactEventService({
    consumerId,
    providerId:    provider_id,
    contactType:   contact_type as ContactType,
    message:       message?.trim(),
    slotTime:      slot_time,
    correlationId,
  });

  logger.info('contact_event.create.success');

  // Fetch provider phone for call-type events (needed by ContactCallScreen)
  let provider_phone: string | null = null;
  if (contact_type === 'call') {
    // phone IS NULL for scraped providers — use raw query to avoid Prisma non-null type error
    const rows = await prisma.$queryRaw`SELECT phone FROM provider_profiles WHERE id = ${provider_id}::uuid LIMIT 1`;
    provider_phone = (rows as any[])[0]?.phone ?? null;
  }
  res.status(201).json({
    success: true,
    data: {
      ...event,
      contactType:   event.contact_type,
      providerStatus: event.providerStatus,
      createdAt:      event.created_at,
      provider_phone,
    },
  });
};

// ─── POST /api/v1/contact-events/:id/no-show ─────────────────────────────────

export const reportNoShow = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const consumerId = req.user!.userId;
  const eventId = req.params.id;

  if (!eventId) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'event id is required' },
    });
    return;
  }

  logger.info('contact_event.no_show.start');

  const result = await reportNoShowService({
    eventId,
    consumer_id: consumerId,
    correlationId,
  });

  logger.info('contact_event.no_show.success');

  res.status(200).json({ success: true, data: result });
};
