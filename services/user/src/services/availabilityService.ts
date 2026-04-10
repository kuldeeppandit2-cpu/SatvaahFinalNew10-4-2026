// services/user/src/services/availabilityService.ts
//
// Availability update — real-time critical path.
//
// Three writes must happen in this order:
//   1. PostgreSQL (source of truth)
//   2. OpenSearch direct update (bypasses CDC — real-time required for search)
//   3. WebSocket broadcast to city room (real-time consumer UI updates)
//
// WHY bypass CDC for availability:
//   The normal CDC path (DB trigger → SQS → Lambda:opensearch-sync) has ~5–30s latency.
//   Availability changes are time-sensitive — a consumer searching RIGHT NOW should see
//   "available" immediately. So we write directly to OpenSearch here AND let CDC sync
//   happen as a consistency backstop.

import { prisma } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';
import { getIo } from '../websocket/server';
import { getOpenSearchClient } from '../lib/opensearchClient';

const OPENSEARCH_INDEX = 'satvaaah_providers';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AvailabilityScheduleSlot {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sunday … 6=Saturday
  open: string;  // HH:MM 24h
  close: string; // HH:MM 24h
}

export interface UpdateAvailabilityInput {
  providerId: string;          // provider_profiles.id
  userId: string;              // users.id — for auth check
  mode: 'available' | 'busy' | 'away' | 'offline';  // Availability enum values
  schedule?: AvailabilityScheduleSlot[];
  correlationId: string;
}

// ─── updateAvailabilityService ────────────────────────────────────────────────

export async function updateAvailabilityService(
  input: UpdateAvailabilityInput,
) {
  const { providerId, userId, mode, schedule, correlationId } = input;

  // ── Validate provider belongs to the authenticated user ───────────────────
  const provider = await prisma.providerProfile.findFirst({
    where: { id: providerId, user_id: userId },
    select: {
      id: true,
      user_id: true,
      city_id: true,
    },
  });

  if (!provider) {
    throw new AppError(
      'PROVIDER_NOT_FOUND',
      'Provider profile not found or access denied',
      404,
    );
  }

  const cityId = provider.city_id;

  // ── Step 1: UPDATE PostgreSQL (source of truth) ───────────────────────────
  const updatedProvider = await prisma.providerProfile.update({
    where: { id: providerId },
    data: {
      availability:        mode as any,  // Availability enum
      availability_updated_at: new Date(),
    },
    select: {
      id: true,
      availability:          true,
      availability_updated_at: true,
    },
  });

  logger.info('availability.postgres.updated');

  // ── Step 2: DIRECT OpenSearch update (real-time, bypass CDC) ─────────────
  // Failures here are logged but do NOT roll back the PostgreSQL write.
  // The CDC path will eventually converge.
  try {
    const osClient = getOpenSearchClient();
    await osClient.update({
      index: OPENSEARCH_INDEX,
      id: providerId,
      body: {
        doc: {
          availability:          mode,
          availability_updated_at: updatedProvider.availability_updated_at?.toISOString(),
        },
      },
      // doc_as_upsert: if for some reason the doc doesn't exist yet
      // (e.g., sync lag on new provider) create it with minimal fields.
      // The next CDC sync will fill the rest.
      doc_as_upsert: false,
    });

    logger.info('availability.opensearch.updated');
  } catch (osErr) {
    // Non-fatal: CDC will converge within seconds
    logger.error('availability.opensearch.update.failed');
  }

  // ── Step 3: WebSocket broadcast to city room ──────────────────────────────
  // Broadcasts on /availability namespace, room city:{city_id}.
  // Consumers currently searching in this city receive real-time update.
  try {
    const io = getIo();
    const payload = {
      provider_id:  providerId,
      mode,
      isAvailable: mode === 'available',  // derived for client convenience
      updated_at:   updatedProvider.availability_updated_at?.toISOString(),
    };
    io.of('/availability').to(`city:${cityId}`).emit('availability_updated', payload);

    logger.info('availability.websocket.broadcast');
  } catch (wsErr) {
    // Non-fatal: consumers will get updated mode on next search result refresh
    logger.warn('availability.websocket.broadcast.failed');
  }

  return {
    provider_id: providerId,
    mode:       updatedProvider.availability,
    updated_at:  updatedProvider.availability_updated_at,
  };
}
