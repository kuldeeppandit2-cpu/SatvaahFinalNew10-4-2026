/**
 * Consumer Controller
 * Handles consumer_profiles and saved_providers endpoints.
 */

import { Request, Response } from 'express';
import { consumerService }   from '../services/consumerService';
import { prisma } from '@satvaaah/db';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '@satvaaah/errors';
import { logger } from '@satvaaah/logger';

// ── Consumer Profile ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/consumers/me
 */
export async function getMyConsumerProfile(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;

  const [profile, user, consumerContactCount] = await Promise.all([
    consumerService.getByUserId(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, subscription_tier: true, referral_code: true, mode: true },
    }),
    // Count accepted contact events for Trusted Circle threshold (contactCount >= 3)
    // audit-ref: DB5 contact_events — consumer_id FK → users.id (V009 SQL, never changed)
    // consumer_id IS users.id — do NOT resolve to cp.id here
    prisma.contactEvent.count({ where: { consumer_id: userId, status: 'accepted' } }),
  ]);

  if (!profile) throw new NotFoundError('CONSUMER_NOT_FOUND', 'No consumer profile found for this account');

  res.json({
    success: true,
    data: {
      id:               profile.id,
      userId:           userId,
      displayName:      profile.display_name,
      phone:            user?.phone ?? null,
      cityLabel:        profile.city?.name ?? null,
      cityId:           profile.city_id,
      subscriptionTier: user?.subscription_tier ?? 'free',
      referralCode:     user?.referral_code ?? null,
      trustScore:       profile.trust_score ?? 75,
      trustTier:        profile.trust_score >= 80 ? 'highly_trusted'
                        : profile.trust_score >= 60 ? 'trusted'
                        : profile.trust_score >= 20 ? 'basic' : 'unverified',
      avatarS3Key:      profile.avatar_s3_key ?? null,
      lead_usage:       profile.lead_usage,
      leadsRemaining:   profile.lead_usage
                        ? Math.max(0, profile.lead_usage.leads_allocated - profile.lead_usage.leads_used)
                        : 0,
      leadsAllocated:   profile.lead_usage?.leads_allocated ?? 0,
      contactCount:     consumerContactCount,
      created_at:       profile.created_at,
    },
  });
}

/**
 * POST /api/v1/consumers/profile
 * Body: { display_name, city_id, avatar_url? }
 * Idempotent — returns existing profile if already created.
 */
export async function createConsumerProfile(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  const { display_name, city_id, avatar_url } = req.body;

  if (!display_name || !city_id) {
    throw new ValidationError('MISSING_FIELDS', 'display_name and city_id are required');
  }

  if (display_name.trim().length < 2 || display_name.trim().length > 80) {
    throw new ValidationError(
      'INVALID_DISPLAY_NAME',
      'display_name must be between 2 and 80 characters'
    );
  }

  const { profile, created } = await consumerService.upsertProfile({
    user_id: userId,
    displayName: display_name.trim(),
    city_id,
    avatar_url,
    correlationId,
  });

  logger.info('Consumer profile upserted', { user_id: userId, created, correlationId });

  res.status(created ? 201 : 200).json({
    success: true,
    data: { ...profile, created },
  });
}

// ── Saved Providers ───────────────────────────────────────────────────────────

/**
 * GET /api/v1/saved-providers
 */
export async function getSavedProviders(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;

  const saved = await consumerService.getSavedProviders(userId);

  const mapped = saved.map((row: any) => ({
    providerId:          row.provider_id,
    saved_at:            row.created_at,
    trust_score_at_save: row.provider?.trust_score_record?.display_score ?? 0,
    provider: {
      id:                    row.provider?.id ?? row.provider_id,
      displayName:           row.provider?.display_name ?? '',
      listingType:           row.provider?.listing_type ?? 'individual_service',
      tab:                   row.provider?.tab ?? 'services',
      trustScore:            row.provider?.trust_score_record?.display_score ?? 0,
      trustTier:             row.provider?.trust_score_record?.trust_tier ?? 'unverified',
      cityId:                row.provider?.city_id ?? null,
      primary_taxonomy_label: row.provider?.taxonomy_node?.display_name ?? '',
      photoUrl:              row.provider?.profile_photo_s3_key ?? null,
      photo_url:             row.provider?.profile_photo_s3_key ?? null,
      cityName:              row.provider?.city?.name ?? null,
      areaName:              row.provider?.area?.name ?? null,
    },
  }));

  res.json({ success: true, data: { providers: mapped, total: mapped.length } });
}

/**
 * POST /api/v1/saved-providers
 * Body: { provider_id }
 */
export async function saveProvider(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  const { provider_id } = req.body;

  if (!provider_id) {
    throw new ValidationError('MISSING_FIELDS', 'provider_id is required');
  }

  // Prevent saving self
  const consumer = await consumerService.getByUserId(userId);
  if (!consumer) throw new NotFoundError('CONSUMER_NOT_FOUND', 'Consumer profile required to save providers');

  const result = await consumerService.saveProvider({
    consumerId: consumer.id,
    providerId: provider_id,
    correlationId,
  });

  res.status(result.alreadySaved ? 200 : 201).json({
    success: true,
    data: { saved: true, already_saved: result.alreadySaved },
  });
}

/**
 * DELETE /api/v1/saved-providers/:id
 * :id = provider_id
 */
export async function unsaveProvider(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const providerId = req.params.id;
  const correlationId = req.headers['x-correlation-id'] as string;

  if (!providerId) {
    throw new ValidationError('MISSING_PARAM', 'provider_id param is required');
  }

  const consumer = await consumerService.getByUserId(userId);
  if (!consumer) throw new NotFoundError('CONSUMER_NOT_FOUND', 'Consumer profile not found');

  await consumerService.unsaveProvider({
    consumerId: consumer.id,
    provider_id: providerId,
    correlationId,
  });

  res.json({ success: true, data: { unsaved: true } });
}
