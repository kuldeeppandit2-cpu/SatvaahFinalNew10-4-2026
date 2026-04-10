import express from 'express';
import { correlationId, errorHandler, notFoundHandler, rateLimiter, requireAuth } from '@satvaaah/middleware';
import { logger } from '@satvaaah/logger';
import { loadSystemConfig, registerSighupReload } from '@satvaaah/config';
import { prisma } from '@satvaaah/db';
import notificationRoutes from './routes/notification.routes';

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(correlationId);                                   // X-Correlation-ID on every request

// ─── Health check (unauthenticated) ───────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ success: true, data: { service: 'notification', port: PORT, status: 'ok' } });
});

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Fail-open during Redis unavailability (Critical Rule #16)
app.use('/api/v1/notifications', rateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'notification' }));

// ─── Auth ────────────────────────────────────────────────────────────────────
app.use('/api/v1/notifications', requireAuth);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/v1/notifications', notificationRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

// ─── Boot ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3006', 10);

async function start(): Promise<void> {
  try {
    await loadSystemConfig(prisma);
    logger.info('Notification service: system config loaded');
  } catch (err: any) {
    logger.warn(`Notification service: system config load failed — ${err.message}`);
  }
  registerSighupReload(prisma);
  app.listen(PORT, () => logger.info(`Notification service started on port ${PORT}`));
}
start().catch((err) => { logger.error(`Fatal: ${err.message}`); process.exit(1); });

export default app;
