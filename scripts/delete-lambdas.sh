#!/bin/bash
# Delete all SatvAAh Lambdas from LocalStack so deploy-lambdas-direct.sh can redeploy fresh.
# Run this when you get ResourceConflictException or InternalError on UpdateFunctionCode.

ENDPOINT="http://localhost:4566"
REGION="ap-south-1"

echo "Deleting all SatvAAh Lambdas from LocalStack..."
for name in trust-recalculate opensearch-sync push-discovery delivery-monitor \
            certificate-generator anonymisation outreach-scheduler ratings-refresh; do
  docker exec satvaaah-localstack awslocal lambda delete-function \
    --function-name "satvaaah-${name}" 2>/dev/null \
    && echo "  Deleted: satvaaah-${name}" \
    || echo "  Not found (ok): satvaaah-${name}"
done

echo ""
echo "Done. Now run: bash scripts/deploy-lambdas-direct.sh"
