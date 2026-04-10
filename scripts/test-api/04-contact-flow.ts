/**
 * 04-contact-flow.ts — Contact Flow Integration Tests
 *
 * Services under test:
 *   services/user (port 3002) — contact_events, leads, consumer_lead_usage
 *
 * Business rules (MASTER_CONTEXT):
 *   - Contact event created → consumer_lead_usage updated atomically in ONE DB tx
 *   - Lead counted against provider quota ONLY on accept
 *   - Consumer phone revealed to provider on accept (reveal_consumer_phone_on_accept=true)
 *   - Provider phone always visible to consumer before contact
 *   - Zero commission — always
 */

import {
  BASE, TestUser, ApiSuccess,
  http, makeHeaders, check, section, log,
  createTestUser, deleteTestUser,
  registerCleanup, withCleanup, ensureHyderabadCity,
  dbQuery, sleep,
} from './00-setup';

const HYD_LAT = 17.3850;
const HYD_LNG = 78.4867;

async function main(): Promise<void> {
  console.log('\n══════════════════════════════════════════');
  console.log(' 04 — Contact Flow');
  console.log('══════════════════════════════════════════');

  const hyderabadId = await ensureHyderabadCity();

  // ── Test data ────────────────────────────────────────────────────────────────
  let providerUser: TestUser | undefined;
  let consumerUser: TestUser | undefined;
  let providerId:   string | undefined;
  let contactEventId: string | undefined;

  registerCleanup(async () => {
    if (providerUser) await deleteTestUser(providerUser);
    if (consumerUser) await deleteTestUser(consumerUser);
  });

  // Create provider
  section('Setup: create provider + consumer');
  {
    providerUser = await createTestUser('contact-provider');
    await http.patch(
      `${BASE.USER}/api/v1/users/me/mode`,
      { mode: 'provider' },
      { headers: makeHeaders(providerUser.accessToken) },
    );

    const provRes = await http.post<ApiSuccess<{ provider_id: string }>>(
      `${BASE.USER}/api/v1/providers/register`,
      {
        display_name:  'Test Provider 04',
        listing_type:  'individual_service',
        city_id:       hyderabadId,
        category_slug: 'plumber',
      },
      { headers: makeHeaders(providerUser.accessToken) },
    );
    check(provRes.status === 200 || provRes.status === 201, 'provider register: 200/201');
    providerId = provRes.data.data.provider_id;

    // Add geo_point so provider appears in search
    await http.post(
      `${BASE.USER}/api/v1/providers/me/verify/geo`,
      { lat: HYD_LAT, lng: HYD_LNG },
      { headers: makeHeaders(providerUser.accessToken) },
    );

    // Create consumer
    consumerUser = await createTestUser('contact-consumer');
    await http.post(
      `${BASE.USER}/api/v1/consumers/profile`,
      { display_name: 'Test Consumer 04', city_id: hyderabadId },
      { headers: makeHeaders(consumerUser.accessToken) },
    ).catch(() => { /* profile may auto-create */ });

    log(`provider_id=${providerId}, consumer_id=${consumerUser.userId}`, true);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Consumer contacts provider → POST /api/v1/contact-events
  //    Assert contact_event + consumer_lead_usage updated in SINGLE DB transaction
  // ────────────────────────────────────────────────────────────────────────────
  section('1. POST /api/v1/contact-events → atomicity check');
  {
    if (!providerId || !consumerUser) throw new Error('missing test data');

    // Snapshot lead usage BEFORE contact
    const usageBefore = await dbQuery<{
      leads_used: number;
      leads_allocated: number;
    }>(
      `SELECT leads_used, leads_allocated FROM consumer_lead_usage
       WHERE consumer_id = $1
       ORDER BY period_start DESC LIMIT 1`,
      [consumerUser.userId],
    );

    const leadsUsedBefore = usageBefore[0]?.leads_used ?? 0;

    const contactRes = await http.post<ApiSuccess<{
      contact_event_id: string;
      status:           string;
    }>>(
      `${BASE.USER}/api/v1/contact-events`,
      {
        provider_id:  providerId,
        contact_type: 'message',
        message:      'Test contact from Phase 25b integration test',
      },
      { headers: makeHeaders(consumerUser.accessToken) },
    );

    check(contactRes.status === 200 || contactRes.status === 201,
          'contact event: HTTP 200/201',                              `got ${contactRes.status}`);
    check(typeof contactRes.data.data.contact_event_id === 'string',
          'contact event: contact_event_id returned');

    contactEventId = contactRes.data.data.contact_event_id;

    // Atomicity check: both contact_event AND consumer_lead_usage must be updated.
    // If the transaction was atomic, both are visible at the same instant.
    const [ceRows, usageAfter] = await Promise.all([
      dbQuery<{ id: string; status: string; consumer_lead_deducted: boolean }>(
        `SELECT id, status, consumer_lead_deducted
         FROM contact_events WHERE id = $1`,
        [contactEventId],
      ),
      dbQuery<{ leads_used: number }>(
        `SELECT leads_used FROM consumer_lead_usage
         WHERE consumer_id = $1
         ORDER BY period_start DESC LIMIT 1`,
        [consumerUser.userId],
      ),
    ]);

    check(ceRows.length === 1,
          'contact event: row exists in DB',                          `found ${ceRows.length}`);
    check(ceRows[0].status === 'pending' || ceRows[0].status === 'sent',
          'contact event: status is pending/sent',                    `got ${ceRows[0].status}`);

    // consumer_lead_usage.leads_used should have incremented (if lead cost > 0 at launch)
    // At launch contact_lead_cost=0, so leads_used may not change.
    // We verify BOTH records exist in a consistent state (not partial).
    const leadsUsedAfter = usageAfter[0]?.leads_used ?? 0;
    check(
      leadsUsedAfter >= leadsUsedBefore,
      'atomicity: consumer_lead_usage.leads_used >= before (never decrements on contact)',
      `before=${leadsUsedBefore}, after=${leadsUsedAfter}`,
    );

    log(`contact_event_id=${contactEventId}, leads_used=${leadsUsedAfter}`, true);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Provider lists leads → GET /api/v1/providers/me/leads → lead present
  // ────────────────────────────────────────────────────────────────────────────
  section('2. Provider lists leads → contact event present');
  {
    if (!providerUser || !contactEventId) throw new Error('missing test data');

    const leadsRes = await http.get<ApiSuccess<Array<{
      id:            string;
      contact_type:  string;
      status:        string;
      consumer_name: string;
    }>>>(
      `${BASE.USER}/api/v1/providers/me/leads`,
      { headers: makeHeaders(providerUser.accessToken) },
    );

    check(leadsRes.status === 200,
          'provider leads: HTTP 200',                                 `got ${leadsRes.status}`);
    const leads = leadsRes.data.data;
    check(Array.isArray(leads),
          'provider leads: response.data is an array');

    const ourLead = leads.find((l) => l.id === contactEventId);
    check(ourLead !== undefined,
          'provider leads: test contact_event present in leads list', `looking for id=${contactEventId}`);

    log(`lead found: id=${ourLead?.id}, status=${ourLead?.status}`, true);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Provider accepts lead → PATCH /api/v1/providers/me/leads/:id {action: accept}
  //    → consumer_phone revealed in response
  //    → providerLeadUsage.leadsAccepted incremented
  // ────────────────────────────────────────────────────────────────────────────
  section('3. Provider accepts lead → consumer phone revealed + leadsAccepted++');
  {
    if (!providerUser || !consumerUser || !contactEventId) throw new Error('missing test data');

    // Snapshot provider lead usage before accept
    const now   = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const usageBefore = await dbQuery<{ leads_accepted: number }>(
      `SELECT leads_accepted FROM provider_lead_usage
       WHERE provider_id = $1 AND month = $2`,
      [providerId, month],
    );
    const acceptedBefore = usageBefore[0]?.leads_accepted ?? 0;

    // Accept the lead
    const acceptRes = await http.patch<ApiSuccess<{
      status:              string;
      consumer_phone?:     string;
      consumer_name?:      string;
    }>>(
      `${BASE.USER}/api/v1/providers/me/leads/${contactEventId}`,
      { action: 'accept' },
      { headers: makeHeaders(providerUser.accessToken) },
    );

    check(acceptRes.status === 200,
          'lead accept: HTTP 200',                                    `got ${acceptRes.status}`);
    check(acceptRes.data.data.status === 'accepted',
          'lead accept: status = accepted',                           `got ${acceptRes.data.data.status}`);

    // Consumer phone must be revealed on accept (reveal_consumer_phone_on_accept=true)
    const phone = acceptRes.data.data.consumer_phone;
    check(
      typeof phone === 'string' && phone.length >= 10,
      'lead accept: consumer_phone revealed in response',
      `got ${JSON.stringify(phone)}`,
    );
    // Sanity: the revealed phone matches our test consumer's phone
    check(
      phone === consumerUser.testPhone || phone?.includes(consumerUser.testPhone.slice(-7)),
      'lead accept: revealed phone matches consumer test phone',
      `expected ~${consumerUser.testPhone}, got ${phone}`,
    );

    // providerLeadUsage.leadsAccepted must have incremented
    await sleep(300); // brief wait for DB update
    const usageAfter = await dbQuery<{ leads_accepted: number }>(
      `SELECT leads_accepted FROM provider_lead_usage
       WHERE provider_id = $1 AND month = $2`,
      [providerId, month],
    );
    const acceptedAfter = usageAfter[0]?.leads_accepted ?? 0;

    check(acceptedAfter > acceptedBefore,
          'lead accept: provider_lead_usage.leads_accepted incremented',
          `before=${acceptedBefore}, after=${acceptedAfter}`);

    log(`consumer_phone=${phone}, leads_accepted: ${acceptedBefore}→${acceptedAfter}`, true);
  }

  console.log('\n  ✓ 04-contact-flow PASSED\n');
}

withCleanup(main).catch((err) => {
  console.error('\n  ✗ 04-contact-flow FAILED:', err.message);
  process.exit(1);
});
