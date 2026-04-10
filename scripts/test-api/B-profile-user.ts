/**
 * B-profile-user.ts — Group B: Profile & User Data
 *
 *  B1. Consumer profile creation + update
 *  B2. Provider profile update after onboarding
 *  B3. Consumer trust score starts at exactly 75
 *  B4. Switch mode consumer→provider and provider→consumer
 *  B5. City list returns Hyderabad + others
 *  B6. Provider public profile visible without auth
 *
 * Observation only — no code changes regardless of outcome.
 */
import {
  BASE, http, section, withCleanup,
  createTestUser, deleteTestUser, registerCleanup,
} from './00-setup';

const PASS = (msg: string) => console.log(`  [PASS] ${msg}`);
const FAIL = (msg: string, detail = '') => console.log(`  [FAIL] ${msg}${detail ? ` — ${detail}` : ''}`);
const INFO = (msg: string) => console.log(`         ${msg}`);

async function runGroupB(): Promise<void> {
  await withCleanup(async () => {

    // ── B1: Consumer profile create + update ─────────────────────────────────
    section('B1. Consumer profile creation + update');
    try {
      const u = await createTestUser('grpB_consumer');
      registerCleanup(() => deleteTestUser(u));

      // Create profile
      const create = await http.post(`${BASE.USER}/api/v1/consumers/profile`,
        { display_name: 'Test Consumer B1', preferred_language: 'en' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } }
      );
      INFO(`create status: ${create.status}`);
      PASS(`B1a: consumer profile created → ${create.status}`);

      // Update profile
      const update = await http.patch(`${BASE.USER}/api/v1/consumers/profile`,
        { display_name: 'Updated Consumer B1' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } }
      );
      INFO(`update status: ${update.status}`);
      if (update.status === 200) PASS('B1b: consumer profile updated → 200');
      else FAIL('B1b: consumer profile update', `got ${update.status}`);

    } catch (e: any) {
      const s = e.response?.status;
      FAIL('B1', `HTTP ${s ?? 'ECONNREFUSED'} — ${e.response?.data?.error?.code ?? e.message}`);
    }

    // ── B2: Provider profile update after onboarding ──────────────────────────
    section('B2. Provider profile update after onboarding');
    try {
      const u = await createTestUser('grpB_provider');
      registerCleanup(() => deleteTestUser(u));

      // Switch to provider mode first
      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'provider' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } }
      );

      // Register as provider
      const reg = await http.post(`${BASE.USER}/api/v1/providers/register`, {
        display_name: 'Test Provider B2',
        listing_type: 'individual_service',
        category_id: 'test-cat-001',
        city_id: 'hyderabad',
      }, { headers: { Authorization: `Bearer ${u.accessToken}` } });
      INFO(`register status: ${reg.status}`);

      // Update provider profile
      const update = await http.patch(`${BASE.USER}/api/v1/providers/me`,
        { bio: 'Updated bio for B2', years_experience: 5 },
        { headers: { Authorization: `Bearer ${u.accessToken}` } }
      );
      INFO(`update status: ${update.status}`);
      if (update.status === 200) PASS('B2: provider profile updated → 200');
      else FAIL('B2: provider profile update', `got ${update.status}`);

    } catch (e: any) {
      const s = e.response?.status;
      FAIL('B2', `HTTP ${s ?? 'ECONNREFUSED'} — ${e.response?.data?.error?.code ?? e.message}`);
    }

    // ── B3: Consumer trust score starts at 75 ────────────────────────────────
    section('B3. Consumer trust score starts at exactly 75 (V005 default)');
    try {
      const u = await createTestUser('grpB_trust75');
      registerCleanup(() => deleteTestUser(u));

      // Create consumer profile to trigger trust score initialisation
      await http.post(`${BASE.USER}/api/v1/consumers/profile`,
        { display_name: 'Trust Test B3' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } }
      );

      // Read trust score
      const trust = await http.get(`${BASE.TRUST}/api/v1/trust/me`,
        { headers: { Authorization: `Bearer ${u.accessToken}` } }
      );
      const score = trust.data?.data?.display_score ?? trust.data?.display_score;
      INFO(`consumer trust score: ${score}`);
      if (score === 75) PASS('B3: consumer trust score = 75 (correct default)');
      else FAIL('B3: consumer trust default score', `expected 75, got ${score}`);

    } catch (e: any) {
      const s = e.response?.status;
      FAIL('B3', `HTTP ${s ?? 'ECONNREFUSED'} — ${e.response?.data?.error?.code ?? e.message}`);
    }

    // ── B4: Switch mode consumer ↔ provider ──────────────────────────────────
    section('B4. Switch mode consumer → provider → consumer');
    try {
      const u = await createTestUser('grpB_modeswitch');
      registerCleanup(() => deleteTestUser(u));

      // Switch to provider
      const toProvider = await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'provider' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } }
      );
      INFO(`switch to provider: ${toProvider.status}`);
      if (toProvider.status === 200) PASS('B4a: switched to provider mode → 200');
      else FAIL('B4a: switch to provider', `got ${toProvider.status}`);

      // Switch back to consumer
      const toConsumer = await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'consumer' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } }
      );
      INFO(`switch to consumer: ${toConsumer.status}`);
      if (toConsumer.status === 200) PASS('B4b: switched back to consumer mode → 200');
      else FAIL('B4b: switch to consumer', `got ${toConsumer.status}`);

    } catch (e: any) {
      const s = e.response?.status;
      FAIL('B4', `HTTP ${s ?? 'ECONNREFUSED'} — ${e.response?.data?.error?.code ?? e.message}`);
    }

    // ── B5: City list returns Hyderabad ───────────────────────────────────────
    section('B5. City list returns Hyderabad + others');
    try {
      const r = await http.get(`${BASE.USER}/api/v1/cities?active=true`);
      const cities: Array<{ name: string; slug?: string }> =
        r.data?.data ?? r.data?.cities ?? r.data ?? [];
      INFO(`cities returned: ${cities.length}`);
      INFO(`first few: ${cities.slice(0, 3).map((c: any) => c.name || c.slug).join(', ')}`);

      const hasHyd = cities.some((c: any) =>
        (c.name ?? '').toLowerCase().includes('hyderabad') ||
        (c.slug ?? '').toLowerCase().includes('hyderabad')
      );
      if (cities.length > 0) PASS(`B5a: city list non-empty (${cities.length} cities)`);
      else FAIL('B5a: city list empty', 'expected at least one city');

      if (hasHyd) PASS('B5b: Hyderabad present in city list');
      else FAIL('B5b: Hyderabad not found in city list', `cities: ${cities.slice(0,5).map((c:any)=>c.name).join(', ')}`);

    } catch (e: any) {
      const s = e.response?.status;
      FAIL('B5', `HTTP ${s ?? 'ECONNREFUSED'} — ${e.message}`);
    }

    // ── B6: Provider public profile visible without auth ─────────────────────
    section('B6. Provider public profile accessible without auth');
    try {
      // First create and register a provider to get a provider_id
      const u = await createTestUser('grpB_pubprofile');
      registerCleanup(() => deleteTestUser(u));

      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'provider' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } }
      );

      const reg = await http.post(`${BASE.USER}/api/v1/providers/register`, {
        display_name: 'Public Profile B6',
        listing_type: 'individual_service',
        category_id: 'test-cat-001',
        city_id: 'hyderabad',
      }, { headers: { Authorization: `Bearer ${u.accessToken}` } });

      const providerId = reg.data?.data?.provider_id ?? reg.data?.provider_id;
      INFO(`provider_id: ${providerId}`);

      if (!providerId) {
        FAIL('B6', 'could not get provider_id from register response');
        return;
      }

      // Now access public profile WITHOUT auth header
      const pub = await http.get(`${BASE.USER}/api/v1/providers/${providerId}`);
      INFO(`public profile status: ${pub.status}`);
      if (pub.status === 200) PASS('B6: provider public profile accessible without auth → 200');
      else FAIL('B6: public profile', `expected 200, got ${pub.status}`);

    } catch (e: any) {
      const s = e.response?.status;
      FAIL('B6', `HTTP ${s ?? 'ECONNREFUSED'} — ${e.response?.data?.error?.code ?? e.message}`);
    }

  });
}

runGroupB().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
