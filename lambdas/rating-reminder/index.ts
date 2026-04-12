/**
 * lambdas/rating-reminder/index.ts
 *
 * Trigger:  EventBridge scheduled rule — every hour (cron: 0 * * * ? *)
 * Purpose:  Find accepted contact_events that are ~24h old with no rating
 *           submitted. Send FCM push to consumer: "How was your experience?"
 *           Deep link: satvaaah://rate/{contactEventId}?provider_id={uuid}
 *
 * Window:   23h–25h after provider_responded_at (when provider accepted)
 *           Using provider_responded_at because that's when the service happened.
 *           Falls back to created_at if provider_responded_at is null.
 *
 * Guards:
 *   - rating_submitted = true → skip (already rated)
 *   - rating_prompt_skipped_count >= 2 → skip (user dismissed twice)
 *   - No FCM token → skip silently
 *
 * Idempotency:
 *   EventBridge can invoke twice. The 23h–25h window + rating_submitted guard
 *   ensure duplicate sends are harmless (second send still within window).
 */

import { ScheduledEvent, Context } from 'aws-lambda';
import { PrismaClient } from '@prisma/client';
import * as admin from 'firebase-admin';

const prisma = new PrismaClient();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID ?? '',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    }),
  });
}
const fcm = admin.messaging();

const log = (level: string, msg: string, extra?: object) =>
  console.log(JSON.stringify({ level, lambda: 'rating-reminder', msg, ...extra }));

export const handler = async (_event: ScheduledEvent, _ctx: Context): Promise<void> => {
  log('info', 'rating-reminder start');

  // ── Find contact_events in the 23–25h window since acceptance ─────────────
  // Uses provider_responded_at (when provider accepted). Falls back to created_at.
  // Only accepted events, not yet rated, not skipped ≥2 times.
  interface EventRow {
    id:           string;
    consumer_id:  string;
    provider_id:  string;
    provider_name: string;
    fcm_token:    string | null;
    taxonomy_l4:  string | null;
  }

  const events = await prisma.$queryRaw<EventRow[]>`
    SELECT
      ce.id,
      ce.consumer_id,
      ce.provider_id,
      pp.display_name AS provider_name,
      u.fcm_token,
      tn.l4 AS taxonomy_l4
    FROM contact_events ce
    JOIN consumer_profiles cp ON cp.id = ce.consumer_id
    JOIN users u ON u.id = cp.user_id
    JOIN provider_profiles pp ON pp.id = ce.provider_id
    LEFT JOIN taxonomy_nodes tn ON tn.id = pp.taxonomy_node_id
    WHERE
      ce.provider_status = 'accepted'
      AND ce.rating_submitted = false
      AND ce.rating_prompt_skipped_count < 2
      AND COALESCE(ce.provider_responded_at, ce.created_at)
          BETWEEN NOW() - INTERVAL '25 hours' AND NOW() - INTERVAL '23 hours'
    LIMIT 500
  `;

  log('info', 'events found', { count: events.length });

  if (events.length === 0) {
    await prisma.$disconnect();
    return;
  }

  // ── Build FCM messages ─────────────────────────────────────────────────────
  const messages: admin.messaging.Message[] = [];
  const eventIds: string[] = [];

  for (const event of events) {
    eventIds.push(event.id);
    if (!event.fcm_token) continue;

    const categoryLabel = event.taxonomy_l4 ?? 'service';
    const deepLink = `satvaaah://rate/${event.id}?provider_id=${event.provider_id}`;

    messages.push({
      token: event.fcm_token,
      notification: {
        title: 'How was your experience?',
        body: `Rate your ${categoryLabel} with ${event.provider_name} — takes 10 seconds.`,
      },
      data: {
        eventType:        'rating_reminder',
        contact_event_id: event.id,
        provider_id:      event.provider_id,
        provider_name:    event.provider_name ?? '',
        deep_link:        deepLink,
      },
      android: {
        priority: 'normal',
        notification: {
          channelId: 'rating_reminder',
          icon: 'ic_star',
          clickAction: deepLink,
        },
      },
      apns: {
        payload: {
          aps: { badge: 1, sound: 'default', category: 'RATING_REMINDER' },
          deep_link: deepLink,
        },
      },
    });
  }

  // ── Send FCM batch ─────────────────────────────────────────────────────────
  if (messages.length > 0) {
    const batch = await fcm.sendEach(messages);
    const ok = batch.responses.filter(r => r.success).length;
    log('info', 'FCM batch sent', { total: messages.length, success: ok });
  }

  // ── Increment prompt_skipped_count for all matched events ─────────────────
  // This prevents re-sending if the consumer ignores the notification.
  // rating_submitted = true resets this counter to irrelevant.
  if (eventIds.length > 0) {
    await prisma.$executeRaw`
      UPDATE contact_events
      SET rating_prompt_skipped_count = rating_prompt_skipped_count + 1,
          updated_at = NOW()
      WHERE id = ANY(${eventIds}::uuid[])
        AND rating_submitted = false
    `;
    log('info', 'prompt_skipped_count incremented', { count: eventIds.length });
  }

  await prisma.$disconnect();
  log('info', 'rating-reminder done');
};
