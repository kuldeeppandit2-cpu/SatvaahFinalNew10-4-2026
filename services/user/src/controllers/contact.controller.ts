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

  // Resolve User.id → ConsumerProfile.id (contact_events.consumer_id is FK to consumer_profiles.id)
  const consumerProfile = await prisma.consumerProfile.findUnique({ where: { user_id: consumerId } });
  if (!consumerProfile) {
    res.status(404).json({ success: false, error: { code: 'CONSUMER_PROFILE_NOT_FOUND', message: 'Please complete your profile setup before contacting a provider.' } });
    return;
  }

  logger.info('contact_event.create.start');

  const event = await createContactEventService({
    consumerId: consumerProfile.id,
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
    const prov = await prisma.providerProfile.findUnique({
      where: { id: provider_id },
      select: { phone: true },
    });
    provider_phone = prov?.phone ?? null;
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

  // Resolve User.id → ConsumerProfile.id
  const consumerProfile = await prisma.consumerProfile.findUnique({ where: { user_id: consumerId } });
  if (!consumerProfile) {
    res.status(404).json({ success: false, error: { code: 'CONSUMER_PROFILE_NOT_FOUND', message: 'Consumer profile not found.' } });
    return;
  }

  logger.info('contact_event.no_show.start');

  const result = await reportNoShowService({
    eventId,
    consumer_id: consumerProfile.id,
    correlationId,
  });

  logger.info('contact_event.no_show.success');

  res.status(200).json({ success: true, data: result });
};
