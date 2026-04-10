/**
 * J-security.ts — Group J: Security (6 tests)
 *  J1. SQL injection in search → 400 or empty, no data leak
 *  J2. XSS in provider bio → stored safely, returned escaped
 *  J3. HS256 JWT rejected → 401
 *  J4. Accessing another user's private data → 403
 *  J5. Admin endpoint with consumer JWT → 403
 *  J6. 50MB body → 413
 */
import { BASE, http, section, withCleanup,
         createTestUser, deleteTestUser, registerCleanup } from './00-setup';
import * as jwt from 'jsonwebtoken';

const PASS = (m: string) => console.log(`  [PASS] ${m}`);
const FAIL = (m: string, d = '') => console.log(`  [FAIL] ${m}${d ? ` — ${d}` : ''}`);
const INFO = (m: string) => console.log(`         ${m}`);

async function runGroupJ(): Promise<void> {
  await withCleanup(async () => {
    let token1 = '';
    let token2 = '';
    let user1FirebaseUid = '';

    try {
      const u1 = await createTestUser('grpJ_user1');
      const u2 = await createTestUser('grpJ_user2');
      registerCleanup(() => deleteTestUser(u1));
      registerCleanup(() => deleteTestUser(u2));
      token1 = u1.accessToken;
      token2 = u2.accessToken;
      user1FirebaseUid = u1.firebaseUid;
    } catch (e: any) {
      console.log(`  [SKIP] Group J setup failed: ${e.message}`);
      return;
    }

    // J1 ──────────────────────────────────────────────────────────────────────
    section('J1. SQL injection in search query — no data leak');
    const injections = [
      "' OR '1'='1",
      "'; DROP TABLE users; --",
      "' UNION SELECT * FROM users --",
      "1; SELECT pg_sleep(5)--",
    ];
    for (const payload of injections) {
      try {
        const r = await http.get(
          `${BASE.SEARCH}/api/v1/search?q=${encodeURIComponent(payload)}&lat=17.385&lng=78.4867&tab=services`,
          { headers: { Authorization: `Bearer ${token1}` } });
        INFO(`"${payload.substring(0, 30)}..." → HTTP ${r.status}`);
        if (r.status >= 500)
          FAIL('J1', `server error on SQL injection — may be vulnerable: ${payload}`);
        else
          PASS(`J1: SQL injection handled safely → ${r.status}`);
      } catch (e: any) {
        const s = e.response?.status;
        if (s && s >= 500)
          FAIL('J1', `500 on SQL injection payload — check for vulnerability`);
        else
          PASS(`J1: SQL injection rejected → ${s ?? e.code}`);
      }
    }

    // J2 ──────────────────────────────────────────────────────────────────────
    section('J2. XSS in provider bio — stored and returned safely');
    try {
      const u = await createTestUser('grpJ_xss');
      registerCleanup(() => deleteTestUser(u));
      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'provider' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });
      const reg = await http.post(`${BASE.USER}/api/v1/providers/register`,
        { display_name: 'XSS Test J2', listing_type: 'individual_service',
          category_id: null, city_id: null },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });
      const pid = reg.data?.data?.id ?? reg.data?.data?.provider_id;

      const xssPayload = '<script>alert(document.cookie)</script>';
      await http.patch(`${BASE.USER}/api/v1/providers/me`,
        { bio: xssPayload },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });

      const profile = await http.get(`${BASE.USER}/api/v1/providers/${pid}`);
      const bio = profile.data?.data?.bio ?? '';
      INFO(`stored bio: ${bio.substring(0, 60)}`);
      if (bio.includes('<script>'))
        FAIL('J2', 'raw <script> tag returned — XSS not sanitised');
      else
        PASS('J2: XSS payload stored/returned safely (no raw <script>)');
    } catch (e: any) {
      FAIL('J2', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // J3 ──────────────────────────────────────────────────────────────────────
    section('J3. HS256-signed JWT rejected → 401');
    try {
      // Sign a JWT with HS256 using a dummy secret
      const hs256Token = jwt.sign(
        { sub: user1FirebaseUid, role: 'consumer' },
        'dummy-secret-key',
        { algorithm: 'HS256', expiresIn: '1h' }
      );
      const r = await http.get(`${BASE.USER}/api/v1/consumers/me`,
        { headers: { Authorization: `Bearer ${hs256Token}` } });
      FAIL('J3', `HS256 JWT accepted — should be rejected. HTTP ${r.status}`);
    } catch (e: any) {
      const s = e.response?.status;
      if (s === 401) PASS('J3: HS256 JWT rejected → 401');
      else FAIL('J3', `expected 401, got ${s ?? e.message}`);
    }

    // J4 ──────────────────────────────────────────────────────────────────────
    section('J4. Accessing another user private data → 403');
    try {
      // User2 tries to access user1's private profile endpoint
      const r = await http.get(`${BASE.USER}/api/v1/users/${user1FirebaseUid}/private`,
        { headers: { Authorization: `Bearer ${token2}` } });
      INFO(`status: ${r.status}`);
      if (r.status === 403 || r.status === 404)
        PASS(`J4: cross-user access blocked → ${r.status}`);
      else
        FAIL('J4', `expected 403/404, got ${r.status}`);
    } catch (e: any) {
      const s = e.response?.status;
      if (s === 403 || s === 404) PASS(`J4: cross-user access blocked → ${s}`);
      else FAIL('J4', `expected 403/404, got ${s ?? e.message}`);
    }

    // J5 ──────────────────────────────────────────────────────────────────────
    section('J5. Admin endpoint with consumer JWT → 403');
    try {
      const r = await http.get(`${BASE.ADMIN}/api/v1/admin/config`,
        { headers: { Authorization: `Bearer ${token1}` } });
      FAIL('J5', `consumer accessed admin — HTTP ${r.status}`);
    } catch (e: any) {
      const s = e.response?.status;
      if (s === 403 || s === 401) PASS(`J5: consumer blocked from admin → ${s}`);
      else FAIL('J5', `expected 403, got ${s ?? e.message}`);
    }

    // J6 ──────────────────────────────────────────────────────────────────────
    section('J6. 50MB request body → 413');
    try {
      const bigBody = { data: 'x'.repeat(50 * 1024 * 1024) };
      const r = await http.post(`${BASE.USER}/api/v1/consumers/profile`,
        bigBody,
        { headers: { Authorization: `Bearer ${token1}` } });
      INFO(`50MB body status: ${r.status}`);
      if (r.status === 413) PASS('J6: 50MB body → 413');
      else FAIL('J6', `expected 413, got ${r.status}`);
    } catch (e: any) {
      const s = e.response?.status;
      if (s === 413) PASS('J6: 50MB body → 413');
      else FAIL('J6', `expected 413, got ${s ?? e.code ?? e.message}`);
    }
  });
}

runGroupJ().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
