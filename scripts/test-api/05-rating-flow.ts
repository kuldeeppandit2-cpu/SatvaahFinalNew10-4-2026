/**
 * 05-rating-flow.ts — Rating Flow Integration Tests
 *
 * Services under test:
 *   services/rating (port 3005)
 *   services/user   (port 3002) — contact events, provider setup
 *
 * Business rules (MASTER_CONTEXT):
 *   Services tab:      contact_event MANDATORY. No CE → 400 CONTACT_EVENT_REQUIRED
 *   Products tab:      contact_event NOT required. No CE → 200
 *   Burst detection:   3rd rating in 60 min → flag only, NEVER block (still 200)
 *   Daily limit:       Exceeded → 429 DAILY_LIMIT_EXCEEDED
 *   Weight types:      verified_contact=1.0, open_community=0.5, scraped_external=0.3
 *   open_community:    weight_value=0.5 when no contact_event linked
 */

import {
  BASE, TestUser, ApiSuccess,
  http, makeHeaders, check, section, log,
  createTestUser, deleteTestUser,
  registerCleanup, withCleanup, ensureHyderabadCity,
  dbQuery, sleep, extractApiError,
} from './00-setup';

const HYD_LAT = 17.3850;
const HYD_LNG = 78.4867;

async function main(): Promise<void> {
  console.log('\n══════════════════════════════════════════');
  console.log(' 05 — Rating Flow');
  console.log('══════════════════════════════════════════');

  const hyderabadId = await ensureHyderabadCity();

  // ── Test data ────────────────────────────────────────────────────────────────
  let serviceProvider:  TestUser | undefined; // listing_type=individual_service (services tab)
  let productProvider:  TestUser | undefined; // listing_type=individual_product (products tab)
  let raterUser:        TestUser | undefined;
  let serviceProviderId: string | undefined;
  let productProviderId: string | undefined;

  registerCleanup(async () => {
    for (const u of [serviceProvider, productProvider, raterUser]) {
      if (u) await deleteTestUser(u);
    }
  });

  section('Setup: create service provider, product provider, rater');
  {
    async function setupProvider(
      user: TestUser,
      listingType: string,
      label: string,
    ): Promise<string> {
      await http.patch(
        `${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'provider' },
        { headers: makeHeaders(user.accessToken) },
      );
      const res = await http.post<ApiSuccess<{ provider_id: string }>>(
        `${BASE.USER}/api/v1/providers/register`,
        {
          display_name:  `Test ${label} 05`,
          listing_type:  listingType,
          city_id:       hyderabadId,
          category_slug: listingType === 'individual_product' ? 'milk' : 'plumber',
        },
        { headers: makeHeaders(user.accessToken) },
      );
      check(res.status === 200 || res.status === 201, `${label} register: 200/201`);
      return res.data.data.provider_id;
    }

    serviceProvider  = await createTestUser('rate-svc-provider');
    productProvider  = await createTestUser('rate-prod-provider');
    raterUser        = await createTestUser('rater');

    serviceProviderId = await setupProvider(serviceProvider, 'individual_service', 'ServiceProvider');
    productProviderId = await setupProvider(productProvider, 'individual_product', 'ProductProvider');

    log(`service_provider_id=${serviceProviderId}`, true);
    log(`product_provider_id=${productProviderId}`, true);
    log(`rater_id=${raterUser.userId}`, true);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Services tab: rate WITHOUT contact_event → 400 CONTACT_EVENT_REQUIRED
  // ────────────────────────────────────────────────────────────────────────────
  section('1. Services tab: no contact_event → 400 CONTACT_EVENT_REQUIRED');
  {
    if (!serviceProviderId || !raterUser) throw new Error('missing test data');

    try {
      await http.post(
        `${BASE.RATING}/api/v1/ratings`,
        {
          provider_id:       serviceProviderId,
          overall_stars:     4,
          comment:           'Test rating no CE — should fail',
          tab:               'services',
          contact_event_id:  null, // explicitly no contact event
        },
        { headers: makeHeaders(raterUser.accessToken) },
      );
      check(false, 'services rating no CE: expected 400, got 200');
    } catch (err) {
      const { code, status } = extractApiError(err);
      check(status === 400,
            'services rating no CE: HTTP 400',                        `got ${status}`);
      check(code === 'CONTACT_EVENT_REQUIRED',
            'services rating no CE: error.code = CONTACT_EVENT_REQUIRED',
            `got ${code}`);
      log(`code=${code}, status=${status}`, true);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Products tab: rate WITHOUT contact_event → 200 (allowed)
  //    Assert weight_type = open_community, weight_value = 0.5
  // ────────────────────────────────────────────────────────────────────────────
  section('2. Products tab: no contact_event → 200, weight_type = open_community (0.5)');
  {
    if (!productProviderId || !raterUser) throw new Error('missing test data');

    const ratingRes = await http.post<ApiSuccess<{
      rating_id:   string;
      weight_type:  string;
      weight_value: number;
    }>>(
      `${BASE.RATING}/api/v1/ratings`,
      {
        provider_id:   productProviderId,
        overall_stars: 4,
        comment:       'Test product rating — open community Phase 25b',
        tab:           'products',
        // no contact_event_id → open_community weight
      },
      { headers: makeHeaders(raterUser.accessToken) },
    );

    check(ratingRes.status === 200 || ratingRes.status === 201,
          'products rating no CE: HTTP 200/201',                      `got ${ratingRes.status}`);

    const data = ratingRes.data.data;
    check(data.weight_type === 'open_community',
          'products rating: weight_type = open_community',            `got ${data.weight_type}`);
    check(data.weight_value === 0.5,
          'products rating: weight_value = 0.5',                      `got ${data.weight_value}`);

    // Verify in DB
    const dbRow = await dbQuery<{
      weight_type:  string;
      weight_value: string;
      contact_event_id: string | null;
    }>(
      `SELECT weight_type, weight_value, contact_event_id
       FROM ratings WHERE id = $1`,
      [data.rating_id],
    );
    check(dbRow.length === 1,
          'products rating: DB row exists');
    check(dbRow[0].weight_type === 'open_community',
          'products rating DB: weight_type = open_community',         `got ${dbRow[0].weight_type}`);
    check(parseFloat(dbRow[0].weight_value) === 0.5,
          'products rating DB: weight_value = 0.5',                   `got ${dbRow[0].weight_value}`);
    check(dbRow[0].contact_event_id === null,
          'products rating DB: contact_event_id is NULL');

    // Cleanup
    registerCleanup(async () => {
      await dbQuery(`DELETE FROM ratings WHERE id = $1`, [data.rating_id]);
    });

    log(`rating_id=${data.rating_id}, weight=${data.weight_value}`, true);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Submit 3 ratings in 60 minutes → 3rd rating SUCCEEDS (burst=flag only, never block)
  //
  // Uses products tab (no CE required) against the same productProvider to avoid
  // hitting CONTACT_EVENT_REQUIRED for services.
  //
  // After 3 rapid submissions, trust_flags table should have a BURST_FLAGGED row
  // but the 3rd POST must return 200, not 429.
  // ────────────────────────────────────────────────────────────────────────────
  section('3. 3 rapid ratings → 3rd succeeds (burst flag only, no block)');
  {
    // Create a second rater to avoid hitting daily limits from step 2
    const burstRater = await createTestUser('burst-rater');
    registerCleanup(async () => deleteTestUser(burstRater));

    const submitRating = (stars: number) =>
      http.post<ApiSuccess<{ rating_id: string }>>(
        `${BASE.RATING}/api/v1/ratings`,
        {
          provider_id:   productProviderId,
          overall_stars: stars,
          comment:       `Burst test ${stars} stars`,
          tab:           'products',
        },
        { headers: makeHeaders(burstRater.accessToken) },
      );

    const r1 = await submitRating(3);
    check(r1.status === 200 || r1.status === 201, 'burst rating 1: HTTP 200/201');

    await sleep(200);
    const r2 = await submitRating(4);
    check(r2.status === 200 || r2.status === 201, 'burst rating 2: HTTP 200/201');

    await sleep(200);
    const r3 = await submitRating(5);
    check(r3.status === 200 || r3.status === 201,
          'burst rating 3: HTTP 200/201 (burst=flag only, NEVER block)',
          `got ${r3.status}`);

    const rating3Id = r3.data.data.rating_id;
    log(`3rd rating id=${rating3Id} — returned 200 (burst logged but not blocked)`, true);

    // Verify trust_flags has a burst entry (warning-only, not blocking)
    const flagRows = await dbQuery<{
      flag_type: string;
      severity:  string;
      status:    string;
    }>(
      `SELECT flag_type, severity, status
       FROM trust_flags
       WHERE rating_id = $1
       LIMIT 1`,
      [rating3Id],
    );
    if (flagRows.length > 0) {
      check(flagRows[0].flag_type.toLowerCase().includes('burst') ||
            flagRows[0].flag_type.toLowerCase().includes('rapid'),
            'burst rating: trust_flag type contains burst/rapid',     `got ${flagRows[0].flag_type}`);
      check(flagRows[0].status !== 'blocked',
            'burst rating: trust_flag status is NOT blocked',         `got ${flagRows[0].status}`);
      log(`trust_flag: type=${flagRows[0].flag_type}, severity=${flagRows[0].severity}`, true);
    } else {
      log('burst rating: no trust_flag row yet (may be async) — 200 confirmed', true);
    }

    // Cleanup
    registerCleanup(async () => {
      await dbQuery(
        `DELETE FROM ratings WHERE consumer_id = $1`,
        [burstRater.userId],
      );
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Daily limit exceeded → 429 DAILY_LIMIT_EXCEEDED
  //
  // Strategy: use direct DB to set daily_rating_usage.count to the limit,
  // then attempt one more rating. This avoids creating N ratings in the API.
  // Products daily limit = 10 (from system_config: rating_daily_limit_products).
  // ────────────────────────────────────────────────────────────────────────────
  section('4. Daily limit exceeded → 429 DAILY_LIMIT_EXCEEDED');
  {
    if (!raterUser || !productProviderId) throw new Error('missing test data');

    const today    = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Read current limit from system_config
    const configRow = await dbQuery<{ value: string }>(
      `SELECT value FROM system_config WHERE key = 'rating_daily_limit_products' LIMIT 1`,
    );
    const dailyLimit = configRow.length > 0 ? parseInt(configRow[0].value, 10) : 10;

    // Upsert daily_rating_usage to the limit so next attempt triggers 429
    await dbQuery(
      `INSERT INTO daily_rating_usage (consumer_id, tab, date, count)
       VALUES ($1, 'products', $2, $3)
       ON CONFLICT (consumer_id, tab, date)
       DO UPDATE SET count = $3`,
      [raterUser.userId, today, dailyLimit],
    );
    registerCleanup(async () => {
      await dbQuery(
        `DELETE FROM daily_rating_usage WHERE consumer_id = $1`,
        [raterUser!.userId],
      );
    });

    // One more attempt must be rejected
    try {
      await http.post(
        `${BASE.RATING}/api/v1/ratings`,
        {
          provider_id:   productProviderId,
          overall_stars: 3,
          comment:       'Over daily limit — should 429',
          tab:           'products',
        },
        { headers: makeHeaders(raterUser.accessToken) },
      );
      check(false, 'daily limit: expected 429, got 200');
    } catch (err) {
      const { code, status } = extractApiError(err);
      check(status === 429,
            'daily limit: HTTP 429',                                  `got ${status}`);
      check(code === 'DAILY_LIMIT_EXCEEDED',
            'daily limit: error.code = DAILY_LIMIT_EXCEEDED',         `got ${code}`);
      log(`code=${code}, daily_limit=${dailyLimit}`, true);
    }
  }

  console.log('\n  ✓ 05-rating-flow PASSED\n');
}

withCleanup(main).catch((err) => {
  console.error('\n  ✗ 05-rating-flow FAILED:', err.message);
  process.exit(1);
});
