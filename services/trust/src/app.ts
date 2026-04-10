import express, { Request, Response } from 'express';
import helmet from 'helmet';
import { correlationId, errorHandler, notFoundHandler, rateLimiter } from '@satvaaah/middleware';
import { logger } from '@satvaaah/logger';
import { loadSystemConfig, registerSighupReload } from '@satvaaah/config';
import { prisma } from '@satvaaah/db';
import trustRoutes from './routes/trust.routes';
import tsaasRoutes from './routes/tsaas.routes';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3004', 10);

// ─── Security & Parsing ───────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// ─── Correlation ID (distributed tracing — MASTER_CONTEXT rule #25) ──────────
app.use(correlationId);

// ─── Rate Limiting (fail-open on Redis unavailability — rule #16) ─────────────
app.use(
  '/api/v1/trust',
  rateLimiter({ windowMs: 60_000, max: 120, keyPrefix: 'trust:v1:rl' }),
);
app.use(
  '/api/v2/tsaas',
  rateLimiter({ windowMs: 60_000, max: 300, keyPrefix: 'trust:tsaas:rl' }),
);

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'trust',
    port: PORT,
    ts: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
// Consumer/provider trust endpoints — /api/v1/trust/...
app.use('/api/v1/trust', trustRoutes);

// TSaaS B2B endpoints — /api/v2/tsaas/...
app.use('/api/v2/tsaas', tsaasRoutes);

app.use(notFoundHandler);

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  try {
    await loadSystemConfig(prisma);
    logger.info('Trust service: system config loaded');
  } catch (err: any) {
    logger.warn(`Trust service: system config load failed — ${err.message}`);
  }
  registerSighupReload(prisma);
  app.listen(PORT, () => logger.info(`Trust service started on port ${PORT}`));
}
start().catch((err) => { logger.error(`Fatal: ${err.message}`); process.exit(1); });

export default app;
