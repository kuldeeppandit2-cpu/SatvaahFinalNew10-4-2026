/**
 * @package @satvaaah/db
 * client.ts — Prisma Client singleton
 *
 * RULES:
 *   - Single PrismaClient instance per process (prevents connection pool exhaustion).
 *   - In development (not in Docker), logs slow queries and errors.
 *   - In production, logs errors only.
 *   - Never instantiate PrismaClient directly in service code — always import from here.
 *   - DATABASE_URL is set in docker-compose.yml environment section (not .env).
 *   - PostgreSQL host in Docker: 'postgres' (per Critical Rule #10).
 *
 * Usage:
 *   import { prisma } from '@satvaaah/db';
 *   const provider = await prisma.providerProfile.findUnique({ where: { id } });
 */

import { PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// LOG LEVELS
// ─────────────────────────────────────────────────────────────────────────────

type PrismaLogLevel = 'query' | 'info' | 'warn' | 'error';

function getLogLevels(): PrismaLogLevel[] {
  if (process.env.NODE_ENV === 'production') {
    return ['error'];
  }
  if (process.env.PRISMA_LOG_QUERIES === 'true') {
    return ['query', 'warn', 'error'];
  }
  return ['warn', 'error'];
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

// Attach to global in development to survive hot-module-reload (e.g. ts-node-dev).
// In production there is no HMR, but the pattern is harmless.
const globalWithPrisma = global as typeof globalThis & {
  _satvaaahPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: getLogLevels(),
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  // Graceful shutdown — critical for Lambda and container environments
  process.on('beforeExit', async () => {
    await client.$disconnect();
  });

  return client;
}

export const prisma: PrismaClient =
  globalWithPrisma._satvaaahPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  // Prevent multiple instances in ts-node watch mode
  globalWithPrisma._satvaaahPrisma = prisma;
}

export default prisma;
