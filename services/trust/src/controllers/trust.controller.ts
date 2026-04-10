import { Request, Response } from 'express';
import { z } from 'zod';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { AppError } from '@satvaaah/errors';
import { logger } from '@satvaaah/logger';
import { prisma } from '@satvaaah/db';
import { calculateTrustBreakdown } from '../services/trustCalculator';
import { getTrustHistory } from '../services/trustHistoryService';
import { getTsaasTrustData, logTsaasUsage } from '../services/tsaasService';

// ─── SQS Client ───────────────────────────────────────────────────────────────
const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });
// Evaluated at call-time so missing env crashes only on use, not service start

// ─── Input Validation ─────────────────────────────────────────────────────────
const providerIdSchema = z.string().uuid('Invalid provider ID');
const phoneSchema = z.string().regex(/^\+91[0-9]{10}$/, 'Phone must be E.164 +91 format');

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ─── TrustController ─────────────────────────────────────────────────────────
export class TrustController {
  /**
   * GET /api/v1/trust/me
   * Authenticated provider's own trust breakdown.
   */
  async getMyTrust(req: Request, res: Response): Promise<void> {
    const user = (req as any).user;

    // Resolve provider_id from authenticated user
    const provider = await prisma.providerProfile.findFirst({
      where: { user_id: user.userId },
      select: { id: true },
    });
    if (!provider) {
      res.status(404).json({
        success: false,
        error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found' },
      });
      return;
    }

    const breakdown = await calculateTrustBreakdown(provider.id);
    if (!breakdown) {
      res.status(404).json({
        success: false,
        error: { code: 'TRUST_SCORE_NOT_FOUND', message: 'Trust score not initialised' },
      });
      return;
    }

    logger.info(`trust.getMyTrust`);

    res.json({ success: true, data: breakdown });
  }

  /**
   * GET /api/v1/trust/:id
   * Public trust breakdown for any provider.
   */
  async getTrust(req: Request, res: Response): Promise<void> {
    const parseResult = providerIdSchema.safeParse(req.params.id);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PROVIDER_ID', message: parseResult.error.errors[0].message },
      });
      return;
    }
    const providerId = parseResult.data;

    // Confirm provider exists
    const exists = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { id: true },
    });
    if (!exists) {
      res.status(404).json({
        success: false,
        error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found' },
      });
      return;
    }

    const breakdown = await calculateTrustBreakdown(providerId);
    if (!breakdown) {
      res.status(404).json({
        success: false,
        error: { code: 'TRUST_SCORE_NOT_FOUND', message: 'Trust score not found' },
      });
      return;
    }

    logger.info(`trust.getTrust`);

    res.json({ success: true, data: breakdown });
  }

  /**
   * GET /api/v1/trust/:id/history
   * Immutable trust biography with peer context.
   */
  async getTrustHistory(req: Request, res: Response): Promise<void> {
    const parseResult = providerIdSchema.safeParse(req.params.id);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PROVIDER_ID', message: parseResult.error.errors[0].message },
      });
      return;
    }

    const queryResult = historyQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_QUERY', message: queryResult.error.errors[0].message },
      });
      return;
    }

    const providerId = parseResult.data;
    const { page, limit } = queryResult.data;

    const historyData = await getTrustHistory(providerId, page, limit);

    res.json({ success: true, ...historyData });
  }

  /**
   * POST /api/v1/trust/:id/recalculate
   * Internal endpoint — sends SQS message to trigger Lambda recalculation.
   * Auth: X-Service-Key header only. Not user-facing.
   */
  async recalculate(req: Request, res: Response): Promise<void> {
    const parseResult = providerIdSchema.safeParse(req.params.id);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PROVIDER_ID', message: parseResult.error.errors[0].message },
      });
      return;
    }
    const providerId = parseResult.data;

    // Confirm provider exists before enqueuing
    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { id: true },
    });
    if (!provider) {
      res.status(404).json({
        success: false,
        error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found' },
      });
      return;
    }

    const correlationId = (req as any).correlationId;

    // ── Enqueue SQS message → trust-score-updates → Lambda:trust-recalculate ──
    const messageBody = JSON.stringify({
      provider_id: providerId,
      triggeredBy:  'manual_recalculate',
      correlationId,
    });

    const queueUrl = process.env.SQS_TRUST_SCORE_UPDATES_URL;
    if (!queueUrl) {
      throw new AppError('MISCONFIGURED', 'SQS_TRUST_SCORE_UPDATES_URL is not set', 500);
    }

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: messageBody,
        // FIFO queue — MessageGroupId required; groups per provider for ordering
        MessageGroupId: `provider:${providerId}`,
        // Content-based deduplication via sha256 of body
        MessageAttributes: {
          correlation_id: {
            DataType: 'String',
            StringValue: correlationId ?? 'unknown',
          },
          trigger: {
            DataType: 'String',
            StringValue: 'manual_recalculate',
          },
        },
      }),
    );

    logger.info(`trust.recalculate.enqueued`);

    res.json({
      success: true,
      data: {
        message: 'Recalculation enqueued',
        provider_id: providerId,
        queue: 'trust-score-updates',
      },
    });
  }
}

// ─── TsaasController ──────────────────────────────────────────────────────────
export class TsaasController {
  /**
   * GET /api/v2/tsaas/trust/:providerId
   * B2B trust score fetch by provider UUID.
   * Checks consent and logs billable usage.
   */
  async getTrustByProviderId(req: Request, res: Response): Promise<void> {
    const parseResult = providerIdSchema.safeParse(req.params.providerId);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PROVIDER_ID', message: parseResult.error.errors[0].message },
      });
      return;
    }
    const providerId = parseResult.data;
    const tsaasClient = (req as any).tsaasClient;

    const result = await getTsaasTrustData({ provider_id: providerId, tsaasClient });

    if (result.consentError) {
      res.status(403).json({
        success: false,
        error: { code: 'TSAAS_CONSENT_NOT_GIVEN', message: 'Provider has not consented to data sharing' },
      });
      return;
    }
    if (result.notFound) {
      res.status(404).json({
        success: false,
        error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found' },
      });
      return;
    }

    // Log billable event (non-blocking)
    logTsaasUsage({
      clientId: tsaasClient.clientId,
      providerId: providerId,
      responseCode: 200,
      correlationId: (req as any).correlationId,
    }).catch((err) =>
      logger.error(`tsaas.logUsage.failed`),
    );

    res.json({ success: true, data: result.data });
  }

  /**
   * GET /api/v2/tsaas/trust/lookup?phone=
   * B2B trust score lookup by provider phone number.
   * Phone must be E.164 format: +91XXXXXXXXXX
   */
  async lookupByPhone(req: Request, res: Response): Promise<void> {
    const parseResult = phoneSchema.safeParse(req.query.phone);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PHONE', message: parseResult.error.errors[0].message },
      });
      return;
    }
    const phone = parseResult.data;
    const tsaasClient = (req as any).tsaasClient;

    // Resolve provider from phone via users table
    const user = await prisma.user.findFirst({
      where: { phone, phone_verified: true, deleted_at: null },
      select: { id: true },
    });
    if (!user) {
      res.status(404).json({
        success: false,
        error: { code: 'PROVIDER_NOT_FOUND', message: 'No verified provider found for this phone' },
      });
      return;
    }

    const provider = await prisma.providerProfile.findFirst({
      where: { user_id: user.id },
      select: { id: true },
    });
    if (!provider) {
      res.status(404).json({
        success: false,
        error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found for this phone' },
      });
      return;
    }

    const result = await getTsaasTrustData({ provider_id: provider.id, tsaasClient });

    if (result.consentError) {
      res.status(403).json({
        success: false,
        error: { code: 'TSAAS_CONSENT_NOT_GIVEN', message: 'Provider has not consented to data sharing' },
      });
      return;
    }
    if (result.notFound) {
      res.status(404).json({
        success: false,
        error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found' },
      });
      return;
    }

    // Log billable event (non-blocking)
    logTsaasUsage({
      clientId: tsaasClient.clientId,
      providerId: provider.id,
      responseCode: 200,
      correlationId: (req as any).correlationId,
    }).catch((err) =>
      logger.error(`tsaas.logUsage.failed`),
    );

    res.json({ success: true, data: result.data });
  }
}
