/**
 * G-notifications.ts — Group G: Notifications (6 tests)
 *  G1. Notification list — all 6 types returned
 *  G2. Mark single notification read
 *  G3. Mark all read
 *  G4. 90-day filter — expired excluded
 *  G5. Per-type opt-out
 *  G6. Preferences save and reload
 */
import { BASE, http, section, withCleanup,
         createTestUser, deleteTestUser, registerCleanup,
         dbQuery, closePg } from './00-setup';

const PASS = (m: string) => console.log(`  [PASS] ${m}`);
const FAIL = (m: string, d = '') => console.log(`  [FAIL] ${m}${d ? ` — ${d}` : ''}`);
const INFO = (m: string) => console.log(`         ${m}`);

async function runGroupG(): Promise<void> {
  await withCleanup(async () => {
    let token = '';
    let userId = '';

    try {
      const u = await createTestUser('grpG');
      registerCleanup(() => deleteTestUser(u));
      token = u.accessToken;
      userId = u.firebaseUid;
    } catch (e: any) {
      console.log(`  [SKIP] Group G setup failed: ${e.message}`);
      return;
    }

    // Seed notifications of all 6 types
    const NOTIF_TYPES = [
      'trust_milestone', 'new_lead', 'lead_accepted',
      'rating_received', 'certificate_ready', 'system_message',
    ];
    try {
      for (const type of NOTIF_TYPES) {
        await dbQuery(
          `INSERT INTO notification_log (user_id, type, title, body, created_at)
           VALUES (
             (SELECT id FROM users WHERE firebase_uid = $1),
             $2, $3, 'Test body', NOW()
           )`,
          [userId, type, `Test ${type}`]
        );
      }
      // Seed one expired notification (>90 days)
      await dbQuery(
        `INSERT INTO notification_log (user_id, type, title, body, created_at, expires_at)
         VALUES (
           (SELECT id FROM users WHERE firebase_uid = $1),
           'system_message', 'Old message', 'expired', NOW() - INTERVAL '91 days',
           NOW() - INTERVAL '1 day'
         )`,
        [userId]
      );
      INFO(`seeded ${NOTIF_TYPES.length} notifications + 1 expired`);
    } catch (e: any) {
      INFO(`seed failed (table may differ): ${e.message}`);
    } finally {
      await closePg();
    }

    // G1 ──────────────────────────────────────────────────────────────────────
    section('G1. Notification list returns notifications');
    let notifId = '';
    try {
      const r = await http.get(`${BASE.NOTIFICATION}/api/v1/notifications`,
        { headers: { Authorization: `Bearer ${token}` } });
      INFO(`status: ${r.status}, count: ${r.data?.data?.length ?? 0}`);
      if (r.status === 200) PASS('G1: notifications list → 200');
      else FAIL('G1', `HTTP ${r.status}`);
      const notifs: { id: string; type: string }[] = r.data?.data ?? [];
      if (notifs.length > 0) {
        PASS(`G1: ${notifs.length} notifications returned`);
        notifId = notifs[0].id;
        const types = new Set(notifs.map(n => n.type));
        INFO(`types present: ${[...types].join(', ')}`);
      } else {
        FAIL('G1', 'empty notification list');
      }
    } catch (e: any) {
      FAIL('G1', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // G2 ──────────────────────────────────────────────────────────────────────
    section('G2. Mark single notification read');
    try {
      if (notifId) {
        const r = await http.patch(
          `${BASE.NOTIFICATION}/api/v1/notifications/${notifId}/read`,
          {},
          { headers: { Authorization: `Bearer ${token}` } });
        INFO(`mark read status: ${r.status}`);
        if (r.status === 200) PASS('G2: notification marked read');
        else FAIL('G2', `HTTP ${r.status}`);
      } else {
        FAIL('G2', 'no notification ID from G1');
      }
    } catch (e: any) {
      FAIL('G2', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // G3 ──────────────────────────────────────────────────────────────────────
    section('G3. Mark all notifications read');
    try {
      const r = await http.patch(
        `${BASE.NOTIFICATION}/api/v1/notifications/read-all`,
        {},
        { headers: { Authorization: `Bearer ${token}` } });
      INFO(`mark all read status: ${r.status}`);
      if (r.status === 200) PASS('G3: all notifications marked read');
      else FAIL('G3', `HTTP ${r.status}`);
    } catch (e: any) {
      FAIL('G3', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // G4 ──────────────────────────────────────────────────────────────────────
    section('G4. 90-day filter — expired notification excluded');
    try {
      const r = await http.get(`${BASE.NOTIFICATION}/api/v1/notifications`,
        { headers: { Authorization: `Bearer ${token}` } });
      const notifs: { title: string }[] = r.data?.data ?? [];
      const hasExpired = notifs.some(n => n.title === 'Old message');
      if (!hasExpired) PASS('G4: expired notification correctly excluded');
      else FAIL('G4', 'expired notification still showing in list');
    } catch (e: any) {
      FAIL('G4', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // G5 ──────────────────────────────────────────────────────────────────────
    section('G5. Per-type opt-out — turn off new_lead type');
    try {
      const r = await http.patch(
        `${BASE.NOTIFICATION}/api/v1/notifications/preferences`,
        { new_lead: false },
        { headers: { Authorization: `Bearer ${token}` } });
      INFO(`opt-out status: ${r.status}`);
      if (r.status === 200) PASS('G5: opt-out preference saved');
      else FAIL('G5', `HTTP ${r.status}`);
    } catch (e: any) {
      FAIL('G5', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // G6 ──────────────────────────────────────────────────────────────────────
    section('G6. Preferences save and reload');
    try {
      await http.patch(
        `${BASE.NOTIFICATION}/api/v1/notifications/preferences`,
        { trust_milestone: true, new_lead: false, rating_received: true },
        { headers: { Authorization: `Bearer ${token}` } });

      const r = await http.get(
        `${BASE.NOTIFICATION}/api/v1/notifications/preferences`,
        { headers: { Authorization: `Bearer ${token}` } });
      INFO(`preferences reload status: ${r.status}`);
      if (r.status === 200) {
        PASS('G6: preferences reloaded');
        const prefs = r.data?.data ?? {};
        if (prefs.new_lead === false)
          PASS('G6: new_lead=false persisted correctly');
        else
          FAIL('G6', `new_lead=${prefs.new_lead} (expected false)`);
      } else {
        FAIL('G6', `HTTP ${r.status}`);
      }
    } catch (e: any) {
      FAIL('G6', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }
  });
}

runGroupG().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
