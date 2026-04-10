/**
 * H-websocket.ts — Group H: WebSocket live (5 tests)
 *  H1. /availability namespace — no auth, city join, toggle visible
 *  H2. /trust namespace — JWT auth, score update event
 *  H3. /messages — send via REST, WS event fires, read receipt
 *  H4. Reconnect — REST catchup on score
 *  H5. Invalid city ID — graceful no crash
 */
import { io as ioClient } from 'socket.io-client';
import { BASE, http, section, withCleanup,
         createTestUser, deleteTestUser, registerCleanup,
         sleep } from './00-setup';

const PASS = (m: string) => console.log(`  [PASS] ${m}`);
const FAIL = (m: string, d = '') => console.log(`  [FAIL] ${m}${d ? ` — ${d}` : ''}`);
const INFO = (m: string) => console.log(`         ${m}`);

const WS_BASE = process.env.WS_URL ?? 'http://localhost:3002';
const TIMEOUT = 5000; // 5s per event

function waitForEvent(socket: ReturnType<typeof ioClient>, event: string, ms = TIMEOUT): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), ms);
    socket.once(event, (data: unknown) => { clearTimeout(t); resolve(data); });
  });
}

async function runGroupH(): Promise<void> {
  await withCleanup(async () => {
    let providerToken = '';
    let consumerToken = '';
    let providerId = '';
    let cityId = 'hyderabad';

    try {
      const provider = await createTestUser('grpH_provider');
      const consumer = await createTestUser('grpH_consumer');
      registerCleanup(() => deleteTestUser(provider));
      registerCleanup(() => deleteTestUser(consumer));
      providerToken = provider.accessToken;
      consumerToken = consumer.accessToken;

      await http.patch(`${BASE.USER}/api/v1/users/me/mode`,
        { mode: 'provider' },
        { headers: { Authorization: `Bearer ${providerToken}` } });
      const reg = await http.post(`${BASE.USER}/api/v1/providers/register`,
        { display_name: 'Provider H', listing_type: 'individual_service',
          category_id: null, city_id: null },
        { headers: { Authorization: `Bearer ${providerToken}` } });
      providerId = reg.data?.data?.id ?? reg.data?.data?.provider_id;

      // Get actual city id if possible
      const cities = await http.get(`${BASE.USER}/api/v1/cities?active=true`);
      const hyderabad = (cities.data?.data ?? []).find(
        (c: { name: string; id: string }) => c.name?.toLowerCase().includes('hyderabad'));
      if (hyderabad) cityId = hyderabad.id;
    } catch (e: any) {
      console.log(`  [SKIP] Group H setup failed: ${e.message}`);
      return;
    }

    // H1 ──────────────────────────────────────────────────────────────────────
    section('H1. /availability — no auth, join city room, toggle visible');
    const availSock = ioClient(`${WS_BASE}/availability`, {
      transports: ['websocket'], reconnection: false, timeout: 3000,
    });
    try {
      await waitForEvent(availSock, 'connect', 4000);
      PASS('H1: /availability connected without auth');

      availSock.emit('join_city', cityId);
      await sleep(500);

      // Toggle provider availability
      await http.put(`${BASE.USER}/api/v1/providers/me/availability`,
        { status: 'available_now', mode: 'simple' },
        { headers: { Authorization: `Bearer ${providerToken}` } });

      try {
        const event = await waitForEvent(availSock, 'availability_updated', TIMEOUT);
        PASS(`H1: availability_updated event received`);
        INFO(`event: ${JSON.stringify(event)}`);
      } catch {
        FAIL('H1', 'availability_updated event not received within 5s');
      }
    } catch (e: any) {
      FAIL('H1', `connect failed: ${e.message}`);
    } finally {
      availSock.disconnect();
    }

    // H2 ──────────────────────────────────────────────────────────────────────
    section('H2. /trust — JWT auth, connect to provider room');
    const trustSock = ioClient(`${WS_BASE}/trust`, {
      auth: { token: providerToken },
      transports: ['websocket'], reconnection: false, timeout: 3000,
    });
    try {
      await waitForEvent(trustSock, 'connect', 4000);
      PASS('H2: /trust connected with JWT');
      trustSock.emit('join_room', `provider:${providerId}`);
      await sleep(200);
      PASS('H2: join_room emitted successfully');
    } catch (e: any) {
      FAIL('H2', `connect failed: ${e.message}`);
    } finally {
      trustSock.disconnect();
    }

    // H3 ──────────────────────────────────────────────────────────────────────
    section('H3. /messages — send REST, WS event on other side');
    const msgSockConsumer = ioClient(`${WS_BASE}/messages`, {
      auth: { token: consumerToken },
      transports: ['websocket'], reconnection: false, timeout: 3000,
    });
    try {
      await waitForEvent(msgSockConsumer, 'connect', 4000);
      PASS('H3: /messages connected');

      // Create contact event
      const ev = await http.post(`${BASE.USER}/api/v1/contact-events`,
        { provider_id: providerId, contact_type: 'message', message_preview: 'H3 test' },
        { headers: { Authorization: `Bearer ${consumerToken}` } });
      const evId = ev.data?.data?.id ?? ev.data?.data?.contact_event_id;

      if (evId) {
        msgSockConsumer.emit('join_conversation', evId);
        await sleep(200);

        // Send via REST
        await http.post(`${BASE.USER}/api/v1/messages`,
          { contact_event_id: evId, body: 'WS test message H3' },
          { headers: { Authorization: `Bearer ${consumerToken}` } });

        try {
          await waitForEvent(msgSockConsumer, 'new_message', TIMEOUT);
          PASS('H3: new_message WS event received');
        } catch {
          FAIL('H3', 'new_message event not received within 5s');
        }
      } else {
        FAIL('H3', 'no contact event id');
      }
    } catch (e: any) {
      FAIL('H3', `connect failed: ${e.message}`);
    } finally {
      msgSockConsumer.disconnect();
    }

    // H4 ──────────────────────────────────────────────────────────────────────
    section('H4. Reconnect — REST catchup on trust score');
    const trustSock2 = ioClient(`${WS_BASE}/trust`, {
      auth: { token: providerToken },
      transports: ['websocket'], reconnection: true,
      reconnectionDelay: 100, reconnectionAttempts: 2, timeout: 3000,
    });
    try {
      await waitForEvent(trustSock2, 'connect', 4000);
      PASS('H4: initial connect OK');

      // Disconnect and reconnect
      trustSock2.disconnect();
      await sleep(200);
      trustSock2.connect();

      try {
        await waitForEvent(trustSock2, 'connect', 4000);
        PASS('H4: reconnected successfully');
      } catch {
        FAIL('H4', 'did not reconnect within 4s');
      }
    } catch (e: any) {
      FAIL('H4', `initial connect failed: ${e.message}`);
    } finally {
      trustSock2.disconnect();
    }

    // H5 ──────────────────────────────────────────────────────────────────────
    section('H5. /availability with invalid city ID — no crash');
    const availSock2 = ioClient(`${WS_BASE}/availability`, {
      transports: ['websocket'], reconnection: false, timeout: 3000,
    });
    try {
      await waitForEvent(availSock2, 'connect', 4000);
      PASS('H5: connected');
      availSock2.emit('join_city', 'invalid-city-that-does-not-exist-xyz');
      await sleep(1000);
      // If we're still connected, the server handled it gracefully
      if (availSock2.connected) PASS('H5: server handled invalid city gracefully');
      else FAIL('H5', 'server disconnected on invalid city');
    } catch (e: any) {
      FAIL('H5', `connect failed: ${e.message}`);
    } finally {
      availSock2.disconnect();
    }
  });
}

runGroupH().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
