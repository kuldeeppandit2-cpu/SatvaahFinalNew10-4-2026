// services/user/src/websocket/server.ts
//
// Socket.IO WebSocket server — 3 namespaces, Redis adapter for horizontal scaling.
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │ Namespace     Auth    Room pattern          Events                   │
// │ /availability  NO     city:{city_id}        availability_updated     │
// │ /trust        JWT     provider:{provider_id} trust_score_updated     │
// │ /messages     JWT     conversation:{eventId} message_received        │
// │                                              message_read            │
// │                                              typing_start            │
// │                                              typing_stop             │
// └──────────────────────────────────────────────────────────────────────┘
//
// Redis adapter: required for multiple user:3002 instances (horizontal scaling).
// connectionStateRecovery: replays missed events within 2-minute disconnect window.
// JWT: RS256 only. Public key loaded from JWT_PUBLIC_KEY env var.

import { Server, Socket, Namespace } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, RedisClientType } from 'redis';
import * as http from 'http';
import * as fs from 'fs';
import * as jwt from 'jsonwebtoken';
import { logger } from '@satvaaah/logger';
import { prisma } from '@satvaaah/db';

// ─── Module-level io instance (singleton) ────────────────────────────────────

let io: Server | null = null;

/**
 * Returns the initialised Socket.IO Server instance.
 * Throws if called before initWebSocket().
 */
export function getIo(): Server {
  if (!io) {
    throw new Error(
      'WebSocket server has not been initialised. Call initWebSocket(httpServer) first.',
    );
  }
  return io;
}

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function getPublicKey(): string {
  // Prefer inline PEM from env; fall back to key file path
  if (process.env.JWT_PUBLIC_KEY) {
    return process.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
  }
  if (process.env.JWT_PUBLIC_KEY_PATH) {
    return fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH, 'utf8');
  }
  throw new Error('JWT_PUBLIC_KEY or JWT_PUBLIC_KEY_PATH must be set');
}

interface JwtPayload {
  sub: string;   // user_id
  userId: string;
  mode: 'consumer' | 'provider';
  iat: number;
  exp: number;
}

function verifyJwt(token: string): JwtPayload {
  const publicKey = getPublicKey();
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as JwtPayload;
}

/**
 * Extracts a Bearer token from the Socket.IO handshake.
 * Clients should send:  { auth: { token: 'Bearer eyJ...' } }
 * or                    headers.authorization = 'Bearer eyJ...'
 */
function extractToken(socket: Socket): string | null {
  const auth = socket.handshake.auth as Record<string, unknown>;
  if (auth?.token && typeof auth.token === 'string') {
    return auth.token.replace(/^Bearer\s+/i, '');
  }
  const authHeader = socket.handshake.headers.authorization;
  if (authHeader && typeof authHeader === 'string') {
    return authHeader.replace(/^Bearer\s+/i, '');
  }
  return null;
}

// ─── Middleware factories ──────────────────────────────────────────────────────

/** Middleware: rejects connections that carry no valid RS256 JWT. */
function requireJwtMiddleware(
  socket: Socket,
  next: (err?: Error) => void,
): void {
  const token = extractToken(socket);
  if (!token) {
    logger.warn('ws.auth.missing_token', { socketId: socket.id });
    return next(new Error('UNAUTHORIZED: token required'));
  }

  try {
    const payload = verifyJwt(token);
    // Attach to socket data for later handlers
    (socket as any).user = { userId: payload.userId ?? payload.sub, mode: payload.mode };
    next();
  } catch (err) {
    logger.warn('ws.auth.invalid_token', {
      socketId: socket.id,
      error: (err as Error).message,
    });
    next(new Error('UNAUTHORIZED: invalid token'));
  }
}

// ─── /availability namespace ───────────────────────────────────────────────────
// Public — no auth. Consumer app joins city:{city_id} room to watch real-time
// availability changes for providers in that city.

function setupAvailabilityNamespace(ns: Namespace): void {
  ns.on('connection', (socket: Socket) => {
    const correlationId = (socket.handshake.query.correlation_id as string) || socket.id;

    logger.info('ws.availability.connected', {
      socketId: socket.id,
      correlationId,
    });

    // Client sends: { cityId: 'uuid' }
    socket.on('join_city', (cityId: unknown) => {
      if (typeof cityId !== 'string' || !/^[0-9a-f-]{36}$/.test(cityId)) {
        socket.emit('error', { code: 'INVALID_CITY_ID', message: 'city_id must be a UUID' });
        return;
      }
      const room = `city:${cityId}`;
      socket.join(room);
      logger.info('ws.availability.join_city', {
        socketId: socket.id,
        room,
        correlationId,
      });
    });

    socket.on('leave_city', (cityId: unknown) => {
      if (typeof cityId === 'string') {
        socket.leave(`city:${cityId}`);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info('ws.availability.disconnected', {
        socketId: socket.id,
        reason,
        correlationId,
      });
    });
  });
}

// ─── /trust namespace ──────────────────────────────────────────────────────────
// JWT required. Provider joins provider:{provider_id} room.
// The Lambda:trust-recalculate emits trust_score_updated via the REST internal
// endpoint → this service broadcasts to the room.

function setupTrustNamespace(ns: Namespace): void {
  ns.use(requireJwtMiddleware);

  ns.on('connection', (socket: Socket) => {
    const user = (socket as any).user as { userId: string; mode: string };
    const correlationId = (socket.handshake.query.correlation_id as string) || socket.id;

    logger.info('ws.trust.connected', {
      socketId: socket.id,
      userId: user.userId,
      correlationId,
    });

    // Provider joins their own room
    socket.on('subscribe_trust', async (providerId: unknown) => {
      if (typeof providerId !== 'string' || !/^[0-9a-f-]{36}$/.test(providerId)) {
        socket.emit('error', { code: 'INVALID_PROVIDER_ID', message: 'provider_id must be a UUID' });
        return;
      }

      // Verify the authenticated user owns this provider profile
      try {
        const profile = await prisma.providerProfile.findFirst({
          where: { id: providerId, user_id: user.userId },
          select: { id: true },
        });

        if (!profile) {
          socket.emit('error', {
            code: 'FORBIDDEN',
            message: 'You do not own this provider profile',
          });
          return;
        }

        const room = `provider:${providerId}`;
        socket.join(room);
        logger.info('ws.trust.subscribe', { socketId: socket.id, room, correlation_id: correlationId });
      } catch (err) {
        logger.error('ws.trust.subscribe.error', {
          socketId: socket.id,
          error: (err as Error).message,
        });
        socket.emit('error', { code: 'INTERNAL_ERROR', message: 'Failed to subscribe' });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info('ws.trust.disconnected', {
        socketId: socket.id,
        user_id: user.userId,
        reason,
        correlationId,
      });
    });
  });
}

// ─── /messages namespace ───────────────────────────────────────────────────────
// JWT required. Both consumer and provider on a contact_event join
// conversation:{event_id} room.
// Events: message_received, message_read, typing_start, typing_stop

function setupMessagesNamespace(ns: Namespace): void {
  ns.use(requireJwtMiddleware);

  ns.on('connection', (socket: Socket) => {
    const user = (socket as any).user as { userId: string; mode: string };
    const correlationId = (socket.handshake.query.correlation_id as string) || socket.id;

    logger.info('ws.messages.connected', {
      socketId: socket.id,
      userId: user.userId,
      correlationId,
    });

    // ── join conversation room ─────────────────────────────────────────────
    socket.on('join_conversation', async (eventId: unknown) => {
      if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/.test(eventId)) {
        socket.emit('error', { code: 'INVALID_EVENT_ID', message: 'event_id must be a UUID' });
        return;
      }

      // Verify the socket owner is a party on this event
      // consumer_id → consumer_profiles.id, provider_id → provider_profiles.id (NOT users.id)
      try {
        const [consumerProfile, providerProfile] = await Promise.all([
          prisma.consumerProfile.findFirst({ where: { user_id: user.userId }, select: { id: true } }),
          prisma.providerProfile.findFirst({ where: { user_id: user.userId }, select: { id: true } }),
        ]);

        const orClauses: any[] = [];
        if (consumerProfile) orClauses.push({ consumer_id: consumerProfile.id });
        if (providerProfile) orClauses.push({ provider_id: providerProfile.id });

        const event = orClauses.length === 0 ? null : await prisma.contactEvent.findFirst({
          where: { id: eventId, OR: orClauses },
          select: { id: true },
        });

        if (!event) {
          socket.emit('error', {
            code: 'FORBIDDEN',
            message: 'You are not a party to this contact event',
          });
          return;
        }

        const room = `conversation:${eventId}`;
        socket.join(room);
        logger.info('ws.messages.join_conversation', {
          socketId: socket.id,
          room,
          user_id: user.userId,
          correlationId,
        });
      } catch (err) {
        logger.error('ws.messages.join_conversation.error', {
          socketId: socket.id,
          error: (err as Error).message,
        });
        socket.emit('error', { code: 'INTERNAL_ERROR', message: 'Failed to join conversation' });
      }
    });

    // ── message_read ───────────────────────────────────────────────────────
    // Client emits when the user opens / reads a message. We broadcast to room
    // AND persist the readAt timestamp.
    socket.on('message_read', async (data: unknown) => {
      const payload = data as { message_id?: string; event_id?: string };
      if (!payload?.message_id || !payload?.event_id) {
        return;
      }

      try {
        // Only update if this user is the recipient (not the sender)
        await prisma.inAppMessage.updateMany({
          where: {
            id: payload.message_id,
            contact_event_id: payload.event_id,
            sender_id: { not: user.userId },
            read_at: null,
          },
          data: { read_at: new Date() },
        });

        const room = `conversation:${payload.event_id}`;
        socket.to(room).emit('message_read', {
          message_id: payload.message_id,
          event_id: payload.event_id,
          read_by: user.userId,
          read_at: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn('ws.messages.message_read.error', {
          error: (err as Error).message,
          socketId: socket.id,
        });
      }
    });

    // ── typing_start / typing_stop ─────────────────────────────────────────
    // Pure relay — no DB persistence. Broadcast to room, exclude sender.
    socket.on('typing_start', (data: unknown) => {
      const payload = data as { event_id?: string };
      if (!payload?.event_id) return;
      socket
        .to(`conversation:${payload.event_id}`)
        .emit('typing_start', { user_id: user.userId, event_id: payload.event_id });
    });

    socket.on('typing_stop', (data: unknown) => {
      const payload = data as { event_id?: string };
      if (!payload?.event_id) return;
      socket
        .to(`conversation:${payload.event_id}`)
        .emit('typing_stop', { user_id: user.userId, event_id: payload.event_id });
    });

    socket.on('leave_conversation', (eventId: unknown) => {
      if (typeof eventId === 'string') {
        socket.leave(`conversation:${eventId}`);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info('ws.messages.disconnected', {
        socketId: socket.id,
        user_id: user.userId,
        reason,
        correlationId,
      });
    });
  });
}

// ─── initWebSocket ─────────────────────────────────────────────────────────────
//
// Call this once from the main server bootstrap (services/user/src/server.ts),
// passing the http.Server instance created before app.listen().
//
// Example:
//   const server = http.createServer(app);
//   await initWebSocket(server);
//   server.listen(PORT);

export async function initWebSocket(httpServer: http.Server): Promise<Server> {
  if (io) {
    logger.warn('ws.init.already_initialised');
    return io;
  }

  // ── Build Redis clients for the pub/sub adapter ──────────────────────────
  // Docker host for Redis is "satvaaah-redis" (MASTER_CONTEXT rule #10)
  const redisUrl = process.env.REDIS_URL || 'redis://satvaaah-redis:6379';

  const pubClient = createClient({ url: redisUrl }) as RedisClientType;
  const subClient = pubClient.duplicate() as RedisClientType;

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    logger.info('ws.redis.connected', { url: redisUrl });
  } catch (redisErr) {
    // Non-fatal: Socket.IO degrades to in-process adapter (single-instance mode).
    // Real-time delivery still works; cross-instance broadcast does not.
    // Alert is logged — ops team should investigate.
    logger.error('ws.redis.connect.failed', {
      url: redisUrl,
      error: (redisErr as Error).message,
      degraded: true,
    });
  }

  // ── Create the Socket.IO Server ──────────────────────────────────────────
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGINS?.split(',') ?? ['*'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // connectionStateRecovery: replays missed events within a 2-minute
    // disconnect window so reconnecting clients don't miss messages.
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes in ms
      skipMiddlewares: true,
    },
    pingTimeout: 30_000,
    pingInterval: 10_000,
  });

  // ── Attach Redis adapter (if clients connected) ──────────────────────────
  if (pubClient.isOpen && subClient.isOpen) {
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('ws.redis_adapter.attached');
  }

  // ── Register the 3 namespaces ─────────────────────────────────────────────
  setupAvailabilityNamespace(io.of('/availability'));
  setupTrustNamespace(io.of('/trust'));
  setupMessagesNamespace(io.of('/messages'));

  logger.info('ws.server.initialised', {
    namespaces: ['/availability', '/trust', '/messages'],
  });

  return io;
}

// ─── broadcastTrustUpdate ─────────────────────────────────────────────────────
//
// Called by the internal trust endpoint when Lambda notifies the user service
// of a trust score change. Broadcasts to the provider's /trust room.

export function broadcastTrustUpdate(
  providerId: string,
  payload: {
    displayScore: number;
    trustTier: string;
    delta_pts: number;
    eventType: string;
  },
): void {
  try {
    const server = getIo();
    server
      .of('/trust')
      .to(`provider:${providerId}`)
      .emit('trust_score_updated', { providerId: providerId, ...payload });

    logger.info('ws.trust.broadcast', { provider_id: providerId, trustTier: payload.trust_tier });
  } catch (err) {
    // Non-fatal: client will see updated score on next poll / app foreground
    logger.warn('ws.trust.broadcast.failed', {
      provider_id: providerId,
      error: (err as Error).message,
    });
  }
}
