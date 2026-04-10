/**
 * lambdas/opensearch-sync/index.ts
 * Trigger: SQS CDC — from V018 PostgreSQL trigger on provider_profiles
 * Purpose: Keep OpenSearch satvaaah_providers index in sync with PostgreSQL.
 *          DLQ after 3 failures (maxReceiveCount=3 on SQS queue level).
 *          Logs every attempt to opensearch_sync_log.
 * CRITICAL: ST_MakePoint(lng, lat) — longitude FIRST. OpenSearch geo_point uses { lat, lon }.
 */

import { SQSEvent, SQSRecord, SQSBatchItemFailure, SQSBatchResponse } from 'aws-lambda';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const openSearch = new OpenSearchClient({
  ...AwsSigv4Signer({ region: process.env.AWS_REGION ?? 'ap-south-1', getCredentials: () => defaultProvider()() }),
  node: process.env.OPENSEARCH_ENDPOINT ?? '',
});

const INDEX = 'satvaaah_providers';

type CDCOperation = 'INSERT' | 'UPDATE' | 'DELETE';
interface CDCMessage { provider_id: string; operation: CDCOperation; correlation_id: string; }

async function buildDoc(providerId: string): Promise<object | null> {
  const p = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: {
      id: true, user_id: true, display_name: true, listing_type: true, tab: true,
      city_id: true, area_id: true, taxonomy_node_id: true,
      is_phone_verified: true, is_aadhaar_verified: true, is_geo_verified: true,
      has_profile_photo: true, has_credentials: true,
      is_active: true, is_claimed: true, is_scrape_record: true, home_visit_available: true,
      created_at: true, updated_at: true,
    },
  });
  if (!p) return null;

  const geoRows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
    SELECT ST_Y(geo_point::geometry) AS lat, ST_X(geo_point::geometry) AS lng
    FROM provider_profiles WHERE id = ${providerId}::uuid AND geo_point IS NOT NULL LIMIT 1
  `;

  const trust = await prisma.trustScore.findUnique({ where: { provider_id: providerId }, select: { display_score: true, trust_tier: true } });
  const city  = await prisma.city.findUnique({ where: { id: p.city_id }, select: { name: true } });

  let taxL1: string | null = null, taxL2: string | null = null,
      taxL3: string | null = null, taxL4: string | null = null, taxName: string | null = null;
  if (p.taxonomy_node_id) {
    const tn = await prisma.taxonomyNode.findUnique({ where: { id: p.taxonomy_node_id }, select: { display_name: true, l1: true, l2: true, l3: true, l4: true } });
    if (tn) { taxName = tn.display_name; taxL1 = tn.l1; taxL2 = tn.l2; taxL3 = tn.l3; taxL4 = tn.l4; }
  }

  const now = new Date().toISOString();
  return {
    provider_id: p.id, user_id: p.user_id, display_name: p.display_name ?? '',
    listing_type: p.listing_type, tab: p.tab, city_id: p.city_id, city_name: city?.name ?? '',
    area_id: p.area_id, taxonomy_node_id: p.taxonomy_node_id,
    taxonomy_l1: taxL1, taxonomy_l2: taxL2, taxonomy_l3: taxL3, taxonomy_l4: taxL4, taxonomy_name: taxName,
    // OpenSearch geo_point: { lat, lon } — note "lon" not "lng"
    geo_point: geoRows[0] ? { lat: geoRows[0].lat, lon: geoRows[0].lng } : null,
    trust_score: trust ? trust.display_score : 0,
    trust_tier: trust?.trust_tier ?? 'unverified',
    is_phone_verified: p.is_phone_verified, is_aadhaar_verified: p.is_aadhaar_verified,
    is_geo_verified: p.is_geo_verified, has_credentials: p.has_credentials,
    is_active: p.is_active, is_claimed: p.is_claimed, is_scrape_record: p.is_scrape_record,
    home_visit_available: p.home_visit_available,
    created_at: p.created_at?.toISOString() ?? now,
    updated_at: p.updated_at?.toISOString() ?? now,
    synced_at: now,
  };
}

async function logSync(providerId: string, triggerType: string, syncStatus: 'success' | 'error', errorMessage: string | null): Promise<void> {
  try {
    await prisma.openSearchSyncLog.create({
      data: { provider_id: providerId, trigger_type: triggerType, sync_status: syncStatus, error_message: errorMessage },
    });
  } catch (e) {
    console.warn(JSON.stringify({ level: 'warn', lambda: 'opensearch-sync', msg: 'Failed to write sync log', error: (e as Error).message }));
  }
}

async function syncProvider(msg: CDCMessage): Promise<void> {
  const { provider_id: providerId, operation, correlation_id: correlationId } = msg;
  const log = (m: string, extra?: object) => console.log(JSON.stringify({ level: 'info', lambda: 'opensearch-sync', provider_id: providerId, correlation_id: correlationId, operation, m, ...extra }));

  log('Processing CDC event');

  try {
    if (operation === 'DELETE') {
      try { await openSearch.delete({ index: INDEX, id: providerId }); }
      catch (e: any) { if (e?.meta?.statusCode !== 404) throw e; }
      log('Deleted from index');
      await logSync(providerId, operation, 'success', null);
      return;
    }

    const doc = await buildDoc(providerId);
    if (!doc) {
      try { await openSearch.delete({ index: INDEX, id: providerId }); } catch (_) {}
      await logSync(providerId, operation, 'success', null);
      return;
    }

    await openSearch.index({ index: INDEX, id: providerId, body: doc, refresh: false });
    log('Indexed');
    await logSync(providerId, operation, 'success', null);
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error(JSON.stringify({ level: 'error', lambda: 'opensearch-sync', provider_id: providerId, operation, error: errMsg }));
    await logSync(providerId, operation, 'error', errMsg);
    throw err; // Re-throw → SQS retry → DLQ after maxReceiveCount=3
  }
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: SQSBatchItemFailure[] = [];
  for (const record of event.Records) { // sequential to avoid OpenSearch thundering herd
    try { await syncProvider(JSON.parse(record.body) as CDCMessage); }
    catch (err) {
      console.error(JSON.stringify({ level: 'error', lambda: 'opensearch-sync', messageId: record.messageId, error: (err as Error).message }));
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  await prisma.$disconnect();
  return { batchItemFailures: failures };
};
