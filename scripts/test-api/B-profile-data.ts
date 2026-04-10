/**
 * B-profile-data.ts — Group B: Profile & User Data (6 tests)
 *  B1. Consumer profile create + update
 *  B2. Provider profile update after onboarding
 *  B3. Consumer trust score starts at 75 (V005 default)
 *  B4. Switch mode consumer→provider and back
 *  B5. City list endpoint returns results
 *  B6. Provider public profile visible without auth
 */
import { BASE, http, section, withCleanup,
         createTestUser, deleteTestUser, registerCleanup,
         dbQuery, closePg } from './00-setup';

const PASS = (m: string) => console.log(`  [PASS] ${m}`);
const FAIL = (m: string, d = '') => console.log(`  [FAIL] ${m}${d ? ` — ${d}` : ''}`);
const INFO = (m: string) => console.log(`         ${m}`);

async function runGroupB(): Promise<void> {
  await withCleanup(async () => {
    // B1 ──────────────────────────────────────────────────────────────────────
    section('B1. Consumer profile create + update');
    try {
      const u = await createTestUser('grpB_consumer');
      registerCleanup(() => deleteTestUser(u));

      // Switch to consumer mode first
      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'consumer' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });

      // Create consumer profile
      const createRes = await http.post(`${BASE.USER}/api/v1/consumers/profile`,
        { display_name: 'Test Consumer B1', city_id: null },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });
      INFO(`create status: ${createRes.status}`);
      if (createRes.status === 200 || createRes.status === 201)
        PASS('B1: consumer profile created');
      else
        FAIL('B1: consumer profile create', `HTTP ${createRes.status}`);

      // Update consumer profile
      const updateRes = await http.patch(`${BASE.USER}/api/v1/consumers/me`,
        { display_name: 'Updated Consumer B1' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });
      INFO(`update status: ${updateRes.status}`);
      if (updateRes.status === 200)
        PASS('B1: consumer profile updated');
      else
        FAIL('B1: consumer profile update', `HTTP ${updateRes.status}`);
    } catch (e: any) {
      FAIL('B1', e.response?.status
        ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`
        : e.message);
    }

    // B2 ──────────────────────────────────────────────────────────────────────
    section('B2. Provider profile update after onboarding');
    try {
      const u = await createTestUser('grpB_provider');
      registerCleanup(() => deleteTestUser(u));

      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'provider' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });

      // Register as provider first
      const regRes = await http.post(`${BASE.USER}/api/v1/providers/register`, {
        display_name: 'Provider B2',
        listing_type: 'individual_service',
        category_id: null,
        city_id: null,
      }, { headers: { Authorization: `Bearer ${u.accessToken}` } });
      INFO(`register status: ${regRes.status}`);

      if (regRes.status === 200 || regRes.status === 201) {
        // Now update profile
        const upd = await http.patch(`${BASE.USER}/api/v1/providers/me`,
          { bio: 'Updated bio for B2 test', famous_for: 'Testing' },
          { headers: { Authorization: `Bearer ${u.accessToken}` } });
        if (upd.status === 200) PASS('B2: provider profile updated');
        else FAIL('B2: provider update', `HTTP ${upd.status}`);
      } else {
        FAIL('B2: provider register prerequisite', `HTTP ${regRes.status}`);
      }
    } catch (e: any) {
      FAIL('B2', e.response?.status
        ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`
        : e.message);
    }

    // B3 ──────────────────────────────────────────────────────────────────────
    section('B3. Consumer trust score starts at 75 (V005 default)');
    try {
      const u = await createTestUser('grpB_trust');
      registerCleanup(() => deleteTestUser(u));

      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'consumer' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });

      await http.post(`${BASE.USER}/api/v1/consumers/profile`,
        { display_name: 'Trust Test B3' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });

      // Check trust score via DB
      const rows = await dbQuery<{ display_score: number }>(
        `SELECT ts.display_score
         FROM users u
         JOIN trust_scores ts ON ts.user_id = u.id
         WHERE u.firebase_uid = $1`,
        [u.firebaseUid]
      );
      INFO(`DB trust score rows: ${rows.length}`);
      if (rows.length > 0) {
        const score = rows[0].display_score;
        INFO(`trust score = ${score}`);
        if (score === 75) PASS('B3: consumer trust starts at 75');
        else FAIL('B3', `expected 75, got ${score}`);
      } else {
        // Try via API
        const r = await http.get(`${BASE.TRUST}/api/v1/trust/me`,
          { headers: { Authorization: `Bearer ${u.accessToken}` } });
        INFO(`trust API score: ${r.data?.data?.display_score}`);
        if (r.data?.data?.display_score === 75)
          PASS('B3: consumer trust starts at 75 (via API)');
        else
          FAIL('B3', `no trust row found and API returned ${r.data?.data?.display_score}`);
      }
    } catch (e: any) {
      FAIL('B3', e.response?.status
        ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`
        : e.message);
    } finally {
      await closePg();
    }

    // B4 ──────────────────────────────────────────────────────────────────────
    section('B4. Switch mode consumer→provider and back');
    try {
      const u = await createTestUser('grpB_mode');
      registerCleanup(() => deleteTestUser(u));

      const toProvider = await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'provider' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });
      INFO(`→ provider: HTTP ${toProvider.status}`);
      if (toProvider.status === 200) PASS('B4: switched to provider mode');
      else FAIL('B4: switch to provider', `HTTP ${toProvider.status}`);

      const toConsumer = await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'consumer' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });
      INFO(`→ consumer: HTTP ${toConsumer.status}`);
      if (toConsumer.status === 200) PASS('B4: switched back to consumer mode');
      else FAIL('B4: switch back to consumer', `HTTP ${toConsumer.status}`);
    } catch (e: any) {
      FAIL('B4', e.response?.status
        ? `HTTP ${e.response.status}`
        : e.message);
    }

    // B5 ──────────────────────────────────────────────────────────────────────
    section('B5. City list endpoint returns results');
    try {
      const r = await http.get(`${BASE.USER}/api/v1/cities?active=true`);
      INFO(`status: ${r.status}, count: ${r.data?.data?.length ?? 0}`);
      if (r.status === 200) PASS('B5: city list returns 200');
      else FAIL('B5', `HTTP ${r.status}`);

      const cities: { name: string }[] = r.data?.data ?? [];
      if (cities.length > 0) PASS(`B5: ${cities.length} cities returned`);
      else FAIL('B5', 'empty city list — no cities seeded');

      const hasHyd = cities.some((c: { name: string }) =>
        c.name?.toLowerCase().includes('hyderabad'));
      if (hasHyd) PASS('B5: Hyderabad present in list');
      else FAIL('B5', 'Hyderabad not in city list');
    } catch (e: any) {
      FAIL('B5', e.response?.status
        ? `HTTP ${e.response.status}`
        : e.message);
    }

    // B6 ──────────────────────────────────────────────────────────────────────
    section('B6. Provider public profile visible without auth');
    try {
      const u = await createTestUser('grpB_pub');
      registerCleanup(() => deleteTestUser(u));

      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'provider' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });

      const reg = await http.post(`${BASE.USER}/api/v1/providers/register`, {
        display_name: 'Public Provider B6',
        listing_type: 'individual_service',
        category_id: null,
        city_id: null,
      }, { headers: { Authorization: `Bearer ${u.accessToken}` } });

      const providerId = reg.data?.data?.id ?? reg.data?.data?.provider_id;
      INFO(`provider id: ${providerId}`);

      if (providerId) {
        // Access public profile WITHOUT auth header
        const pub = await http.get(`${BASE.USER}/api/v1/providers/${providerId}`);
        INFO(`public profile status: ${pub.status}`);
        if (pub.status === 200) PASS('B6: public provider profile accessible without auth');
        else FAIL('B6', `HTTP ${pub.status}`);
      } else {
        FAIL('B6', 'could not get provider ID from register response');
      }
    } catch (e: any) {
      FAIL('B6', e.response?.status
        ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`
        : e.message);
    }
  });
}

runGroupB().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
