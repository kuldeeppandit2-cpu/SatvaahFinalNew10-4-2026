/**
 * @package @satvaaah/middleware
 * correlationId.ts — X-Correlation-ID middleware
 *
 * RULE (Critical Rule #25): X-Correlation-ID header on every request.
 * Log it. Pass it to every SQS message and Lambda invocation.
 *
 * Behaviour:
 *   1. If incoming request already has X-Correlation-ID → use it (upstream service)
 *   2. Otherwise → generate new UUID v4
 *   3. Attach to req.correlationId
 *   4. Set on response header so clients/gateways can trace
 *   5. Run all downstream middleware inside AsyncLocalStorage context
 *      so logger picks it up automatically without passing explicitly
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto'; // Node 18+ built-in — no package needed
import { correlationStorage } from '@satvaaah/logger';

// Extend Express Request to carry correlationId
declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-correlation-id'];
  const id =
    typeof incoming === 'string' && incoming.trim().length > 0
      ? incoming.trim()
      : randomUUID();

  req.correlationId = id;
  res.setHeader('X-Correlation-ID', id);

  // Run rest of request pipeline inside AsyncLocalStorage context.
  // This means logger.info(...) automatically gets correlation_id
  // without any explicit passing — works across async await chains.
  correlationStorage.run({ correlationId: id }, () => next());
}
