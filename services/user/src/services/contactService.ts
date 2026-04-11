// services/user/src/services/contactService.ts
//
// Core business logic for contact events.
//
// RULES:
//   • contact_lead_cost MUST always be read from system_config. NEVER hardcoded.
//   • Lead deduction and event insertion are a single atomic Prisma transaction.
//   • On no-show: status update + lead refund are atomic. Trust penalty goes to SQS.
//   • FCM notifications are fire-and-forget (logged on failure, never blocking).
//   • trust_score is NEVER written from app code — only via SQS → Lambda trigger.

import { prisma } from '@satvaaah/db';
import { loadSystemConfig } from '@satvaaah/config';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';
import { sendFcmNotification, sendWhatsAppToPhone } from '../lib/notificationClient';
import { sqsPublish } from './sqsHelper';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateContactEventInput {
  consumerId: string;
  providerId: string;
  contactType: 'call' | 'message' | 'slot_booking';
  message?: string;
  correlationId: string;
}

interface ReportNoShowInput {
  eventId: string;
  consumerId: string;
  correlationId: string;
}

// ─── createContactEventService ────────────────────────────────────────────────

export async function createContactEventService(
  input: CreateContactEventInput,
) {
  const { consumerId, providerId, contactType, message, slotTime, correlationId } = input;

  // ── 1. Read contact_lead_cost from system_config (ALWAYS from DB) ─────────
  const config = await loadSystemConfig();
  const contactLeadCost = parseInt(config['contact_lead_cost'] ?? '0', 10);

  logger.info('contact_event.lead_cost.read', {
    correlationId,
    contactLeadCost,
    source: 'system_config',
  });

  // ── 2. Validate provider exists and is not soft-deleted ───────────────────
  const provider = await prisma.providerProfile.findFirst({
    where: {
      id: providerId,
      // Allow scraped providers where user_id is NULL (not yet claimed).
      // Only exclude providers whose linked user account is soft-deleted.
      OR: [
        { user_id: null },
        { user: { deleted_at: null } },
      ],
    },
    select: {
      id: true,
      user_id: true,
      phone: true,              // needed for scraped provider WhatsApp outreach (EX5)
      wa_opted_out: true,       // respect opt-out even for scraped providers
      user: { select: { fcm_token: true } },
    },
  });
  if (!provider) {
    throw new AppError('PROVIDER_NOT_FOUND', 'Provider not found', 404);
  }

  // Cannot contact yourself
  if (provider.user_id === consumerId) {
    throw new AppError(
      'SELF_CONTACT_FORBIDDEN',
      'You cannot contact your own profile',
      400,
    );
  }

  // ── 3. Validate slot_booking rules ────────────────────────────────────────
  if (contactType === 'slot_booking') {
    const consumer = await prisma.consumerProfile.findUnique({
      where: { user_id: consumerId },
      select: { user_id: true },
    });
    // Slot booking requires Gold-tier consumer; check via subscription_records
    const activeSub = await prisma.subscriptionRecord.findFirst({
      where: {
        user_id: consumerId,
        status: 'active',
        plan: { tier: 'gold' },
      },
    });
    if (!activeSub) {
      throw new AppError(
        'SLOT_BOOKING_REQUIRES_GOLD',
        'Slot booking is available for Gold tier consumers only',
        403,
      );
    }
  }

  // ── 4. Check for active lead balance if cost > 0 ─────────────────────────
  let leadUsage = null;
  if (contactLeadCost > 0) {
    leadUsage = await prisma.consumerLeadUsage.findFirst({
      where: {
        consumer_id: consumerId,
        period_end: { gte: new Date() },
      },
      orderBy: { period_end: 'desc' },
    });

    if (!leadUsage) {
      throw new AppError(
        'NO_ACTIVE_LEAD_PLAN',
        'You do not have an active lead plan',
        402,
      );
    }

    if (leadUsage.leads_used + contactLeadCost > leadUsage.leads_allocated) {
      throw new AppError(
        'INSUFFICIENT_LEADS',
        'You do not have enough leads. Please upgrade your plan.',
        402,
      );
    }
  }

  // ── 5. ATOMIC transaction: INSERT event + deduct lead ─────────────────────
  const contactEvent = await prisma.$transaction(async (tx) => {
    // Insert the contact event
    const event = await tx.contactEvent.create({
      data: {
        consumer_id: consumerId,
        provider_id: providerId,
        contact_type: contactType,
        status: 'pending',
        providerStatus: 'pending',
        consumer_lead_deducted: contactLeadCost > 0,
        provider_phone_revealed_to_consumer: false,
        ...(slotTime ? { slot_date: new Date(slotTime) } : {}),
      },
      select: {
        id: true,
        consumer_id: true,
        provider_id: true,
        contact_type: true,
        status: true,
        providerStatus: true,
        consumer_lead_deducted: true,
        provider_phone_revealed_to_consumer: true,
        created_at: true,
      },
    });

    // If there's a lead cost, deduct now inside the same transaction
    if (contactLeadCost > 0 && leadUsage) {
      await tx.consumerLeadUsage.update({
        where: { id: leadUsage.id },
        data: { leads_used: { increment: contactLeadCost } },
      });

      logger.info('contact_event.lead_deducted', {
        correlationId,
        eventId: event.id,
        consumer_id: consumerId,
        contactLeadCost,
        newLeadsUsed: leadUsage.leads_used + contactLeadCost,
      });
    }

    // If this is a message-type event, also store the initial message
    if (contactType === 'message' && message) {
      await tx.inAppMessage.create({
        data: {
          contact_event_id: event.id,
          sender_id: consumerId,
          message_text: message,
          sent_at: new Date(),
        },
      });
    }

    return event;
  });

  // ── 6. FCM to provider (fire-and-forget) ─────────────────────────────────
  // provider_lead_usage: increment leads_received (outside transaction — not
  // atomic because lead counts are eventually consistent)
  try {
    await prisma.providerLeadUsage.upsert({
      where: {
        providerId_month: {
          provider_id: providerId,
          month: monthKey(),
        },
      },
      create: {
        provider_id: providerId,
        month: monthKey(),
        leads_allocated: 0,
        leads_received: 1,
        leads_accepted: 0,
        leads_declined: 0,
        leads_expired: 0,
      },
      update: {
        leads_received: { increment: 1 },
      },
    });
  } catch (err) {
    logger.warn('contact_event.provider_lead_usage.upsert.failed', {
      correlationId,
      provider_id: providerId,
      error: (err as Error).message,
    });
  }

  // Notify provider of new lead (fire-and-forget)
  if (provider.user_id) {
    // Claimed provider with a user account — send FCM push
    sendFcmNotification({
      userId:    provider.user_id,
      eventType: 'new_contact_request',
      payload: {
        contact_event_id: contactEvent.id,
        contact_type:     contactType,
      },
      correlationId,
    }).catch((err) => {
      logger.warn('contact_event.provider_fcm.failed', {
        correlationId,
        eventId:     contactEvent.id,
        provider_id: providerId,
        error: (err as Error).message,
      });
    });
  } else if (provider.phone && !provider.wa_opted_out) {
    // Scraped provider — no user account, no FCM token
    // audit-ref: EX5 — WhatsApp outreach to scraped provider phone
    // Template: new_contact_request (template #4 in APPROVED_WA_TEMPLATES)
    // Params: [contact_type_label] — e.g. 'call', 'message', 'appointment'
    const contactTypeLabel = contactType === 'slot_booking' ? 'appointment' : contactType;
    sendWhatsAppToPhone({
      phone:          `+91${provider.phone}`,  // provider.phone is 10-digit mobile
      templateName:   'new_contact_request',
      templateParams: [contactTypeLabel],
      correlationId,
    }).catch((err) => {
      logger.warn('contact_event.scraped_provider_wa.failed', {
        correlationId,
        eventId:     contactEvent.id,
        provider_id: providerId,
        error: (err as Error).message,
      });
    });
  }

  return contactEvent;
}

// ─── reportNoShowService ──────────────────────────────────────────────────────

export async function reportNoShowService(input: ReportNoShowInput) {
  const { eventId, consumer_id: consumerId, correlationId } = input;

  // ── 1. Load the event and verify ownership ────────────────────────────────
  const event = await prisma.contactEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      consumer_id: true,
      provider_id: true,
      status: true,
      consumer_lead_deducted: true,
      provider: {
        select: {
          id: true,
          user_id: true,
          city_id: true,
          user: { select: { fcm_token: true } },
        },
      },
      consumer: {
        select: {
          user_id: true,
          user: { select: { fcm_token: true } },
        },
      },
    },
  });

  if (!event) {
    throw new AppError('EVENT_NOT_FOUND', 'Contact event not found', 404);
  }

  if (event.consumer_id !== consumerId) {
    throw new AppError(
      'FORBIDDEN',
      'You are not the consumer on this event',
      403,
    );
  }

  // Only accepted events can be reported as no-show
  if (event.status !== 'accepted') {
    throw new AppError(
      'INVALID_STATE',
      'Only accepted contact events can be reported as no-show',
      400,
    );
  }

  // ── 2. Read contact_lead_cost (always from system_config) ─────────────────
  const config = await loadSystemConfig();
  const contactLeadCost = parseInt(config['contact_lead_cost'] ?? '0', 10);

  // ── 3. ATOMIC transaction: update status + refund lead ────────────────────
  await prisma.$transaction(async (tx) => {
    // Update event status
    await tx.contactEvent.update({
      where: { id: eventId },
      data: { status: 'no_show' },
    });

    // Refund lead if one was deducted
    if (event.consumer_lead_deducted && contactLeadCost > 0) {
      const leadUsage = await tx.consumerLeadUsage.findFirst({
        where: {
          consumer_id: consumerId,
          period_end: { gte: new Date() },
        },
        orderBy: { period_end: 'desc' },
      });

      if (leadUsage) {
        await tx.consumerLeadUsage.update({
          where: { id: leadUsage.id },
          data: {
            leads_used: { decrement: Math.min(contactLeadCost, leadUsage.leads_used) },
          },
        });

        logger.info('contact_event.no_show.lead_refunded', {
          correlationId,
          eventId,
          consumer_id: consumerId,
          contactLeadCost,
        });
      }
    }
  });

  // ── 4. Enqueue trust penalty to SQS (fire-and-forget) ────────────────────
  // trust_score is NEVER written from app code — only via Lambda trigger.
  // trust_score is NEVER written from app code — sqsPublish → Lambda:trust-recalculate
  sqsPublish({
    queueKey: 'SQS_TRUST_SCORE_UPDATES_URL',
    messageGroupId: `provider:${event.provider_id}`,
    body: {
      signal: 'no_show',
      provider_id: event.provider_id,
      contact_event_id: eventId,
      source: 'user_service',
    },
    correlationId,
  }).catch((err) => {
    logger.warn(`no_show SQS trust signal failed (fire-and-forget): ${(err as Error).message}`);
  });

  // ── 5. FCM to consumer: reroute to nearest available provider ─────────────
  // Notify consumer to find another provider (fire-and-forget)
  if (event.consumer) {
    sendFcmNotification({
      userId:    event.consumer.user_id,
      eventType: 'no_show_reroute',
      payload: {
        contact_event_id: eventId,
        city_id: event.provider.city_id,
        message: 'Provider was unavailable. Here are the nearest available providers.',
      },
      correlationId,
    }).catch((err) => {
      logger.warn('contact_event.no_show.consumer_fcm.failed', {
        correlationId,
        eventId,
        error: (err as Error).message,
      });
    });
  }

  return { event_id: eventId, status: 'no_show', lead_refunded: event.consumer_lead_deducted };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the first day of the current month as a Date, used as the month key
 *  for provider_lead_usage lookups. */
function monthKey(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
