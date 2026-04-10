/**
 * @package @satvaaah/middleware
 * asyncHandler.ts — wraps async route handlers
 *
 * Prevents uncaught promise rejections from crashing the process.
 * All async route handlers should be wrapped with this.
 *
 * Usage:
 *   router.get('/providers/:id', asyncHandler(async (req, res) => {
 *     const provider = await getProvider(req.params.id);
 *     res.json({ success: true, data: provider });
 *   }));
 *
 * Without this wrapper, a rejected promise in an Express route handler
 * produces an UnhandledPromiseRejection, not a 500 response.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler(fn: AsyncRouteHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default asyncHandler;
