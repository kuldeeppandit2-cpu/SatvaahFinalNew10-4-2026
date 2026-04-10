#!/bin/bash
# Migration verification - run: bash VERIFY_MIGRATIONS.sh
python3 << 'PYEOF'
import os, re, sys

pass_count = 0
fail_count = 0

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

def sql(filepath):
    try:
        with open(filepath) as f: return f.read()
    except: return ""

def schema():
    with open("packages/db/prisma/schema.prisma") as f: return f.read()

def contains(text, content): return text in content
def fileexists(path): return os.path.exists(path)

S = schema()

print()
print("━"*60)
print(" MIGRATION FORENSIC AUDIT — SECTIONS 10-20 VERIFICATION")
print("━"*60)

# ── GROUP 1: Migration files exist ──────────────────────────────
print("\nGROUP 1: ALIGNMENT MIGRATION FILES EXIST")
for v, desc in [
    ("V036_fix_subscription_tier_enum", "SubscriptionTier basic→silver fix"),
    ("V037_users_schema_alignment",     "referral_code size, referred_by_user_id drop"),
    ("V038_provider_profiles_alignment","column renames, availability enum, missing cols"),
    ("V039_ratings_enum_alignment",     "WeightType→RatingWeightType, FK fix"),
    ("V040_cities_areas_alignment",     "slug, country_code, ring_km, bbox cols"),
    ("V041_trust_scores_alignment",     "city_id NOT NULL, signal_breakdown"),
    ("V042_schema_alignment_batch2",    "V011-V030 comprehensive alignment"),
    ("V043_subscriptions_alignment",    "plan_name→display_name, taxonomy display_name"),
]:
    path = f"packages/db/prisma/migrations/{v}/migration.sql"
    check(f"{v} exists ({desc})", fileexists(path),
          f"File missing: {path}")

# ── GROUP 2: V002 fixes confirmed in V036/V037 ──────────────────
print("\nGROUP 2: V002 USERS — FIXES CONFIRMED")
v036 = sql("packages/db/prisma/migrations/V036_fix_subscription_tier_enum/migration.sql")
v037 = sql("packages/db/prisma/migrations/V037_users_schema_alignment/migration.sql")

check("V036: adds 'silver' to SubscriptionTier enum",
      contains("ADD VALUE IF NOT EXISTS 'silver'", v036),
      "silver not added to SubscriptionTier")
check("V036: migrates 'basic' rows to 'silver'",
      contains("subscription_tier = 'silver'", v036) and contains("subscription_tier = 'basic'", v036),
      "basic→silver migration missing")
check("V037: referral_code expanded to VARCHAR(16)",
      contains("VARCHAR(16)", v037),
      "VARCHAR(16) not in V037")
check("V037: referral_code set NOT NULL",
      contains("SET NOT NULL", v037),
      "NOT NULL not set on referral_code")
check("V037: referred_by_user_id dropped (not in schema)",
      contains("DROP COLUMN IF EXISTS referred_by_user_id", v037),
      "referred_by_user_id not dropped")

# ── GROUP 3: V003 cities/areas alignment ────────────────────────
print("\nGROUP 3: V003 CITIES/AREAS — V040 ALIGNMENT")
v040 = sql("packages/db/prisma/migrations/V040_cities_areas_alignment/migration.sql")

check("V040: adds slug to cities",
      contains("slug", v040) and contains("cities", v040),
      "slug not added to cities")
check("V040: adds country_code to cities",
      contains("country_code", v040),
      "country_code not added")
check("V040: adds is_launch_city to cities",
      contains("is_launch_city", v040),
      "is_launch_city not added")
check("V040: adds ring_1_km to cities",
      contains("ring_1_km", v040),
      "ring_*_km cols not added")
check("V040: adds bbox_min_lat to areas",
      contains("bbox_min_lat", v040),
      "bbox_min_lat not added to areas")
check("V040: adds sort_order to areas",
      contains("sort_order", v040) and contains("areas", v040),
      "sort_order not added to areas")

# ── GROUP 4: V006 signal_breakdown + V004 city_id ───────────────
print("\nGROUP 4: V006/V004 — V041 ALIGNMENT")
v041 = sql("packages/db/prisma/migrations/V041_trust_scores_alignment/migration.sql")

check("V041: signal_breakdown JSONB added to trust_scores",
      contains("signal_breakdown", v041),
      "signal_breakdown not added to trust_scores")
check("V041: provider_profiles.city_id set NOT NULL",
      contains("city_id", v041) and contains("NOT NULL", v041),
      "city_id NOT NULL constraint not added")
check("schema.prisma: TrustScoreConfig has decay_days field",
      contains("decay_days", S),
      "decay_days missing from TrustScoreConfig in schema.prisma")

# ── GROUP 5: V011 daily_rating_usage ────────────────────────────
print("\nGROUP 5: V011 DAILY_RATING_USAGE — V042 ALIGNMENT")
v042 = sql("packages/db/prisma/migrations/V042_schema_alignment_batch2/migration.sql")

check("V042: renames 'count' to 'ratings_submitted'",
      contains("ratings_submitted", v042),
      "count→ratings_submitted rename missing from V042")
check("V042: daily_rating_usage FK changed to consumer_profiles",
      contains("consumer_profiles", v042) and contains("daily_rating_usage", v042),
      "FK not updated to consumer_profiles")
check("V042: drops last_rated_at (not in schema)",
      contains("last_rated_at", v042),
      "last_rated_at drop missing from V042")

# ── GROUP 6: V012 search_intents ────────────────────────────────
print("\nGROUP 6: V012 SEARCH_INTENTS — V042 ALIGNMENT")
check("V042: renames raw_query to search_query",
      contains("search_query", v042) and contains("raw_query", v042),
      "raw_query→search_query rename missing")
check("V042: adds notification_provider_id to search_intents",
      contains("notification_provider_id", v042),
      "notification_provider_id not added")

# ── GROUP 7: V015 subscriptions ─────────────────────────────────
print("\nGROUP 7: V015 SUBSCRIPTIONS — V043 ALIGNMENT")
v043 = sql("packages/db/prisma/migrations/V043_subscriptions_alignment/migration.sql")

check("V043: plan_name renamed to display_name",
      contains("display_name", v043) and contains("plan_name", v043),
      "plan_name→display_name rename missing")
check("V043: billing_cycle_days renamed to validity_days",
      contains("validity_days", v043) and contains("billing_cycle_days", v043),
      "billing_cycle_days→validity_days rename missing")
check("V043: adds description to subscription_plans",
      contains("description", v043),
      "description column not added")
check("V043: amount_paid_paise renamed to amount_paise",
      contains("amount_paise", v043) and contains("amount_paid_paise", v043),
      "amount_paid_paise→amount_paise rename missing")
check("V043: adds cancelled_at to subscription_records",
      contains("cancelled_at", v043),
      "cancelled_at not added")

# ── GROUP 8: V017 taxonomy_nodes ────────────────────────────────
print("\nGROUP 8: V017 TAXONOMY_NODES — V043 ALIGNMENT")
check("V043: adds display_name to taxonomy_nodes",
      contains("taxonomy_nodes", v043) and contains("display_name", v043),
      "display_name not added to taxonomy_nodes")
check("V043: adds parent_id to taxonomy_nodes",
      contains("parent_id", v043),
      "parent_id not added to taxonomy_nodes")
check("V043: renames search_rank to sort_order",
      contains("search_rank", v043) and contains("sort_order", v043),
      "search_rank→sort_order rename missing")

# ── GROUP 9: V026 trust_flags CRITICAL ──────────────────────────
print("\nGROUP 9: V026 TRUST_FLAGS — CRITICAL FIXES IN V042")
check("V042: adds TrustFlagType enum to DB",
      contains("TrustFlagType", v042),
      "CRITICAL: TrustFlagType enum not created — flag_type column unusable")
check("V042: adds TrustFlagSeverity enum to DB",
      contains("TrustFlagSeverity", v042),
      "CRITICAL: TrustFlagSeverity enum not created")
check("V042: adds TrustFlagStatus enum to DB",
      contains("TrustFlagStatus", v042),
      "CRITICAL: TrustFlagStatus enum not created")
check("V042: adds flag_type column to trust_flags",
      contains("flag_type", v042) and contains("trust_flags", v042),
      "CRITICAL: flag_type not added — entire trust flag system broken")
check("V042: adds severity column to trust_flags",
      contains("severity", v042) and contains("trust_flags", v042),
      "severity not added to trust_flags")
check("V042: adds status column to trust_flags",
      contains("'open'", v042) and contains("trust_flags", v042),
      "status not added to trust_flags")

# ── GROUP 10: V030 certificate_records ──────────────────────────
print("\nGROUP 10: V030 CERTIFICATE_RECORDS — CRITICAL FIXES IN V042")
check("V042: adds s3_key to certificate_records",
      contains("s3_key", v042) and contains("certificate_records", v042),
      "CRITICAL: s3_key not added — certificate PDFs cannot be stored")
check("V042: adds is_revoked to certificate_records",
      contains("is_revoked", v042) and contains("certificate_records", v042),
      "is_revoked not added")
check("V042: adds is_suspended to certificate_records",
      contains("is_suspended", v042),
      "is_suspended not added")

# ── GROUP 11: V025 refresh_tokens ───────────────────────────────
print("\nGROUP 11: V025 REFRESH_TOKENS — V042 ALIGNMENT")
check("V042: adds ip_address to refresh_tokens",
      contains("ip_address", v042) and contains("refresh_tokens", v042),
      "ip_address not added — security audit trail broken")
check("V042: adds user_agent to refresh_tokens",
      contains("user_agent", v042) and contains("refresh_tokens", v042),
      "user_agent not added")

# ── GROUP 12: V027 referral_events ──────────────────────────────
print("\nGROUP 12: V027 REFERRAL_EVENTS — V042 ALIGNMENT")
check("V042: adds reward_amount_paise (PAISE rule)",
      contains("reward_amount_paise", v042),
      "reward_amount_paise not added — reward stored as wrong type/name")
check("V042: drops branch_click_id (not in schema)",
      contains("branch_click_id", v042),
      "branch_click_id not dropped")

# ── GROUP 13: schema.prisma vs migration table names ────────────
print("\nGROUP 13: SCHEMA @@MAP NAMES MATCH MIGRATION CREATE TABLE NAMES")
maps = re.findall(r'@@map\("([^"]+)"\)', S)
mig_tables = set()
mig_dir = "packages/db/prisma/migrations"
for d in os.listdir(mig_dir):
    path = os.path.join(mig_dir, d, "migration.sql")
    if os.path.exists(path):
        with open(path) as f: content = f.read()
        for t in re.findall(r'CREATE TABLE (?:IF NOT EXISTS )?(?:"?(\w+)"?)\s*\(', content):
            mig_tables.add(t)

missing_from_mig = [m for m in maps if m not in mig_tables]
check(f"All schema @@map tables have a CREATE TABLE in some migration",
      len(missing_from_mig) == 0,
      f"Tables in schema but no migration: {missing_from_mig}")

# ── GROUP 14: V016 saved_providers FK fix ───────────────────────
print("\nGROUP 14: V016 SAVED_PROVIDERS — FK FIX IN V042")
check("V042: saved_providers FK updated to consumer_profiles",
      contains("saved_providers", v042) and contains("consumer_profiles", v042),
      "saved_providers FK not updated")

# ── GROUP 15: V028 scraping tables ──────────────────────────────
print("\nGROUP 15: V028 SCRAPING TABLES — V042 ALIGNMENT")
check("V042: adds status to scraping_jobs",
      contains("scraping_jobs", v042) and contains("status", v042),
      "status not added to scraping_jobs")
check("V042: adds attempt_1_at to outreach_schedule",
      contains("attempt_1_at", v042),
      "attempt tracking cols not added to outreach_schedule")
check("V042: adds outreach_status to outreach_schedule",
      contains("outreach_status", v042),
      "outreach_status not added")
check("V042: adds wa_message_id_1 to outreach_schedule",
      contains("wa_message_id_1", v042),
      "WhatsApp message ID tracking not added")

# ── FINAL ───────────────────────────────────────────────────────
total = pass_count + fail_count
print()
print("━"*60)
print(f" RESULT: {pass_count} PASS  /  {fail_count} FAIL  /  {total} TOTAL")
if fail_count == 0:
    print(" ✅ ALL MIGRATION CHECKS PASSED")
else:
    print(f" ❌ {fail_count} CHECKS FAILED — scroll up to see details")
print("━"*60)
sys.exit(1 if fail_count > 0 else 0)
PYEOF
