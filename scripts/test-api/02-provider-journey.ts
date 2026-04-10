/**
 * 02-provider-journey.ts — Provider Journey Integration Tests
 *
 * Services under test:
 *   services/user  (port 3002) — provider registration, geo verify, Aadhaar mock
 *   services/trust (port 3004) — trust score, trust tiers, trust history
 *
 * Trust tier thresholds (from MASTER_CONTEXT + system_config):
 *   0–19:  unverified
 *  20–59:  basic        (trust_tier_basic_threshold = 20 — NOT 40)
 *  60–79:  trusted      (trust_tier_trusted_threshold = 60)
 *  80–100: highly_trusted
 *
 * trust_score_history is IMMUTABLE: rows are INSERT-only, never updated.
 */

import {
  BASE, TestUser, ApiSuccess,
  http, makeHeaders, check, section, log,
  createTestUser, deleteTestUser,
  registerCleanup, withCleanup, ensureHyderabadCity,
  dbQuery,
} from './00-setup';

// Hyderabad lat/lng (PostGIS: ST_MakePoint(lng, lat))
const HYD_LAT =  17.3850;
const HYD_LNG =  78.4867;

async function main(): Promise<void> {
  console.log('\n══════════════════════════════════════════');
  console.log(' 02 — Provider Journey');
  console.log('══════════════════════════════════════════');

  const hyderabadId = await ensureHyderabadCity();

  // ── Test data ────────────────────────────────────────────────────────────────
  let providerUser: TestUser | undefined;
  let providerId:   string | undefined;

  registerCleanup(async () => {
    if (providerUser) await deleteTestUser(providerUser);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Step 1: Register provider — city=Hyderabad, category=plumber
  // ────────────────────────────────────────────────────────────────────────────
  section('1. Register provider (Hyderabad / plumber)');
  {
    providerUser = await createTestUser('provider');
    log(`Firebase user created: ${providerUser.firebaseUid}`, true);

    // Switch mode to provider
    await http.patch(
      `${BASE.USER}/api/v1/users/me/mode`,
      { mode: 'provider' },
      { headers: makeHeaders(providerUser.accessToken) },
    );

    const res = await http.post<ApiSuccess<{
      provider_id: string;
      trust_tier:  string;
    }>>(
      `${BASE.USER}/api/v1/providers/register`,
      {
        display_name:  'Test Plumber Hyderabad',
        listing_type:  'individual_service',
        city_id:       hyderabadId,
        category_slug: 'plumber',           // taxonomy node slug
        bio:           'Test bio — Phase 25b',
      },
      { headers: makeHeaders(providerUser.accessToken) },
    );

    check(res.status === 200 || res.status === 201,
          'provider register: HTTP 200/201',                          `got ${res.status}`);
    check(typeof res.data.data.provider_id === 'string',
          'provider register: provider_id returned');

    providerId = res.data.data.provider_id;
    log(`provider_id=${providerId}`, true);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 2: GET /api/v1/trust/:id — new account → unverified (score < 20)
  // ────────────────────────────────────────────────────────────────────────────
  section('2. New provider trust: score >= 0, tier = unverified');
  {
    if (!providerId) throw new Error('providerId missing');

    const res = await http.get<ApiSuccess<{
      trust_score:  number;
      trust_tier:   string;
      display_score: number;
    }>>(
      `${BASE.TRUST}/api/v1/trust/${providerId}`,
      { headers: makeHeaders(providerUser!.accessToken) },
    );

    check(res.status === 200,
          'trust GET: HTTP 200',                                      `got ${res.status}`);
    check(res.data.success === true,
          'trust GET: response.success = true');

    const score = res.data.data.display_score ?? res.data.data.trust_score;
    const tier  = res.data.data.trust_tier;

    check(score >= 0,
          'new provider: trust_score >= 0',                          `got ${score}`);
    check(score < 20,
          'new provider: trust_score < 20 (unverified threshold)',   `got ${score}`);
    check(tier === 'unverified',
          'new provider: trust_tier = unverified',                   `got ${tier}`);

    log(`score=${score}, tier=${tier}`, true);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 3: Add geo_point → trust_score >= 20, tier = basic
  // ────────────────────────────────────────────────────────────────────────────
  section('3. Geo-verify → trust_score >= 20, tier = basic');
  {
    if (!providerId || !providerUser) throw new Error('missing test data');

    // POST geo verification — sends provider location
    const geoRes = await http.post(
      `${BASE.USER}/api/v1/providers/me/verify/geo`,
      {
        lat: HYD_LAT,
        lng: HYD_LNG,
      },
      { headers: makeHeaders(providerUser.accessToken) },
    );
    check(geoRes.status === 200 || geoRes.status === 201,
          'geo verify: HTTP 200/201',                                 `got ${geoRes.status}`);

    // Trust recalculation may be synchronous or async via SQS→Lambda.
    // Poll up to 5 s for the score to update.
    const trustRes = await (async () => {
      let attempts = 0;
      while (attempts < 10) {
        const r = await http.get<ApiSuccess<{
          trust_score:   number;
          display_score: number;
          trust_tier:    string;
        }>>(
          `${BASE.TRUST}/api/v1/trust/${providerId}`,
          { headers: makeHeaders(providerUser!.accessToken) },
        );
        const s = r.data.data.display_score ?? r.data.data.trust_score;
        if (s >= 20) return r;
        await new Promise((res) => setTimeout(res, 500));
        attempts++;
      }
      return http.get<ApiSuccess<{
        trust_score:   number;
        display_score: number;
        trust_tier:    string;
      }>>(
        `${BASE.TRUST}/api/v1/trust/${providerId}`,
        { headers: makeHeaders(providerUser!.accessToken) },
      );
    })();

    const score = trustRes.data.data.display_score ?? trustRes.data.data.trust_score;
    const tier  = trustRes.data.data.trust_tier;

    check(score >= 20,
          'post-geo: trust_score >= 20 (basic threshold)',            `got ${score}`);
    check(tier === 'basic',
          'post-geo: trust_tier = basic',                             `got ${tier}`);

    // Verify trust_tier_basic_threshold from system_config is indeed 20
    const configRows = await dbQuery<{ value: string }>(
      `SELECT value FROM system_config WHERE key = 'trust_tier_basic_threshold' LIMIT 1`,
    );
    if (configRows.length > 0) {
      check(parseInt(configRows[0].value, 10) === 20,
            'system_config: trust_tier_basic_threshold = 20',         `got ${configRows[0].value}`);
    } else {
      log('system_config: trust_tier_basic_threshold not in DB (may not be seeded yet)', false,
          'ensure V031 seed is run');
    }

    log(`score=${score}, tier=${tier}`, true);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 4: Verify trust_score_history is INSERT-only (no updated_at changed)
  // ────────────────────────────────────────────────────────────────────────────
  section('4. trust_score_history: all rows INSERT-only (immutable)');
  {
    if (!providerId) throw new Error('providerId missing');

    // Fetch all history rows for this provider
    const historyRes = await http.get<ApiSuccess<Array<{
      id:                string;
      event_type:        string;
      delta_pts:         number;
      new_display_score: number;
      new_tier:          string;
      event_at:          string;
    }>>>(
      `${BASE.TRUST}/api/v1/trust/${providerId}/history`,
      { headers: makeHeaders(providerUser!.accessToken) },
    );

    check(historyRes.status === 200,
          'trust history GET: HTTP 200',                              `got ${historyRes.status}`);
    const rows = historyRes.data.data;
    check(Array.isArray(rows) && rows.length > 0,
          'trust history: at least one row exists',                   `got ${rows.length} rows`);

    // DB-level immutability: no row should have an updated_at different from event_at.
    // trust_score_history has no updated_at column by design — confirm via pg.
    const dbRows = await dbQuery<{
      id:       string;
      event_at: Date;
    }>(
      `SELECT id, event_at FROM trust_score_history
       WHERE provider_id = $1
       ORDER BY event_at ASC`,
      [providerId],
    );

    check(dbRows.length > 0,
          'trust history DB: rows found for provider',                `got ${dbRows.length}`);

    // Confirm the table has no updated_at column (immutability by schema design)
    const colCheck = await dbQuery<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'trust_score_history'
         AND column_name = 'updated_at'`,
    );
    check(colCheck.length === 0,
          'trust_score_history: NO updated_at column (INSERT-only schema)');

    log(`${dbRows.length} history row(s), schema is INSERT-only`, true);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 5: Aadhaar mock verify → trust_score >= 60, tier = trusted
  //
  // In test environments the Aadhaar/DigiLocker OAuth flow is simulated via
  //   POST /api/v1/providers/me/verify/aadhaar/mock
  // This endpoint exists ONLY in non-production environments (guarded by NODE_ENV).
  // Skip gracefully in CI if the endpoint is absent (404/403).
  // ────────────────────────────────────────────────────────────────────────────
  section('5. Aadhaar mock verify → trust_score >= 60, tier = trusted');
  {
    if (!providerId || !providerUser) throw new Error('missing test data');

    let aadhaarVerified = false;
    try {
      const mockRes = await http.post(
        `${BASE.USER}/api/v1/providers/me/verify/aadhaar/mock`,
        {
          // Mock DigiLocker callback payload — UID is never stored (CRITICAL RULE #1)
          // Only the bcrypt(digilocker_uid + salt) is stored.
          digilocker_uid: `TEST_DL_${Date.now()}`,
          verified:       true,
        },
        { headers: makeHeaders(providerUser.accessToken) },
      );
      aadhaarVerified = mockRes.status === 200 || mockRes.status === 201;
    } catch (err: unknown) {
      const e = err as { response?: { status: number } };
      if (e.response?.status === 404 || e.response?.status === 403) {
        log('Aadhaar mock endpoint not available (test-env only) — skipping step 5',
            true, 'expected in non-test environments');
        return; // still PASS, just no Aadhaar check
      }
      throw err;
    }

    check(aadhaarVerified, 'Aadhaar mock: HTTP 200/201');

    // Poll up to 8 s for Lambda to process trust recalculation
    const trustAfterAadhaar = await (async () => {
      let attempts = 0;
      while (attempts < 16) {
        const r = await http.get<ApiSuccess<{
          display_score: number;
          trust_score:   number;
          trust_tier:    string;
        }>>(
          `${BASE.TRUST}/api/v1/trust/${providerId}`,
          { headers: makeHeaders(providerUser!.accessToken) },
        );
        const s = r.data.data.display_score ?? r.data.data.trust_score;
        if (s >= 60) return r;
        await new Promise((resolve) => setTimeout(resolve, 500));
        attempts++;
      }
      return http.get<ApiSuccess<{
        display_score: number;
        trust_score:   number;
        trust_tier:    string;
      }>>(
        `${BASE.TRUST}/api/v1/trust/${providerId}`,
        { headers: makeHeaders(providerUser!.accessToken) },
      );
    })();

    const score = trustAfterAadhaar.data.data.display_score
                ?? trustAfterAadhaar.data.data.trust_score;
    const tier  = trustAfterAadhaar.data.data.trust_tier;

    check(score >= 60,
          'post-Aadhaar: trust_score >= 60 (trusted threshold)',      `got ${score}`);
    check(tier === 'trusted',
          'post-Aadhaar: trust_tier = trusted',                       `got ${tier}`);

    // trust_score_history must have grown (new row, existing unchanged)
    const histRows = await dbQuery<{ id: string }>(
      `SELECT id FROM trust_score_history WHERE provider_id = $1`,
      [providerId],
    );
    check(histRows.length >= 2,
          'trust history: at least 2 rows after geo + Aadhaar',       `got ${histRows.length}`);

    log(`score=${score}, tier=${tier}, history_rows=${histRows.length}`, true);
  }

  console.log('\n  ✓ 02-provider-journey PASSED\n');
}

withCleanup(main).catch((err) => {
  console.error('\n  ✗ 02-provider-journey FAILED:', err.message);
  process.exit(1);
});
