#!/bin/bash
python3 - << 'PYEOF'
import re, os, json, sys

pass_count = 0
fail_count = 0

def check(label, ok, detail=""):
    global pass_count, fail_count
    if ok:
        print(f"  \033[32m✅ PASS:\033[0m {label}")
        pass_count += 1
    else:
        print(f"  \033[31m❌ FAIL:\033[0m {label}")
        if detail: print(f"     WHY:  {detail}")
        fail_count += 1

def read(path):
    try:
        with open(path) as f: return f.read()
    except: return ""

def contains(text, content): return text in content
def not_contains(text, content): return text not in content
def fileexists(path): return os.path.exists(path)

SQL_KEYWORDS = {
    'create','table','index','trigger','function','type','extension',
    'constraint','primary','unique','foreign','check','references',
    'deferrable','initially','deferred','not','null','default','on',
    'delete','cascade','restrict','where','using','gist','gin',
    'before','after','each','row','execute','begin','end','return',
    'new','language','plpgsql','comment','is','for','do','case','when',
    'then','else','update','insert','into','values','select','from',
    'if','and','or','as','with','by','asc','desc','limit','offset',
    'join','left','right','inner','outer','cross','all','any','some',
    'add','drop','alter','rename','column','to',
    'no','action','match','full','partial','simple','deferred',
    'immediate','per','always','generated','stored','identity',
    'enable','disable','replica','true','false','serial',
}

def get_db_columns(migration_sql):
    tables = {}
    for mig_name, sql in migration_sql.items():
        lines = sql.split('\n')
        i = 0
        while i < len(lines):
            m = re.match(r'\s*CREATE TABLE(?:\s+IF NOT EXISTS)?\s+["\']?(\w+)["\']?\s*\(', lines[i], re.I)
            if m:
                tname = m.group(1).lower()
                tables.setdefault(tname, set())
                depth = lines[i].count('(') - lines[i].count(')')
                j, block = i + 1, [lines[i]]
                while j < len(lines) and depth > 0:
                    block.append(lines[j])
                    depth += lines[j].count('(') - lines[j].count(')')
                    j += 1
                for bl in block:
                    bl2 = bl.strip()
                    if not bl2 or re.match(r'^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|--|/\*|DEFERRABLE)', bl2, re.I): continue
                    cm = re.match(r'^["\']?([a-zA-Z_]\w*)["\']?\s+\S', bl2)
                    if cm:
                        col = cm.group(1).lower()
                        if col not in SQL_KEYWORDS: tables[tname].add(col)
                i = j; continue
            i += 1
        for m in re.finditer(r'ALTER TABLE ["\']?(\w+)["\']?', sql, re.I):
            tname = m.group(1).lower()
            stmt_end = sql.find(';', m.start())
            if stmt_end == -1: continue
            stmt = sql[m.start():stmt_end + 1]
            for cm in re.finditer(r'ADD COLUMN(?:\s+IF NOT EXISTS)?\s+["\']?([a-zA-Z_]\w*)["\']?', stmt, re.I):
                col = cm.group(1).lower()
                if col not in SQL_KEYWORDS: tables.setdefault(tname, set()).add(col)
        for m in re.finditer(r'ALTER TABLE ["\']?(\w+)["\']?\s+RENAME COLUMN\s+["\']?(\w+)["\']?\s+TO\s+["\']?(\w+)["\']?', sql, re.I):
            t, old, new = m.group(1).lower(), m.group(2).lower(), m.group(3).lower()
            if t in tables: tables[t].discard(old); tables[t].add(new) if new not in SQL_KEYWORDS else None
        for m in re.finditer(r'ALTER TABLE ["\']?(\w+)["\']?\s+DROP COLUMN(?:\s+IF EXISTS)?\s+["\']?([a-zA-Z_]\w*)["\']?', sql, re.I):
            t, c = m.group(1).lower(), m.group(2).lower()
            if t in tables: tables[t].discard(c)
    return tables

def get_models(text):
    models = {}
    lines = text.split('\n')
    i = 0
    while i < len(lines):
        m = re.match(r'^model (\w+) \{', lines[i])
        if m:
            model_name, fields, table, depth = m.group(1), {}, None, 1
            i += 1
            while i < len(lines) and depth > 0:
                l = lines[i]
                depth += l.count('{') - l.count('}')
                if depth <= 0: break
                s = l.strip()
                mm = re.search(r'@@map\("([^"]+)"\)', s)
                if mm: table = mm.group(1)
                if s and not s.startswith('//') and not s.startswith('@@') and not s.startswith('@'):
                    parts = s.split()
                    if len(parts) >= 2 and re.match(r'^[a-zA-Z_]\w*$', parts[0]):
                        fields[parts[0]] = parts[1].rstrip('?[]')
                i += 1
            if table is None:
                table = re.sub(r'(?<!^)(?=[A-Z])', '_', model_name).lower() + 's'
            models[model_name] = {'table': table, 'fields': fields}
        else: i += 1
    return models

SKIP = {
    'id','created_at','updated_at','consumer','provider','user','plan','sender',
    'contact_event','taxonomy_node','city','area','ratings','rating','trust_score_record',
    'trust_score_histories','contact_events','provider_profile','consumer_profile',
    'refresh_tokens','consent_records','notification_logs','sent_messages','search_intents',
    'subscription_records','referrals_made','referrals_received','external_ratings',
    'verifications','provider_lead_usages','trust_flags','certificate_record',
    'opensearch_sync_logs','tsaas_usage_logs','saved_by_consumers','consumer_ratings_given',
    'consumer_ratings_received','ratings_received','in_app_messages','consumer_ratings',
    'saved_providers','subscription_plans','consumer_lead_usages','staging_records',
    'staging','usage_logs','areas','consumer_profiles','provider_profiles',
    'certificate_records','referrer','referred','parent','children','scraping_jobs',
    'scrape_stagings','outreach_schedules','daily_rating_usages','trust_score_config',
    'api_key','outreach_schedule','job','subscription_plan',
}

def p2s(name): return re.sub(r'(?<!^)(?=[A-Z])', '_', name).lower()

def hs256_in_code(content):
    for line in content.split('\n'):
        stripped = line.strip()
        if stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'): continue
        if 'HS256' in line.split('//')[0]: return True
    return False

schema_text = read("packages/db/prisma/schema.prisma")
mig_dir = "packages/db/prisma/migrations"
migration_sql = {}
for d in sorted(os.listdir(mig_dir)):
    path = os.path.join(mig_dir, d, "migration.sql")
    if os.path.exists(path):
        with open(path) as f: migration_sql[d] = f.read()

models  = get_models(schema_text)
db_cols = get_db_columns(migration_sql)
v_nums  = sorted([int(re.match(r'V(\d+)', d).group(1)) for d in os.listdir(mig_dir) if re.match(r'V\d+', d)])

print()
print("━"*62)
print("  SATVAAAH FULL HEALTH CHECK — SECTIONS 1-30")
print("━"*62)

# ══ BLOCK A: Files ═══════════════════════════════════════════════
print("\n── BLOCK A: CRITICAL FILES ──────────────────────────────────")
for f in [
    "packages/db/prisma/schema.prisma","packages/db/src/index.ts",
    "packages/types/src/index.ts","packages/middleware/src/requireAuth.ts",
    "packages/middleware/src/rateLimiter.ts","packages/config/src/systemConfig.ts",
    "docker-compose.yml","turbo.json",".eslintrc.js",
    "services/auth/src/app.ts","services/auth/src/routes/auth.routes.ts",
    "services/auth/src/controllers/auth.controller.ts",
    "services/auth/src/services/authService.ts","services/auth/src/redis.ts",
    "services/user/src/app.ts","services/user/src/routes/contact.routes.ts",
    "services/user/src/routes/lead.routes.ts","services/user/src/routes/message.routes.ts",
    "services/user/src/services/sqsHelper.ts","services/user/src/services/contactService.ts",
]:
    check(f"Exists: {f}", fileexists(f))

# ══ BLOCK B: JSON validity ════════════════════════════════════════
print("\n── BLOCK B: JSON / JS VALIDITY ──────────────────────────────")
for f in ["turbo.json",".prettierrc","package.json"]:
    try: json.loads(read(f)); check(f"{f} valid JSON", True)
    except Exception as e: check(f"{f} valid JSON", False, str(e))
check("turbo.json has pipeline",         '"pipeline"' in read("turbo.json"))
check(".eslintrc.js has module.exports", "module.exports" in read(".eslintrc.js"))

# ══ BLOCK C: Schema vs migrations ════════════════════════════════
print(f"\n── BLOCK C: SCHEMA vs MIGRATIONS ({len(v_nums)} migrations, {len(models)} models) ──")
model_issues = []
for model_name, info in sorted(models.items()):
    table, fields = info['table'], info['fields']
    db = db_cols.get(table, set())
    if table not in db_cols:
        missing = [f for f in fields if f not in SKIP]
        if missing: model_issues.append((model_name, table, missing, 'NO TABLE'))
        continue
    missing = [p2s(fname) for fname in fields if fname not in SKIP and p2s(fname) not in db and fname.lower() not in db]
    if missing: model_issues.append((model_name, table, missing, 'MISSING COLS'))
if not model_issues:
    check(f"All {len(models)} schema models fully covered in migrations", True)
else:
    check(f"All {len(models)} schema models fully covered in migrations", False,
          f"{len(model_issues)} models have gaps")
    for model_name, table, missing, reason in model_issues:
        print(f"\n  ❌ {model_name} → {table} ({reason}): {missing[:6]}")

# ══ BLOCK D: Auth service fixes (S1-S9, S21-S25) ════════════════
print("\n── BLOCK D: AUTH SERVICE FIXES ──────────────────────────────")
auth    = read("services/auth/src/services/authService.ts")
rauth   = read("packages/middleware/src/requireAuth.ts")
cfg_s   = read("packages/config/src/systemConfig.ts")
cfg_i   = read("packages/config/src/index.ts")
auth_app= read("services/auth/src/app.ts")
auth_rt = read("services/auth/src/routes/auth.routes.ts")
auth_ctl= read("services/auth/src/controllers/auth.controller.ts")
auth_red= read("services/auth/src/redis.ts")

check("S24: JWT issues 'sub' not userId",              contains("sub: user.id", auth))
check("S1:  requireAuth maps payload.sub → userId",    "userId:" in rauth and "payload.sub" in rauth)
check("S1:  requireAuth RS256 algorithm",              contains("algorithms: ['RS256']", rauth))
check("S24: authService mode='consumer' (lowercase)",  contains("mode: 'consumer'", auth))
check("S24: authService subscription_tier='free'",     contains("subscriptionTier: 'free'", auth))
check("S24: ConsentRecord granted_at (not given_at)",  contains("grantedAt: new Date()", auth))
check("S24: referral_code in User.create",             contains("referralCode:", auth))
check("S24: device_id in RefreshToken.create",         contains("deviceId:", auth))
check("S24: CRITICAL deleted_at check before login",   contains("deletedAt", auth))
check("S24: userAgent stored on RefreshToken",         contains("userAgent: userAgent", auth))
check("S24: ip_address stored on RefreshToken",        contains("ipAddress: ip", auth))
check("S24: policy_version in ConsentRecord",          contains("policyVersion:", auth))
check("S24: refreshTokens checks deleted_at on rotate",contains("deletedAt", auth) and contains("ACCOUNT_DELETED", auth))
check("S21: auth/app.ts has rateLimiter",              contains("rateLimiter", auth_app))
check("S21: auth/app.ts calls loadSystemConfig",       contains("loadSystemConfig", auth_app))
check("S21: auth/app.ts calls registerSighupReload",   contains("registerSighupReload", auth_app))
check("S21: auth/app.ts uses notFoundHandler",         contains("notFoundHandler", auth_app))
check("S21: auth/app.ts PORT from env not hardcoded",  not_contains("const PORT = 3001", auth_app))
check("S22: /admin/verify has adminRateLimiter",       contains("adminRateLimiter", auth_rt))
check("S22: /token/refresh has refreshRateLimiter",    contains("refreshRateLimiter", auth_rt))
check("S23: firebaseVerify captures userAgent",        contains("user-agent", auth_ctl))
check("S23: adminVerify logs audit trail",             contains("Admin login attempt", auth_ctl))
check("S23: CONSENT_REQUIRED throws ValidationError",  contains("throw new ValidationError", auth_ctl) and not_contains("res.status(400).json", auth_ctl))
check("S25: auth/redis.ts supports REDIS_URL",         contains("REDIS_URL", auth_red))
check("S25: auth/redis.ts no dead reconnectTimer",     not_contains("let reconnectTimer", auth_red))
check("S15: HS256 only in comments (not code)",        not hs256_in_code(rauth))
check("S15: No HS256 in auth service code",            not hs256_in_code(auth))

# ══ BLOCK E: Config + Types fixes (S6, S2) ════════════════════════
print("\n── BLOCK E: CONFIG + TYPES FIXES ────────────────────────────")
check("S6:  loadSystemConfig returns Record not void",       contains("Promise<Record<string, string>>", cfg_s))
check("S6:  getDailyRatingLimit uses correct V031 key",      contains("rating_daily_limit_products", cfg_s))
check("S6:  config/index exports loadSystemConfig",          contains("loadSystemConfig", cfg_i))
check("S6:  config/index no wrong getSystemConfig export",   not_contains("getSystemConfig", cfg_i))
check("S2:  types: JwtPayload has sub not userId",           contains("sub: string;", read("packages/types/src/index.ts")))
check("S2:  types: ContactStatus has CANCELLED",             contains("CANCELLED = 'cancelled'", read("packages/types/src/index.ts")))
check("S2:  types: TrustFlagType RATING_MANIPULATION",       contains("RATING_MANIPULATION = 'rating_manipulation'", read("packages/types/src/index.ts")))
check("S4:  logger: maskPhone preserves country code",       contains("const cc = digits.slice(0, 2)", read("packages/logger/src/index.ts")))
check("S4:  logger: @types/winston removed",                 not_contains("@types/winston", read("packages/logger/package.json")))
check("S5:  db/index exports ConsumerRating",                contains("ConsumerRating,", read("packages/db/src/index.ts")))
check("S5:  db/index exports ProviderVerification",          contains("ProviderVerification,", read("packages/db/src/index.ts")))

# ══ BLOCK F: Docker-compose fixes (S1) ═══════════════════════════
print("\n── BLOCK F: DOCKER-COMPOSE FIXES ────────────────────────────")
dc = read("docker-compose.yml")
check("S1:  TRUST_TIER_TRUSTED_THRESHOLD (not VERIFIED)",    contains("TRUST_TIER_TRUSTED_THRESHOLD", dc))
check("S1:  TRUST_TIER_HIGHLY_TRUSTED:-80 (was PREMIUM:-85)",contains("TRUST_TIER_HIGHLY_TRUSTED_THRESHOLD:-80", dc))
check("S1:  TRUST_TIER_VERIFIED_THRESHOLD gone",             not_contains("TRUST_TIER_VERIFIED_THRESHOLD", dc))
check("S1:  TRUST_TIER_PREMIUM_THRESHOLD gone",              not_contains("TRUST_TIER_PREMIUM_THRESHOLD", dc))
check("S1:  SQS_TRUST_SCORE_UPDATES_URL present",            contains("SQS_TRUST_SCORE_UPDATES_URL", dc))
check("S1:  SQS_TRUST_EVENTS_QUEUE_URL gone",                not_contains("SQS_TRUST_EVENTS_QUEUE_URL", dc))
for svc in ["auth","user","search","trust","rating","notification","payment","admin"]:
    check(f"S4:  SERVICE_NAME={svc} in docker-compose",      contains(f"SERVICE_NAME: {svc}", dc))

# ══ BLOCK G: Schema integrity (S9) ═══════════════════════════════
print("\n── BLOCK G: SCHEMA INTEGRITY ────────────────────────────────")
mc = len(re.findall(r'^model \w+ \{', schema_text, re.MULTILINE))
ec = len(re.findall(r'^enum \w+ \{',  schema_text, re.MULTILINE))
check("S9:  Schema has 36 models",                       mc == 36, f"Got {mc}")
check("S9:  Schema has 18 enums",                        ec == 18, f"Got {ec}")
check("S9:  @@map notification_log (singular)",          contains('@@map("notification_log")', schema_text))
check("S9:  ContactStatus has cancelled",                contains("cancelled", schema_text))
check("S9:  ProviderLeadStatus enum exists",             contains("enum ProviderLeadStatus {", schema_text))
check("S9:  ContactEvent has providerStatus",            contains("providerStatus  ProviderLeadStatus", schema_text))
check("S9:  TrustScoreConfig has decay_days",            contains("decay_days", schema_text))
check("S9:  TrustScore has signal_breakdown",            contains("signal_breakdown", schema_text))
mf = [l for l in schema_text.split('\n') if 'Float' in l
      and any(w in l.lower() for w in ['price','amount','paise']) and not l.strip().startswith('//')]
check("S9:  No Float monetary fields (PAISE rule)",      len(mf) == 0, f"{mf[:1]}")

# ══ BLOCK H: User service fixes (S27-S30) ════════════════════════
print("\n── BLOCK H: USER SERVICE FIXES ──────────────────────────────")
user_app= read("services/user/src/app.ts")
cont_svc= read("services/user/src/services/contactService.ts")
ver_svc = read("services/user/src/services/verificationService.ts")
pro_svc = read("services/user/src/services/providerService.ts")
cont_rt = read("services/user/src/routes/contact.routes.ts")
lead_rt = read("services/user/src/routes/lead.routes.ts")
msg_rt  = read("services/user/src/routes/message.routes.ts")

check("S27: contactRoutes imported in user/app.ts",          contains("contactRoutes", user_app))
check("S27: leadRoutes imported in user/app.ts",             contains("leadRoutes", user_app))
check("S27: messageRoutes imported in user/app.ts",          contains("messageRoutes", user_app))
check("S27: contact-events registered in user/app.ts",       contains("contact-events", user_app))
check("S27: user/app.ts PORT from env not hardcoded",        not_contains("const PORT = 3002", user_app))
check("S27: user/app.ts has notFoundHandler",                contains("notFoundHandler", user_app))
check("S27: user/app.ts calls loadSystemConfig",             contains("loadSystemConfig", user_app))
check("S27: user/app.ts CORS not hardcoded '*'",             contains("WS_CORS_ORIGIN", user_app))
check("S27: socketAuthMiddleware no provider_id from JWT",   not_contains("payload.provider_id", user_app))
check("S28: contact.routes uses '/' not '/contact-events'",  contains("router.post('/', ", cont_rt))
check("S28: lead routes mounted at /api/v1 not /api/v1/leads", contains("app.use('/api/v1',                  leadRoutes)", user_app))
check("S28: message routes mounted at /api/v1",              contains("app.use('/api/v1',                  messageRoutes)", user_app))
check("S30: contactService uses sqsPublish not sendSqsMessage", contains("sqsPublish", cont_svc) and not_contains("sendSqsMessage", cont_svc))
check("S30: contactService no import from non-existent lib/sqsClient", not_contains("lib/sqsClient", cont_svc))
check("S30: verificationService uses SQS_TRUST_SCORE_UPDATES_URL", contains("SQS_TRUST_SCORE_UPDATES_URL", ver_svc))
check("S30: verificationService no wrong TRUST_SCORE_UPDATES_QUEUE_URL", not_contains("TRUST_SCORE_UPDATES_QUEUE_URL'", ver_svc))
check("S30: providerService uses is_geo_verified not geo_verified", contains("is_geo_verified", pro_svc) and not_contains("geo_verified:", pro_svc.replace("is_geo_verified", "")))
check("S30: P12 RESOLVED: no ! assertion on SQS URL",       not_contains("SQS_TRUST_SCORE_UPDATES_URL!", cont_svc))

# ══ BLOCK I: Dockerfiles (S26) ════════════════════════════════════
print("\n── BLOCK I: DOCKERFILES (all 8 services) ────────────────────")
for svc in ["auth","user","search","trust","rating","notification","payment","admin"]:
    df = read(f"services/{svc}/Dockerfile")
    check(f"S26: {svc}/Dockerfile has prisma generate",      contains("prisma generate", df))
    check(f"S26: {svc}/Dockerfile no --frozen-lockfile",     not_contains("--frozen-lockfile", df))

# ══ BLOCK J: Lambda dependencies ═════════════════════════════════
print("\n── BLOCK J: LAMBDA DEPENDENCIES ────────────────────────────")
for name in ["trust-recalculate","certificate-generator","push-discovery",
             "anonymisation","opensearch-sync","outreach-scheduler",
             "delivery-monitor","ratings-refresh","ai-narration"]:
    try:
        pkg = json.loads(read(f"lambdas/{name}/package.json"))
        hp = "@prisma/client" in pkg.get("dependencies",{})
        hpg = "pg" in pkg.get("dependencies",{})
        check(f"S5:  lambda/{name}: @prisma/client=✓ pg=✗", hp and not hpg, f"prisma={hp} pg={hpg}")
    except: check(f"lambda/{name} readable", False)


# ══ BLOCK M: Search service fixes (S31-S40) ══════════════════════
print("\n── BLOCK M: SEARCH SERVICE FIXES ────────────────────────────")
search_app = read("services/search/src/app.ts")
search_rt  = read("services/search/src/routes/search.routes.ts")
search_ctl = read("services/search/src/controllers/search.controller.ts")
expand     = read("services/search/src/services/expandingRingSearch.ts")
intent     = read("services/search/src/services/intentService.ts")
suggest    = read("services/search/src/services/suggestService.ts")
os_client  = read("services/search/src/lib/opensearchClient.ts")
redis_cl   = read("services/search/src/lib/redisClient.ts")
os_lambda  = read("lambdas/opensearch-sync/index.ts")

check("S31: search/app.ts has rateLimiter",                contains("rateLimiter", search_app))
check("S31: search/app.ts calls loadSystemConfig",         contains("loadSystemConfig", search_app))
check("S31: search/app.ts calls registerSighupReload",     contains("registerSighupReload", search_app))
check("S31: search/app.ts has notFoundHandler",            contains("notFoundHandler", search_app))
check("S32: internalAuth uses timingSafeEqual (not !=)",   contains("timingSafeEqual", search_rt))
check("S32: internalAuth no timing-vulnerable !=",         not_contains("key !== expected", search_rt))
check("S33: controller imports from lib/opensearchClient", contains("from '../lib/opensearchClient'", search_ctl))
check("S33: getCategories uses isActive",                  contains("isActive: true", search_ctl))
check("S33: getProviderProfile uses displayName",          contains("displayName: true", search_ctl))
check("S33: getProviderProfile uses profilePhotoS3Key",     contains("profilePhotoS3Key", search_ctl))
check("S33: getProviderProfile uses taxonomyNode",         contains("taxonomyNode:", search_ctl))
check("S33: trustScore uses displayScore",                 contains("displayScore:", search_ctl))
check("S34: CRITICAL listing_type 'premium' filter removed", not_contains("listing_type: 'premium'", expand))
check("S34: 150km filter uses isClaimed",                  contains("isClaimed: true", expand))
check("S34: OPENSEARCH_INDEX imported from lib",           contains("from '../lib/opensearchClient'", expand))
check("S35: intentService uses findFirst not upsert",      contains("findFirst", intent) and not_contains("upsert", intent))
check("S36: suggestService uses isActive",                 contains("isActive: true", suggest))
check("S37: opensearchClient exports OPENSEARCH_INDEX",    contains("export const OPENSEARCH_INDEX", os_client))
check("S38: redisClient uses promise singleton",           contains("_clientPromise", redis_cl))
check("S38: ioredis removed from search/package.json",     not_contains("ioredis", read("services/search/package.json")))
check("S40: expandingRingSearch no profile_photo_url",     not_contains("profile_photo_url", expand))
check("S40: expandingRingSearch reads taxonomy_l4 not category_l4", contains("taxonomy_l4", expand))
check("S40: Lambda uses isGeoVerified not address_verified", contains("isGeoVerified", os_lambda) and not_contains("address_verified", os_lambda))


# ══ BLOCK N: Trust + Rating service fixes (S41-S50) ════════════════════
print("\n── BLOCK N: TRUST + RATING SERVICE FIXES ────────────────────")
trust_app = read("services/trust/src/app.ts")
trust_rt  = read("services/trust/src/routes/trust.routes.ts")
tsaas_rt  = read("services/trust/src/routes/tsaas.routes.ts")
trust_ctl = read("services/trust/src/controllers/trust.controller.ts")
rating_app= read("services/rating/src/app.ts")
rate_svc  = read("services/rating/src/services/ratingService.ts")
disp_svc  = read("services/rating/src/services/disputeService.ts")
cons_svc  = read("services/rating/src/services/consumerTrustService.ts")

# S41: trust/app.ts
check("S41: trust/app.ts named import { logger }",       contains("{ logger }", trust_app))
check("S41: trust/app.ts no failOpen option",            not_contains("failOpen", trust_app))
check("S41: trust/app.ts uses notFoundHandler",          contains("notFoundHandler", trust_app))
check("S41: trust/app.ts calls loadSystemConfig",        contains("loadSystemConfig", trust_app))
check("S41: trust/app.ts calls registerSighupReload",    contains("registerSighupReload", trust_app))
# S42: trust.routes.ts
check("S42: trust routes timingSafeEqual (not !=)",      contains("timingSafeEqual", trust_rt))
check("S42: trust routes INTERNAL_SERVICE_KEY standard", contains("INTERNAL_SERVICE_KEY", trust_rt) and not_contains("SERVICE_INTERNAL_KEY", trust_rt))
check("S42: trust GET /:id is public (no requireAuth)",
      "asyncHandler(ctrl.getTrust" in trust_rt and
      "requireAuth,\n  asyncHandler(ctrl.getTrust" not in trust_rt)
# S42: tsaas.routes.ts
check("S42: tsaas.routes named { logger }",              contains("{ logger }", tsaas_rt))
check("S42: tsaas.routes named { prisma }",              contains("{ prisma }", tsaas_rt))
check("S42: tsaas quota re-reads live callsUsed from DB",contains("findUnique", tsaas_rt) and contains("liveUsed", tsaas_rt))
check("S42: tsaas requiresProviderConsent attached",     contains("requiresProviderConsent", tsaas_rt))
# S43: trust.controller.ts
check("S43: trust ctrl named { logger }",                contains("{ logger }", trust_ctl))
check("S43: trust ctrl named { prisma }",                contains("{ prisma }", trust_ctl))
check("S43: trust ctrl no ! SQS URL assertion",          not_contains("SQS_TRUST_SCORE_UPDATES_URL!", trust_ctl))
check("S43: trust ctrl FIFO MessageGroupId on SQS",      contains("MessageGroupId", trust_ctl))
# S47: rating/app.ts
check("S47: rating/app.ts has rateLimiter",              contains("rateLimiter", rating_app))
check("S47: rating/app.ts uses notFoundHandler",         contains("notFoundHandler", rating_app))
check("S47: rating/app.ts calls loadSystemConfig",       contains("loadSystemConfig", rating_app))
check("S47: rating/app.ts PORT not hardcoded",           not_contains("port: 3005,", rating_app))
# S49-50: rating services
check("S49: ratingService DailyRatingUsage.ratings_submitted", contains("ratings_submitted", rate_svc))
check("S49: ratingService no DailyRatingUsage.count",   not_contains("count: 1 }", rate_svc) and not_contains("count: { increment", rate_svc))
check("S48: disputeService FLAG_TYPE_MAP correct enums", contains("rating_manipulation", disp_svc) and not_contains("'FAKE_REVIEW'", disp_svc))
check("S50: consumerTrustService reviewNote not reviewText", contains("reviewNote", cons_svc) and not_contains("reviewText:", cons_svc))


# ══ BLOCK O: Notification + Payment service fixes (S51-S60) ════════════════
print("\n── BLOCK O: NOTIFICATION + PAYMENT FIXES ────────────────────")
notif_app  = read("services/notification/src/app.ts")
notif_rt   = read("services/notification/src/routes/notification.routes.ts")
fcm_svc    = read("services/notification/src/services/fcmService.ts")
wa_svc     = read("services/notification/src/services/whatsappService.ts")
del_svc    = read("services/notification/src/services/deliveryMonitorService.ts")
pay_app    = read("services/payment/src/app.ts")
pay_rt     = read("services/payment/src/routes/payment.routes.ts")
sub_svc    = read("services/payment/src/services/subscriptionService.ts")
ref_svc    = read("services/payment/src/services/referralService.ts")

# S51: notification/app.ts
check("S51: notification/app.ts has notFoundHandler",     contains("notFoundHandler", notif_app))
check("S51: notification/app.ts calls loadSystemConfig",  contains("loadSystemConfig", notif_app))
check("S51: notification/app.ts PORT not hardcoded",      not_contains("port: 3006", notif_app))
# S52-55: prisma model name
check("S52: notification routes uses prisma.notificationLog",
      contains("prisma.notificationLog.", notif_rt) and not_contains("prisma.notification_log.", notif_rt))
check("S53: fcmService uses prisma.notificationLog",
      contains("prisma.notificationLog.", fcm_svc) and not_contains("prisma.notification_log.", fcm_svc))
check("S54: whatsappService uses prisma.notificationLog",
      contains("prisma.notificationLog.", wa_svc) and not_contains("prisma.notification_log.", wa_svc))
check("S55: deliveryMonitorService uses prisma.notificationLog",
      contains("prisma.notificationLog.", del_svc) and not_contains("prisma.notification_log.", del_svc))
# S56: payment/app.ts
check("S56: payment/app.ts exports db pg Pool",           contains("export const db = new Pool", pay_app))
check("S56: payment/app.ts calls loadSystemConfig",       contains("loadSystemConfig", pay_app))
# S57: payment.routes.ts
check("S57: payment routes uses shared requireAuth",      contains("requireAuth", pay_rt) and not_contains("function authenticate", pay_rt))
check("S57: payment routes uses asyncHandler",            contains("asyncHandler", pay_rt))
check("S57: payment routes no console.error",             not_contains("console.error", pay_rt))
# S58-60: payment services
check("S58: subscriptionService uses plan.name not display_name", not_contains("plan.display_name", sub_svc) and contains("plan.name", sub_svc))
check("S58: subscriptionService uses price_paise SQL",    contains("price_paise", sub_svc))
check("S58: subscriptionService no payment_orders table", not_contains("payment_orders", sub_svc))
check("S59: referralService no referral_used_at column",  not_contains("referral_used_at", ref_svc))
check("S60: no console.* in payment services",
      not_contains("console.", read("services/payment/src/services/razorpayWebhook.ts")) and
      not_contains("console.", read("services/payment/src/services/leadCounterService.ts")))


# ══ BLOCK P: Admin service + Infrastructure (S61-S70) ══════════════════
print("\n── BLOCK P: ADMIN + INFRASTRUCTURE FIXES ────────────────────")
admin_app  = read("services/admin/src/app.ts")
admin_mw   = read("services/admin/src/middleware/requireAdmin.ts")
admin_rt   = read("services/admin/src/routes/admin.routes.ts")
admin_svc  = read("services/admin/src/services/adminService.ts")
dc         = read("docker-compose.yml")
pay_nc     = read("services/payment/src/services/notificationClient.ts")
notif_rt   = read("services/notification/src/routes/notification.routes.ts")

# S61: admin/app.ts
check("S61: admin/app.ts uses { prisma } not { db }",      contains("{ prisma }", admin_app) and not_contains("{ db }", admin_app))
check("S61: admin/app.ts no failOpen option",              not_contains("failOpen", admin_app))
check("S61: admin/app.ts uses notFoundHandler",            contains("notFoundHandler", admin_app))
check("S61: admin/app.ts calls loadSystemConfig",          contains("loadSystemConfig", admin_app))
check("S61: admin/app.ts json limit 64kb not 2mb",         contains("limit: '64kb'", admin_app) and not_contains("limit: '2mb'", admin_app))
# S62: admin.routes.ts
check("S62: dispute status uses open/under_review/resolved/dismissed",
      contains("under_review", admin_rt) and not_contains("upheld", admin_rt) and not_contains("weight_reduced", admin_rt))
# S64: adminService.ts
check("S64: adminService uses prisma not db",              contains("prisma.", admin_svc) and not_contains("db.", admin_svc))
check("S64: resolvedByAdminId in trustFlag update",        contains("resolvedByAdminId:", admin_svc))
check("S64: providerVerification not providerCredential",  contains("providerVerification", admin_svc) and not_contains("providerCredential", admin_svc))
# S65: requireAdmin.ts
check("S65: requireAdmin uses isActive not is_active",     contains("isActive: true", admin_mw) and not_contains("is_active: true", admin_mw))
# S67: docker-compose
check("S67: INTERNAL_SERVICE_KEY in user service",         contains("SERVICE_NAME: user", dc) and "INTERNAL_SERVICE_KEY" in dc[dc.index("SERVICE_NAME: user"):dc.index("SERVICE_NAME: user")+2000])
check("S67: INTERNAL_SERVICE_KEY in admin service",        contains("SERVICE_NAME: admin", dc) and "INTERNAL_SERVICE_KEY" in dc[dc.index("SERVICE_NAME: admin"):dc.index("SERVICE_NAME: admin")+2000])
check("S67: NOTIFICATION_SERVICE_URL in payment",          contains("SERVICE_NAME: payment", dc) and "NOTIFICATION_SERVICE_URL" in dc[dc.index("SERVICE_NAME: payment"):dc.index("SERVICE_NAME: payment")+2000])
# S70: cross-service contracts
check("S70: notification service has /internal/notify/fcm route",   contains("/internal/notify/fcm", notif_rt))
check("S70: paymentClient uses INTERNAL_SERVICE_KEY not TOKEN",     contains("INTERNAL_SERVICE_KEY", pay_nc) and not_contains("INTERNAL_SERVICE_TOKEN", pay_nc))
check("S70: paymentClient uses docker hostname not localhost",       contains("http://notification:3006", pay_nc) and not_contains("localhost:3006", pay_nc))
check("S70: adminService uses correct /api/v1/internal/notify/fcm", contains("/api/v1/internal/notify/fcm", admin_svc))


# ══ BLOCK Q: Sections 81-90 (Lambdas, Packages, Apps) ═════════════════════
print("\n── BLOCK Q: LAMBDAS + PACKAGES + APPS ───────────────────────")
outreach    = read("lambdas/outreach-scheduler/index.ts")
req_admin   = read("packages/middleware/src/requireAdmin.ts")
req_auth    = read("packages/middleware/src/requireAuth.ts")
types_idx   = read("packages/types/src/index.ts")
mobile_cli  = read("apps/mobile/src/api/client.ts")
errors_idx  = read("packages/errors/src/index.ts")

# S81: outreach-scheduler
check("S81: outreach uses camelCase Prisma fields (waOptedOut)",   contains("waOptedOut", outreach))
check("S81: outreach no snake_case wa_opted_out in select",        not_contains("wa_opted_out: true", outreach))
check("S81: outreach uses isClaimed not is_claimed",               contains("isClaimed", outreach) and not_contains("is_claimed) {", outreach))
# S82: requireAdmin
check("S82: requireAdmin is async (awaits requireAuth)",           contains("async function requireAdmin", req_admin))
check("S82: requireAdmin awaits requireAuth correctly",            contains("await requireAuth", req_admin))
# S71/S82: requireAuth
check("S71: requireAuth has JTI blocklist check",                  contains("jti_blocklist", req_auth))
check("S71: requireAuth is async for Redis check",                 contains("export async function requireAuth", req_auth))
check("S71: TokenRevokedError in errors package",                  contains("TokenRevokedError", errors_idx))
# S84: types
check("S84: TrustFlagStatus.UNDER_REVIEW not INVESTIGATING",       contains("UNDER_REVIEW = 'under_review'", types_idx) and not_contains("INVESTIGATING", types_idx))
check("S84: No duplicate SystemConfigKey entries",                 types_idx.count("scraped_external_stale_days") <= 2)
# S90: mobile
check("S90: mobile client uses uuid not react-native-uuid",        contains("from 'uuid'", mobile_cli) and not_contains("from 'react-native-uuid'", mobile_cli))
check("S90: mobile onRefreshFailed rejects pending promises",      contains("reject(new Error", mobile_cli))


# ══ BLOCK R: Sections 91-110 (Mobile API + Cross-cutting) ══════════════════
print("\n── BLOCK R: MOBILE API + CROSS-CUTTING ──────────────────────")
search_api  = read("apps/mobile/src/api/search.api.ts")
rating_api  = read("apps/mobile/src/api/rating.api.ts")
sub_api     = read("apps/mobile/src/api/subscription.api.ts")
prov_api    = read("apps/mobile/src/api/provider.api.ts")
notif_rt    = read("services/notification/src/routes/notification.routes.ts")
rating_rt   = read("services/rating/src/routes/rating.routes.ts")
pay_rt      = read("services/payment/src/routes/payment.routes.ts")
cons_rt     = read("services/user/src/routes/consumer.routes.ts")
prov_rt     = read("services/user/src/routes/provider.routes.ts")
os_sync     = read("lambdas/opensearch-sync/index.ts")
tr_lambda   = read("lambdas/trust-recalculate/index.ts")
app_json    = read("apps/mobile/app.json")

# S91: /api/v1 prefix fixes
check("S91: search.api uses /api/v1/search",          contains("'/api/v1/search'", search_api))
check("S91: search.api uses /api/v1/search/suggest",  contains("'/api/v1/search/suggest'", search_api))
check("S91: search.api no missing prefix /search'",   not_contains("get('/search'", search_api) and not_contains('get("/search"', search_api))
check("S91: rating.api uses /api/v1/ratings",         contains("'/api/v1/ratings'", rating_api))
check("S91: rating.api no missing prefix /ratings",   not_contains("get('/ratings/", rating_api) and not_contains("post('/ratings'", rating_api))
check("S91: subscription uses /api/v1/subscriptions", contains("'/api/v1/subscriptions/plans'", sub_api))
check("S91: subscription no payments/verify",         not_contains("payments/verify", sub_api))
check("S91: provider.api uses /api/v1/trust/me",      contains("'/api/v1/trust/me'", prov_api))
# S91: added missing server endpoints
check("S91: notification service has read-all route", contains("read-all", notif_rt))
check("S91: rating service has daily-usage route",    contains("daily-usage", rating_rt))
check("S91: payment service has subscriptions/me",    contains("subscriptions/me", pay_rt))
# S100: app.json FCM config
check("S100: app.json has googleServicesFile",        contains("googleServicesFile", app_json))
check("S100: app.json has expo-notifications",        contains("expo-notifications", app_json))
# S105-106: OpenSearch field alignment
check("S106: opensearch-sync uses isAadhaarVerified", contains("isAadhaarVerified", os_sync))
check("S106: opensearch-sync uses homeVisitAvailable", contains("homeVisitAvailable", os_sync))
check("S106: opensearch-sync uses is_aadhaar_verified (not bare form)", not_contains("aadhaar_verified:      boolean", os_sync))
# S108: Lambda ! assertions removed
check("S108: trust-recalculate no ! on queue URLs",   not_contains("CERTIFICATE_GENERATOR_QUEUE_URL!", tr_lambda) and not_contains("PUSH_DISCOVERY_QUEUE_URL!", tr_lambda))
# S110: route path collision fixes
check("S110: consumer routes no doubled /consumers/me/settings", not_contains("'/consumers/me/settings'", cons_rt))
check("S110: provider routes no doubled /providers/me/availability", not_contains("'/providers/me/availability'", prov_rt))
check("S110: consumer routes has /me/settings",       contains("'/me/settings'", cons_rt))
check("S110: provider routes has /me/availability",   contains("'/me/availability'", prov_rt))


# ══ BLOCK S: Sections 111-150 (Service Business Logic) ════════════════════
print("\n── BLOCK S: SERVICE BUSINESS LOGIC ──────────────────────────")
auth_svc    = read("services/auth/src/services/authService.ts")
contact_svc = read("services/user/src/services/contactService.ts")
lead_svc    = read("services/user/src/services/leadService.ts")
aadhaar_svc = read("services/user/src/services/aadhaarService.ts")
admin_svc   = read("services/admin/src/services/adminService.ts")
delivery    = read("services/notification/src/services/deliveryMonitorService.ts")
webhook     = read("services/payment/src/services/razorpayWebhook.ts")
trust_calc  = read("services/trust/src/services/trustCalculator.ts")
rating_mod  = read("services/rating/src/services/ratingModerationService.ts")
tr_lambda   = read("lambdas/trust-recalculate/index.ts")
user_ctrl   = read("services/user/src/controllers/user.controller.ts")

# S111: authService Prisma camelCase
check("S111: authService uses userId not user_id",           contains("userId: user.id", auth_svc))
check("S111: authService uses tokenHash not token_hash",     contains("tokenHash", auth_svc) and not_contains("token_hash:", auth_svc))
check("S111: authService uses phoneVerified not phone_verified", contains("phoneVerified: true", auth_svc))
check("S111: authService uses consentType not consent_type", contains("consentType:", auth_svc) and not_contains("consent_type:", auth_svc))
check("S111: adminUser uses isActive not is_active",         contains("isActive: true", auth_svc) and not_contains("is_active: true", auth_svc))
# S113: model names
check("S113: user.controller uses prisma.providerProfile",   contains("prisma.providerProfile", user_ctrl))
check("S113: user.controller no snake_case model names",     not_contains("prisma.provider_profiles", user_ctrl) and not_contains("prisma.users.", user_ctrl))
# S141: contactService field name
check("S141: contactService uses providerPhoneRevealedToConsumer",
      contains("providerPhoneRevealedToConsumer", contact_svc) and not_contains("providerPhoneRevealed:", contact_svc))
# S142: leadService
check("S142: leadService uses providerStatus not provider_status", not_contains("provider_status:", lead_svc))
check("S142: leadService named import { logger }",           contains("{ logger }", lead_svc))
# S143: adminService
check("S143: adminService uses trustScoreHistory include",   contains("trustScoreHistory:", admin_svc))
check("S143: adminService uses eventAt not event_at",       contains("eventAt:", admin_svc) and not_contains("event_at:", admin_svc))
# S145: aadhaarService
check("S145: aadhaarService writes to providerVerification", contains("providerVerification", aadhaar_svc))
check("S145: aadhaarService no aadhaar_hash on providerProfile",
      not_contains("aadhaar_hash:", aadhaar_svc) or contains("digilockerUidHash", aadhaar_svc))
# S146: ratingModerationService
check("S146: ratingModerationService uses ratingsSubmitted",  contains("ratingsSubmitted", rating_mod))
# S147: deliveryMonitorService
check("S147: deliveryMonitor uses row.userId not row.user_id", contains("row.userId", delivery) and not_contains("row.user_id", delivery))
# S148: razorpayWebhook
check("S148: razorpayWebhook no user_subscriptions table",   not_contains("user_subscriptions", webhook))
check("S148: razorpayWebhook uses subscription_records",     contains("subscription_records", webhook))
check("S148: razorpayWebhook no payment_orders table",       not_contains("UPDATE payment_orders", webhook))
# S130: Lambda trust-recalculate
check("S130: trust-recalculate uses tx.trustScore",          contains("tx.trustScore.", tr_lambda))
check("S130: trust-recalculate no tx.trust_scores",          not_contains("tx.trust_scores.", tr_lambda))

# ══ BLOCK K: Migration completeness ══════════════════════════════
print("\n── BLOCK K: MIGRATION SEQUENCE ──────────────────────────────")
gaps = [i for i in range(1, max(v_nums)+1) if i not in v_nums]
check(f"S10: No gaps in V001–V{max(v_nums):03d}", len(gaps)==0, f"Gaps: {gaps}")
check(f"S10: {len(v_nums)} migrations present",   len(v_nums) == max(v_nums), f"Found {len(v_nums)}, max={max(v_nums)}")

# ══ BLOCK L: Package tsconfigs ════════════════════════════════════
print("\n── BLOCK L: PACKAGE TSCONFIGS ───────────────────────────────")
for pkg in ["types","errors","logger","middleware","config","db"]:
    check(f"S8:  packages/{pkg}/tsconfig.json", fileexists(f"packages/{pkg}/tsconfig.json"))

total = pass_count + fail_count
print()
print("━"*62)
print(f"  PASS: {pass_count}  FAIL: {fail_count}  TOTAL: {total}")
if fail_count == 0:
    print("  ✅ ALL CHECKS PASSED")
else:
    print(f"  ❌ {fail_count} CHECKS FAILED — see ❌ lines above")
print("━"*62)
sys.exit(1 if fail_count > 0 else 0)
PYEOF
# (HEALTH_CHECK.sh is rewritten below — this append marker is ignored)
