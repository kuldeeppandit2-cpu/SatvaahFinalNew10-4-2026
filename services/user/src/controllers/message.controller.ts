// services/user/src/controllers/message.controller.ts
// In-app messaging. Both consumer and provider may read/send on their event.
// Messages are scoped to a contact_event; FCM notifies recipient.

import { Request, Response } from 'express';
import { logger } from '@satvaaah/logger';
import { prisma } from '@satvaaah/db';
import { AppError } from '@satvaaah/errors';
import { sendFcmNotification } from '../lib/notificationClient';
import { getIo } from '../websocket/server';

// ─── GET /api/v1/messages/:event_id ──────────────────────────────────────────

export const getMessages = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const userId = req.user!.userId;
  const eventId = req.params.event_id;

  if (!eventId) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'event_id is required' },
    });
    return;
  }

  // Verify the caller is a party on this event.
  // contact_events.consumer_id → consumer_profiles.id (NOT users.id)
  // contact_events.provider_id → provider_profiles.id (NOT users.id)
  const event = await prisma.contactEvent.findUnique({
    where: { id: eventId },
    select: { consumer_id: true, provider_id: true },
  });

  if (!event) {
    res.status(404).json({
      success: false,
      error: { code: 'EVENT_NOT_FOUND', message: 'Contact event not found' },
    });
    return;
  }

  const [consumerProfile, providerProfile] = await Promise.all([
    prisma.consumerProfile.findFirst({ where: { user_id: userId }, select: { id: true } }),
    prisma.providerProfile.findFirst({ where: { user_id: userId }, select: { id: true } }),
  ]);

  const isConsumerParty = consumerProfile && event.consumer_id === consumerProfile.id;
  const isProviderParty = providerProfile && event.provider_id === providerProfile.id;

  if (!isConsumerParty && !isProviderParty) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'You are not a party to this contact event',
      },
    });
    return;
  }

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, parseInt((req.query.limit as string) || '50', 10));
  const skip = (page - 1) * limit;

  const [messages, total] = await Promise.all([
    prisma.inAppMessage.findMany({
      where: { contact_event_id: eventId },
      orderBy: { sent_at: 'asc' },
      skip,
      take: limit,
      select: {
        id: true,
        contact_event_id: true,
        sender_id: true,
        message_text: true,
        photo_url: true,
        sent_at: true,
        delivered_at: true,
        read_at: true,
      },
    }),
    prisma.inAppMessage.count({ where: { contact_event_id: eventId } }),
  ]);

  // Mark unread messages from the other party as delivered
  await prisma.inAppMessage.updateMany({
    where: {
      contact_event_id: eventId,
      sender_id: { not: userId },
      delivered_at: null,
    },
    data: { delivered_at: new Date() },
  });

  logger.info('messages.get.success');

  const mapped = messages.map(m => ({
    id:             m.id,
    contactEventId: m.contact_event_id,
    sender_id:      m.sender_id,
    message_text:   m.message_text,
    photo_url:      m.photo_url,
    sentAt:         m.sent_at?.toISOString() ?? null,
    deliveredAt:    m.delivered_at?.toISOString() ?? null,
    readAt:         m.read_at?.toISOString() ?? null,
  }));

  res.status(200).json({
    success: true,
    data: mapped,
    meta: { total, page, pages: Math.ceil(total / limit) },
  });
};

// ─── POST /api/v1/messages ────────────────────────────────────────────────────

export const sendMessage = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const senderId = req.user!.userId;

  const body = req.body as Record<string, string | undefined>;
  const event_id = body.event_id ?? body.contactEventId;
  const text = body.text ?? body.message_text;
  const photo_url = body.photo_url;

  if (!event_id || typeof event_id !== 'string') {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'event_id is required' },
    });
    return;
  }

  if ((!text || !text.trim()) && !photo_url) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'text or photo_url is required',
      },
    });
    return;
  }

  if (text && text.length > 2000) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'text must not exceed 2000 characters',
      },
    });
    return;
  }

  // Verify sender is a party to the event and event is in an active state
  const event = await prisma.contactEvent.findUnique({
    where: { id: event_id },
    select: {
      consumer_id: true,
      provider_id: true,
      status: true,
      provider: {
        select: { user_id: true },
      },
    },
  });

  if (!event) {
    res.status(404).json({
      success: false,
      error: { code: 'EVENT_NOT_FOUND', message: 'Contact event not found' },
    });
    return;
  }

  if (event.consumer_id !== senderId && event.provider_id !== senderId) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'You are not a party to this contact event',
      },
    });
    return;
  }

  // Determine recipient
  const recipientId =
    senderId === event.consumer_id ? event.provider_id : event.consumer_id;

  // Get recipient FCM token
  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { id: true },
  });

  // Persist the message
  const message = await prisma.inAppMessage.create({
    data: {
      contact_event_id: event_id,
      sender_id: senderId,
      message_text: text?.trim() ?? null,
      photo_url: photo_url ?? null,
      sent_at: new Date(),
    },
    select: {
      id: true,
      contact_event_id: true,
      sender_id: true,
      message_text: true,
      photo_url: true,
      sent_at: true,
      delivered_at: true,
      read_at: true,
    },
  });

  // ── Broadcast over WebSocket to conversation room ─────────────────────
  try {
    const io = getIo();
    io.of('/messages')
      .to(`conversation:${event_id}`)
      .emit('message_received', {
        id:             message.id,
        contactEventId: message.contact_event_id,
        sender_id:      message.sender_id,
        message_text:   message.message_text,
        photo_url:      message.photo_url,
        sentAt:         message.sent_at?.toISOString() ?? null,
        deliveredAt:    message.delivered_at?.toISOString() ?? null,
        readAt:         message.read_at?.toISOString() ?? null,
      });
  } catch (wsErr) {
    // Non-fatal — client will catch up via REST poll on reconnect
    logger.warn('messages.websocket.broadcast.failed');
  }

  // ── FCM push to recipient (fire-and-forget) ──────────────────────────
  sendFcmNotification({
    userId:    recipientId,
    eventType: 'new_message',
    payload: {
      event_id,
      message_id: message.id,
      sender_id:  senderId,
      preview:    text ? text.substring(0, 100) : '📷 Photo',
    },
    correlationId,
  }).catch((err) => {
    logger.warn('messages.fcm.send.failed');
  });

  logger.info('messages.send.success');

  // Map Prisma snake_case fields to camelCase for mobile contract
  res.status(201).json({
    success: true,
    data: {
      id:             message.id,
      contactEventId: message.contact_event_id,
      sender_id:      message.sender_id,
      message_text:   message.message_text,
      photo_url:      message.photo_url,
      sentAt:         message.sent_at?.toISOString() ?? null,
      deliveredAt:    message.delivered_at?.toISOString() ?? null,
      readAt:         message.read_at?.toISOString() ?? null,
    },
  });
};
