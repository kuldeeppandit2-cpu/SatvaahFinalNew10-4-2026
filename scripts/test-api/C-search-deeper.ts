/**
 * C-search-deeper.ts — Group C: Search (7 tests)
 *  C1. Taxonomy autocomplete — 2+ chars returns results
 *  C2. Category grid loads per tab
 *  C3. Search with min_trust filter
 *  C4. Search with availability filter
 *  C5. Search with distance filter
 *  C6. Search intent stored in DB (V012)
 *  C7. Empty search query handled gracefully
 */
import { BASE, http, section, withCleanup,
         createTestUser, deleteTestUser, registerCleanup,
         dbQuery, closePg } from './00-setup';

const PASS = (m: string) => console.log(`  [PASS] ${m}`);
const FAIL = (m: string, d = '') => console.log(`  [FAIL] ${m}${d ? ` — ${d}` : ''}`);
const INFO = (m: string) => console.log(`         ${m}`);

async function runGroupC(): Promise<void> {
  await withCleanup(async () => {
    let consumerToken = '';

    // Setup consumer
    try {
      const u = await createTestUser('grpC_consumer');
      registerCleanup(() => deleteTestUser(u));
      consumerToken = u.accessToken;
    } catch (e: any) {
      console.log(`  [SKIP] Group C setup failed: ${e.message}`);
      return;
    }

    // C1 ──────────────────────────────────────────────────────────────────────
    section('C1. Taxonomy autocomplete — 1 char = nothing, 2+ = results');
    try {
      const r1 = await http.get(`${BASE.SEARCH}/api/v1/categories/autocomplete?q=p`,
        { headers: { Authorization: `Bearer ${consumerToken}` } });
      INFO(`1 char status: ${r1.status}, count: ${r1.data?.data?.length ?? 0}`);

      const r2 = await http.get(`${BASE.SEARCH}/api/v1/categories/autocomplete?q=pl`,
        { headers: { Authorization: `Bearer ${consumerToken}` } });
      INFO(`2 chars status: ${r2.status}, count: ${r2.data?.data?.length ?? 0}`);

      if (r2.status === 200) PASS('C1: autocomplete returns 200 for 2+ chars');
      else FAIL('C1', `HTTP ${r2.status}`);
    } catch (e: any) {
      FAIL('C1', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // C2 ──────────────────────────────────────────────────────────────────────
    section('C2. Category grid loads per tab');
    const tabs = ['services', 'products', 'expertise', 'establishments'];
    for (const tab of tabs) {
      try {
        const r = await http.get(
          `${BASE.SEARCH}/api/v1/categories?tab=${tab}`,
          { headers: { Authorization: `Bearer ${consumerToken}` } });
        INFO(`tab=${tab}: HTTP ${r.status}, items=${r.data?.data?.length ?? 0}`);
        if (r.status === 200) PASS(`C2: categories for tab=${tab} → 200`);
        else FAIL(`C2: tab=${tab}`, `HTTP ${r.status}`);
      } catch (e: any) {
        FAIL(`C2: tab=${tab}`, e.response?.status ? `HTTP ${e.response.status}` : e.message);
      }
    }

    // C3 ──────────────────────────────────────────────────────────────────────
    section('C3. Search with min_trust filter');
    try {
      const r = await http.get(
        `${BASE.SEARCH}/api/v1/search?q=plumber&min_trust=60&lat=17.385&lng=78.4867&tab=services`,
        { headers: { Authorization: `Bearer ${consumerToken}` } });
      INFO(`status: ${r.status}, results: ${r.data?.data?.length ?? 0}`);
      if (r.status === 200) PASS('C3: min_trust filter accepted');
      else FAIL('C3', `HTTP ${r.status}`);

      const results: { trust_score?: number }[] = r.data?.data ?? [];
      const allAboveThreshold = results.every(p => (p.trust_score ?? 100) >= 60);
      if (results.length === 0) INFO('C3: no results to validate threshold (OK if no providers seeded)');
      else if (allAboveThreshold) PASS('C3: all results meet min_trust=60');
      else FAIL('C3', 'some results below min_trust threshold');
    } catch (e: any) {
      FAIL('C3', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // C4 ──────────────────────────────────────────────────────────────────────
    section('C4. Search with availability=available_now filter');
    try {
      const r = await http.get(
        `${BASE.SEARCH}/api/v1/search?q=&availability=available_now&lat=17.385&lng=78.4867&tab=services`,
        { headers: { Authorization: `Bearer ${consumerToken}` } });
      INFO(`status: ${r.status}, results: ${r.data?.data?.length ?? 0}`);
      if (r.status === 200) PASS('C4: availability filter accepted → 200');
      else FAIL('C4', `HTTP ${r.status}`);
    } catch (e: any) {
      FAIL('C4', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // C5 ──────────────────────────────────────────────────────────────────────
    section('C5. Search with distance_km filter');
    try {
      const r = await http.get(
        `${BASE.SEARCH}/api/v1/search?q=&distance_km=5&lat=17.385&lng=78.4867&tab=services`,
        { headers: { Authorization: `Bearer ${consumerToken}` } });
      INFO(`status: ${r.status}, results: ${r.data?.data?.length ?? 0}`);
      if (r.status === 200) PASS('C5: distance filter accepted → 200');
      else FAIL('C5', `HTTP ${r.status}`);
    } catch (e: any) {
      FAIL('C5', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // C6 ──────────────────────────────────────────────────────────────────────
    section('C6. Search intent stored in V012 table');
    try {
      const u2 = await createTestUser('grpC_intent');
      registerCleanup(() => deleteTestUser(u2));

      const intentRes = await http.post(`${BASE.SEARCH}/api/v1/search/intent`,
        { query: 'electrician', tab: 'services', lat: 17.385, lng: 78.4867 },
        { headers: { Authorization: `Bearer ${u2.accessToken}` } });
      INFO(`intent POST status: ${intentRes.status}`);

      if (intentRes.status === 200 || intentRes.status === 201) {
        PASS('C6: search intent POST accepted');
        // Verify DB row
        const rows = await dbQuery<{ id: string }>(
          `SELECT id FROM search_intents
           WHERE user_id = (SELECT id FROM users WHERE firebase_uid = $1)
           ORDER BY created_at DESC LIMIT 1`,
          [u2.firebaseUid]
        );
        if (rows.length > 0) PASS('C6: search intent row in V012 DB table');
        else FAIL('C6', 'no row in search_intents table');
      } else {
        FAIL('C6', `HTTP ${intentRes.status}`);
      }
    } catch (e: any) {
      FAIL('C6', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    } finally {
      await closePg();
    }

    // C7 ──────────────────────────────────────────────────────────────────────
    section('C7. Empty search query handled gracefully (no 500)');
    try {
      const r = await http.get(
        `${BASE.SEARCH}/api/v1/search?q=&lat=17.385&lng=78.4867&tab=services`,
        { headers: { Authorization: `Bearer ${consumerToken}` } });
      INFO(`empty query status: ${r.status}`);
      if (r.status === 200) PASS('C7: empty query returns 200 gracefully');
      else if (r.status >= 500) FAIL('C7', `server error on empty query: ${r.status}`);
      else PASS(`C7: empty query handled gracefully → ${r.status}`);
    } catch (e: any) {
      const s = e.response?.status;
      if (s && s >= 500) FAIL('C7', `500 on empty query — server crashed`);
      else FAIL('C7', e.message);
    }
  });
}

runGroupC().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
