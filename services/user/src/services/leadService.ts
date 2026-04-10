// services/user/src/services/leadService.ts
//
// Business logic for provider lead management.
//
// RULES:
//   • Lead is COUNTED (leads_accepted++) only on accept.
//   • Consumer phone is REVEALED on accept via providerPhoneRevealedToConsumer flag.
//   • reveal_consumer_phone_on_accept is read from system_config — not hardcoded.
//   • FCM to consumer fires after accept. Delivery monitored by Lambda:delivery-monitor.
//   • trust_score is NEVER written directly. All score changes go via SQS → Lambda.

import { prisma } from '@satvaaah/db';
import { loadSystemConfig } from '@satvaaah/config';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';
import { sendFcmNotification } from '../lib/notificationClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GetLeadsInput {
  providerId: string;
  status?: 'pending' | 'accepted' | 'declined' | 'expired';
  page: number;
  limit: number;
  correlationId: string;
}

interface UpdateLeadInput {
  eventId: string;
  providerId: string;
  action: 'accept' | 'decline';
  declineReason?: string;
  correlationId: string;
}

// ─── getLeadsService ──────────────────────────────────────────────────────────

export async function getLeadsService(input: GetLeadsInput) {
  const { providerId, status, page, limit, correlationId } = input;

  const skip = (page - 1) * limit;

  // Map status filter to the providerStatus column (provider-facing view)
  const where = {
    provider_id: providerId,
    ...(status ? { providerStatus: status } : {}),
  };

  const [leads, total] = await Promise.all([
    prisma.contactEvent.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        contact_type: true,
        status: true,
        providerStatus: true,
        provider_phone_revealed_to_consumer: true,
        created_at: true,
        updated_at: true,
        expiry_at: true,
        consumer: {
          select: {
            user_id: true,
            display_name: true,
            trust_score: true,
            // Only include phone if already revealed
            user: {
              select: {
                phone: true,
              },
            },
          },
        },
      },
    }),
    prisma.contactEvent.count({ where }),
  ]);

  // Mask consumer phone on leads that have not been accepted yet
  const sanitisedLeads = leads.map((lead) => {
    const { consumer, ...rest } = lead;
    return {
      id:            rest.id,
      contactType:   rest.contact_type,
      status:        rest.status,
      providerStatus: rest.providerStatus,
      provider_phone_revealed_to_consumer: rest.provider_phone_revealed_to_consumer,
      createdAt:     rest.created_at,
      updatedAt:     rest.updated_at,
      expiresAt:     rest.expiry_at ?? null,
      consumer: {
        userId:       consumer.user_id,
        displayName:  consumer.display_name,
        trustScore:   consumer.trust_score,
        trustTier:    consumer.trust_score >= 80 ? 'highly_trusted'
                      : consumer.trust_score >= 60 ? 'trusted'
                      : consumer.trust_score >= 20 ? 'basic' : 'unverified',
        // Phone revealed only after provider accepted
        phone: rest.provider_phone_revealed_to_consumer ? consumer.user.phone : null,
      },
    };
  });

  logger.info('leads.get.success', {
    correlationId,
    provider_id: providerId,
    status,
    page,
    total,
  });

  return { leads: sanitisedLeads, total };
}

// ─── updateLeadService ────────────────────────────────────────────────────────

export async function updateLeadService(input: UpdateLeadInput) {
  const { eventId, providerId, action, declineReason, correlationId } = input;

  // ── 1. Load event and verify provider ownership ───────────────────────────
  const event = await prisma.contactEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      consumer_id: true,
      provider_id: true,
      providerStatus: true,
      consumer: {
        select: {
          user_id: true,
          display_name: true,
          user: {
            select: { fcm_token: true, phone: true },
          },
        },
      },
    },
  });

  if (!event) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404);
  }

  if (event.provider_id !== providerId) {
    throw new AppError('FORBIDDEN', 'This lead does not belong to you', 403);
  }

  // Only pending leads can be acted on
  if (event.providerStatus !== 'pending') {
    throw new AppError(
      'LEAD_ALREADY_ACTIONED',
      `This lead has already been ${event.providerStatus}`,
      400,
    );
  }

  // ── 2. Read reveal flag from system_config ────────────────────────────────
  const config = await loadSystemConfig();
  const revealPhone =
    (config['reveal_consumer_phone_on_accept'] ?? 'true') === 'true';

  // ── 3. Perform the action ─────────────────────────────────────────────────
  if (action === 'accept') {
    // Accept: update status, optionally reveal phone, count the lead
    const updatedEvent = await prisma.$transaction(async (tx) => {
      const updated = await tx.contactEvent.update({
        where: { id: eventId },
        data: {
          providerStatus: 'accepted',
          status: 'accepted',
          provider_phone_revealed_to_consumer: revealPhone,
        },
        select: {
          id: true,
          status: true,
          providerStatus: true,
          provider_phone_revealed_to_consumer: true,
          consumer: {
            select: {
              user: { select: { phone: true } },
            },
          },
        },
      });

      // Count the accepted lead in provider_lead_usage
      await tx.providerLeadUsage.upsert({
        where: {
          providerId_month: {
            provider_id: providerId,
            month: currentMonthStart(),
          },
        },
        create: {
          provider_id: providerId,
          month: currentMonthStart(),
          leads_allocated: 0,
          leads_received: 1,
          leads_accepted: 1,
          leads_declined: 0,
          leads_expired: 0,
        },
        update: {
          leads_accepted: { increment: 1 },
        },
      });

      return updated;
    });

    // ── FCM to consumer: contact accepted ─────────────────────────────────
    sendFcmNotification({
      userId:    event.consumer.user_id,
      eventType: 'contact_accepted',
      payload: {
        contact_event_id: eventId,
        provider_id:      providerId,
      },
      correlationId,
    }).catch((err) => {
      logger.warn('leads.accept.consumer_fcm.failed', {
        correlationId, eventId, error: (err as Error).message,
      });
    });

    logger.info('leads.accept.success', { correlation_id: correlationId, eventId, provider_id: providerId });

    return {
      id: updatedEvent.id,
      status: updatedEvent.status,
      provider_status: updatedEvent.providerStatus,
      consumer_phone: revealPhone ? updatedEvent.consumer.user.phone : null,
    };
  } else {
    // Decline: update status, record reason
    const updatedEvent = await prisma.$transaction(async (tx) => {
      const updated = await tx.contactEvent.update({
        where: { id: eventId },
        data: {
          providerStatus: 'declined',
          status: 'declined',
          decline_reason: declineReason ?? null,
        },
        select: {
          id: true,
          status: true,
          providerStatus: true,
        },
      });

      // Count declined lead
      await tx.providerLeadUsage.upsert({
        where: {
          providerId_month: {
            provider_id: providerId,
            month: currentMonthStart(),
          },
        },
        create: {
          provider_id: providerId,
          month: currentMonthStart(),
          leads_allocated: 0,
          leads_received: 1,
          leads_accepted: 0,
          leads_declined: 1,
          leads_expired: 0,
        },
        update: {
          leads_declined: { increment: 1 },
        },
      });

      return updated;
    });

    // FCM to consumer: contact declined
    sendFcmNotification({
      userId:    event.consumer.user_id,
      eventType: 'contact_declined',
      payload: {
        contact_event_id: eventId,
        provider_id:      providerId,
      },
      correlationId,
    }).catch((err) => {
      logger.warn('leads.decline.consumer_fcm.failed', {
        correlationId, eventId, error: (err as Error).message,
      });
    });

    logger.info('leads.decline.success', { correlation_id: correlationId, eventId, provider_id: providerId });

    return {
      id: updatedEvent.id,
      status: updatedEvent.status,
      provider_status: updatedEvent.providerStatus,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
