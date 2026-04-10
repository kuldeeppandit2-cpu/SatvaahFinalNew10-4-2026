/**
 * SatvAAh — Payment Service
 * Port: 3007
 *
 * CRITICAL ORDERING:
 *   express.raw() for /webhook/razorpay MUST be registered
 *   before express.json() so the raw Buffer is available for
 *   HMAC-SHA256 signature verification.
 *
 * Session 13 | Phase 13 | 2026-04-04
 */

import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import helmet from 'helmet';
import cors from 'cors';
import { logger } from '@satvaaah/logger';
import { correlationId, rateLimiter, errorHandler, notFoundHandler } from '@satvaaah/middleware';
import { loadSystemConfig, registerSighupReload } from '@satvaaah/config';
import { prisma } from '@satvaaah/db';
import paymentRoutes from './routes/payment.routes';

// ─── Postgres connection pool (payment service uses raw SQL for transactions) ──
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();

// Security headers
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }));

// ─── CRITICAL: Raw body for Razorpay webhook BEFORE json() ───────────────────
// Razorpay HMAC-SHA256 signature verification requires the raw request Buffer.
// express.json() must NOT consume the body first.
app.use(
  '/api/v1/payments/webhook/razorpay',
  express.raw({ type: 'application/json' }),
);

// Standard JSON body parser for all other routes
app.use(express.json());

// ─── Rate limiting (Redis-backed, fail-open — Critical Rule #16) ─────────────
// Webhook NOT rate-limited — Razorpay retries; dropping breaks payment flow
app.use('/api/v1/subscriptions',
  rateLimiter({ windowMs: 15 * 60_000, max: 100, keyPrefix: 'rl:payment:plans' }));
app.use('/api/v1/subscriptions/purchase',
  rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'rl:payment:purchase' }));
app.use('/api/v1/referrals',
  rateLimiter({ windowMs: 15 * 60_000, max: 50, keyPrefix: 'rl:payment:referral' }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'payment',
    port: process.env.PORT ?? 3007,
    timestamp: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/v1', paymentRoutes);

// ─── 404 + Error handlers (shared, correct response format) ──────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3007', 10);

async function start(): Promise<void> {
  try {
    await loadSystemConfig(prisma);
    logger.info('Payment service: system config loaded');
  } catch (err: any) {
    logger.warn(`Payment service: system config load failed — ${err.message}`);
  }
  registerSighupReload(prisma);
  app.listen(PORT, () => logger.info(`Payment service started on port ${PORT}`));
}
start().catch((err) => { logger.error(`Fatal: ${err.message}`); process.exit(1); });

export default app;
