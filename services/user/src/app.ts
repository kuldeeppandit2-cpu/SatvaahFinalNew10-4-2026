/**
 * SatvAAh — User Service (port 3002)
 * Handles: provider_profiles, consumer_profiles, credentials,
 *          geo-verify, DigiLocker / Aadhaar verification,
 *          saved_providers, referrals, DPDP data-export / deletion,
 *          WebSocket (Socket.IO — 3 namespaces: /availability, /trust, /messages)
 */

import express, { Application } from 'express';
import http from 'http';
import { correlationId, rateLimiter, errorHandler, notFoundHandler, requireAuth } from '@satvaaah/middleware';
import { logger }        from '@satvaaah/logger';

import providerRoutes      from './routes/provider.routes';
import consumerRoutes      from './routes/consumer.routes';
import userRoutes          from './routes/user.routes';
import verificationRoutes  from './routes/verification.routes';
import internalRoutes       from './routes/internal.routes';
import contactRoutes       from './routes/contact.routes';
import leadRoutes          from './routes/lead.routes';
import messageRoutes       from './routes/message.routes';

const PORT = parseInt(process.env.PORT || '3002', 10);

// ── Express ────────────────────────────────────────────────────────────────
const app: Application = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// X-Correlation-ID — MUST be first middleware
app.use(correlationId);

// Global rate limiter — fail-open during Redis unavailability (critical rule #16)
app.use(rateLimiter({ windowMs: 60_000, max: 120, keyPrefix: 'rl:user' }));

// Health probe (no auth, no correlation required)
app.get('/health', (_req, res) =>
  res.json({ success: true, data: { service: 'user', port: PORT, status: 'ok' } })
);

// ── API routes ──────────────────────────────────────────────────────────────
app.use('/api/v1/providers',        providerRoutes);
app.use('/api/v1/consumers',        consumerRoutes);
app.use('/api/v1/users',            userRoutes);
app.use('/api/v1/contact-events',   contactRoutes);   // CRITICAL: contact/booking flow
app.use('/api/v1',                  leadRoutes);      // /api/v1/providers/me/leads
app.use('/api/v1',                  messageRoutes);   // /api/v1/messages
app.use('/api/v1',                  verificationRoutes);
app.use('/api/v1',                  internalRoutes);  // /api/v1/internal/trust/broadcast — Lambda→WS

// 404 for unmatched routes — MUST be before errorHandler
app.use(notFoundHandler);
// Global error handler — MUST be last
app.use(errorHandler);

// ── HTTP server ─────────────────────────────────────────────────────────────
const httpServer = http.createServer(app);

// ── Bootstrap ────────────────────────────────────────────────────────────────
import { loadSystemConfig, registerSighupReload } from '@satvaaah/config';
import { prisma } from '@satvaaah/db';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Client as PgClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { initWebSocket } from './websocket/server';

/**
 * PostgreSQL CDC bridge — LISTENs on 'opensearch_cdc' pg_notify channel
 * and forwards each payload to SQS for Lambda:opensearch-sync.
 * V018 trigger fires pg_notify but without this bridge nothing listens.
 * Auto-reconnects with exponential backoff. Non-blocking on failure.
 */
async function startCdcBridge(): Promise<void> {
  const sqsQueueUrl = process.env.SQS_OPENSEARCH_SYNC_URL;
  if (!sqsQueueUrl) {
    logger.warn('SQS_OPENSEARCH_SYNC_URL not set — OpenSearch CDC bridge disabled');
    return;
  }
  const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });
  let retryDelay = 1000;

  async function connect(): Promise<void> {
    const pgClient = new PgClient({ connectionString: process.env.DATABASE_URL });
    pgClient.on('error', (err) => {
      logger.error('CDC bridge PG error — reconnecting', { error: err.message });
      pgClient.end().catch(() => {});
      setTimeout(() => { retryDelay = Math.min(retryDelay * 2, 30_000); connect().catch(() => {}); }, retryDelay);
    });
    try {
      await pgClient.connect();
      retryDelay = 1000;
      logger.info('CDC bridge connected — LISTEN opensearch_cdc');
      await pgClient.query('LISTEN opensearch_cdc');
      pgClient.on('notification', async (msg) => {
        if (msg.channel !== 'opensearch_cdc' || !msg.payload) return;
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(msg.payload); } catch { return; }
        const providerId = payload['provider_id'] as string;
        const correlationId = uuidv4();
        try {
          await sqs.send(new SendMessageCommand({
            QueueUrl: sqsQueueUrl,
            MessageBody: JSON.stringify({ ...payload, correlation_id: correlationId }),
            MessageGroupId: `provider:${providerId}`,
            MessageDeduplicationId: `${providerId}:${payload['operation']}:${payload['epoch_ms']}`,
          }));
        } catch (err) {
          logger.error('CDC bridge SQS publish failed', { error: (err as Error).message });
        }
      });
    } catch (err) {
      setTimeout(() => { retryDelay = Math.min(retryDelay * 2, 30_000); connect().catch(() => {}); }, retryDelay);
    }
  }
  connect().catch(() => {});
}

(async () => {
  // Load system config — Rule #20: nothing hardcoded
  try {
    await loadSystemConfig(prisma);
    logger.info('System config loaded');
  } catch (err: any) {
    logger.warn(`System config load failed — defaults used: ${err.message}`);
  }
  registerSighupReload(prisma);

  await initWebSocket(httpServer);

  // Start OpenSearch CDC bridge (non-blocking)
  startCdcBridge().catch((err) => {
    logger.error('CDC bridge startup error', { error: (err as Error).message });
  });

  httpServer.listen(PORT, () => {
    logger.info(`SatvAAh user-service listening on port ${PORT}`);
  });
})();

export { app, httpServer };
