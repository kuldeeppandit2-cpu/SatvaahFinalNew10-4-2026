#!/usr/bin/env python3
"""
scripts/scraper_v2_google.py

SatvAAh — Google Places Scraper V2
====================================
Target: services + expertise + establishments (422 L4 nodes)
Goal:   1 provider per L4 per city with ALL 3 bare minimums:
        name + phone + geo (address is bonus)

KEY DIFFERENCE FROM V1:
  V1: Text Search only ($0.017) → no phone
  V2: Text Search + Details ALWAYS ($0.034) → real phone

HONEST EXPECTATIONS:
  - ~50% of L4s will get a phone (business must have claimed Google listing)
  - ~50% will return no phone (auto-listed by Google, never claimed)
  - Common trades (electrician, plumber, AC repair) → high phone hit rate
  - Niche L4s (termite treatment, violin teacher) → low hit rate
  - The script prints PROOF for every record inserted — you verify yourself

PROOF OUTPUT (what you see for every insert):
  [INSERTED] Fan & Light Fitting | Hyderabad
    Name:    Srinivas Electricals
    Phone:   9876543210        ← REAL or MISSING
    Geo:     17.4126, 78.4483  ← always present
    Address: Banjara Hills, Hyderabad
    Source:  https://maps.google.com/...

  [SKIPPED] Violin | Hyderabad — no phone returned from Google

5-MINUTE TEST:
  python3 scripts/scraper_v2_google.py --key YOUR_KEY --test
  Runs 10 L4s in Hyderabad only. Costs ~$0.34. Shows proof table.
  If ≥5/10 have phone → proceed to full run.

FULL RUN:
  python3 scripts/scraper_v2_google.py --key YOUR_KEY
  All 422 L4s × 5 cities = 2,110 max records. Costs ~$72.

AFTER RUN:
  python3 scripts/bulk-index-opensearch.py
"""

import re, uuid, time, subprocess, sys, argparse, json
from datetime import datetime

try:
    import requests
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'requests', '-q'])
    import requests

# ── Cities ────────────────────────────────────────────────────────────────────
CITIES = {
    'hyderabad': {'name':'Hyderabad', 'lat':17.3850, 'lng':78.4867, 'slug':'hyderabad'},
    'mumbai':    {'name':'Mumbai',    'lat':19.0760, 'lng':72.8777, 'slug':'mumbai'},
    'delhi':     {'name':'Delhi',     'lat':28.6139, 'lng':77.2090, 'slug':'delhi'},
    'chennai':   {'name':'Chennai',   'lat':13.0827, 'lng':80.2707, 'slug':'chennai'},
    'bangalore': {'name':'Bangalore', 'lat':12.9716, 'lng':77.5946, 'slug':'bangalore'},
}

LOG = 'scraper_v2_google.log'

# ── Logging ───────────────────────────────────────────────────────────────────
def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG, 'a') as f:
        f.write(line + '\n')

# ── DB helpers ────────────────────────────────────────────────────────────────
def dbq(sql):
    r = subprocess.run(
        ['docker','exec','satvaaah-postgres','psql',
         '-U','satvaaah_user','-d','satvaaah',
         '-t','-A','-F','\t','-c', sql],
        capture_output=True, text=True, timeout=30)
    return [l.split('\t') for l in r.stdout.strip().split('\n') if l.strip()]

def dbx(sql):
    r = subprocess.run(
        ['docker','exec','-i','satvaaah-postgres','psql',
         '-U','satvaaah_user','-d','satvaaah'],
        input=sql, capture_output=True, text=True, timeout=60)
    ok = 'INSERT' in r.stdout or 'COMMIT' in r.stdout
    if not ok and r.stderr.strip():
        log(f"  DB error: {r.stderr[:150]}")
    return ok

def esc(s):
    if s is None: return 'NULL'
    return "'" + str(s).replace("'","''")[:500] + "'"

def clean_phone(raw):
    if not raw: return None
    d = re.sub(r'\D','', str(raw))
    if d.startswith('91') and len(d) == 12: d = d[2:]
    if len(d) == 10 and d[0] in '6789': return d
    return None

# ── Google API ────────────────────────────────────────────────────────────────
def text_search(api_key, query, lat, lng):
    """Text Search — returns list of results with place_id, name, geo, address."""
    try:
        r = requests.get(
            'https://maps.googleapis.com/maps/api/place/textsearch/json',
            params={'query':query, 'location':f'{lat},{lng}',
                    'radius':15000, 'key':api_key, 'language':'en'},
            timeout=10)
        data = r.json()
        if data.get('status') == 'REQUEST_DENIED':
            log(f"  ❌ API key denied: {data.get('error_message','')}")
            return None   # None = fatal stop
        if data.get('status') == 'OVER_QUERY_LIMIT':
            log("  ⚠️  Rate limit — sleeping 30s")
            time.sleep(30)
            return []
        return data.get('results', [])
    except Exception as e:
        log(f"  API error: {e}")
        return []

def place_details(api_key, place_id):
    """
    Place Details — returns phone, website, hours for a specific place_id.
    This is the call V1 NEVER made. Rs 1.50 per call.
    """
    try:
        r = requests.get(
            'https://maps.googleapis.com/maps/api/place/details/json',
            params={
                'place_id': place_id,
                'fields':   'formatted_phone_number,international_phone_number,website',
                'key':      api_key,
            },
            timeout=10)
        return r.json().get('result', {})
    except Exception as e:
        log(f"  Details error: {e}")
        return {}

# ── Load taxonomy from DB ─────────────────────────────────────────────────────
def load_l4_nodes():
    """
    Load all non-products L4 nodes from DB.
    Returns list of dicts with id, tab, l1, l2, l3, l4, display_name, synonyms.
    """
    rows = dbq("""
        SELECT id, tab::text, l1, l2, l3, l4, display_name, search_synonyms
        FROM taxonomy_nodes
        WHERE is_active = true
          AND tab::text != 'products'
          AND l4 IS NOT NULL
        ORDER BY tab, l1, l3, l4
    """)
    nodes = []
    for row in rows:
        if len(row) >= 8:
            nodes.append({
                'id':       row[0].strip(),
                'tab':      row[1].strip(),
                'l1':       row[2].strip(),
                'l2':       row[3].strip(),
                'l3':       row[4].strip(),
                'l4':       row[5].strip(),
                'display':  row[6].strip(),
                'synonyms': row[7].strip() if row[7].strip() else '',
            })
    return nodes

def get_city_ids():
    rows = dbq("SELECT slug, id FROM cities WHERE is_active = true")
    return {r[0].strip(): r[1].strip() for r in rows if len(r) >= 2}

# ── Check existing count ──────────────────────────────────────────────────────
def existing_count(node_id, city_id):
    rows = dbq(f"""
        SELECT COUNT(*) FROM provider_profiles
        WHERE taxonomy_node_id = '{node_id}'
          AND city_id = '{city_id}'
          AND is_active = true
          AND phone IS NOT NULL
          AND phone != ''
          AND phone != '0000000000'
          AND LENGTH(phone) = 10
    """)
    try: return int(rows[0][0])
    except: return 0

# ── Insert ────────────────────────────────────────────────────────────────────
def insert_provider(node, city_key, city_id, name, phone, lat, lng, address,
                    place_id, website):
    tab = node['tab']
    lt_map = {'services':'individual_service','expertise':'expertise',
              'establishments':'establishment'}
    lt = lt_map.get(tab, 'individual_service')
    pid = str(uuid.uuid4())
    ts_id = str(uuid.uuid4())
    source_url = f"https://maps.google.com/maps/place/?q=place_id:{place_id}"

    sql = f"""
BEGIN;
INSERT INTO provider_profiles (
    id, display_name, business_name, city_id, tab,
    is_active, is_scrape_record, is_claimed, is_phone_verified,
    listing_type, scrape_source, scrape_external_id,
    address_line, phone, website_url,
    geo_point, taxonomy_node_id, scrape_source_url,
    created_at, updated_at
) VALUES (
    '{pid}',
    {esc(name)}, {esc(name)},
    '{city_id}',
    '{tab}'::\"Tab\",
    true, true, false, false,
    '{lt}'::\"ListingType\",
    'google_maps_v2',
    {esc(place_id)},
    {esc(address)},
    {esc(phone or '')},
    {esc(website) if website else 'NULL'},
    ST_SetSRID(ST_MakePoint({lng},{lat}),4326),
    '{node['id']}'::uuid,
    {esc(source_url)},
    NOW(), NOW()
) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

INSERT INTO trust_scores (id, provider_id, display_score, raw_score, trust_tier, signal_breakdown)
VALUES ('{ts_id}', '{pid}', 15, 15, 'unverified', '{{}}'::jsonb)
ON CONFLICT (provider_id) DO NOTHING;
COMMIT;
"""
    return dbx(sql)

# ── Build search query ────────────────────────────────────────────────────────
def build_query(node, city_name):
    """
    Build the best Google search query for this L4.
    Try L4 name first. If it has special chars, clean them.
    """
    l4 = node['l4']
    # Clean special chars that confuse Google
    q = re.sub(r'[—–]', '-', l4)
    q = re.sub(r'[&]', 'and', q)
    q = re.sub(r'[^\w\s\-/,]', '', q).strip()
    return f"{q} in {city_name}"

# ── Main scrape loop ──────────────────────────────────────────────────────────
def scrape(api_key, cities_to_run, nodes, city_ids, test_mode):
    """
    For each L4 × city:
    1. Check if already has a provider with phone — skip if yes
    2. Text Search → get candidates
    3. For top candidate: Place Details → get phone
    4. If phone found: INSERT and print PROOF
    5. If no phone: print SKIPPED with reason
    """
    total_inserted = 0
    total_skipped_has_data = 0
    total_no_phone = 0
    total_no_results = 0
    api_calls = 0

    results_table = []  # for summary

    for node in nodes:
        for city_key in cities_to_run:
            city = CITIES[city_key]
            city_id = city_ids.get(city['slug'])
            if not city_id:
                continue

            # Skip if already has a provider with phone
            if existing_count(node['id'], city_id) >= 1:
                total_skipped_has_data += 1
                continue

            query = build_query(node, city['name'])

            # ── Step 1: Text Search ──────────────────────────────────────────
            time.sleep(0.5)
            results = text_search(api_key, query, city['lat'], city['lng'])
            api_calls += 1

            if results is None:
                log("❌ Fatal API error — stopping")
                _print_summary(results_table, total_inserted, total_no_phone,
                               total_no_results, api_calls)
                sys.exit(1)

            if not results:
                log(f"  ⚪ [{node['tab']}] {node['l4']} | {city['name']} — 0 results from Google")
                total_no_results += 1
                results_table.append({
                    'l4': node['l4'], 'city': city['name'],
                    'name':'—', 'phone':'—', 'result':'NO_RESULTS'
                })
                continue

            # Take the top result
            place = results[0]
            place_id = place.get('place_id','')
            name = (place.get('name') or '').strip()
            address = (place.get('formatted_address') or '').strip()
            geo = place.get('geometry',{}).get('location',{})
            lat = geo.get('lat')
            lng = geo.get('lng')

            if not name or not lat or not lng or not place_id:
                total_no_results += 1
                continue

            # ── Step 2: Place Details → get phone ───────────────────────────
            time.sleep(0.3)
            details = place_details(api_key, place_id)
            api_calls += 1

            raw_phone = (details.get('formatted_phone_number') or
                        details.get('international_phone_number') or '')
            phone = clean_phone(raw_phone)
            website = details.get('website','')

            # ── Step 3: Insert only if we have phone ─────────────────────────
            if not phone:
                log(f"  ⚪ [{node['tab']}] {node['l4'][:40]:<40} | {city['name']}"
                    f" — '{name[:30]}' has no phone on Google")
                total_no_phone += 1
                results_table.append({
                    'l4': node['l4'], 'city': city['name'],
                    'name': name, 'phone': 'NO PHONE', 'result': 'NO_PHONE'
                })
                continue

            ok = insert_provider(node, city_key, city_id, name, phone,
                                lat, lng, address, place_id, website)

            if ok:
                total_inserted += 1
                log(f"  ✅ [{node['tab']}] {node['l4'][:40]:<40} | {city['name']}")
                log(f"     Name:    {name}")
                log(f"     Phone:   {phone}")
                log(f"     Geo:     {lat:.4f}, {lng:.4f}")
                log(f"     Address: {address[:80]}")
                results_table.append({
                    'l4': node['l4'], 'city': city['name'],
                    'name': name, 'phone': phone, 'result': 'INSERTED'
                })
            else:
                results_table.append({
                    'l4': node['l4'], 'city': city['name'],
                    'name': name, 'phone': phone, 'result': 'DUPLICATE'
                })

    _print_summary(results_table, total_inserted, total_no_phone,
                  total_no_results, api_calls)

def _print_summary(results_table, inserted, no_phone, no_results, api_calls):
    log("")
    log("="*65)
    log("RESULTS — WHAT WAS ACTUALLY INSERTED INTO DB")
    log("="*65)
    log(f"{'L4':<40} {'City':<12} {'Name':<30} {'Phone':<12} {'Result'}")
    log("-"*110)
    for r in results_table:
        flag = '✅' if r['result']=='INSERTED' else '❌' if r['result']=='NO_PHONE' else '⚪'
        log(f"{flag} {r['l4'][:38]:<38} {r['city']:<12} {r['name'][:28]:<28} "
            f"{r['phone'][:11]:<11}  {r['result']}")
    log("-"*110)
    total = len(results_table)
    log(f"Total L4×city combinations tried: {total}")
    log(f"  ✅ INSERTED (name+phone+geo):     {inserted}  "
        f"({'—' if not total else f'{inserted/total*100:.0f}%'})")
    log(f"  ❌ NO PHONE from Google:           {no_phone}  "
        f"({'—' if not total else f'{no_phone/total*100:.0f}%'})")
    log(f"  ⚪ NO RESULTS at all:              {no_results}")
    log(f"  API calls made:                    {api_calls}")
    log(f"  Approx cost:                       ${api_calls * 0.017:.2f}"
        f" (Rs {api_calls * 0.017 * 83:.0f})")
    log("")
    if inserted == 0:
        log("⛔ VERDICT: Google is NOT giving phone numbers for these L4s.")
        log("   Do not scale this scraper. Try a different source.")
    elif inserted/max(total,1) >= 0.5:
        log("✅ VERDICT: Google works. ≥50% hit rate. Safe to scale.")
    elif inserted/max(total,1) >= 0.3:
        log("⚠️  VERDICT: Google partially works. 30-50% hit rate.")
        log("   Consider running for high-demand L4s only.")
    else:
        log("⛔ VERDICT: <30% hit rate. Google phones unreliable for these L4s.")

def main():
    ap = argparse.ArgumentParser(description='SatvAAh Google Scraper V2')
    ap.add_argument('--key',   required=True, help='Google Places API key')
    ap.add_argument('--test',  action='store_true',
                    help='Test mode: 10 L4s in Hyderabad only (~$0.34)')
    ap.add_argument('--cities', default='all',
                    help='Comma-separated city slugs or "all"')
    ap.add_argument('--tab',   default='all',
                    help='Tab to run: services/expertise/establishments/all')
    args = ap.parse_args()

    log("="*65)
    log("SatvAAh Google Scraper V2 — Text Search + Details Together")
    log(f"Mode: {'TEST (10 L4s, Hyderabad only)' if args.test else 'FULL RUN'}")
    log("="*65)

    # Validate key
    test_r = text_search(args.key, 'electrician in Hyderabad', 17.385, 78.486)
    if test_r is None:
        log("❌ Invalid API key"); sys.exit(1)
    log(f"✅ API key valid")

    city_ids = get_city_ids()
    log(f"Cities in DB: {list(city_ids.keys())}")

    nodes = load_l4_nodes()
    log(f"L4 nodes loaded: {len(nodes)}")

    # Filter by tab
    if args.tab != 'all':
        nodes = [n for n in nodes if n['tab'] == args.tab]
        log(f"Filtered to tab '{args.tab}': {len(nodes)} nodes")

    # Test mode: first 10 nodes, Hyderabad only
    if args.test:
        nodes = nodes[:10]
        cities_to_run = ['hyderabad']
        log(f"TEST MODE: {len(nodes)} L4s × 1 city = {len(nodes)} max records")
        log(f"Estimated cost: ${len(nodes) * 2 * 0.017:.2f} "
            f"(Rs {len(nodes) * 2 * 0.017 * 83:.0f})")
    else:
        if args.cities == 'all':
            cities_to_run = list(CITIES.keys())
        else:
            cities_to_run = [c.strip() for c in args.cities.split(',')
                            if c.strip() in CITIES]
        log(f"FULL RUN: {len(nodes)} L4s × {len(cities_to_run)} cities")
        log(f"Max records: {len(nodes) * len(cities_to_run)}")
        log(f"Max cost: ${len(nodes) * len(cities_to_run) * 2 * 0.017:.0f} "
            f"(Rs {len(nodes) * len(cities_to_run) * 2 * 0.017 * 83:.0f})")

    log("")
    scrape(args.key, cities_to_run, nodes, city_ids, args.test)

    log("")
    log("NEXT: python3 scripts/bulk-index-opensearch.py")

if __name__ == '__main__':
    main()
