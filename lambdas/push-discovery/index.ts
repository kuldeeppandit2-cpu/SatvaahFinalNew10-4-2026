/**
 * lambdas/push-discovery/index.ts
 * Trigger: SQS — push-discovery (from trust-recalculate when score crosses push threshold)
 * Purpose: Match newly-trusted provider against active search_intents.
 *          Send FCM push to matching consumers. Mark intents as notified.
 * CRITICAL: ST_MakePoint(lng, lat) — longitude FIRST always.
 */

import { SQSEvent, SQSRecord, SQSBatchItemFailure, SQSBatchResponse } from 'aws-lambda';
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

interface PushDiscoveryMessage {
  provider_id:    string;
  correlation_id: string;
  display_score:  number;
}

async function runPushDiscovery(msg: PushDiscoveryMessage): Promise<void> {
  const { provider_id: providerId, correlation_id: correlationId, display_score: displayScore } = msg;
  const log = (m: string, extra?: object) => console.log(JSON.stringify({ level: 'info', lambda: 'push-discovery', provider_id: providerId, correlation_id: correlationId, m, ...extra }));

  // 1. Load provider
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: { id: true, display_name: true, listing_type: true, city_id: true, taxonomy_node_id: true, is_active: true },
  });

  if (!provider) { log('Provider not found'); return; }
  if (!provider.is_active) { log('Provider inactive'); return; }
  if (!provider.taxonomy_node_id) { log('No taxonomy_node_id — cannot match'); return; }

  // 2. Extract geo coordinates from PostGIS column via raw SQL
  const geoRows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
    SELECT ST_Y(geo_point::geometry) AS lat, ST_X(geo_point::geometry) AS lng
    FROM provider_profiles
    WHERE id = ${providerId}::uuid AND geo_point IS NOT NULL
    LIMIT 1
  `;
  if (!geoRows[0]) { log('No geo_point — skipping'); return; }
  const { lat: provLat, lng: provLng } = geoRows[0];

  // 3. Load trust score and taxonomy for notification payload
  const trust   = await prisma.trustScore.findUnique({ where: { provider_id: providerId }, select: { display_score: true, trust_tier: true } });
  const taxNode = await prisma.taxonomyNode.findUnique({ where: { id: provider.taxonomy_node_id }, select: { display_name: true } });
  const city    = await prisma.city.findUnique({ where: { id: provider.city_id }, select: { name: true } });

  const categoryName = taxNode?.display_name ?? provider.listing_type;
  const trustScore   = trust ? trust.display_score : displayScore;
  const trustTier    = trust?.trust_tier ?? 'trusted';
  const cityName     = city?.name ?? '';

  // 4. Load radius from system_config (default 3km)
  const radiusCfg = await prisma.systemConfig.findUnique({ where: { key: 'push_discovery_radius_m' }, select: { value: true } });
  const radiusM   = radiusCfg ? parseInt(radiusCfg.value, 10) : 3000;

  log('Searching intents', { taxonomy_node_id: provider.taxonomy_node_id, lat: provLat, lng: provLng, radius_m: radiusM });

  // 5. Query matching search_intents with PostGIS (expiry_at IS NULL OR expiry_at > NOW())
  interface IntentRow { intent_id: string; user_id: string; distance_m: number; }
  const intents = await prisma.$queryRaw<IntentRow[]>`
    SELECT
      si.id       AS intent_id,
      si.user_id,
      ST_Distance(
        ST_SetSRID(ST_MakePoint(${provLng}, ${provLat}), 4326)::geography,
        ST_SetSRID(ST_MakePoint(si.lng, si.lat), 4326)::geography
      ) AS distance_m
    FROM search_intents si
    WHERE
      si.taxonomy_node_id = ${provider.taxonomy_node_id}::uuid
      AND (si.expiry_at IS NULL OR si.expiry_at > NOW())
      AND si.notified_at IS NULL
      AND si.user_dismissed_at IS NULL
      AND ST_Distance(
            ST_SetSRID(ST_MakePoint(${provLng}, ${provLat}), 4326)::geography,
            ST_SetSRID(ST_MakePoint(si.lng, si.lat), 4326)::geography
          ) < ${radiusM}
    ORDER BY distance_m ASC
    LIMIT 500
  `;

  if (intents.length === 0) { log('No matching intents'); return; }
  log('Matching intents found', { count: intents.length });

  // 6. Load FCM tokens
  const userIds = [...new Set(intents.map(i => i.user_id))];
  const users   = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fcm_token: true } });
  const tokenMap = new Map<string, string | null>(users.map(u => [u.id, u.fcm_token]));

  // 7. Build FCM messages
  const notifiedIds: string[] = [];
  const fcmMessages: admin.messaging.Message[] = [];

  for (const intent of intents) {
    const fcmToken = tokenMap.get(intent.user_id);
    notifiedIds.push(intent.intent_id);
    if (!fcmToken) continue; // no token — still mark notified

    fcmMessages.push({
      token: fcmToken,
      notification: { title: `${categoryName} near you`, body: `${provider.display_name} joined SatvAAh with trust score ${trustScore}/100.` },
      data: {
        eventType: 'provider_discovery', provider_id: providerId,
        provider_name: provider.display_name ?? '', category_name: categoryName,
        trust_score: String(trustScore), trust_tier: String(trustTier), city_name: cityName,
        distance_m: String(Math.round(intent.distance_m)), correlation_id: correlationId,
        deep_link: `satvaaah://provider/${providerId}`,
      },
      android: { priority: 'normal', notification: { channelId: 'provider_discovery', icon: 'ic_discovery' } },
      apns: { payload: { aps: { badge: 1, sound: 'default' } } },
    });
  }

  if (fcmMessages.length > 0) {
    const batch = await fcm.sendEach(fcmMessages);
    const ok = batch.responses.filter(r => r.success).length;
    log('FCM batch sent', { total: fcmMessages.length, success: ok });
  }

  // 8. Mark intents as notified
  if (notifiedIds.length > 0) {
    await prisma.$executeRaw`UPDATE search_intents SET notified_at = NOW() WHERE id = ANY(${notifiedIds}::uuid[])`;
    log('Intents marked notified', { count: notifiedIds.length });
  }
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: SQSBatchItemFailure[] = [];
  await Promise.all(event.Records.map(async (record: SQSRecord) => {
    try { await runPushDiscovery(JSON.parse(record.body) as PushDiscoveryMessage); }
    catch (err) {
      console.error(JSON.stringify({ level: 'error', lambda: 'push-discovery', messageId: record.messageId, error: (err as Error).message }));
      failures.push({ itemIdentifier: record.messageId });
    }
  }));
  await prisma.$disconnect();
  return { batchItemFailures: failures };
};
