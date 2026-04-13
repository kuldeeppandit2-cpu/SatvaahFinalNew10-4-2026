#!/usr/bin/env python3
"""
scripts/scraper_targeted_l4.py

SatvAAh — Targeted L4 Gap Filler
===================================
Scrapes ONLY the L4 taxonomy nodes that have < 3 providers in each city.
Uses Google Places Text Search API.

SAFETY GUARANTEES:
  1. Reads target L4 list at startup from DB — no hardcoded UUIDs
  2. Every result is assigned to EXACTLY the L4 being searched — no match_taxonomy guessing
  3. ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING — safe to re-run
  4. DRY RUN mode prints what would be inserted without touching DB
  5. Skips any L4 that already has >= MIN_PROVIDERS in that city at runtime
  6. Never deletes, never updates existing records — only inserts new ones
  7. Logs every action to scraper_targeted_l4.log

REALISTIC EXPECTATIONS:
  - Google Places finds businesses, not freelancers
  - Home tutors, maids, individual musicians will return 0 or coaching centres
  - Pest control companies will appear in all 3 pest L4s — this is correct
  - Coaching centres assigned to 'Mathematics Tutor' is correct behaviour
  - Estimate: 13-16 of 24 L4s will get results, 7-8 will stay at 0

Run:
  python3 scripts/scraper_targeted_l4.py --key YOUR_GOOGLE_API_KEY --dry-run
  python3 scripts/scraper_targeted_l4.py --key YOUR_GOOGLE_API_KEY
  python3 scripts/scraper_targeted_l4.py --key YOUR_GOOGLE_API_KEY --cities hyderabad
  python3 scripts/scraper_targeted_l4.py --key YOUR_GOOGLE_API_KEY --l4 "Termite Treatment"
"""

import json, time, uuid, re, subprocess, sys, argparse, os
from datetime import datetime
from collections import defaultdict

try:
    import requests
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'requests', '-q'])
    import requests

# ── Constants ─────────────────────────────────────────────────────────────────

MIN_PROVIDERS   = 3      # Skip city+L4 combination if already >= this many
TARGET_PER_CITY = 10     # How many providers to collect per city per L4
API_SLEEP       = 1.5    # Seconds between API calls (avoid rate limiting)
LOG_FILE        = 'scraper_targeted_l4.log'

CITIES = {
    'hyderabad': {'name': 'Hyderabad', 'lat': 17.385,  'lng': 78.4867, 'slug': 'hyderabad'},
    'mumbai':    {'name': 'Mumbai',    'lat': 19.076,  'lng': 72.8777, 'slug': 'mumbai'},
    'delhi':     {'name': 'Delhi',     'lat': 28.6139, 'lng': 77.2090, 'slug': 'delhi'},
    'chennai':   {'name': 'Chennai',   'lat': 13.0827, 'lng': 80.2707, 'slug': 'chennai'},
    'bangalore': {'name': 'Bangalore', 'lat': 12.9716, 'lng': 77.5946, 'slug': 'bangalore'},
}

# ── Logging ────────────────────────────────────────────────────────────────────

def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(line + '\n')
    except Exception:
        pass

# ── DB helpers ─────────────────────────────────────────────────────────────────

def dbq(sql):
    """Query DB, return list of tab-separated rows."""
    r = subprocess.run(
        ['docker', 'exec', 'satvaaah-postgres', 'psql',
         '-U', 'satvaaah_user', '-d', 'satvaaah',
         '-t', '-A', '-F', '\t', '-c', sql],
        capture_output=True, text=True, timeout=30
    )
    if r.returncode != 0:
        log(f"  DB query error: {r.stderr[:100]}")
        return []
    return [l.split('\t') for l in r.stdout.strip().split('\n') if l.strip()]

def dbx(sql):
    """Execute SQL, return True if committed."""
    r = subprocess.run(
        ['docker', 'exec', '-i', 'satvaaah-postgres', 'psql',
         '-U', 'satvaaah_user', '-d', 'satvaaah'],
        input=sql, capture_output=True, text=True, timeout=60
    )
    ok = 'COMMIT' in r.stdout or 'INSERT' in r.stdout
    if not ok and r.stderr.strip():
        log(f"  DB exec error: {r.stderr[:200]}")
    return ok

def esc(s):
    """Escape string for SQL."""
    if s is None:
        return 'NULL'
    return "'" + str(s).replace("'", "''")[:500] + "'"

# ── Load targets from DB ───────────────────────────────────────────────────────

def load_targets():
    """
    Load all non-products L4 nodes from DB with their current provider counts per city.
    Returns list of nodes that need filling (< MIN_PROVIDERS in at least one city).
    UUID comes from DB — no hardcoding.
    """
    log("Loading taxonomy nodes from DB...")

    # Get all non-products L4 nodes with per-city counts
    sql = """
SELECT
    tn.id,
    tn.tab::text,
    tn.l1, tn.l2, tn.l3, tn.l4,
    tn.display_name,
    tn.search_synonyms,
    COUNT(CASE WHEN c.slug='hyderabad' THEN 1 END)  AS hyd,
    COUNT(CASE WHEN c.slug='mumbai'    THEN 1 END)  AS mum,
    COUNT(CASE WHEN c.slug='delhi'     THEN 1 END)  AS del,
    COUNT(CASE WHEN c.slug='chennai'   THEN 1 END)  AS che,
    COUNT(CASE WHEN c.slug='bangalore' THEN 1 END)  AS blr
FROM taxonomy_nodes tn
LEFT JOIN provider_profiles pp ON pp.taxonomy_node_id = tn.id AND pp.is_active = true
LEFT JOIN cities c ON c.id = pp.city_id
WHERE tn.is_active = true
  AND tn.tab::text != 'products'
  AND tn.l4 IS NOT NULL
GROUP BY tn.id, tn.tab, tn.l1, tn.l2, tn.l3, tn.l4, tn.display_name, tn.search_synonyms
HAVING
    COUNT(CASE WHEN c.slug='hyderabad' THEN 1 END) < 3
    OR COUNT(CASE WHEN c.slug='mumbai'    THEN 1 END) < 3
    OR COUNT(CASE WHEN c.slug='delhi'     THEN 1 END) < 3
    OR COUNT(CASE WHEN c.slug='chennai'   THEN 1 END) < 3
    OR COUNT(CASE WHEN c.slug='bangalore' THEN 1 END) < 3
ORDER BY tn.tab, tn.l1, tn.l3, tn.l4;
"""
    rows = dbq(sql)
    nodes = []
    for row in rows:
        if len(row) < 13:
            continue
        try:
            node = {
                'id':       row[0].strip(),
                'tab':      row[1].strip(),
                'l1':       row[2].strip(),
                'l2':       row[3].strip(),
                'l3':       row[4].strip(),
                'l4':       row[5].strip(),
                'display':  row[6].strip(),
                'synonyms': row[7].strip() if row[7].strip() else '',
                'counts': {
                    'hyderabad': int(row[8] or 0),
                    'mumbai':    int(row[9] or 0),
                    'delhi':     int(row[10] or 0),
                    'chennai':   int(row[11] or 0),
                    'bangalore': int(row[12] or 0),
                }
            }
            # Skip if ALL cities already have >= MIN_PROVIDERS
            if all(node['counts'][c] >= MIN_PROVIDERS for c in CITIES):
                continue
            nodes.append(node)
        except (ValueError, IndexError) as e:
            log(f"  Skipping malformed row: {e}")
    
    log(f"  {len(nodes)} target L4 nodes loaded")
    return nodes

def get_city_ids():
    """Get city UUIDs from DB."""
    rows = dbq("SELECT slug, id FROM cities WHERE is_active = true")
    return {row[0].strip(): row[1].strip() for row in rows if len(row) >= 2}

# ── Search query builder ───────────────────────────────────────────────────────

def build_queries(node):
    """
    Build 1-3 search queries for a node, from most specific to broadest.
    Each query is a (query_string, fallback_level) tuple.
    fallback_level: 'l4' | 'synonym' | 'l3'

    CRITICAL: All queries map to the SAME taxonomy_node_id regardless of fallback level.
    A result found via L3 fallback is still assigned to this specific L4.

    Bad fallbacks are filtered out to avoid useless searches like
    'Control in Mumbai' or 'Service in Delhi'.
    """
    queries = []
    l4 = node['l4']
    l3 = node['l3']
    synonyms_raw = node['synonyms']

    # Q1: L4 display name — clean up special chars for Google
    l4_clean = re.sub(r'[—–]', '-', l4)   # em-dash → hyphen
    l4_clean = re.sub(r'[&]', 'and', l4_clean)
    l4_clean = re.sub(r'[^\w\s\-/,]', '', l4_clean).strip()
    queries.append((l4_clean, 'l4'))

    # Q2: Best synonym — skip Hindi transliterations and generic words
    # Words/phrases that make a synonym useless as a Google search term
    SKIP_SYNONYMS = {
        # Hindi/regional — Google Places won't match
        'keedamaar', 'bai', 'kaam wali', 'padhai', 'sangeet',
        'bijli', 'nali', 'darzi', 'mali', 'mochi',
        # Too generic — will return unrelated businesses
        'maid', 'domestic', 'tutor', 'coaching', 'teacher',
        'service', 'control', 'shift', 'only',
        'cs', 'psychologist', 'therapist',
        # Pest-specific: 'cockroach' as synonym for termite/rat is wrong
        'cockroach',
        # Logistics words, not service names
        'pickup & delivery', 'pickup and delivery',
        # Time fragments
        '2-3 hrs', '2–3 hrs',
    }
    if synonyms_raw:
        for syn in synonyms_raw.split(','):
            syn = syn.strip()
            syn_lower = syn.lower()
            # Skip if it's just the L4 name again
            if syn_lower == l4.lower():
                continue
            # Skip very short terms
            if len(syn) < 6:
                continue
            # Skip any term that contains a bad word
            if any(skip in syn_lower for skip in SKIP_SYNONYMS):
                continue
            queries.append((syn, 'synonym'))
            break  # Only take first good synonym

    # Q3: L3 name — only if it adds meaningful context (not the same as L4, not too generic)
    SKIP_L3 = {
        'part-time', 'service', 'software', 'instruments', 'control',
        'senior school (class 11–12)', 'middle school (class 6–10)',
        'senior school (class 11\u201312)', 'middle school (class 6\u201310)',
    }
    if l3 and l3.lower() != l4.lower() and l3.lower() not in SKIP_L3:
        l3_clean = re.sub(r'[—–]', '-', l3)
        l3_clean = re.sub(r'[&]', 'and', l3_clean).strip()
        # Only add L3 if it's meaningfully different from L4 (not just adding/removing a word)
        l4_words = set(l4.lower().split())
        l3_words = set(l3.lower().split())
        if len(l3_words - l4_words) > 0:  # L3 has words not in L4
            queries.append((l3_clean, 'l3'))

    return queries

# ── Google Places API ─────────────────────────────────────────────────────────

def places_text_search(api_key, query, lat, lng):
    """
    Call Google Places Text Search API.
    Returns list of place dicts, or empty list on error.
    Handles rate limits gracefully.
    """
    url = 'https://maps.googleapis.com/maps/api/place/textsearch/json'
    params = {
        'query':    query,
        'location': f'{lat},{lng}',
        'radius':   15000,
        'key':      api_key,
    }
    try:
        r = requests.get(url, params=params, timeout=10)
        data = r.json()
        status = data.get('status', '')

        if status == 'REQUEST_DENIED':
            log(f"  ❌ API key denied: {data.get('error_message', '')}")
            return None  # None = fatal, stop everything

        if status == 'OVER_QUERY_LIMIT':
            log(f"  ⚠️  Rate limit hit — sleeping 30s")
            time.sleep(30)
            return []

        if status == 'ZERO_RESULTS':
            return []

        if status == 'OK':
            return data.get('results', [])

        log(f"  Unexpected status: {status}")
        return []

    except Exception as e:
        log(f"  API error: {e}")
        return []

# ── Insert provider ────────────────────────────────────────────────────────────

def insert_provider(place, city_id, city_slug, taxonomy_node_id, tab, query_used, fallback_level, dry_run):
    """
    Insert one Google Places result into provider_profiles.

    SAFETY:
    - ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING
    - place_id is scrape_external_id — Google's unique stable ID
    - taxonomy_node_id is the SPECIFIC L4 being searched — never guessed
    - Only inserts, never updates or deletes
    """
    place_id = place.get('place_id', '')
    if not place_id:
        return False

    name = (place.get('name') or '').strip()[:200]
    if not name:
        return False

    address = (place.get('formatted_address') or place.get('vicinity') or '').strip()[:500]
    rating = place.get('rating')
    review_count = place.get('user_ratings_total', 0)

    # Geo
    geo = place.get('geometry', {}).get('location', {})
    lat = geo.get('lat')
    lng = geo.get('lng')
    if not lat or not lng:
        return False

    # Phone — only available via Place Details API call
    # We skip details call to save API quota — phone will be empty
    # Providers can claim their profile to add phone later
    phone_val = ''

    # ListingType based on tab
    listing_type_map = {
        'services':      'individual_service',
        'expertise':     'expertise',
        'establishments':'establishment',
        'products':      'individual_product',
    }
    listing_type = listing_type_map.get(tab, 'individual_service')

    pid = str(uuid.uuid4())
    ts_id = str(uuid.uuid4())

    # Trust score: use Google rating if available, else 10
    # Formula: (google_rating / 5) * 40 + base 10 = max 50 for unverified scraped
    if rating and review_count and review_count >= 5:
        trust = min(50, int(10 + (float(rating) / 5.0) * 40))
        trust_tier = 'basic' if trust < 30 else 'trusted' if trust < 60 else 'highly_trusted'
    else:
        trust = 10
        trust_tier = 'unverified'

    source_url = f"https://maps.google.com/maps/place/?q=place_id:{place_id}"

    if dry_run:
        log(f"    [DRY RUN] Would insert: '{name}' | {city_slug} | trust:{trust} | fallback:{fallback_level}")
        return True

    sql = f"""
BEGIN;
INSERT INTO provider_profiles (
    id, display_name, business_name, city_id, tab,
    is_active, is_scrape_record, is_claimed, is_phone_verified,
    listing_type, scrape_source, scrape_external_id,
    address_line, phone, geo_point,
    taxonomy_node_id, scrape_source_url,
    created_at, updated_at
) VALUES (
    '{pid}',
    {esc(name)},
    {esc(name)},
    '{city_id}',
    '{tab}'::\"Tab\",
    true, true, false, false,
    '{listing_type}'::\"ListingType\",
    'google_maps',
    {esc(place_id)},
    {esc(address)},
    '',
    ST_SetSRID(ST_MakePoint({lng},{lat}),4326),
    '{taxonomy_node_id}'::uuid,
    {esc(source_url)},
    NOW(), NOW()
) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

INSERT INTO trust_scores (id, provider_id, display_score, raw_score, trust_tier, signal_breakdown)
VALUES ('{ts_id}', '{pid}', {trust}, {trust}, '{trust_tier}'::"TrustTier", '{{}}'::jsonb)
ON CONFLICT (provider_id) DO NOTHING;
COMMIT;
"""
    return dbx(sql)

# ── Scrape one L4 in one city ─────────────────────────────────────────────────

def scrape_l4_city(api_key, node, city_key, city, city_id, dry_run):
    """
    Try to find TARGET_PER_CITY providers for one L4 in one city.
    Tries queries in order: L4 → synonym → L3.
    Stops as soon as TARGET_PER_CITY are found.
    Returns count of providers inserted.
    """
    current_count = node['counts'].get(city['name'].lower(), 0)
    # Re-check if this city already has enough
    # (might have been filled by earlier city in same run)
    check = dbq(f"""
        SELECT COUNT(*) FROM provider_profiles pp
        JOIN cities c ON c.id = pp.city_id
        JOIN taxonomy_nodes tn ON tn.id = pp.taxonomy_node_id
        WHERE c.slug = '{city['slug']}'
        AND tn.id = '{node['id']}'
        AND pp.is_active = true
    """)
    live_count = int(check[0][0]) if check and check[0] else 0

    if live_count >= MIN_PROVIDERS:
        log(f"  ⏭  {city['name']}: already {live_count} — skipping")
        return 0

    queries = build_queries(node)
    inserted = 0
    seen_place_ids = set()

    for query_text, fallback_level in queries:
        if inserted >= TARGET_PER_CITY:
            break

        full_query = f"{query_text} in {city['name']}"
        log(f"  🔍 [{fallback_level}] '{full_query}'")
        time.sleep(API_SLEEP)

        results = places_text_search(api_key, full_query, city['lat'], city['lng'])

        if results is None:
            log(f"  ❌ Fatal API error — stopping")
            return -1  # Signal to stop everything

        if not results:
            log(f"  ↳ 0 results")
            continue

        log(f"  ↳ {len(results)} results from Google")

        for place in results:
            if inserted >= TARGET_PER_CITY:
                break

            place_id = place.get('place_id', '')
            if not place_id or place_id in seen_place_ids:
                continue
            seen_place_ids.add(place_id)

            ok = insert_provider(
                place, city_id, city['slug'],
                node['id'], node['tab'],
                query_text, fallback_level, dry_run
            )
            if ok:
                inserted += 1

        if inserted > 0:
            log(f"  ✅ {city['name']}: +{inserted} inserted via [{fallback_level}]")
            break  # Found results — don't try broader fallback

    if inserted == 0:
        log(f"  ⚪ {city['name']}: 0 results across all queries")

    return inserted

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description='SatvAAh Targeted L4 Gap Filler')
    ap.add_argument('--key',      required=True, help='Google Places API key')
    ap.add_argument('--cities',   default='all',
                    help='Comma-separated city slugs or "all" (default: all)')
    ap.add_argument('--l4',       default=None,
                    help='Run for specific L4 display_name only (for testing)')
    ap.add_argument('--dry-run',  action='store_true',
                    help='Print what would be inserted without touching DB')
    ap.add_argument('--limit',    type=int, default=10,
                    help=f'Max providers per city per L4 (default: 10)')
    args = ap.parse_args()

    global TARGET_PER_CITY
    TARGET_PER_CITY = args.limit

    log("=" * 65)
    log("SatvAAh — Targeted L4 Gap Filler")
    log(f"Mode:     {'DRY RUN — no DB changes' if args.dry_run else 'LIVE — will write to DB'}")
    log(f"Target:   {args.limit} providers per city per L4")
    log(f"Min threshold to skip: {MIN_PROVIDERS} existing providers")
    log("=" * 65)

    # Validate API key
    test = places_text_search(args.key, 'test', 17.385, 78.4867)
    if test is None:
        log("❌ API key invalid or denied — check your key")
        sys.exit(1)
    log("✅ API key valid")

    # Load city IDs
    city_ids = get_city_ids()
    log(f"Cities in DB: {list(city_ids.keys())}")

    # Filter cities
    if args.cities == 'all':
        active_cities = list(CITIES.keys())
    else:
        active_cities = [c.strip() for c in args.cities.split(',') if c.strip() in CITIES]

    if not active_cities:
        log("❌ No valid cities specified")
        sys.exit(1)
    log(f"Running for: {active_cities}")

    # Load targets from DB
    nodes = load_targets()

    # Filter by --l4 if specified
    if args.l4:
        nodes = [n for n in nodes if args.l4.lower() in n['l4'].lower() or args.l4.lower() in n['display'].lower()]
        log(f"Filtered to L4 matching '{args.l4}': {len(nodes)} nodes")

    if not nodes:
        log("No target nodes found. All L4s already have >= 3 providers per city.")
        sys.exit(0)

    log(f"\n{len(nodes)} L4 nodes to process × {len(active_cities)} cities\n")

    # ── Main loop ──────────────────────────────────────────────────────────
    total_inserted = 0
    total_skipped  = 0
    results_summary = []

    for node in nodes:
        log(f"\n{'─'*65}")
        log(f"[{node['tab'].upper()}] {node['l4']}")
        log(f"  UUID: {node['id']}")
        log(f"  Current counts: " + 
            " | ".join(f"{c}: {node['counts'].get(c,0)}" for c in ['hyderabad','mumbai','delhi','chennai','bangalore']))

        node_total = 0

        for city_key in active_cities:
            city = CITIES[city_key]
            city_id = city_ids.get(city['slug'])

            if not city_id:
                log(f"  ⚠️  {city['name']} not found in DB — run setup first")
                continue

            current = node['counts'].get(city['name'].lower(), 0)
            if current >= MIN_PROVIDERS:
                log(f"  ⏭  {city['name']}: {current} existing — skipping")
                total_skipped += 1
                continue

            result = scrape_l4_city(args.key, node, city_key, city, city_id, args.dry_run)

            if result == -1:
                log("\n❌ Fatal API error — stopping all scraping")
                _print_summary(results_summary, total_inserted, total_skipped, args.dry_run)
                sys.exit(1)

            node_total += result
            total_inserted += result
            time.sleep(0.5)

        results_summary.append({
            'tab':    node['tab'],
            'l4':     node['l4'],
            'inserted': node_total,
        })

    _print_summary(results_summary, total_inserted, total_skipped, args.dry_run)

    # Remind to re-index
    if total_inserted > 0 and not args.dry_run:
        log("\n" + "=" * 65)
        log("NEXT STEP: Re-index OpenSearch to make new providers searchable:")
        log("  python3 scripts/bulk-index-opensearch.py")
        log("=" * 65)

def _print_summary(results_summary, total_inserted, total_skipped, dry_run):
    log("\n" + "=" * 65)
    log(f"{'DRY RUN ' if dry_run else ''}SUMMARY")
    log("=" * 65)
    log(f"{'L4':<50} {'Inserted':>9}")
    log("-" * 65)
    for r in results_summary:
        mark = "✅" if r['inserted'] > 0 else "⚪"
        log(f"{mark} [{r['tab'][:3]}] {r['l4'][:46]:<46} {r['inserted']:>9}")
    log("-" * 65)
    log(f"Total providers {'would be ' if dry_run else ''}inserted: {total_inserted}")
    log(f"City+L4 combinations skipped (already >= {MIN_PROVIDERS}): {total_skipped}")
    log(f"Log file: {LOG_FILE}")

if __name__ == '__main__':
    main()
