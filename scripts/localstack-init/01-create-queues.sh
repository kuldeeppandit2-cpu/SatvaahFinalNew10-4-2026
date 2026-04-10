#!/bin/bash
# LocalStack init — runs after SQS is ready
# Creates all SQS FIFO queues that services and Lambdas need

set -e

REGION="ap-south-1"
ENDPOINT="http://localhost:4566"
ACCOUNT="000000000000"

echo "[LocalStack] Creating SQS queues..."

create_fifo() {
  local name="$1"
  awslocal sqs create-queue \
    --queue-name "${name}.fifo" \
    --region "$REGION" \
    --attributes '{
      "FifoQueue": "true",
      "ContentBasedDeduplication": "true",
      "MessageRetentionPeriod": "86400",
      "VisibilityTimeout": "300"
    }' 2>/dev/null && echo "  ✅ Created: ${name}.fifo" \
    || echo "  ↩  Already exists: ${name}.fifo"
}

# Core queues
create_fifo "satvaaah-trust-score-updates"
create_fifo "satvaaah-anonymisation"
create_fifo "satvaaah-opensearch-sync"
create_fifo "satvaaah-outreach-schedule"
create_fifo "satvaaah-certificate-generate"
create_fifo "satvaaah-push-discovery"
create_fifo "satvaaah-notification"
create_fifo "satvaaah-payment-events"

# List all queues
echo ""
echo "[LocalStack] Queues created:"
awslocal sqs list-queues --region "$REGION" 2>/dev/null || true
