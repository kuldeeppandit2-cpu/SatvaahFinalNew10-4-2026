/**
 * A-auth-deeper.ts — Group A: Authentication deeper
 * Each section in own try-catch so all 7 run regardless of failure.
 */
import { v4 as uuidv4 } from 'uuid';
import { BASE, http, makeHeaders, section, withCleanup,
         createTestUser, deleteTestUser, registerCleanup } from './00-setup';

const PASS = (msg: string) => console.log(`  [PASS] ${msg}`);
const FAIL = (msg: string, detail = '') => console.log(`  [FAIL] ${msg}${detail ? ` — ${detail}` : ''}`);
const INFO = (msg: string) => console.log(`         ${msg}`);

async function runGroupA(): Promise<void> {
  await withCleanup(async () => {
    let consumerToken = '';

    // A1 ─────────────────────────────────────────────────────────────────────
    section('A1. Invalid Firebase token → 400 or 401');
    try {
      const r = await http.post(`${BASE.AUTH}/api/v1/auth/firebase/verify`,
        { firebaseIdToken: 'garbage.token.here', consent_given: true });
      FAIL('A1', `expected 400/401 — got HTTP ${r.status}`);
    } catch (e: any) {
      const s = e.response?.status;
      if (s === 400 || s === 401) PASS(`A1: rejected with ${s}`);
      else FAIL('A1', `got HTTP ${s ?? 'ECONNREFUSED'}`);
    }

    // A2 ─────────────────────────────────────────────────────────────────────
    section('A2. Tampered JWT on protected route → 401');
    try {
      const r = await http.get(`${BASE.USER}/api/v1/consumers/me`,
        { headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.fake.badsig' } });
      FAIL('A2', `expected 401 — got HTTP ${r.status}`);
    } catch (e: any) {
      const s = e.response?.status;
      if (s === 401) PASS('A2: tampered JWT → 401');
      else FAIL('A2', `got HTTP ${s ?? 'ECONNREFUSED'}`);
    }

    // A3 ─────────────────────────────────────────────────────────────────────
    section('A3. Consumer JWT on admin-only route → 403');
    try {
      const u = await createTestUser('grpA_consumer');
      registerCleanup(() => deleteTestUser(u));
      consumerToken = u.accessToken;
      const r = await http.get(`${BASE.ADMIN}/api/v1/admin/config`,
        { headers: { Authorization: `Bearer ${consumerToken}` } });
      FAIL('A3', `expected 403 — got HTTP ${r.status}`);
    } catch (e: any) {
      const s = e.response?.status;
      if (s === 403 || s === 401) PASS(`A3: consumer blocked from admin → ${s}`);
      else FAIL('A3', `got HTTP ${s ?? 'ECONNREFUSED (Firebase or admin service)'}`);
    }

    // A4 ─────────────────────────────────────────────────────────────────────
    section('A4. OTP rate limit — 6th attempt → 429');
    try {
      let got429 = false;
      for (let i = 1; i <= 6; i++) {
        try {
          const r = await http.post(`${BASE.AUTH}/api/v1/auth/otp/send`,
            { phone: '+917799000099' });
          INFO(`attempt ${i}: HTTP ${r.status}`);
        } catch (e: any) {
          const s = e.response?.status ?? 'ECONNREFUSED';
          INFO(`attempt ${i}: HTTP ${s}`);
          if (e.response?.status === 429) { got429 = true; break; }
        }
      }
      if (got429) PASS('A4: 429 received within 6 attempts');
      else FAIL('A4', 'never got 429 — rate limiter not active or endpoint offline');
    } catch (e: any) {
      FAIL('A4', e.message);
    }

    // A5 ─────────────────────────────────────────────────────────────────────
    section('A5. Concurrent refresh — no 5xx server crash');
    try {
      const u = await createTestUser('grpA_refresh');
      registerCleanup(() => deleteTestUser(u));
      const statuses = await Promise.all(Array.from({ length: 3 }, () =>
        http.post(`${BASE.AUTH}/api/v1/auth/refresh`, { refreshToken: u.refreshToken })
          .then(r => r.status).catch(e => e.response?.status ?? 0)
      ));
      INFO(`concurrent statuses: ${statuses.join(', ')}`);
      if (statuses.some(s => s >= 500)) FAIL('A5', `server crashed: ${statuses}`);
      else if (statuses.some(s => s === 200)) PASS('A5: at least one refresh succeeded, no 5xx');
      else FAIL('A5', `no 200 received: ${statuses} (services offline?)`);
    } catch (e: any) {
      FAIL('A5', e.message);
    }

    // A6 ─────────────────────────────────────────────────────────────────────
    section('A6. X-Correlation-ID echoed in response header');
    try {
      const sentId = `test-grpA-${uuidv4()}`;
      const r = await http.get(`${BASE.AUTH}/health`,
        { headers: { 'X-Correlation-ID': sentId } });
      const echoed = (r.headers as Record<string,string>)['x-correlation-id'];
      INFO(`sent: ${sentId}`);
      INFO(`got:  ${echoed ?? '(not present)'}`);
      if (echoed === sentId) PASS('A6: X-Correlation-ID echoed exactly');
      else FAIL('A6', `header missing or different: "${echoed ?? 'not present'}"`);
    } catch (e: any) {
      FAIL('A6', `service unreachable: ${e.response?.status ?? e.code}`);
    }

    // A7 ─────────────────────────────────────────────────────────────────────
    section('A7. All 8 services healthy + return JSON');
    const svcs = [
      ['auth',         BASE.AUTH],
      ['user',         BASE.USER],
      ['search',       BASE.SEARCH],
      ['trust',        BASE.TRUST],
      ['rating',       BASE.RATING],
      ['notification', BASE.NOTIFICATION],
      ['payment',      BASE.PAYMENT],
      ['admin',        BASE.ADMIN],
    ] as const;

    for (const [name, base] of svcs) {
      try {
        const r = await http.get(`${base}/health`);
        if (r.status === 200 && typeof r.data === 'object')
          PASS(`A7: ${name} → 200 JSON`);
        else
          FAIL(`A7: ${name}`, `status=${r.status} type=${typeof r.data}`);
      } catch (e: any) {
        FAIL(`A7: ${name}`, `UNREACHABLE — ${e.response?.status ?? e.code ?? e.message}`);
      }
    }

  });
}

runGroupA().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
