/**
 * app.ts — Admin Service  |  port 3009
 * services/admin/src/app.ts
 *
 * VPN-only in production. All routes require requireAdmin middleware
 * (role: admin, sourced from admin_users table only — Critical Rule #19).
 *
 * Critical Rule #16: Rate limiter fails-open during Redis outages.
 * Critical Rule #25: X-Correlation-ID on every request.
 */

import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { correlationId, errorHandler, notFoundHandler, rateLimiter } from '@satvaaah/middleware';
import { logger } from '@satvaaah/logger';
import { prisma } from '@satvaaah/db';
import { loadSystemConfig, registerSighupReload } from '@satvaaah/config';
import adminRouter from './routes/admin.routes';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app: Application = express();
const PORT = Number(process.env.PORT ?? 3009);

// 1. Correlation ID — must be first. Critical Rule #25.
app.use(correlationId);

// 2. Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
    },
  },
}));

// 3. CORS — admin portal only. Strict in production.
app.use(cors({
  origin: (origin, cb) => {
    const allowed = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3099').split(',');
    // Allow same-origin requests (no origin header) from VPN tools
    if (!origin || allowed.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Correlation-ID'],
  exposedHeaders: ['X-Correlation-ID'],
}));

// 4. Body parsing — admin sends JSON only (no raw Razorpay webhook here)
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false }));

// 5. Rate limiter — generous for admin tooling. Fail-open. Critical Rule #16.
const adminRateLimiter = rateLimiter({
  windowMs: 60_000,          // 1 minute
  max: 600,                  // 600 req/min per admin IP — deliberate actions
  keyPrefix: 'rl:admin:',
});
app.use(adminRateLimiter);

// ---------------------------------------------------------------------------
// Health check — no auth required (load balancer probes)
// ---------------------------------------------------------------------------

app.get('/health', async (_req: Request, res: Response) => {
  try {
    // Ping DB to confirm connectivity
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      success: true,
      data: {
        service: 'admin',
        status: 'ok',
        port: PORT,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error(`Health check DB ping failed: ${(err as Error).message}`);
    res.status(503).json({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unreachable' },
    });
  }
});

// ---------------------------------------------------------------------------
// Routes — all admin routes under /api/v1
// ---------------------------------------------------------------------------

app.use('/api/v1', adminRouter);

app.use(notFoundHandler);

// ---------------------------------------------------------------------------
// Global error handler — must be last
// ---------------------------------------------------------------------------

app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  try {
    await loadSystemConfig(prisma);
    logger.info('Admin service: system config loaded');
  } catch (err: any) {
    logger.warn(`Admin service: system config load failed — ${err.message}`);
  }
  registerSighupReload(prisma);
}

start().catch((err) => { logger.error(`Fatal startup: ${err.message}`); process.exit(1); });

const server = app.listen(PORT, () => {
  logger.info(`Admin service started on port ${PORT}`);
});

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info(`Shutdown signal received: ${signal}`);
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Admin service stopped cleanly');
    process.exit(0);
  });
  // Force exit after 10 seconds
  setTimeout(() => process.exit(1), 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${String(reason)}`);
});

export default app;
