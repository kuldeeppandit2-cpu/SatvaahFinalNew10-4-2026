/**
 * app.ts — Express application for SatvAAh auth service (port 3001)
 *
 * Middleware stack (in order):
 *   1. express.json()           — parse request body (10kb limit)
 *   2. correlationId            — X-Correlation-ID on every request (Critical Rule #25)
 *   3. rateLimiter              — 20 req/min per IP on all auth routes (fail-open)
 *   4. /health                  — health check (no auth, no logging overhead)
 *   5. /api/v1/auth             — auth routes
 *   6. notFoundHandler          — shared 404 handler
 *   7. errorHandler             — global error handler (no stack traces in production)
 */

import express, { Request, Response } from 'express';
import {
  correlationId,
  errorHandler,
  notFoundHandler,
  rateLimiter,
} from '@satvaaah/middleware';
import { logger } from '@satvaaah/logger';
import { loadSystemConfig, registerSighupReload } from '@satvaaah/config';
import { prisma } from '@satvaaah/db';
import { authRoutes } from './routes/auth.routes';
import { initRedis } from './redis';

const app = express();

// ---------------------------------------------------------------------------
// Body parsing (10kb limit — tokens are small, no large payloads expected)
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '10kb' }));

// ---------------------------------------------------------------------------
// X-Correlation-ID on every request (Critical Rule #25)
// ---------------------------------------------------------------------------
app.use(correlationId);

// ---------------------------------------------------------------------------
// Health check — must respond quickly, no DB/Redis calls
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3001', 10);

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'auth',
    port: PORT,
  });
});

// ---------------------------------------------------------------------------
// Rate limiter — auth endpoints are high-value attack surface
// 20 requests per minute per IP (fail-open on Redis unavailability per Rule #16)
// ---------------------------------------------------------------------------
app.use(
  rateLimiter({
    windowMs: 60_000,
    max: 20,
    keyPrefix: 'rl:auth:',
  }),
);

// ---------------------------------------------------------------------------
// Auth routes — mounted at /api/v1/auth
// ---------------------------------------------------------------------------
app.use('/api/v1/auth', authRoutes);

// ---------------------------------------------------------------------------
// Shared 404 and error handlers — must be last
// ---------------------------------------------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function start(): Promise<void> {
  // Load system config from DB (all thresholds, feature flags, limits)
  // Critical Rule #20: NOTHING hardcoded — always read from system_config table
  try {
    await loadSystemConfig(prisma);
    logger.info('System config loaded from DB');
  } catch (err: any) {
    logger.warn(`System config load failed — defaults will be used: ${err.message}`);
  }

  // Register SIGHUP handler for hot-reload without restart (Rule #12)
  registerSighupReload(prisma);

  // Initialise Redis (fail-open — server starts even if Redis is unavailable)
  try {
    initRedis();
    logger.info('Redis initialised');
  } catch (err: any) {
    // Non-fatal — auth service can run without Redis (rate limiting + blocklist fail-open)
    logger.warn(`Redis init failed — running in fail-open mode: ${err.message}`);
  }

  app.listen(PORT, () => {
    logger.info(`SatvAAh auth service started on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  });
}

start().catch((err) => {
  logger.error(`Fatal: auth service failed to start: ${err.message}`);
  process.exit(1);
});

export default app;
