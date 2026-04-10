// services/search/src/services/intentService.ts
//
// Search intent capture — drives push discovery Lambda.
//
// RULES:
//   • POST /api/v1/search/intent is INTERNAL and ASYNC.
//   • This function is called fire-and-forget from the controller.
//   • It MUST NEVER throw to the caller. All errors are logged only.
//   • Inserts a row into search_intents table.
//   • expiry_at is derived from taxonomy_node.search_intent_expiry_days.
//     If search_intent_expiry_days is NULL on the node, expiry_at is NULL (never expires).
//
// Why does this matter?
//   The Lambda:push-discovery reads search_intents rows to find users who searched
//   for "plumber" in Hyderabad two hours ago but haven't booked yet, then sends
//   them a push notification when a new high-trust plumber comes online nearby.

import { prisma } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CaptureIntentInput {
  userId: string;
  taxonomyNodeId: string;
  lat: number;
  lng: number;
  correlationId: string;
}

// ─── captureSearchIntent ──────────────────────────────────────────────────────

/**
 * Inserts a search_intent row.
 *
 * NEVER throws. All errors are swallowed and logged.
 * Call with void / fire-and-forget:
 *   void captureSearchIntent(input);
 */
export async function captureSearchIntent(
  input: CaptureIntentInput,
): Promise<void> {
  const { userId, taxonomyNodeId, lat, lng, correlationId } = input;

  try {
    // ── Resolve expiry from taxonomy_node ──────────────────────────────────
    const node = await prisma.taxonomyNode.findUnique({
      where: { id: taxonomyNodeId },
      select: {
        id: true,
        search_intent_expiry_days: true,
      },
    });

    if (!node) {
      logger.warn('search.intent.taxonomy_node.not_found', {
        correlationId,
        taxonomyNodeId,
      });
      // Still record intent even without expiry — fallback to NULL expiry
    }

    let expiryAt: Date | null = null;
    if (node?.search_intent_expiry_days != null) {
      expiryAt = new Date();
      expiryAt.setDate(expiryAt.getDate() + node.search_intent_expiry_days);
    }

    const searchedAt = new Date();

    // ── INSERT into search_intents ─────────────────────────────────────────
    // SearchIntent has no @@unique([userId, taxonomyNodeId]) — use findFirst + update/create
    const existing = await prisma.searchIntent.findFirst({
      where: {
        user_id: userId,
        taxonomyNodeId,
        user_dismissed_at: null,        // only refresh non-dismissed intents
        OR: [
          { expiry_at: null },         // never-expiring intent
          { expiry_at: { gt: new Date() } }, // not yet expired
        ],
      },
      select: { id: true },
    });

    if (existing) {
      // Refresh existing intent — user is still searching this category
      await prisma.searchIntent.update({
        where: { id: existing.id },
        data: { lat, lng, searched_at: searchedAt, expiry_at: expiryAt },
      });
    } else {
      // Create new intent
      await prisma.searchIntent.create({
        data: { user_id: userId, taxonomy_node_id: taxonomyNodeId, lat, lng, searched_at: searchedAt, expiry_at: expiryAt },
      });
    }

    logger.info('search.intent.captured', {
      correlationId,
      user_id: userId,
      taxonomyNodeId,
      expiry_at: expiryAt?.toISOString() ?? 'never',
    });
  } catch (err) {
    // NEVER propagate — intent capture failure must not affect search UX
    logger.error('search.intent.capture.failed', {
      correlationId,
      user_id: userId,
      taxonomyNodeId,
      error: (err as Error).message,
    });
  }
}
