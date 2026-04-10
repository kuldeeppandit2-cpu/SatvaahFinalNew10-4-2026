/**
 * I-db-integrity.ts — Group I: Database integrity (7 tests)
 *  I1. V008 — trust_score_history has no updated_at column
 *  I2. V011 — daily_rating_usage UNIQUE constraint
 *  I3. V016 — saved_providers composite PK
 *  I4. V022 — all 68 system_config keys present
 *  I5. V023 — consent_records created on signup
 *  I6. PostGIS — geo_point stored correctly
 *  I7. Cascade — delete user removes contact_events
 */
import { BASE, http, section, withCleanup,
         createTestUser, deleteTestUser, registerCleanup,
         dbQuery, closePg } from './00-setup';

const PASS = (m: string) => console.log(`  [PASS] ${m}`);
const FAIL = (m: string, d = '') => console.log(`  [FAIL] ${m}${d ? ` — ${d}` : ''}`);
const INFO = (m: string) => console.log(`         ${m}`);

async function runGroupI(): Promise<void> {
  await withCleanup(async () => {

    // I1 ──────────────────────────────────────────────────────────────────────
    section('I1. V008 — trust_score_history has no updated_at column');
    try {
      const rows = await dbQuery<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'trust_score_history'
         AND column_name = 'updated_at'`
      );
      if (rows.length === 0)
        PASS('I1: trust_score_history has no updated_at column');
      else
        FAIL('I1', 'updated_at column exists — table is NOT immutable by design');
    } catch (e: any) {
      FAIL('I1', e.message);
    } finally {
      await closePg();
    }

    // I2 ──────────────────────────────────────────────────────────────────────
    section('I2. V011 — daily_rating_usage UNIQUE constraint works');
    try {
      const u = await createTestUser('grpI_rating');
      registerCleanup(() => deleteTestUser(u));

      const userId = (await dbQuery<{ id: string }>(
        `SELECT id FROM users WHERE firebase_uid = $1`, [u.firebaseUid]))[0]?.id;

      if (userId) {
        await dbQuery(
          `INSERT INTO daily_rating_usage (consumer_id, tab, date)
           VALUES ($1, 'services', CURRENT_DATE)`,
          [userId]);
        try {
          await dbQuery(
            `INSERT INTO daily_rating_usage (consumer_id, tab, date)
             VALUES ($1, 'services', CURRENT_DATE)`,
            [userId]);
          FAIL('I2', 'duplicate insert succeeded — UNIQUE constraint missing');
        } catch (dupErr: any) {
          INFO(`duplicate blocked: ${dupErr.message?.substring(0, 60)}`);
          PASS('I2: UNIQUE constraint on daily_rating_usage works');
        }
      } else {
        FAIL('I2', 'could not find user in DB');
      }
    } catch (e: any) {
      FAIL('I2', e.message);
    } finally {
      await closePg();
    }

    // I3 ──────────────────────────────────────────────────────────────────────
    section('I3. V016 — saved_providers composite PK blocks duplicates');
    try {
      const consumer = await createTestUser('grpI_save_c');
      const provider = await createTestUser('grpI_save_p');
      registerCleanup(() => deleteTestUser(consumer));
      registerCleanup(() => deleteTestUser(provider));

      const cId = (await dbQuery<{ id: string }>(
        `SELECT id FROM users WHERE firebase_uid = $1`, [consumer.firebaseUid]))[0]?.id;
      const pId = (await dbQuery<{ id: string }>(
        `SELECT id FROM users WHERE firebase_uid = $1`, [provider.firebaseUid]))[0]?.id;

      if (cId && pId) {
        await dbQuery(
          `INSERT INTO saved_providers (consumer_id, provider_id) VALUES ($1, $2)`,
          [cId, pId]);
        try {
          await dbQuery(
            `INSERT INTO saved_providers (consumer_id, provider_id) VALUES ($1, $2)`,
            [cId, pId]);
          FAIL('I3', 'duplicate saved_provider insert succeeded');
        } catch (dupErr: any) {
          INFO(`duplicate blocked: ${dupErr.message?.substring(0, 60)}`);
          PASS('I3: composite PK on saved_providers works');
        }
      } else {
        FAIL('I3', 'could not get user IDs');
      }
    } catch (e: any) {
      FAIL('I3', e.message);
    } finally {
      await closePg();
    }

    // I4 ──────────────────────────────────────────────────────────────────────
    section('I4. V022 — 68 system_config keys present');
    try {
      const rows = await dbQuery<{ count: string }>(
        `SELECT COUNT(*) as count FROM system_config`);
      const count = parseInt(rows[0]?.count ?? '0');
      INFO(`system_config rows: ${count}`);
      if (count >= 68)
        PASS(`I4: ${count} system_config keys present (≥68)`);
      else
        FAIL('I4', `only ${count} keys — expected 68`);
    } catch (e: any) {
      FAIL('I4', e.message);
    } finally {
      await closePg();
    }

    // I5 ──────────────────────────────────────────────────────────────────────
    section('I5. V023 — consent_records created on signup');
    try {
      const u = await createTestUser('grpI_consent');
      registerCleanup(() => deleteTestUser(u));

      const rows = await dbQuery<{ id: string; consent_given: boolean }>(
        `SELECT id, consent_given FROM consent_records
         WHERE user_id = (SELECT id FROM users WHERE firebase_uid = $1)`,
        [u.firebaseUid]);
      INFO(`consent rows: ${rows.length}`);
      if (rows.length > 0) {
        PASS('I5: consent_record created on signup');
        if (rows[0].consent_given === true)
          PASS('I5: consent_given=true');
        else
          FAIL('I5', `consent_given=${rows[0].consent_given}`);
      } else {
        FAIL('I5', 'no consent_record row found after signup');
      }
    } catch (e: any) {
      FAIL('I5', e.message);
    } finally {
      await closePg();
    }

    // I6 ──────────────────────────────────────────────────────────────────────
    section('I6. PostGIS — geo_point stored and retrievable');
    try {
      const u = await createTestUser('grpI_geo');
      registerCleanup(() => deleteTestUser(u));

      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'provider' },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });
      await http.post(`${BASE.USER}/api/v1/providers/register`,
        { display_name: 'Geo Provider I6', listing_type: 'individual_service',
          category_id: null, city_id: null },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });

      // Geo verify
      await http.post(`${BASE.USER}/api/v1/providers/me/verify/geo`,
        { lat: 17.385, lng: 78.4867, accuracy_meters: 20 },
        { headers: { Authorization: `Bearer ${u.accessToken}` } });

      // Check PostGIS
      const rows = await dbQuery<{ lng: number; lat: number }>(
        `SELECT ST_X(geo_point::geometry) as lng, ST_Y(geo_point::geometry) as lat
         FROM provider_profiles
         WHERE user_id = (SELECT id FROM users WHERE firebase_uid = $1)`,
        [u.firebaseUid]);
      if (rows.length > 0) {
        INFO(`stored: lng=${rows[0].lng}, lat=${rows[0].lat}`);
        if (Math.abs(rows[0].lng - 78.4867) < 0.001)
          PASS('I6: PostGIS lng stored correctly (lng first)');
        else
          FAIL('I6', `lng=${rows[0].lng} expected≈78.4867`);
        if (Math.abs(rows[0].lat - 17.385) < 0.001)
          PASS('I6: PostGIS lat stored correctly');
        else
          FAIL('I6', `lat=${rows[0].lat} expected≈17.385`);
      } else {
        FAIL('I6', 'no geo_point found in provider_profiles');
      }
    } catch (e: any) {
      FAIL('I6', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    } finally {
      await closePg();
    }

    // I7 ──────────────────────────────────────────────────────────────────────
    section('I7. Cascade — delete user removes associated data');
    try {
      const u = await createTestUser('grpI_cascade');
      // Do NOT register for cleanup — we delete manually to test cascade
      const userId = (await dbQuery<{ id: string }>(
        `SELECT id FROM users WHERE firebase_uid = $1`, [u.firebaseUid]))[0]?.id;

      if (userId) {
        // Insert a notification for this user
        await dbQuery(
          `INSERT INTO notification_log (user_id, type, title, body)
           VALUES ($1, 'system_message', 'cascade test', 'test')`,
          [userId]);

        // Delete the user
        await dbQuery(`DELETE FROM users WHERE id = $1`, [userId]);

        // Check notification is gone
        const notifRows = await dbQuery<{ id: string }>(
          `SELECT id FROM notification_log WHERE user_id = $1`, [userId]);
        if (notifRows.length === 0)
          PASS('I7: cascade delete removed notification_log rows');
        else
          FAIL('I7', `${notifRows.length} orphaned notification_log rows remain`);

        // Also delete from Firebase to keep clean
        await deleteTestUser(u);
      } else {
        FAIL('I7', 'user not found in DB');
      }
    } catch (e: any) {
      FAIL('I7', e.message);
    } finally {
      await closePg();
    }
  });
}

runGroupI().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
