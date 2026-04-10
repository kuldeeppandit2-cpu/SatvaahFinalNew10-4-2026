// services/search/src/app.ts
//
// Search Service — port 3003
//
// Endpoints exposed:
//   GET  /api/v1/search                          — expanding ring search (3→7→15→50→150km)
//   GET  /api/v1/search/suggest                  — taxonomy autocomplete (min 2 chars)
//   POST /api/v1/search/intent                   — async intent capture
//   GET  /api/v1/categories                      — category grid (Redis 24h cache)
//   GET  /api/v1/providers/:id                   — public provider profile
//   GET  /health                                 — health check

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { logger } from '@satvaaah/logger';
import {
  correlationId,
  errorHandler,
  notFoundHandler,
  rateLimiter,
} from '@satvaaah/middleware';
import { loadSystemConfig, registerSighupReload } from '@satvaaah/config';
import { prisma } from '@satvaaah/db';
import searchRoutes from './routes/search.routes';
import categoriesRoutes from './routes/categories.routes';

const app = express();

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

app.use(
  cors({
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
      : process.env.NODE_ENV === 'production' ? false : '*',
    methods: ['GET', 'POST', 'OPTIONS'],
  }),
);

app.use(express.json({ limit: '64kb' }));

// ─── Correlation ID (Critical Rule #25) ───────────────────────────────────────
app.use(correlationId);

// ─── Rate limiter — search is read-heavy but must throttle scrapers ────────────
// 60 req/min per IP (fail-open on Redis unavailability — Critical Rule #16)
app.use(rateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'rl:search:' }));

// ─── Request logging ──────────────────────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info('request.incoming', {
    correlationId: req.headers['x-correlation-id'],
    method: req.method,
    path: req.path,
    // Deliberately NOT logging query params — may contain lat/lng (PII-adjacent)
  });
  next();
});

// ─── Health check ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3003', 10);

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    service: 'search',
    status: 'ok',
    port: PORT,
    timestamp: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/v1', searchRoutes);
app.use('/api/v1', categoriesRoutes);

// ─── 404 + error handlers ─────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  // Load system config — Critical Rule #20: nothing hardcoded
  // Ring distances, trust thresholds all come from system_config table
  try {
    await loadSystemConfig(prisma);
    logger.info('System config loaded');
  } catch (err: any) {
    logger.warn(`System config load failed — ring defaults active: ${err.message}`);
  }

  // Hot-reload on SIGHUP without restart
  registerSighupReload(prisma);

  // Warm up Prisma connection pool (avoids cold-query latency on first search)
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Prisma connection pool warmed');
  } catch (err: any) {
    logger.warn(`Prisma warmup failed: ${err.message}`);
  }

  // Warm up Redis connection (category cache, rate limiter)
  try {
    const { getRedisClient } = await import('./lib/redisClient');
    const redis = getRedisClient();
    await redis.ping();
    logger.info('Redis connection warmed');
  } catch (err: any) {
    logger.warn(`Redis warmup failed — cache will cold-start: ${err.message}`);
  }

  // Warm up OpenSearch connection (first search will be slow otherwise)
  try {
    const { getOpenSearchClient } = await import('./lib/opensearchClient');
    const os = getOpenSearchClient();
    await os.ping();
    logger.info('OpenSearch connection warmed');
  } catch (err: any) {
    logger.warn(`OpenSearch warmup failed — first search may be slow: ${err.message}`);
  }

  app.listen(PORT, () => {
    logger.info(`SatvAAh search service started on port ${PORT}`);
  });
}

start().catch((err) => {
  logger.error(`Fatal: search service failed to start: ${err.message}`);
  process.exit(1);
});

export default app;
