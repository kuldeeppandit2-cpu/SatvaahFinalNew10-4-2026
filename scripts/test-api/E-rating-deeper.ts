/**
 * E-rating-deeper.ts — Group E: Rating (8 tests)
 *  E1. Verified rating WITH dimension scores
 *  E2. Verified rating WITH review text
 *  E3. Open community rating — Products tab works
 *  E4. Open community rating — Services tab → blocked
 *  E5. Provider rates consumer
 *  E6. Flag a rating
 *  E7. Rating weight 1.0 verified vs 0.5 open community
 *  E8. Skip rating 3x → expires
 */
import { BASE, http, section, withCleanup,
         createTestUser, deleteTestUser, registerCleanup,
         dbQuery, closePg } from './00-setup';

const PASS = (m: string) => console.log(`  [PASS] ${m}`);
const FAIL = (m: string, d = '') => console.log(`  [FAIL] ${m}${d ? ` — ${d}` : ''}`);
const INFO = (m: string) => console.log(`         ${m}`);

async function runGroupE(): Promise<void> {
  await withCleanup(async () => {
    let consumerToken = '';
    let providerToken = '';
    let providerFirebaseUid = '';
    let providerId = '';
    let contactEventId = '';

    try {
      const consumer = await createTestUser('grpE_consumer');
      const provider = await createTestUser('grpE_provider');
      registerCleanup(() => deleteTestUser(consumer));
      registerCleanup(() => deleteTestUser(provider));
      consumerToken = consumer.accessToken;
      providerToken = provider.accessToken;
      providerFirebaseUid = provider.firebaseUid;

      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'provider' },
        { headers: { Authorization: `Bearer ${providerToken}` } });
      const reg = await http.post(`${BASE.USER}/api/v1/providers/register`,
        { display_name: 'Provider E', listing_type: 'individual_service',
          category_id: null, city_id: null },
        { headers: { Authorization: `Bearer ${providerToken}` } });
      providerId = reg.data?.data?.id ?? reg.data?.data?.provider_id;

      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'consumer' },
        { headers: { Authorization: `Bearer ${consumerToken}` } });
      await http.post(`${BASE.USER}/api/v1/consumers/profile`,
        { display_name: 'Consumer E' },
        { headers: { Authorization: `Bearer ${consumerToken}` } });

      // Create contact event and accept lead
      const evRes = await http.post(`${BASE.USER}/api/v1/contact-events`,
        { provider_id: providerId, contact_type: 'call' },
        { headers: { Authorization: `Bearer ${consumerToken}` } });
      contactEventId = evRes.data?.data?.id ?? evRes.data?.data?.contact_event_id;
      INFO(`setup: provider=${providerId}, contact_event=${contactEventId}`);
    } catch (e: any) {
      console.log(`  [SKIP] Group E setup failed: ${e.message}`);
      return;
    }

    // E1 ──────────────────────────────────────────────────────────────────────
    section('E1. Verified rating with dimension scores');
    try {
      const r = await http.post(`${BASE.RATING}/api/v1/ratings`, {
        contact_event_id: contactEventId,
        overall_score: 4,
        dimension_scores: { punctuality: 4, quality: 5, value: 3 },
      }, { headers: { Authorization: `Bearer ${consumerToken}` } });
      INFO(`status: ${r.status}`);
      if (r.status === 200 || r.status === 201)
        PASS('E1: verified rating with dimensions accepted');
      else
        FAIL('E1', `HTTP ${r.status}: ${JSON.stringify(r.data)}`);
    } catch (e: any) {
      FAIL('E1', e.response?.status ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}` : e.message);
    }

    // E2 ──────────────────────────────────────────────────────────────────────
    section('E2. Verified rating with review text (500 char limit)');
    try {
      const consumer2 = await createTestUser('grpE_consumer2');
      registerCleanup(() => deleteTestUser(consumer2));
      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'consumer' },
        { headers: { Authorization: `Bearer ${consumer2.accessToken}` } });
      const ev2 = await http.post(`${BASE.USER}/api/v1/contact-events`,
        { provider_id: providerId, contact_type: 'call' },
        { headers: { Authorization: `Bearer ${consumer2.accessToken}` } });
      const ev2Id = ev2.data?.data?.id ?? ev2.data?.data?.contact_event_id;

      const r = await http.post(`${BASE.RATING}/api/v1/ratings`, {
        contact_event_id: ev2Id,
        overall_score: 5,
        review_text: 'Excellent service. Very professional and on time.',
      }, { headers: { Authorization: `Bearer ${consumer2.accessToken}` } });
      INFO(`status: ${r.status}`);
      if (r.status === 200 || r.status === 201)
        PASS('E2: rating with review text accepted');
      else
        FAIL('E2', `HTTP ${r.status}`);
    } catch (e: any) {
      FAIL('E2', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // E3 ──────────────────────────────────────────────────────────────────────
    section('E3. Open community rating — Products tab works');
    try {
      const r = await http.post(`${BASE.RATING}/api/v1/ratings`, {
        provider_id: providerId,
        contact_event_id: null,
        overall_score: 4,
        tab: 'products',
      }, { headers: { Authorization: `Bearer ${consumerToken}` } });
      INFO(`status: ${r.status}`);
      if (r.status === 200 || r.status === 201)
        PASS('E3: open rating on products tab accepted');
      else
        FAIL('E3', `HTTP ${r.status}`);
    } catch (e: any) {
      FAIL('E3', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // E4 ──────────────────────────────────────────────────────────────────────
    section('E4. Open community rating — Services tab → blocked');
    try {
      const r = await http.post(`${BASE.RATING}/api/v1/ratings`, {
        provider_id: providerId,
        contact_event_id: null,
        overall_score: 3,
        tab: 'services',
      }, { headers: { Authorization: `Bearer ${consumerToken}` } });
      INFO(`status: ${r.status}`);
      if (r.status === 400 || r.status === 403 || r.status === 422)
        PASS(`E4: open rating on services tab blocked → ${r.status}`);
      else
        FAIL('E4', `expected 400/403/422, got ${r.status}`);
    } catch (e: any) {
      const s = e.response?.status;
      if (s === 400 || s === 403 || s === 422)
        PASS(`E4: open rating on services tab blocked → ${s}`);
      else
        FAIL('E4', `expected 400/403/422, got ${s ?? e.message}`);
    }

    // E5 ──────────────────────────────────────────────────────────────────────
    section('E5. Provider rates consumer');
    try {
      const r = await http.post(`${BASE.RATING}/api/v1/ratings/provider-rates-consumer`, {
        contact_event_id: contactEventId,
        overall_score: 5,
      }, { headers: { Authorization: `Bearer ${providerToken}` } });
      INFO(`status: ${r.status}`);
      if (r.status === 200 || r.status === 201)
        PASS('E5: provider rated consumer successfully');
      else
        FAIL('E5', `HTTP ${r.status}`);
    } catch (e: any) {
      FAIL('E5', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // E6 ──────────────────────────────────────────────────────────────────────
    section('E6. Flag a rating');
    try {
      const ratingRows = await dbQuery<{ id: string }>(
        `SELECT id FROM ratings WHERE provider_id = (
           SELECT id FROM provider_profiles
           WHERE user_id = (SELECT id FROM users WHERE firebase_uid = $1)
         ) LIMIT 1`,
        [/* providerFirebaseUid captured in E setup */ providerToken ? '' : '']
      );
      if (ratingRows.length > 0) {
        const ratingId = ratingRows[0].id;
        const r = await http.post(`${BASE.RATING}/api/v1/ratings/${ratingId}/flag`,
          { reason: 'spam' },
          { headers: { Authorization: `Bearer ${consumerToken}` } });
        INFO(`flag status: ${r.status}`);
        if (r.status === 200 || r.status === 201)
          PASS('E6: rating flagged successfully');
        else
          FAIL('E6', `HTTP ${r.status}`);
      } else {
        FAIL('E6', 'no rating found to flag');
      }
    } catch (e: any) {
      FAIL('E6', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    } finally {
      await closePg();
    }

    // E7 ──────────────────────────────────────────────────────────────────────
    section('E7. Rating weight — verified=1.0, open=0.5 in DB');
    try {
      const rows = await dbQuery<{ weight: number; contact_event_id: string | null }>(
        `SELECT weight, contact_event_id
         FROM ratings
         WHERE provider_id = (
           SELECT id FROM provider_profiles
           WHERE user_id = (SELECT id FROM users WHERE firebase_uid = $1)
         )
         ORDER BY created_at DESC LIMIT 5`,
        [/* providerFirebaseUid captured in E setup */ providerToken ? '' : '']
      );
      INFO(`rating rows found: ${rows.length}`);
      for (const row of rows) {
        const expected = row.contact_event_id ? 1.0 : 0.5;
        const ok = Math.abs(row.weight - expected) < 0.01;
        if (ok) PASS(`E7: weight=${row.weight} correct for ${row.contact_event_id ? 'verified' : 'open'}`);
        else FAIL('E7', `weight=${row.weight} expected=${expected}`);
      }
      if (rows.length === 0) FAIL('E7', 'no ratings in DB to check');
    } catch (e: any) {
      FAIL('E7', e.message);
    } finally {
      await closePg();
    }

    // E8 ──────────────────────────────────────────────────────────────────────
    section('E8. Skip rating 3x → expires (system_config rating_expiry_after_skips)');
    try {
      const consumer3 = await createTestUser('grpE_skip');
      registerCleanup(() => deleteTestUser(consumer3));
      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'consumer' },
        { headers: { Authorization: `Bearer ${consumer3.accessToken}` } });
      const ev3 = await http.post(`${BASE.USER}/api/v1/contact-events`,
        { provider_id: providerId, contact_type: 'call' },
        { headers: { Authorization: `Bearer ${consumer3.accessToken}` } });
      const ev3Id = ev3.data?.data?.id ?? ev3.data?.data?.contact_event_id;

      // Seed skip count to limit via DB
      await dbQuery(
        `INSERT INTO daily_rating_usage (consumer_id, contact_event_id, skip_count, date)
         VALUES (
           (SELECT id FROM users WHERE firebase_uid = $1),
           $2, 3, CURRENT_DATE
         )
         ON CONFLICT (consumer_id, date) DO UPDATE SET skip_count = 3`,
        [consumer3.firebaseUid, ev3Id]
      );

      // Now try to rate — should be expired/blocked
      const r = await http.post(`${BASE.RATING}/api/v1/ratings`, {
        contact_event_id: ev3Id,
        overall_score: 4,
      }, { headers: { Authorization: `Bearer ${consumer3.accessToken}` } });
      INFO(`after 3 skips, rate status: ${r.status}`);
      if (r.status === 400 || r.status === 403 || r.status === 410)
        PASS(`E8: rating expired after 3 skips → ${r.status}`);
      else
        FAIL('E8', `expected 400/403/410, got ${r.status}`);
    } catch (e: any) {
      const s = e.response?.status;
      if (s === 400 || s === 403 || s === 410)
        PASS(`E8: rating expired after 3 skips → ${s}`);
      else
        FAIL('E8', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    } finally {
      await closePg();
    }
  });
}

runGroupE().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
