/**
 * SatvAAh — services/rating/src/lib/sqsClient.ts
 *
 * SQS client for the rating service.
 *
 * Queues used:
 *   • trust-score-updates  — after every successful rating INSERT (step 10)
 *   • trust-score-updates  — after consumer is rated by provider
 *
 * Every SQS message carries X-Correlation-ID (CRITICAL_RULE #25).
 */

import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandInput,
} from '@aws-sdk/client-sqs';
import { logger } from '@satvaaah/logger';

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  ...(process.env.AWS_ENDPOINT_URL
    ? { endpoint: process.env.AWS_ENDPOINT_URL }
    : {}),
});

const TRUST_SCORE_UPDATES_QUEUE_URL =
  process.env.SQS_TRUST_SCORE_UPDATES_URL ?? '';

export interface TrustScoreUpdateMessage {
  providerId?: string;
  consumerId?: string;
  event:
    | 'rating_submitted'
    | 'rating_flagged'
    | 'consumer_rated'
    | 'rating_resolved';
  ratingId?: string;
  correlationId: string;
  timestamp: string;
  /** Additional context — never log Aadhaar/passwords */
  meta?: Record<string, unknown>;
}

/**
 * Enqueues a trust-score-updates message.
 * Fire-and-forget — logs on failure but never throws.
 */
export async function sendTrustScoreUpdate(
  payload: TrustScoreUpdateMessage
): Promise<void> {
  if (!TRUST_SCORE_UPDATES_QUEUE_URL) {
    logger.warn('SQS_TRUST_SCORE_UPDATES_URL not set — skipping SQS send');
    return;
  }

  const params: SendMessageCommandInput = {
    QueueUrl: TRUST_SCORE_UPDATES_QUEUE_URL,
    MessageBody: JSON.stringify(payload),
    // Use providerId (or consumerId) as the deduplication / grouping key
    MessageGroupId: payload.providerId ?? payload.consumerId ?? 'default',
    MessageDeduplicationId: `${payload.event}-${payload.ratingId ?? payload.consumerId ?? payload.providerId}-${Date.now()}`,
  };

  try {
    const cmd = new SendMessageCommand(params);
    const result = await sqs.send(cmd);
    logger.info('SQS trust-score-updates sent');
  } catch (err: any) {
    // Log but do not propagate — rating was already saved to DB
    logger.error('SQS send failed for trust-score-updates');
  }
}
