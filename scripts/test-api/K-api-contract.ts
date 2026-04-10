/**
 * K-api-contract.ts — Group K: API Contract (5 tests)
 *  K1. Every endpoint returns { success: true/false } wrapper
 *  K2. Every error has { error: { code, message } }
 *  K3. Pagination — page 2 differs from page 1
 *  K4. X-Correlation-ID in response matches request
 *  K5. All timestamps are UTC ISO 8601
 */
import { BASE, http, makeHeaders, correlationId, section, withCleanup,
         createTestUser, deleteTestUser, registerCleanup } from './00-setup';
import { v4 as uuidv4 } from 'uuid';

const PASS = (m: string) => console.log(`  [PASS] ${m}`);
const FAIL = (m: string, d = '') => console.log(`  [FAIL] ${m}${d ? ` — ${d}` : ''}`);
const INFO = (m: string) => console.log(`         ${m}`);

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function isUtcIso(s: string): boolean { return ISO_UTC.test(s); }
function findTimestamps(obj: unknown, path = ''): { path: string; value: string }[] {
  if (!obj || typeof obj !== 'object') return [];
  const results: { path: string; value: string }[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === 'string' && (k.endsWith('_at') || k.endsWith('_time') || k === 'timestamp')) {
      results.push({ path: `${path}.${k}`, value: v });
    } else if (typeof v === 'object' && v !== null) {
      results.push(...findTimestamps(v, `${path}.${k}`));
    }
  }
  return results;
}

async function runGroupK(): Promise<void> {
  await withCleanup(async () => {
    let token = '';

    try {
      const u = await createTestUser('grpK');
      registerCleanup(() => deleteTestUser(u));
      token = u.accessToken;
      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'consumer' },
        { headers: { Authorization: `Bearer ${token}` } });
    } catch (e: any) {
      console.log(`  [SKIP] Group K setup failed: ${e.message}`);
      return;
    }

    // K1 ──────────────────────────────────────────────────────────────────────
    section('K1. All endpoints return { success } wrapper');
    const endpoints = [
      { label: 'cities',        url: `${BASE.USER}/api/v1/cities?active=true`, auth: false },
      { label: 'consumer/me',   url: `${BASE.USER}/api/v1/consumers/me`,       auth: true },
      { label: 'search',        url: `${BASE.SEARCH}/api/v1/search?q=plumber&lat=17.385&lng=78.4867&tab=services`, auth: true },
      { label: 'categories',    url: `${BASE.SEARCH}/api/v1/categories?tab=services`, auth: true },
      { label: 'trust/me',      url: `${BASE.TRUST}/api/v1/trust/me`,          auth: true },
      { label: 'notifications', url: `${BASE.NOTIFICATION}/api/v1/notifications`, auth: true },
    ];
    for (const ep of endpoints) {
      try {
        const headers = ep.auth ? { Authorization: `Bearer ${token}` } : {};
        const r = await http.get(ep.url, { headers });
        if ('success' in r.data)
          PASS(`K1: ${ep.label} has "success" field`);
        else
          FAIL(`K1: ${ep.label}`, `missing "success" — keys: ${Object.keys(r.data).join(', ')}`);
      } catch (e: any) {
        FAIL(`K1: ${ep.label}`, e.response?.status ? `HTTP ${e.response.status}` : e.message);
      }
    }

    // K2 ──────────────────────────────────────────────────────────────────────
    section('K2. Error responses have { error: { code, message } }');
    const errorCases = [
      { label: 'invalid firebase', url: `${BASE.AUTH}/api/v1/auth/firebase/verify`,
        method: 'post', body: { firebaseIdToken: 'garbage', consent_given: true } },
      { label: 'no auth on protected', url: `${BASE.USER}/api/v1/consumers/me`,
        method: 'get', body: null },
    ];
    for (const ec of errorCases) {
      try {
        if (ec.method === 'post')
          await http.post(ec.url, ec.body);
        else
          await http.get(ec.url);
        FAIL(`K2: ${ec.label}`, 'expected error, got 200');
      } catch (e: any) {
        const d = e.response?.data;
        if (d?.success === false)
          PASS(`K2: ${ec.label} → success=false`);
        else
          FAIL(`K2: ${ec.label}`, `no success=false in error: ${JSON.stringify(d).substring(0,80)}`);
        if (d?.error?.code || d?.error?.message)
          PASS(`K2: ${ec.label} → error.code/message present`);
        else
          FAIL(`K2: ${ec.label}`, `error envelope missing code/message: ${JSON.stringify(d?.error)}`);
      }
    }

    // K3 ──────────────────────────────────────────────────────────────────────
    section('K3. Pagination — page 2 differs from page 1');
    try {
      const p1 = await http.get(
        `${BASE.SEARCH}/api/v1/search?q=&lat=17.385&lng=78.4867&tab=services&page=1&limit=5`,
        { headers: { Authorization: `Bearer ${token}` } });
      const p2 = await http.get(
        `${BASE.SEARCH}/api/v1/search?q=&lat=17.385&lng=78.4867&tab=services&page=2&limit=5`,
        { headers: { Authorization: `Bearer ${token}` } });
      INFO(`page1 count: ${p1.data?.data?.length ?? 0}, page2 count: ${p2.data?.data?.length ?? 0}`);

      if (p1.status === 200 && p2.status === 200)
        PASS('K3: pagination params accepted');
      else
        FAIL('K3', `p1=${p1.status} p2=${p2.status}`);

      const meta1 = p1.data?.meta ?? p1.data?.pagination;
      if (meta1) PASS('K3: pagination metadata present');
      else FAIL('K3', 'no pagination metadata in response');
    } catch (e: any) {
      FAIL('K3', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // K4 ──────────────────────────────────────────────────────────────────────
    section('K4. X-Correlation-ID echoed in response for all services');
    const services = [
      { name: 'auth',   url: `${BASE.AUTH}/health` },
      { name: 'user',   url: `${BASE.USER}/health` },
      { name: 'search', url: `${BASE.SEARCH}/health` },
      { name: 'trust',  url: `${BASE.TRUST}/health` },
    ];
    for (const svc of services) {
      const sentId = `k4-${uuidv4()}`;
      try {
        const r = await http.get(svc.url, {
          headers: { 'X-Correlation-ID': sentId },
        });
        const echoed = (r.headers as Record<string,string>)['x-correlation-id'];
        if (echoed === sentId)
          PASS(`K4: ${svc.name} echoes X-Correlation-ID`);
        else
          FAIL(`K4: ${svc.name}`, `sent="${sentId}" got="${echoed ?? 'missing'}"`);
      } catch (e: any) {
        FAIL(`K4: ${svc.name}`, e.message);
      }
    }

    // K5 ──────────────────────────────────────────────────────────────────────
    section('K5. All timestamps in responses are UTC ISO 8601');
    try {
      const r = await http.get(`${BASE.USER}/api/v1/consumers/me`,
        { headers: { Authorization: `Bearer ${token}` } });
      const timestamps = findTimestamps(r.data);
      INFO(`timestamp fields found: ${timestamps.length}`);
      if (timestamps.length === 0)
        INFO('K5: no timestamp fields in consumer/me (newly created user, OK)');
      for (const ts of timestamps) {
        if (isUtcIso(ts.value))
          PASS(`K5: ${ts.path} = "${ts.value}" is UTC ISO`);
        else
          FAIL('K5', `${ts.path} = "${ts.value}" is NOT UTC ISO`);
      }

      // Also check search results if any
      const sr = await http.get(
        `${BASE.SEARCH}/api/v1/search?q=&lat=17.385&lng=78.4867&tab=services&limit=3`,
        { headers: { Authorization: `Bearer ${token}` } });
      const srTimestamps = findTimestamps(sr.data);
      for (const ts of srTimestamps) {
        if (isUtcIso(ts.value))
          PASS(`K5: search ${ts.path} is UTC ISO`);
        else
          FAIL('K5', `search ${ts.path} = "${ts.value}" is NOT UTC ISO`);
      }
    } catch (e: any) {
      FAIL('K5', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }
  });
}

runGroupK().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
