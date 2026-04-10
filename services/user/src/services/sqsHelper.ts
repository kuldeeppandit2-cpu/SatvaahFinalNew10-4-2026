/**
 * SQS Helper — thin wrapper around AWS SDK SendMessageCommand.
 *
 * All SQS messages include X-Correlation-ID for distributed tracing.
 * Message retention: 14 days per MASTER_CONTEXT.
 * All queues are FIFO queues using MessageGroupId for ordering.
 */

import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandInput,
} from '@aws-sdk/client-sqs';
import { logger } from '@satvaaah/logger';

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

interface SqsPublishInput {
  /** env var key pointing to the SQS queue URL e.g. 'TRUST_SCORE_UPDATES_QUEUE_URL' */
  queueKey:        string;
  /** FIFO MessageGroupId — keeps messages ordered per entity */
  messageGroupId:  string;
  /** Payload object — will be JSON.stringified */
  body:            Record<string, unknown>;
  correlationId:   string;
}

export async function sqsPublish(input: SqsPublishInput): Promise<void> {
  const { queueKey, messageGroupId, body, correlationId } = input;

  const queueUrl = process.env[queueKey];
  if (!queueUrl) {
    logger.error(`SQS queue URL not configured: ${queueKey}`, { correlationId });
    // Fail gracefully in development — do not throw; queue unavailability should not block API
    return;
  }

  const payload = {
    ...body,
    _correlation_id: correlationId,
    _emitted_at:     new Date().toISOString(),
  };

  const params: SendMessageCommandInput = {
    QueueUrl:               queueUrl,
    MessageBody:            JSON.stringify(payload),
    MessageGroupId:         messageGroupId,
    // Deduplication: use content hash so retries don't double-process
    MessageDeduplicationId: Buffer.from(
      JSON.stringify({ messageGroupId, body_hash: simpleHash(JSON.stringify(body)) })
    )
      .toString('base64')
      .slice(0, 128),
    MessageAttributes: {
      CorrelationId: {
        DataType:    'String',
        StringValue: correlationId,
      },
    },
  };

  try {
    const result = await sqs.send(new SendMessageCommand(params));
    logger.debug('SQS message published', {
      queueKey,
      messageGroupId,
      messageId: result.MessageId,
      correlationId,
    });
  } catch (err) {
    logger.error('SQS publish failed', { queueKey, messageGroupId, correlationId, err });
    // Rethrow only for critical queues (trust updates are retryable via background jobs)
    throw err;
  }
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}
