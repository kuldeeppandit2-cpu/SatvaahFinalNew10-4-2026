# SatvAAh — Backend API Test Scripts

Curl-based integration tests for all 8 microservices.
Tests run against the local `docker-compose` stack.

## Prerequisites

```bash
# 1. Start the stack
docker-compose up -d

# 2. Wait ~30 seconds for services to be healthy
# verify-all.sh will also wait automatically
```

## Run all tests

```bash
bash scripts/test-api/verify-all.sh
```

Exit code `0` = all pass. Exit code `1` = one or more failures.

## Run a single suite

```bash
bash scripts/test-api/test-health.sh
bash scripts/test-api/test-auth.sh
bash scripts/test-api/test-user.sh
bash scripts/test-api/test-search.sh
bash scripts/test-api/test-trust.sh
bash scripts/test-api/test-rating.sh
bash scripts/test-api/test-payment.sh
bash scripts/test-api/test-response-format.sh
bash scripts/test-api/test-correlation-id.sh
```

## What is tested

| Suite | Coverage |
|---|---|
| `test-health.sh` | `/health` on all 8 services. Port 3008 must NOT respond. |
| `test-response-format.sh` | `{ success, data/error }` format on all services. |
| `test-correlation-id.sh` | X-Correlation-ID echoed back (MASTER_CONTEXT Rule #25). |
| `test-auth.sh` | Firebase verify, refresh, logout, admin verify. Consent required. |
| `test-user.sh` | Provider/consumer/contact endpoints — all 401 unauthenticated. |
| `test-search.sh` | `/categories?tab=` public. Search/suggest/intent require JWT. |
| `test-trust.sh` | All trust endpoints require JWT. TSaaS requires API key. |
| `test-rating.sh` | Eligibility, submit, flag — all require JWT. |
| `test-payment.sh` | Subscriptions, Razorpay webhook, referrals — auth + HMAC. |

## MASTER_CONTEXT rules verified by these tests

| Rule | Test |
|---|---|
| Port 3008 does not exist | `test-health.sh` |
| API response format `{ success, data }` | `test-response-format.sh` |
| X-Correlation-ID on every request | `test-correlation-id.sh` |
| `consent_given:true` required on auth | `test-auth.sh` |
| HMAC-SHA256 webhook validation | `test-payment.sh` |
| `lng` not `lon` in search | `test-search.sh` |
| TSaaS requires X-Service-Key | `test-trust.sh` |

## Service ports

| Service | Port |
|---|---|
| auth | 3001 |
| user | 3002 |
| search | 3003 |
| trust | 3004 |
| rating | 3005 |
| notification | 3006 |
| payment | 3007 |
| — (does not exist) | 3008 |
| admin | 3009 |
