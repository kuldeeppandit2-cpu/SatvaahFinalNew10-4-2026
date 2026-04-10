/**
 * SatvAAh — services/rating/src/app.ts
 * Rating service — port 3005
 *
 * Responsibilities:
 *   • 10-step moderation pipeline for incoming ratings
 *   • Daily tab limits (from system_config — NEVER hardcoded)
 *   • Burst detection: 3 ratings in 60 min → FLAG ONLY, never block
 *   • Consumer trust score (starts 75, 6 signals)
 *   • Dispute flagging → trust_flags table
 *   • SQS → trust-score-updates after every rating insert
 */

import express, { Request, Response } from 'express';
import { correlationId, errorHandler, notFoundHandler, rateLimiter } from '@satvaaah/middleware';
import { logger } from '@satvaaah/logger';

import { loadSystemConfig, registerSighupReload } from '@satvaaah/config';
import { prisma } from '@satvaaah/db';
import ratingRoutes from './routes/rating.routes';
import consumerRatingRoutes from './routes/consumerRating.routes';
import disputeRoutes from './routes/dispute.routes';

const app = express();

// ── Body parser ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '256kb' }));

// ── X-Correlation-ID on every request (CRITICAL_RULE #25) ────────────────────
app.use(correlationId);

// ── Rate limiter — ratings are write-heavy, tight limit prevents abuse ────────
app.use(rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'rl:rating:' }));

// ── Health endpoint (unauthenticated) ────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      service: 'rating',
      port: PORT,
      status: 'healthy',
      ts: new Date().toISOString(),
    },
  });
});

// ── API routes ────────────────────────────────────────────────────────────────
// GET  /api/v1/ratings/eligibility/:providerId
// POST /api/v1/ratings
app.use('/api/v1', ratingRoutes);

// POST /api/v1/consumer-ratings
// GET  /api/v1/consumers/me/trust
app.use('/api/v1', consumerRatingRoutes);

// POST /api/v1/ratings/:id/flag
app.use('/api/v1', disputeRoutes);

app.use(notFoundHandler);

app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3005', 10);

async function start(): Promise<void> {
  try {
    await loadSystemConfig(prisma);
    logger.info('Rating service: system config loaded');
  } catch (err: any) {
    logger.warn(`Rating service: system config load failed — ${err.message}`);
  }
  registerSighupReload(prisma);
  app.listen(PORT, () => logger.info(`Rating service started on port ${PORT}`));
}
start().catch((err) => { logger.error(`Fatal: ${err.message}`); process.exit(1); });

export default app;
