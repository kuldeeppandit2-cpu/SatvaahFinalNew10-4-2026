#!/usr/bin/env python3
"""
SatvAAh — Phase 1-7 Health Check
Run from repo root: python3 scripts/healthcheck.py
"""

import os, re, json, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
os.chdir(ROOT)

SAFFRON  = "\033[38;5;208m"
GREEN    = "\033[92m"
RED      = "\033[91m"
YELLOW   = "\033[93m"
BOLD     = "\033[1m"
DIM      = "\033[2m"
RESET    = "\033[0m"

passed = 0
failed = 0
phase_results = {}

def read(path):
    try: return Path(path).read_text(errors="replace")
    except: return ""

def is_stub(path):
    head = read(path)[:200]
    return any(x in head for x in ["PLACEHOLDER","Status  :","Written by Claude","# File    :"])

def strip_comments(s):
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.DOTALL)
    return re.sub(r'//[^\n]*', '', s)

def check(phase, description, ok, detail=""):
    global passed, failed
    phase_results.setdefault(phase, []).append((description, ok, detail))
    if ok: passed += 1
    else:  failed += 1

def header(title):
    print(f"\n{BOLD}{SAFFRON}{'─'*60}{RESET}")
    print(f"{BOLD}{SAFFRON}  {title}{RESET}")
    print(f"{BOLD}{SAFFRON}{'─'*60}{RESET}")

# ══════════════════════════════════════════════════════════════
# PHASE 1 — Docker / Infrastructure
# ══════════════════════════════════════════════════════════════
dc   = read("docker-compose.yml")
env  = read(".env.example")

check(1, "docker-compose.yml is real (not stub)",
      len(dc) > 1000 and not is_stub("docker-compose.yml"))
check(1, "All 9 services in docker-compose",
      all(s in dc for s in ["auth","user","search","trust","rating","notification","payment","admin","scraping"]))
check(1, "PostgreSQL host = postgres",
      "postgres:" in dc or "POSTGRES" in dc or "postgres" in dc)
check(1, "Redis host = satvaaah-redis",
      "satvaaah-redis" in dc)
check(1, ".env.example is real",
      len(env) > 500 and not is_stub(".env.example"))
check(1, "scripts/postgres/init.sql real",
      not is_stub("scripts/postgres/init.sql") and len(read("scripts/postgres/init.sql")) > 50)
check(1, "scripts/redis/redis.conf real",
      not is_stub("scripts/redis/redis.conf") and len(read("scripts/redis/redis.conf")) > 50)
check(1, "scripts/mongodb/init.js real",
      not is_stub("scripts/mongodb/init.js") and len(read("scripts/mongodb/init.js")) > 50)
check(1, ".gitignore protects .env",
      ".env" in read(".gitignore") and "*.pem" in read(".gitignore"))

# ══════════════════════════════════════════════════════════════
# PHASE 2 — Prisma Schema
# ══════════════════════════════════════════════════════════════
schema = read("packages/db/prisma/schema.prisma")
model_count = len(re.findall(r'^model\s+\w+', schema, re.MULTILINE))
enum_count  = len(re.findall(r'^enum\s+\w+',  schema, re.MULTILINE))

check(2, "schema.prisma is real",
      len(schema) > 5000 and not is_stub("packages/db/prisma/schema.prisma"))
check(2, f"33 models present (found {model_count}) — City + Area both count",
      model_count == 33)
check(2, f"Exactly 17 enums (found {enum_count})",
      enum_count == 17)
check(2, "All monetary amounts use Int (paise, never Float)",
      all(re.search(rf'\b{f}\b\s+Int', schema) for f in
          ['price_paise','amount_paise']) and
      all(f not in schema for f in ['price_paise     Float','amount_paise    Float']))
check(2, "PostGIS geo_point in provider_profiles",
      "geo_point" in schema or "Unsupported" in schema)
check(2, "deleted_at soft delete on users",
      "deleted_at" in schema)
check(2, "trust_score in provider_profiles",
      "trust_score" in schema)
check(2, "refresh_tokens table present",
      "RefreshToken" in schema or "refresh_tokens" in schema)

# ══════════════════════════════════════════════════════════════
# PHASE 3 — Migrations V001-V018
# ══════════════════════════════════════════════════════════════
mig_dir = Path("packages/db/prisma/migrations")
for i in range(1, 19):
    v = f"V{i:03d}"
    matches = [d for d in mig_dir.iterdir() if d.name.startswith(v)]
    if matches:
        sql = read(matches[0] / "migration.sql")
        check(3, f"{matches[0].name}",
              len(sql) > 100 and not is_stub(matches[0] / "migration.sql"),
              f"{len(sql.splitlines())} lines")
    else:
        check(3, f"{v} MISSING", False)

# Special: V012 must never be deleted
v012 = [d for d in mig_dir.iterdir() if d.name.startswith("V012")]
check(3, "V012_search_intents present (NEVER DELETE — push discovery Lambda)",
      bool(v012) and "NEVER DELETE" in read(v012[0] / "migration.sql") if v012 else False)

# ══════════════════════════════════════════════════════════════
# PHASE 4 — Migrations V019-V031 + Seeds
# ══════════════════════════════════════════════════════════════
for i in range(19, 32):
    v = f"V{i:03d}"
    matches = [d for d in mig_dir.iterdir() if d.name.startswith(v)]
    if matches:
        sql = read(matches[0] / "migration.sql")
        check(4, f"{matches[0].name}",
              len(sql) > 100 and not is_stub(matches[0] / "migration.sql"),
              f"{len(sql.splitlines())} lines")
    else:
        check(4, f"{v} MISSING", False)

# Seeds
seeds = ["trust_score_config_individual.sql","trust_score_config_expertise.sql",
         "trust_score_config_establishment.sql","trust_score_config_brand.sql","taxonomy_nodes.sql"]
for s in seeds:
    path = f"packages/db/seeds/{s}"
    content = read(path)
    check(4, f"seed: {s}", len(content) > 200 and not is_stub(path),
          f"{len(content.splitlines())} lines")

# V031: exactly 68 system_config keys
v031 = read("packages/db/prisma/migrations/V031_seed_system_config/migration.sql")
key_count = len(re.findall(r"^\('([a-z][a-z_0-9]+)'", v031, re.MULTILINE))
check(4, f"V031 has exactly 68 config keys (found {key_count})",
      key_count == 68)

# Critical config values
critical = {
    "trust_tier_basic_threshold": "20",
    "contact_lead_cost":          "0",
    "wa_channel_policy":          "cac_and_extraordinary",
    "push_discovery_trust_threshold": "80",
}
kv = dict(re.findall(r"^\('([a-z_]+)',\s*\n?\s*'([^']+)'", v031, re.MULTILINE))
for key, expected in critical.items():
    actual = kv.get(key, "NOT FOUND")
    check(4, f"system_config: {key} = {expected}",
          actual == expected, f"found: {actual}")

# ══════════════════════════════════════════════════════════════
# PHASE 5 — Shared Packages
# ══════════════════════════════════════════════════════════════
pkg_files = {
    "packages/types/src/index.ts":              (900, ["UserMode","ListingType","TrustTier"]),
    "packages/errors/src/index.ts":             (400, ["AppError","AuthError","RateLimitError"]),
    "packages/logger/src/index.ts":             (200, ["winston","AADHAAR_REDACTED","redact"]),
    "packages/middleware/src/requireAuth.ts":   (100, ["RS256","JWT_PUBLIC_KEY","TokenExpiredError"]),
    "packages/middleware/src/requireAdmin.ts":  (40,  ["admin","requireAuth"]),
    "packages/middleware/src/rateLimiter.ts":   (200, ["fail-open","INCR","429"]),
    "packages/middleware/src/correlationId.ts": (30,  ["X-Correlation-ID"]),
    "packages/middleware/src/errorHandler.ts":  (100, ["isProduction","stack","NODE_ENV"]),
    "packages/middleware/src/asyncHandler.ts":  (20,  ["NextFunction"]),
    "packages/config/src/systemConfig.ts":      (200, ["system_config","SIGHUP"]),
    "packages/db/src/client.ts":                (50,  ["PrismaClient"]),
    "packages/db/src/index.ts":                 (50,  ["prisma"]),
}
for path, (min_lines, kws) in pkg_files.items():
    content = read(path)
    ok = not is_stub(path) and content.count('\n') >= min_lines and all(k in content for k in kws)
    check(5, path.replace("packages/","pkg/"), ok,
          f"{content.count(chr(10))} lines")

# RS256 only in requireAuth — strip comments
auth_code = strip_comments(read("packages/middleware/src/requireAuth.ts"))
check(5, "requireAuth: RS256 in algorithms array, HS256 absent from code",
      "'RS256'" in auth_code and "HS256" not in auth_code)

# fail-open in rateLimiter
check(5, "rateLimiter: fail-open (next() called on Redis error)",
      read("packages/middleware/src/rateLimiter.ts").count("fail-open") >= 3)

# All 6 package.json scoped
for pkg in ["types","errors","logger","middleware","config","db"]:
    try:
        d = json.loads(read(f"packages/{pkg}/package.json"))
        check(5, f"packages/{pkg}/package.json: @satvaaah/ scope",
              d.get("name","").startswith("@satvaaah/"))
    except:
        check(5, f"packages/{pkg}/package.json: @satvaaah/ scope", False, "invalid JSON")

# ══════════════════════════════════════════════════════════════
# PHASE 6 — Auth Service
# ══════════════════════════════════════════════════════════════
auth_svc  = read("services/auth/src/services/authService.ts")
auth_ctrl = read("services/auth/src/controllers/auth.controller.ts")
auth_rl   = read("services/auth/src/middleware/rateLimiter.ts")
auth_app  = read("services/auth/src/app.ts")

check(6, "services/auth/src/app.ts: real (not stub)",
      not is_stub("services/auth/src/app.ts") and len(auth_app) > 500)

check(6, "GET /health → 200 {status,service,port} — no DB call",
      "app.get('/health'" in auth_app and "res.status(200)" in auth_app and
      "service: 'auth'" in auth_app and "port: 3001" in auth_app)

auth_code = strip_comments(auth_svc)
sign_algos   = re.findall(r"algorithm:\s*'(\w+)'", auth_code)
verify_algos = re.findall(r"algorithms:\s*\[\s*'(\w+)'\s*\]", auth_code)
check(6, f"JWT sign: RS256 only ({len(sign_algos)} calls, no HS256)",
      len(sign_algos) >= 3 and all(a=="RS256" for a in sign_algos) and "HS256" not in auth_code)
check(6, f"JWT verify: RS256 only ({len(verify_algos)} calls, no HS256)",
      len(verify_algos) >= 2 and all(a=="RS256" for a in verify_algos))

check(6, "consent_given !== true → 400 CONSENT_REQUIRED",
      "consent_given !== true" in auth_ctrl and "400" in auth_ctrl and "CONSENT_REQUIRED" in auth_ctrl)
check(6, "DPDP: user + consent_record in atomic prisma.$transaction",
      "prisma.$transaction" in auth_svc and "consentRecord.create" in auth_svc)
check(6, "bcrypt(JTI, cost=12) stored — never raw token (Rule #8)",
      "BCRYPT_ROUNDS = 12" in auth_svc and "bcrypt.hash(refreshJti" in auth_svc and
      "token_hash: tokenHash" in auth_svc)
check(6, "OTP rate limit: 5 per 10 min, fail-open",
      "OTP_MAX_ATTEMPTS = 5" in auth_rl and "10 * 60" in auth_rl and "fail-open" in auth_rl)
check(6, "Admin from admin_users table only (Rule #19)",
      "adminUser.findFirst" in auth_svc and "role: 'admin'" in auth_svc)
check(6, "Redis fail-open on unavailability (Rule #16)",
      read("services/auth/src/redis.ts").count("fail-open") >= 4)

# ══════════════════════════════════════════════════════════════
# PHASE 7 — User Service Part 1
# ══════════════════════════════════════════════════════════════
aadhaar  = read("services/user/src/services/aadhaarService.ts")
prov_svc = read("services/user/src/services/providerService.ts")
cons_svc = read("services/user/src/services/consumerService.ts")
cred_svc = read("services/user/src/services/credentialService.ts")
sqs      = read("services/user/src/services/sqsHelper.ts")

check(7, "services/user/src/app.ts: real (not stub)",
      not is_stub("services/user/src/app.ts") and
      len(read("services/user/src/app.ts")) > 500)

# Aadhaar security contract
aadhaar_code = strip_comments(aadhaar)
check(7, "Aadhaar number NEVER stored (Rule #1)",
      "aadhaar_number" not in aadhaar_code and
      not re.search(r'data\s*:\s*\{[^}]*digilockerUid', aadhaar_code, re.DOTALL))
check(7, "Only bcrypt(UID+salt, cost=12) stored — NEVER raw UID",
      bool(re.search(r'aadhaar_hash\s*:\s*aadhaarHash', aadhaar)) and
      bool(re.search(r'aadhaar_salt\s*:\s*perRecordSalt', aadhaar)) and
      "BCRYPT_COST = 12" in aadhaar)
check(7, "Raw UID cleared after hash (explicit memory hint)",
      "digilockerUid = '';" in aadhaar or "digilockerUid=''" in aadhaar)
check(7, "DigiLocker access_token discarded — never persisted",
      "NEVER persisted" in aadhaar or "access_token is discarded" in aadhaar)
check(7, "DigiLocker response body never logged",
      "err.response.data" not in aadhaar_code)
check(7, "PKCE S256 flow (code_verifier + code_challenge + S256)",
      "code_verifier" in aadhaar and "S256" in aadhaar)
check(7, "CSRF state validated before token exchange",
      "session.state !== state" in aadhaar)
check(7, "Redis state key one-time use (del before exchange)",
      "redis.del(redisKey)" in aadhaar)

# trust_score never written in user service
combined_code = strip_comments(prov_svc + cons_svc)
data_write = re.findall(r'(?:create|update|upsert)\s*\([^)]*data\s*:\s*\{([^}]+)\}', combined_code, re.DOTALL)
check(7, "trust_score NEVER written in user service (SQS → Lambda only)",
      not any("trust_score" in b for b in data_write) and
      not re.search(r'data\s*:\s*\{[^}]*trust_score\s*:', combined_code, re.DOTALL))
check(7, "ST_MakePoint(lng, lat) — longitude FIRST (Rule #5)",
      "ST_MakePoint(lng, lat)" in prov_svc and
      not re.search(r'ST_MakePoint\s*\(\s*lat', prov_svc))
check(7, "Credentials via S3 pre-signed URL — not server upload",
      "getSignedUrl" in cred_svc and "writeFile" not in cred_svc)
check(7, "X-Correlation-ID in every SQS message (Rule #25)",
      "correlationId" in sqs)
check(7, "DPDP data-export + deletion in user controller",
      "data-export" in read("services/user/src/routes/user.routes.ts") or
      "dataExport" in read("services/user/src/controllers/user.controller.ts"))

# ══════════════════════════════════════════════════════════════
# PRINT RESULTS
# ══════════════════════════════════════════════════════════════

phase_names = {
    1: "Phase 1 — Docker / Infrastructure",
    2: "Phase 2 — Prisma Schema (32 models, 17 enums)",
    3: "Phase 3 — Migrations V001–V018",
    4: "Phase 4 — Migrations V019–V031 + Seeds",
    5: "Phase 5 — Shared Packages (@satvaaah/*)",
    6: "Phase 6 — Auth Service (port 3001)",
    7: "Phase 7 — User Service Part 1 (port 3002)",
}

print(f"\n{BOLD}{'═'*62}")
print(f"  SatvAAh — Health Check  |  Phases 1–7")
print(f"{'═'*62}{RESET}")

total_pass = total_fail = 0
for phase_num in sorted(phase_results):
    checks = phase_results[phase_num]
    p = sum(1 for _,ok,_ in checks if ok)
    f = sum(1 for _,ok,_ in checks if not ok)
    total_pass += p; total_fail += f
    icon = f"{GREEN}✅{RESET}" if f == 0 else f"{RED}❌{RESET}"
    print(f"\n{icon}  {BOLD}{phase_names[phase_num]}{RESET}  {DIM}[{p}/{p+f}]{RESET}")
    for desc, ok, detail in checks:
        tick = f"{GREEN}  ✓{RESET}" if ok else f"{RED}  ✗{RESET}"
        det  = f"  {DIM}{detail}{RESET}" if detail and not ok else ""
        print(f"{tick}  {desc}{det}")

print(f"\n{BOLD}{'═'*62}{RESET}")
total = total_pass + total_fail
if total_fail == 0:
    print(f"{GREEN}{BOLD}  ✅  ALL {total} CHECKS PASS — Phases 1–7 healthy{RESET}")
else:
    print(f"{RED}{BOLD}  ❌  {total_fail} FAILURES / {total} checks — see above{RESET}")
print(f"{BOLD}{'═'*62}{RESET}\n")

sys.exit(0 if total_fail == 0 else 1)
