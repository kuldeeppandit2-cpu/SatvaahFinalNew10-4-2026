/**
 * SatvAAh — User Service (port 3002)
 * Handles: provider_profiles, consumer_profiles, credentials,
 *          geo-verify, DigiLocker / Aadhaar verification,
 *          saved_providers, referrals, DPDP data-export / deletion,
 *          WebSocket (Socket.IO — 3 namespaces: /availability, /trust, /messages)
 */

import express, { Application } from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

import { correlationId, rateLimiter, errorHandler, notFoundHandler, requireAuth } from '@satvaaah/middleware';
import { logger }        from '@satvaaah/logger';

import providerRoutes      from './routes/provider.routes';
import consumerRoutes      from './routes/consumer.routes';
import userRoutes          from './routes/user.routes';
import verificationRoutes  from './routes/verification.routes';
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

// 404 for unmatched routes — MUST be before errorHandler
app.use(notFoundHandler);
// Global error handler — MUST be last
app.use(errorHandler);

// ── HTTP server ─────────────────────────────────────────────────────────────
const httpServer = http.createServer(app);

// ── Socket.IO ───────────────────────────────────────────────────────────────
//
// 3 namespaces (from MASTER_CONTEXT):
//   /availability  — public (no auth)
//   /trust         — JWT required, provider joins room provider:{id}
//   /messages      — JWT required, both parties join conversation:{event_id}
//
// Redis adapter required for horizontal scaling.
async function attachSocketIO(): Promise<void> {
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
  } catch (err) {
    logger.error('Socket.IO Redis adapter connection failed — running without adapter', { err });
    // Fail gracefully; single-instance WS still functional
  }

  const io = new SocketIOServer(httpServer, {
    cors: { origin: process.env.WS_CORS_ORIGIN || process.env.APP_CORS_ORIGIN || '*' },
    // connectionStateRecovery replays missed events within 2-minute window
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000, skipMiddlewares: false },
  });

  if (pubClient.isReady && subClient.isReady) {
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.IO Redis adapter attached');
  }

  // ── /availability namespace (public) ─────────────────────────────────────
  const availabilityNs = io.of('/availability');
  availabilityNs.on('connection', (socket) => {
    const cityId = socket.handshake.query.city_id as string | undefined;
    if (cityId) {
      socket.join(`city:${cityId}`);
    }
    logger.debug('Socket /availability connected', {
      socketId: socket.id,
      cityId,
    });
  });

  // ── /trust namespace (JWT required) ──────────────────────────────────────
  const trustNs = io.of('/trust');
  trustNs.use(socketAuthMiddleware);
  trustNs.on('connection', (socket) => {
    const providerId = (socket as any).providerId as string | undefined;
    if (providerId) {
      socket.join(`provider:${providerId}`);
    }
    socket.on('disconnect', () =>
      logger.debug('Socket /trust disconnected', { socketId: socket.id })
    );
  });

  // ── /messages namespace (JWT required) ───────────────────────────────────
  const messagesNs = io.of('/messages');
  messagesNs.use(socketAuthMiddleware);
  messagesNs.on('connection', (socket) => {
    const eventId = socket.handshake.query.event_id as string | undefined;
    if (eventId) {
      socket.join(`conversation:${eventId}`);
    }
    socket.on('disconnect', () =>
      logger.debug('Socket /messages disconnected', { socketId: socket.id })
    );
  });

  // Attach io to app so controllers can emit events
  (app as any).io = io;
  logger.info('Socket.IO namespaces registered: /availability, /trust, /messages');
}

/**
 * Socket.IO auth middleware — verifies RS256 JWT from handshake auth.token
 * Mirrors requireAuth but adapted for Socket.IO Next callbacks.
 */
async function socketAuthMiddleware(socket: any, next: (err?: Error) => void): Promise<void> {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) return next(new Error('UNAUTHORIZED'));

  try {
    const jwt = await import('jsonwebtoken');
    const publicKey = process.env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n') ?? '';
    const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as any;
    socket.userId = payload.sub;
    // Look up provider profile id so /trust namespace can join the correct room
    try {
      const providerProfile = await prisma.providerProfile.findFirst({
        where: { user_id: payload.sub },
        select: { id: true },
      });
      if (providerProfile) {
        socket.providerId = providerProfile.id;
      }
    } catch {
      // Non-fatal — provider room join will simply be skipped
    }
    // provider_id is NOT in JWT — look up from DB if needed
    next();
  } catch {
    next(new Error('UNAUTHORIZED'));
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
import { loadSystemConfig, registerSighupReload } from '@satvaaah/config';
import { prisma } from '@satvaaah/db';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Client as PgClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

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

  await attachSocketIO();

  // Start OpenSearch CDC bridge (non-blocking)
  startCdcBridge().catch((err) => {
    logger.error('CDC bridge startup error', { error: (err as Error).message });
  });

  httpServer.listen(PORT, () => {
    logger.info(`SatvAAh user-service listening on port ${PORT}`);
  });
})();

export { app, httpServer };
