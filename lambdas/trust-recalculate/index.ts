/**
 * lambdas/trust-recalculate/index.ts
 * Trigger: SQS — trust-score-updates
 * Purpose: Full trust score recalculation for a provider after any signal change.
 *          Reads ALL weights from trust_score_config. Nothing hardcoded.
 *          trust_score_history is IMMUTABLE — only INSERT, never UPDATE.
 *          Dispatches to certificate-generator and push-discovery SQS queues on threshold crossings.
 */

import { SQSEvent, SQSRecord, SQSBatchItemFailure, SQSBatchResponse } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

interface TrustRecalculateMessage {
  provider_id: string;
  correlation_id: string;
  triggered_by?: string; // optional — ratingService sends 'event' field instead
  event?: string;        // fallback from ratingService ('rating_submitted')
  signal?: string;       // fallback from other services
}

function computeCustomerVoiceWeight(ratingCount: number, curveStr: string, maxWeight: number): number {
  const points = curveStr.split(',').map(p => {
    const [cnt, wt] = p.trim().split(':');
    return { count: parseInt(cnt, 10), weight: parseFloat(wt) };
  }).sort((a, b) => a.count - b.count);

  if (ratingCount <= points[0].count) return Math.min(points[0].weight, maxWeight);
  if (ratingCount >= points[points.length - 1].count) return Math.min(points[points.length - 1].weight, maxWeight);

  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i], hi = points[i + 1];
    if (ratingCount >= lo.count && ratingCount < hi.count) {
      const ratio = (ratingCount - lo.count) / (hi.count - lo.count);
      return Math.min(lo.weight + ratio * (hi.weight - lo.weight), maxWeight);
    }
  }
  return Math.min(points[points.length - 1].weight, maxWeight);
}

function determineTier(score: number, basic: number, trusted: number, highlyTrusted: number): string {
  if (score >= highlyTrusted) return 'highly_trusted';
  if (score >= trusted) return 'trusted';
  if (score >= basic) return 'basic';
  return 'unverified';
}

async function recalculate(providerId: string, correlationId: string, triggeredBy: string): Promise<void> {
  const log = (msg: string, extra?: object) => console.log(JSON.stringify({
    level: 'info', lambda: 'trust-recalculate', provider_id: providerId, correlation_id: correlationId, msg, ...extra,
  }));

  // 1. Load provider
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: {
      id: true, listing_type: true, city_id: true, taxonomy_node_id: true,
      is_phone_verified: true, is_aadhaar_verified: true, is_geo_verified: true,
      has_profile_photo: true, has_credentials: true, is_active: true,
    },
  });

  if (!provider) { log('Provider not found — skipping'); return; }

  // 2. Load trust_score_config for this listing_type
  const signals = await prisma.trustScoreConfig.findMany({
    where: { listing_type: provider.listing_type, is_active: true },
    orderBy: { signal_name: 'asc' },
  });

  if (signals.length === 0) { log('No signals configured — skipping'); return; }

  // 3. Map signal_name → provider boolean flag
  const signalFlagMap: Record<string, boolean> = {
    'phone_otp_verified': provider.is_phone_verified ?? false,
    'geo_verified':       provider.is_geo_verified ?? false,
    'aadhaar_verified':   provider.is_aadhaar_verified ?? false,
    'credential_verified': provider.has_credentials ?? false,
    'profile_photo':      provider.has_profile_photo ?? false,
    // Non-boolean signals (gst_registered, linkedin_verified) default false unless added to provider_profiles
    'gst_registered':     false,
    'linkedin_verified':  false,
  };

  // Compute raw_max_total dynamically if not stored
  const rawMaxTotal = signals[0].raw_max_total ?? signals.reduce((sum, s) => sum + s.max_pts, 0);

  let earnedPts = 0;
  const signalBreakdown: Record<string, number> = {};
  for (const signal of signals) {
    // ratings_quality and response_rate are computed separately — not boolean flags
    if (['ratings_quality', 'response_rate'].includes(signal.signal_name)) continue;
    const earned = (signalFlagMap[signal.signal_name] === true) ? signal.max_pts : 0;
    earnedPts += earned;
    signalBreakdown[signal.signal_name] = earned;
  }

  const verificationScore = rawMaxTotal > 0 ? Math.min(100, (earnedPts / rawMaxTotal) * 100) : 0;

  // 4. Load approved ratings for customer_voice_score
  const ratings = await prisma.rating.findMany({
    where: { provider_id: providerId, moderation_status: 'approved' },
    select: { overall_stars: true, weight_value: true },
  });

  const ratingCount = ratings.length;
  let customerVoiceScore = 0;
  if (ratingCount > 0) {
    let weightedSum = 0, totalWeight = 0;
    for (const r of ratings) {
      weightedSum += r.overall_stars * r.weight_value;
      totalWeight += r.weight_value;
    }
    customerVoiceScore = totalWeight > 0 ? ((weightedSum / totalWeight) / 5) * 100 : 0;
  }

  // 5. Load system_config
  const configRows = await prisma.systemConfig.findMany({
    where: { key: { in: ['customer_weight_curve','customer_voice_max_weight','trust_tier_basic_threshold','trust_tier_trusted_threshold','trust_tier_highly_trusted_threshold','push_discovery_trust_threshold'] } },
  });
  const cfg = Object.fromEntries(configRows.map(r => [r.key, r.value]));

  const curveStr             = cfg['customer_weight_curve']              ?? '0:0.10,3:0.20,10:0.30,50:0.65,200:0.70';
  const maxWeight            = parseFloat(cfg['customer_voice_max_weight']            ?? '0.70');
  const basicThreshold       = parseFloat(cfg['trust_tier_basic_threshold']           ?? '20');
  const trustedThreshold     = parseFloat(cfg['trust_tier_trusted_threshold']         ?? '60');
  const highlyTrustedThreshold = parseFloat(cfg['trust_tier_highly_trusted_threshold'] ?? '80');
  const pushDiscoveryThreshold = parseFloat(cfg['push_discovery_trust_threshold']     ?? '60');

  // 6. Compute weights and display score
  const customerVoiceWeight = computeCustomerVoiceWeight(ratingCount, curveStr, maxWeight);
  const verificationWeight  = 1.0 - customerVoiceWeight;
  const displayScore = Math.round(Math.min(100, Math.max(0,
    (verificationScore * verificationWeight) + (customerVoiceScore * customerVoiceWeight),
  )));
  const newTier = determineTier(displayScore, basicThreshold, trustedThreshold, highlyTrustedThreshold);

  // 7. Load previous score for threshold crossing detection
  const current = await prisma.trustScore.findUnique({
    where: { provider_id: providerId },
    select: { display_score: true, trust_tier: true },
  });
  const prevScore = current ? current.display_score : 0;
  const deltaPts  = displayScore - prevScore;

  log('Score computed', { displayScore, newTier, prevScore, deltaPts, ratingCount });

  // 8. Atomic write: upsert trust_scores + INSERT trust_score_history (IMMUTABLE)
  await prisma.$transaction(async (tx) => {
    await tx.trustScore.upsert({
      where:  { provider_id: providerId },
      update: { display_score: displayScore, raw_score: displayScore, verification_score: Math.round(verificationScore), customer_voice_score: Math.round(customerVoiceScore), customer_voice_weight: customerVoiceWeight, trust_tier: newTier as any, signal_breakdown: signalBreakdown },
      create: { provider_id: providerId, display_score: displayScore, raw_score: displayScore, verification_score: Math.round(verificationScore), customer_voice_score: Math.round(customerVoiceScore), customer_voice_weight: customerVoiceWeight, trust_tier: newTier as any, signal_breakdown: signalBreakdown },
    });
    // IMMUTABLE — INSERT ONLY
    await tx.trustScoreHistory.create({
      data: { provider_id: providerId, event_type: triggeredBy, delta_pts: deltaPts, new_display_score: displayScore, new_raw_score: displayScore, new_tier: newTier as any, correlation_id: correlationId },
    });
  });

  log('trust_scores and trust_score_history written');

  // 9. Threshold crossing dispatch
  const crossedHighlyTrusted = displayScore >= highlyTrustedThreshold && prevScore < highlyTrustedThreshold;
  const crossedPushDiscovery = displayScore >= pushDiscoveryThreshold && prevScore < pushDiscoveryThreshold;

  await Promise.all([
    crossedHighlyTrusted ? sqs.send(new SendMessageCommand({
      QueueUrl: process.env.CERTIFICATE_GENERATOR_QUEUE_URL ?? '',
      MessageBody: JSON.stringify({ provider_id: providerId, correlation_id: correlationId, display_score: displayScore, triggered_at: new Date().toISOString() }),
    })) : Promise.resolve(),
    crossedPushDiscovery ? sqs.send(new SendMessageCommand({
      QueueUrl: process.env.PUSH_DISCOVERY_QUEUE_URL ?? '',
      MessageBody: JSON.stringify({ provider_id: providerId, correlation_id: correlationId, display_score: displayScore, triggered_at: new Date().toISOString() }),
    })) : Promise.resolve(),
  ]);
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: SQSBatchItemFailure[] = [];
  await Promise.all(event.Records.map(async (record: SQSRecord) => {
    try {
      const msg = JSON.parse(record.body) as TrustRecalculateMessage;
      await recalculate(msg.provider_id, msg.correlation_id, msg.triggered_by ?? msg.event ?? msg.signal ?? 'signal_change');
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', lambda: 'trust-recalculate', messageId: record.messageId, error: (err as Error).message }));
      failures.push({ itemIdentifier: record.messageId });
    }
  }));
  await prisma.$disconnect();
  return { batchItemFailures: failures };
};
