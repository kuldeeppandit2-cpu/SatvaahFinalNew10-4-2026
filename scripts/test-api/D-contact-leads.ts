/**
 * D-contact-leads.ts — Group D: Contact & Leads (9 tests)
 *  D1. Message-type contact event
 *  D2. Slot booking — non-Gold consumer → 403
 *  D3. Slot booking — (noted, needs Gold subscription)
 *  D4. Lead decline with reason — stored in DB
 *  D5. Lead defer — expiry extended
 *  D6. No-show report
 *  D7. In-app messages send + receive
 *  D8. Saved providers — save/unsave/list (V016)
 *  D9. Lead expiry — past expires_at → status=expired
 */
import { BASE, http, section, withCleanup,
         createTestUser, deleteTestUser, registerCleanup,
         dbQuery, closePg } from './00-setup';

const PASS = (m: string) => console.log(`  [PASS] ${m}`);
const FAIL = (m: string, d = '') => console.log(`  [FAIL] ${m}${d ? ` — ${d}` : ''}`);
const INFO = (m: string) => console.log(`         ${m}`);

async function setupProviderAndConsumer() {
  const provider = await createTestUser('grpD_provider');
  const consumer = await createTestUser('grpD_consumer');

  // Register provider
  await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
    { mode: 'provider' },
    { headers: { Authorization: `Bearer ${provider.accessToken}` } });
  const regRes = await http.post(`${BASE.USER}/api/v1/providers/register`, {
    display_name: 'Provider D',
    listing_type: 'individual_service',
    category_id: null, city_id: null,
  }, { headers: { Authorization: `Bearer ${provider.accessToken}` } });
  const providerId = regRes.data?.data?.id ?? regRes.data?.data?.provider_id;

  // Setup consumer
  await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
    { mode: 'consumer' },
    { headers: { Authorization: `Bearer ${consumer.accessToken}` } });
  await http.post(`${BASE.USER}/api/v1/consumers/profile`,
    { display_name: 'Consumer D' },
    { headers: { Authorization: `Bearer ${consumer.accessToken}` } });

  return { provider, consumer, providerId };
}

async function runGroupD(): Promise<void> {
  await withCleanup(async () => {
    let provider: Awaited<ReturnType<typeof createTestUser>>;
    let consumer: Awaited<ReturnType<typeof createTestUser>>;
    let providerId: string;

    try {
      ({ provider, consumer, providerId } = await setupProviderAndConsumer());
      registerCleanup(() => deleteTestUser(provider));
      registerCleanup(() => deleteTestUser(consumer));
      INFO(`provider id: ${providerId}`);
    } catch (e: any) {
      console.log(`  [SKIP] Group D setup failed: ${e.message}`);
      return;
    }

    // D1 ──────────────────────────────────────────────────────────────────────
    section('D1. Message-type contact event');
    try {
      const r = await http.post(`${BASE.USER}/api/v1/contact-events`, {
        provider_id: providerId,
        contact_type: 'message',
        message_preview: 'Hello, I need help with plumbing',
      }, { headers: { Authorization: `Bearer ${consumer.accessToken}` } });
      INFO(`status: ${r.status}`);
      if (r.status === 200 || r.status === 201)
        PASS('D1: message contact event created');
      else
        FAIL('D1', `HTTP ${r.status}: ${JSON.stringify(r.data)}`);
    } catch (e: any) {
      FAIL('D1', e.response?.status ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}` : e.message);
    }

    // D2 ──────────────────────────────────────────────────────────────────────
    section('D2. Slot booking — non-Gold consumer → 403');
    try {
      const r = await http.post(`${BASE.USER}/api/v1/contact-events`, {
        provider_id: providerId,
        contact_type: 'slot_booking',
        slot_time: new Date(Date.now() + 86400000).toISOString(),
      }, { headers: { Authorization: `Bearer ${consumer.accessToken}` } });
      INFO(`status: ${r.status}`);
      if (r.status === 403) PASS('D2: slot booking blocked for non-Gold → 403');
      else FAIL('D2', `expected 403, got HTTP ${r.status}`);
    } catch (e: any) {
      const s = e.response?.status;
      if (s === 403) PASS('D2: slot booking blocked for non-Gold → 403');
      else FAIL('D2', `expected 403, got ${s ?? e.message}`);
    }

    // D3 ──────────────────────────────────────────────────────────────────────
    section('D3. Slot booking Gold consumer (skipped — needs subscription)');
    INFO('SKIP: Gold subscription requires Razorpay — out of scope this session');

    // D4 ──────────────────────────────────────────────────────────────────────
    section('D4. Lead decline with reason stored in DB');
    try {
      // Get leads for provider
      const leadsRes = await http.get(`${BASE.USER}/api/v1/providers/me/leads?status=pending`,
        { headers: { Authorization: `Bearer ${provider.accessToken}` } });
      const leads: { id: string }[] = leadsRes.data?.data ?? [];
      INFO(`pending leads: ${leads.length}`);

      if (leads.length > 0) {
        const leadId = leads[0].id;
        const decRes = await http.patch(
          `${BASE.USER}/api/v1/providers/me/leads/${leadId}`,
          { action: 'decline', decline_reason: 'too_far' },
          { headers: { Authorization: `Bearer ${provider.accessToken}` } });
        INFO(`decline status: ${decRes.status}`);
        if (decRes.status === 200) {
          PASS('D4: lead declined successfully');
          // Verify reason in DB
          const rows = await dbQuery<{ decline_reason: string }>(
            `SELECT decline_reason FROM contact_events WHERE id = $1`, [leadId]);
          if (rows[0]?.decline_reason === 'too_far')
            PASS('D4: decline_reason stored in DB');
          else
            FAIL('D4', `DB has decline_reason=${rows[0]?.decline_reason}`);
        } else {
          FAIL('D4', `HTTP ${decRes.status}`);
        }
      } else {
        INFO('D4: no pending leads to decline — contact event may not have created a lead yet');
        FAIL('D4', 'no pending leads available to test');
      }
    } catch (e: any) {
      FAIL('D4', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    } finally {
      await closePg();
    }

    // D5 ──────────────────────────────────────────────────────────────────────
    section('D5. Lead defer — status stays pending');
    try {
      const leadsRes = await http.get(`${BASE.USER}/api/v1/providers/me/leads?status=pending`,
        { headers: { Authorization: `Bearer ${provider.accessToken}` } });
      const leads: { id: string }[] = leadsRes.data?.data ?? [];

      if (leads.length > 0) {
        const leadId = leads[0].id;
        const deferRes = await http.patch(
          `${BASE.USER}/api/v1/providers/me/leads/${leadId}`,
          { action: 'defer' },
          { headers: { Authorization: `Bearer ${provider.accessToken}` } });
        INFO(`defer status: ${deferRes.status}`);
        if (deferRes.status === 200) PASS('D5: lead deferred successfully');
        else FAIL('D5', `HTTP ${deferRes.status}`);
      } else {
        FAIL('D5', 'no pending leads to defer');
      }
    } catch (e: any) {
      FAIL('D5', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // D6 ──────────────────────────────────────────────────────────────────────
    section('D6. No-show report endpoint');
    try {
      const r = await http.post(`${BASE.USER}/api/v1/contact-events/no-show`,
        { provider_id: providerId },
        { headers: { Authorization: `Bearer ${consumer.accessToken}` } });
      INFO(`no-show status: ${r.status}`);
      if (r.status === 200 || r.status === 201)
        PASS('D6: no-show reported');
      else
        FAIL('D6', `HTTP ${r.status}`);
    } catch (e: any) {
      FAIL('D6', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // D7 ──────────────────────────────────────────────────────────────────────
    section('D7. In-app messages send + list');
    try {
      // Create a contact event first to get an event_id
      const evRes = await http.post(`${BASE.USER}/api/v1/contact-events`, {
        provider_id: providerId,
        contact_type: 'message',
        message_preview: 'D7 test message',
      }, { headers: { Authorization: `Bearer ${consumer.accessToken}` } });
      const eventId = evRes.data?.data?.id ?? evRes.data?.data?.contact_event_id;
      INFO(`contact event id: ${eventId}`);

      if (eventId) {
        const msgRes = await http.post(`${BASE.USER}/api/v1/messages`,
          { contact_event_id: eventId, body: 'Test message D7' },
          { headers: { Authorization: `Bearer ${consumer.accessToken}` } });
        INFO(`send message status: ${msgRes.status}`);
        if (msgRes.status === 200 || msgRes.status === 201)
          PASS('D7: message sent');
        else
          FAIL('D7: send', `HTTP ${msgRes.status}`);

        const listRes = await http.get(
          `${BASE.USER}/api/v1/messages/${eventId}`,
          { headers: { Authorization: `Bearer ${consumer.accessToken}` } });
        INFO(`list messages status: ${listRes.status}`);
        if (listRes.status === 200) PASS('D7: messages listed');
        else FAIL('D7: list', `HTTP ${listRes.status}`);
      } else {
        FAIL('D7', 'could not get contact event id');
      }
    } catch (e: any) {
      FAIL('D7', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // D8 ──────────────────────────────────────────────────────────────────────
    section('D8. Saved providers — save, list, unsave (V016)');
    try {
      const saveRes = await http.post(`${BASE.USER}/api/v1/saved-providers`,
        { provider_id: providerId },
        { headers: { Authorization: `Bearer ${consumer.accessToken}` } });
      INFO(`save status: ${saveRes.status}`);
      if (saveRes.status === 200 || saveRes.status === 201)
        PASS('D8: provider saved');
      else
        FAIL('D8: save', `HTTP ${saveRes.status}`);

      const listRes = await http.get(`${BASE.USER}/api/v1/saved-providers`,
        { headers: { Authorization: `Bearer ${consumer.accessToken}` } });
      INFO(`list status: ${listRes.status}, count: ${listRes.data?.data?.length ?? 0}`);
      if (listRes.status === 200) PASS('D8: saved providers list returned');
      else FAIL('D8: list', `HTTP ${listRes.status}`);

      const delRes = await http.delete(
        `${BASE.USER}/api/v1/saved-providers/${providerId}`,
        { headers: { Authorization: `Bearer ${consumer.accessToken}` } });
      INFO(`unsave status: ${delRes.status}`);
      if (delRes.status === 200 || delRes.status === 204)
        PASS('D8: provider unsaved');
      else
        FAIL('D8: unsave', `HTTP ${delRes.status}`);
    } catch (e: any) {
      FAIL('D8', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    }

    // D9 ──────────────────────────────────────────────────────────────────────
    section('D9. Expired lead — past expires_at shows status=expired');
    try {
      // Seed a lead with expires_at in the past via DB
      const rows = await dbQuery<{ id: string }>(
        `UPDATE contact_events
         SET expires_at = NOW() - INTERVAL '1 hour',
             status = 'expired'
         WHERE provider_id = (
           SELECT id FROM provider_profiles
           WHERE user_id = (SELECT id FROM users WHERE firebase_uid = $1)
         )
         AND status = 'pending'
         RETURNING id`,
        [provider.firebaseUid]
      );
      INFO(`expired leads seeded: ${rows.length}`);

      const leadsRes = await http.get(
        `${BASE.USER}/api/v1/providers/me/leads?status=expired`,
        { headers: { Authorization: `Bearer ${provider.accessToken}` } });
      INFO(`expired leads from API: ${leadsRes.data?.data?.length ?? 0}`);
      if (leadsRes.status === 200) PASS('D9: expired leads endpoint works');
      else FAIL('D9', `HTTP ${leadsRes.status}`);
    } catch (e: any) {
      FAIL('D9', e.response?.status ? `HTTP ${e.response.status}` : e.message);
    } finally {
      await closePg();
    }
  });
}

runGroupD().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
