#!/bin/bash
# Run: bash VERIFY.sh
python3 << 'PYEOF'
import subprocess, os, json, sys

pass_count = 0
fail_count = 0

def contains(text, filepath):
    try:
        with open(filepath) as f:
            return text in f.read()
    except:
        return False

def notcontains(text, filepath):
    return not contains(text, filepath)

def fileexists(path):
    return os.path.exists(path)

def check(label, ok, detail=""):
    global pass_count, fail_count
    if ok:
        print(f"  \033[32m✅ PASS:\033[0m {label}")
        pass_count += 1
    else:
        print(f"  \033[31m❌ FAIL:\033[0m {label}")
        if detail:
            print(f"     WHY:  {detail}")
        fail_count += 1

print()
print("━"*60)
print(" SATVAAAH FORENSIC AUDIT — SECTIONS 1-9 VERIFICATION")
print("━"*60)

# GROUP 1
print("\nGROUP 1: JWT FIELD MAPPING")
check("authService issues JWT field 'sub' (not userId)",
      contains("sub: user.id", "services/auth/src/services/authService.ts"),
      "sub: user.id not found — JWT won't have userId field")
check("requireAuth maps payload.sub → req.user.userId",
      contains("userId: payload.sub", "packages/middleware/src/requireAuth.ts"),
      "userId: payload.sub not found")
check("Old wrong mapping payload.userId is gone",
      notcontains("userId: payload.userId", "packages/middleware/src/requireAuth.ts"),
      "STILL HAS payload.userId — userId will always be undefined")
check("requireAuth maps payload.subscription_tier → subscriptionTier",
      contains("subscriptionTier: payload.subscription_tier", "packages/middleware/src/requireAuth.ts"),
      "subscriptionTier: payload.subscription_tier not found")
check("requireAuth maps payload.phone_verified → phoneVerified",
      contains("phoneVerified: payload.phone_verified", "packages/middleware/src/requireAuth.ts"),
      "phoneVerified: payload.phone_verified not found")

# GROUP 2
print("\nGROUP 2: PRISMA ENUM CASING")
check("User.create: mode='consumer' (Prisma requires lowercase)",
      contains("mode: 'consumer'", "services/auth/src/services/authService.ts"),
      "mode: 'consumer' not found")
check("User.create: subscription_tier='free' (Prisma requires lowercase)",
      contains("subscription_tier: 'free'", "services/auth/src/services/authService.ts"),
      "subscription_tier: 'free' not found")
check("UPPERCASE 'CONSUMER' is gone from authService",
      notcontains("mode: 'CONSUMER'", "services/auth/src/services/authService.ts"),
      "STILL HAS mode: 'CONSUMER' — Prisma will throw P2009 validation error")
check("UPPERCASE 'FREE' is gone from authService",
      notcontains("subscription_tier: 'FREE'", "services/auth/src/services/authService.ts"),
      "STILL HAS subscription_tier: 'FREE' — Prisma will throw P2009 validation error")

# GROUP 3
print("\nGROUP 3: CONSENT RECORD FIELD NAME")
check("authService uses 'granted_at' (correct schema field name)",
      contains("granted_at: new Date()", "services/auth/src/services/authService.ts"),
      "granted_at: new Date() not found")
check("Wrong field name 'given_at' is gone",
      notcontains("given_at: new Date()", "services/auth/src/services/authService.ts"),
      "STILL HAS given_at — Prisma will throw unknown field error")

# GROUP 4
print("\nGROUP 4: REQUIRED FIELDS IN PRISMA CREATES")
check("referral_code present in User.create (schema: NOT NULL, no default)",
      contains("referral_code:", "services/auth/src/services/authService.ts"),
      "referral_code: not found — every registration will crash with Prisma error")
check("device_id present in RefreshToken.create (schema: NOT NULL, no default)",
      contains("device_id:", "services/auth/src/services/authService.ts"),
      "device_id: not found — every login/refresh will crash with Prisma error")

# GROUP 5
print("\nGROUP 5: TRUST TIER ENV VAR NAMES IN DOCKER-COMPOSE")
check("TRUST_TIER_TRUSTED_THRESHOLD present (was wrong name VERIFIED)",
      contains("TRUST_TIER_TRUSTED_THRESHOLD", "docker-compose.yml"),
      "TRUST_TIER_TRUSTED_THRESHOLD not found in docker-compose.yml")
check("TRUST_TIER_HIGHLY_TRUSTED=80 correct (was PREMIUM=85)",
      contains("TRUST_TIER_HIGHLY_TRUSTED_THRESHOLD:-80", "docker-compose.yml"),
      "HIGHLY_TRUSTED_THRESHOLD:-80 not found — wrong threshold value")
check("Wrong name TRUST_TIER_VERIFIED_THRESHOLD is gone",
      notcontains("TRUST_TIER_VERIFIED_THRESHOLD", "docker-compose.yml"),
      "STILL HAS VERIFIED_THRESHOLD — env var name does not match code")
check("Wrong name TRUST_TIER_PREMIUM_THRESHOLD is gone",
      notcontains("TRUST_TIER_PREMIUM_THRESHOLD", "docker-compose.yml"),
      "STILL HAS PREMIUM_THRESHOLD — env var name does not match code")

# GROUP 6
print("\nGROUP 6: SQS QUEUE NAME STANDARDIZATION")
check("Old wrong name SQS_TRUST_EVENTS_QUEUE_URL is gone",
      notcontains("SQS_TRUST_EVENTS_QUEUE_URL", "docker-compose.yml"),
      "STILL HAS SQS_TRUST_EVENTS_QUEUE_URL — name mismatch with service code")
check("Standard name SQS_TRUST_SCORE_UPDATES_URL present",
      contains("SQS_TRUST_SCORE_UPDATES_URL", "docker-compose.yml"),
      "SQS_TRUST_SCORE_UPDATES_URL not in docker-compose.yml")

# GROUP 7
print("\nGROUP 7: PAYMENT SERVICE RS256 (Critical Rule 15)")
check("JWT_SECRET (HS256) removed from payment routes",
      notcontains("JWT_SECRET", "services/payment/src/routes/payment.routes.ts"),
      "STILL HAS JWT_SECRET — any service can forge payment tokens with HS256")
check("JWT_PUBLIC_KEY (RS256) used in payment routes",
      contains("JWT_PUBLIC_KEY", "services/payment/src/routes/payment.routes.ts"),
      "JWT_PUBLIC_KEY not found in payment routes")
check("RS256 algorithm specified in payment routes",
      contains("RS256", "services/payment/src/routes/payment.routes.ts"),
      "RS256 not found")

# GROUP 8
print("\nGROUP 8: PAYMENT APP CLEANUP")
check("pg (wrong DB library) removed from payment/app.ts",
      notcontains("from 'pg'", "services/payment/src/app.ts"),
      "STILL IMPORTS pg — should use Prisma, not raw PostgreSQL driver")
check("express-rate-limit removed (not fail-open, violates Critical Rule 16)",
      notcontains("express-rate-limit", "services/payment/src/app.ts"),
      "STILL HAS express-rate-limit — not Redis-backed, not fail-open")
check("console.log removed from payment/app.ts (must use logger)",
      notcontains("console.log", "services/payment/src/app.ts"),
      "STILL HAS console.log — no correlation_id, no CloudWatch integration")
check("Shared errorHandler registered in payment/app.ts",
      contains("errorHandler", "services/payment/src/app.ts"),
      "errorHandler not found — errors expose stack traces in production")

# GROUP 9
print("\nGROUP 9: SEARCH APP CLEANUP")
check("err.statusCode removed (AppError has httpStatus not statusCode)",
      notcontains("err.statusCode", "services/search/src/app.ts"),
      "STILL HAS err.statusCode — every custom error returns 500 instead of correct status")
check("Shared errorHandler registered in search/app.ts",
      contains("errorHandler", "services/search/src/app.ts"),
      "errorHandler not found")
check("Shared correlationId middleware in search/app.ts",
      contains("correlationId", "services/search/src/app.ts"),
      "correlationId not found — logger cannot inject correlation_id for search requests")

# GROUP 10
print("\nGROUP 10: ADMIN MIDDLEWARE")
check("{ db } removed from admin middleware (db is not exported by @satvaaah/db)",
      notcontains("{ db }", "services/admin/src/middleware/requireAdmin.ts"),
      "STILL IMPORTS { db } — crashes on service startup, db does not exist")
check("{ prisma } used in admin middleware (correct export name)",
      contains("{ prisma }", "services/admin/src/middleware/requireAdmin.ts"),
      "{ prisma } not found")
check("IIFE removed (was crashing if JWT_PUBLIC_KEY env var missing)",
      notcontains("const PUBLIC_KEY: string = (() =>", "services/admin/src/middleware/requireAdmin.ts"),
      "STILL HAS IIFE — crashes on module import if JWT_PUBLIC_KEY not set")
check("Admin role read from JWT decoded.role (AdminUser DB has no role column)",
      contains("role: decoded.role", "services/admin/src/middleware/requireAdmin.ts"),
      "decoded.role not found — admin role will always be undefined")

# GROUP 11
print("\nGROUP 11: CONFIG PACKAGE")
check("Wrong export 'getSystemConfig' gone from config/index.ts",
      notcontains("getSystemConfig", "packages/config/src/index.ts"),
      "STILL EXPORTS getSystemConfig — this function does not exist, import returns undefined")
check("Wrong export 'getConfigValue' gone from config/index.ts",
      notcontains("getConfigValue", "packages/config/src/index.ts"),
      "STILL EXPORTS getConfigValue — this function does not exist")
check("loadSystemConfig correctly exported from config/index.ts",
      contains("loadSystemConfig", "packages/config/src/index.ts"),
      "loadSystemConfig NOT exported — every service import of this function fails")
check("loadSystemConfig returns Promise<Record> not Promise<void>",
      contains("Promise<Record<string, string>>", "packages/config/src/systemConfig.ts"),
      "Still returns void — services call: const config = await loadSystemConfig() — config is undefined")
check("Cache TTL prevents DB query on every request",
      contains("CACHE_TTL_MS", "packages/config/src/systemConfig.ts"),
      "CACHE_TTL_MS not found — every request hits the database to load config")
check("getDailyRatingLimit uses rating_daily_limit (V031 seed key name)",
      contains("rating_daily_limit_products", "packages/config/src/systemConfig.ts"),
      "rating_daily_limit_products not found — V031 seeds this key name, lookup returns ConfigurationError")
check("Wrong key name daily_rating_limit_products gone",
      notcontains("daily_rating_limit_products", "packages/config/src/systemConfig.ts"),
      "STILL HAS daily_rating_limit — different from V031 key, config lookup always throws")

# GROUP 12
print("\nGROUP 12: DB PACKAGE EXPORTS")
check("ConsumerRating exported from @satvaaah/db",
      contains("ConsumerRating,", "packages/db/src/index.ts"),
      "ConsumerRating not exported — TypeScript build fails for rating service")
check("ProviderVerification exported from @satvaaah/db",
      contains("ProviderVerification,", "packages/db/src/index.ts"),
      "ProviderVerification not exported")
check("ProviderLeadStatus exported (correct Prisma enum name)",
      contains("ProviderLeadStatus as PrismaProviderLeadStatus", "packages/db/src/index.ts"),
      "ProviderLeadStatus not exported")
check("Non-existent OpenSearchSyncStatus NOT exported",
      notcontains("OpenSearchSyncStatus as PrismaOpenSearchSyncStatus", "packages/db/src/index.ts"),
      "STILL EXPORTS OpenSearchSyncStatus — this enum does not exist in Prisma, build fails")

# GROUP 13
print("\nGROUP 13: SCHEMA.PRISMA")
check("NotificationLog @@map is notification_log (V020 created singular name)",
      contains('@@map("notification_log")', "packages/db/prisma/schema.prisma"),
      "@@map notification_log not found — every Prisma notificationLog query fails with table not found")
check("Wrong @@map notification_logs (plural) is gone",
      notcontains('@@map("notification_logs")', "packages/db/prisma/schema.prisma"),
      "STILL HAS notification_logs plural — table does not exist in database")
check("ContactStatus enum has 'cancelled' value",
      contains("cancelled // consumer cancelled", "packages/db/prisma/schema.prisma"),
      "cancelled not in ContactStatus — Prisma cannot write/read cancelled status")
check("ProviderLeadStatus enum exists in schema",
      contains("enum ProviderLeadStatus {", "packages/db/prisma/schema.prisma"),
      "ProviderLeadStatus enum missing — leadService.ts providerStatus queries fail")
check("ContactEvent model has providerStatus field",
      contains("providerStatus  ProviderLeadStatus", "packages/db/prisma/schema.prisma"),
      "providerStatus field missing — entire lead accept/decline flow broken")
check("ScrapingJob model in schema (was missing, V028 created table)",
      contains("model ScrapingJob {", "packages/db/prisma/schema.prisma"),
      "ScrapingJob model missing — Prisma cannot generate types for this table")
check("ConsumerRating model in schema",
      contains("model ConsumerRating {", "packages/db/prisma/schema.prisma"),
      "ConsumerRating model missing")
check("ProviderVerification model in schema",
      contains("model ProviderVerification {", "packages/db/prisma/schema.prisma"),
      "ProviderVerification model missing")

# GROUP 14
print("\nGROUP 14: MIGRATIONS")
check("V033 ProviderLeadStatus migration exists",
      fileexists("packages/db/prisma/migrations/V033_provider_lead_status/migration.sql"),
      "V033 missing — DB has no ProviderLeadStatus enum, providerStatus column")
check("V034 provider_verifications migration exists",
      fileexists("packages/db/prisma/migrations/V034_provider_verifications/migration.sql"),
      "V034 missing — provider_verifications table does not exist in database")
check("V035 consumer_ratings migration exists",
      fileexists("packages/db/prisma/migrations/V035_consumer_ratings/migration.sql"),
      "V035 missing — consumer_ratings table does not exist in database")

# GROUP 15
print("\nGROUP 15: LOGGER")
check("maskPhone preserves country code (e.g. +91******3210)",
      contains("const cc = digits.slice(0, 2)", "packages/logger/src/index.ts"),
      "Country code logic not found — +91 gets masked, violates MASTER_CONTEXT spec")
check("Dead 'prefix' variable removed from maskPhone",
      notcontains("const prefix = phone.slice", "packages/logger/src/index.ts"),
      "STILL HAS dead prefix variable — computed but never used in return value")
check("camelCase 'accessToken' covered in SENSITIVE_KEYS",
      contains("'accesstoken'", "packages/logger/src/index.ts"),
      "accesstoken not in SENSITIVE_KEYS — accessToken field logs in clear text")
check("fcm_token in SENSITIVE_KEYS (device identifier)",
      contains("'fcm_token'", "packages/logger/src/index.ts"),
      "fcm_token not in SENSITIVE_KEYS")

# GROUP 16
print("\nGROUP 16: TYPES PACKAGE")
check("TrustFlagType has RATING_MANIPULATION (correct Prisma schema value)",
      contains("RATING_MANIPULATION = 'rating_manipulation'", "packages/types/src/index.ts"),
      "rating_manipulation not found — old wrong values still there")
check("Wrong TrustFlagType value BURST_DETECTION gone",
      notcontains("BURST_DETECTION = 'burst_detection'", "packages/types/src/index.ts"),
      "STILL HAS burst_detection — not in Prisma schema, any flag create will fail")
check("ContactStatus has COMPLETED value",
      contains("COMPLETED = 'completed'", "packages/types/src/index.ts"),
      "COMPLETED not in ContactStatus enum — schema has it but types didn't")
check("ContactStatus has CANCELLED value",
      contains("CANCELLED = 'cancelled'", "packages/types/src/index.ts"),
      "CANCELLED not in ContactStatus enum")
check("SystemConfigKey uses V031 name: rating_daily_limit_products",
      contains("'rating_daily_limit_products'", "packages/types/src/index.ts"),
      "rating_daily_limit_products not in SystemConfigKey type")

# GROUP 17
print("\nGROUP 17: PACKAGE TSCONFIGS (all 6 were missing)")
for pkg in ["types", "errors", "logger", "middleware", "config", "db"]:
    check(f"packages/{pkg}/tsconfig.json exists",
          fileexists(f"packages/{pkg}/tsconfig.json"),
          f"MISSING — tsc build command in {pkg}/package.json will fail")

# GROUP 18
print("\nGROUP 18: LAMBDA DEPENDENCIES (all 9 had pg not prisma)")
for name in ["trust-recalculate","certificate-generator","push-discovery",
             "anonymisation","opensearch-sync","outreach-scheduler",
             "delivery-monitor","ratings-refresh","ai-narration"]:
    try:
        with open(f"lambdas/{name}/package.json") as f:
            pkg = json.load(f)
        has_prisma = "@prisma/client" in pkg.get("dependencies", {})
        has_pg = "pg" in pkg.get("dependencies", {})
        check(f"lambda/{name}: has @prisma/client, no unused pg",
              has_prisma and not has_pg,
              f"prisma={has_prisma} pg={has_pg}")
    except Exception as e:
        check(f"lambda/{name}: package.json readable", False, str(e))

# GROUP 19
print("\nGROUP 19: SERVICE_NAME IN DOCKER-COMPOSE (was missing, logs all said 'satvaaah')")
for svc in ["auth","user","search","trust","rating","notification","payment","admin"]:
    check(f"SERVICE_NAME={svc} in docker-compose",
          contains(f"SERVICE_NAME: {svc}", "docker-compose.yml"),
          f"SERVICE_NAME={svc} missing — service logs as 'satvaaah', CloudWatch filter broken")

# GROUP 20
print("\nGROUP 20: NOTIFICATION ROUTES")
check("req.user.sub removed from notification routes",
      notcontains("req.user!.sub", "services/notification/src/routes/notification.routes.ts"),
      "STILL HAS req.user.sub — userId is undefined in every notification handler")
check("req.user.userId used in notification routes",
      contains("req.user!.userId", "services/notification/src/routes/notification.routes.ts"),
      "req.user.userId not found")

# GROUP 21
print("\nGROUP 21: RATELIMITER API")
check("rateLimiter(windowMs,max,keyPrefix) function exported (was missing)",
      contains("export function rateLimiter", "packages/middleware/src/rateLimiter.ts"),
      "rateLimiter function not exported — 13 service calls to rateLimiter() all crash on startup")

# GROUP 22
print("\nGROUP 22: TURBO.JSON (was a YAML comment file, invalid JSON)")
try:
    with open("turbo.json") as f:
        t = json.load(f)
    check("turbo.json is valid JSON", True)
    check("turbo.json has pipeline key", "pipeline" in t,
          "pipeline key missing")
except Exception as e:
    check("turbo.json is valid JSON", False, f"JSON parse error: {e}")

# GROUP 23
print("\nGROUP 23: ESLINTRC.JS (was a YAML comment, not valid JS)")
check(".eslintrc.js has module.exports (valid JavaScript)",
      contains("module.exports", ".eslintrc.js"),
      "module.exports not found — ESLint crashes loading this file")

# FINAL
total = pass_count + fail_count
print()
print("━"*60)
print(f" RESULT: {pass_count} PASS  /  {fail_count} FAIL  /  {total} TOTAL")
if fail_count == 0:
    print(" ✅ ALL CHECKS PASSED")
else:
    print(f" ❌ {fail_count} CHECKS FAILED — scroll up to see which ones")
print("━"*60)

sys.exit(1 if fail_count > 0 else 0)
PYEOF
