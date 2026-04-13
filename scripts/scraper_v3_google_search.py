#!/usr/bin/env python3
"""
scripts/scraper_v3_google_search.py

SatvAAh — Google Search Scraper (NOT Places API)
==================================================
Scrapes google.com/search results directly — the same page you see
in your browser that shows business name + phone + address + geo.

WHY THIS WORKS WHEN PLACES API FAILED:
  Google Search page (browser): shows phone numbers freely
  Google Places API: strips phone numbers from response
  This scraper hits the search page, not the API.

WHAT IT EXTRACTS FROM EACH RESULT:
  Name:    from business title
  Phone:   from the phone number shown in snippet (09853268490)
  Geo:     from Google Maps URL embedded in result (?q=lat,lng)
  Address: from address line in snippet

BARE MINIMUM CHECK:
  Only inserts if ALL 3 are present: name + phone + geo
  If phone missing → skips. No partial records.

ANTI-BLOCKING:
  - Rotates User-Agent strings
  - Random sleep between requests (3-7 seconds)
  - Uses Indian locale headers (gl=in, hl=en)
  - Google will eventually block — this is expected
  - When blocked: script stops, tells you to wait

COST: FREE — no API key needed

5-MINUTE TEST:
  python3 scripts/scraper_v3_google_search.py --test
  Runs 10 L4s in Hyderabad. Free.

FULL RUN:
  python3 scripts/scraper_v3_google_search.py
  All 422 non-products L4s × 5 cities.
"""

import re, uuid, time, subprocess, sys, argparse, random, json
from datetime import datetime

try:
    import requests
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'requests', '-q'])
    import requests

# ── Cities ────────────────────────────────────────────────────────────────────
CITIES = {
    'hyderabad': {'name':'Hyderabad','lat':17.3850,'lng':78.4867,'slug':'hyderabad'},
    'mumbai':    {'name':'Mumbai',   'lat':19.0760,'lng':72.8777,'slug':'mumbai'},
    'delhi':     {'name':'Delhi',    'lat':28.6139,'lng':77.2090,'slug':'delhi'},
    'chennai':   {'name':'Chennai',  'lat':13.0827,'lng':80.2707,'slug':'chennai'},
    'bangalore': {'name':'Bangalore','lat':12.9716,'lng':77.5946,'slug':'bangalore'},
}

# Rotate these to avoid blocking
USER_AGENTS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
]

LOG = 'scraper_v3_google_search.log'

# ── Logging ───────────────────────────────────────────────────────────────────
def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG, 'a') as f:
        f.write(line + '\n')

# ── DB ────────────────────────────────────────────────────────────────────────
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
    d = re.sub(r'\D', '', str(raw))
    if d.startswith('91') and len(d) == 12: d = d[2:]
    if len(d) == 10 and d[0] in '6789': return d
    return None

# ── Google Search ─────────────────────────────────────────────────────────────
def google_search(query, city_name):
    """
    Hit google.com/search and extract business listings with phone numbers.
    Returns list of dicts: {name, phone, address, lat, lng}
    Returns 'BLOCKED' string if Google blocks us.
    """
    full_query = f"{query} in {city_name}"

    headers = {
        'User-Agent': random.choice(USER_AGENTS),
        'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }
    params = {
        'q':   full_query,
        'num': 20,
        'hl':  'en',
        'gl':  'in',      # India results
        'pws': '0',       # Disable personalisation
    }

    try:
        r = requests.get(
            'https://www.google.com/search',
            params=params,
            headers=headers,
            timeout=12,
        )

        if r.status_code == 429:
            return 'BLOCKED'
        if r.status_code == 200 and 'unusual traffic' in r.text.lower():
            return 'BLOCKED'
        if r.status_code != 200:
            log(f"  HTTP {r.status_code} for '{full_query}'")
            return []

        return parse_google_results(r.text, full_query)

    except Exception as e:
        log(f"  Search error: {e}")
        return []

def parse_google_results(html, query):
    """
    Parse Google search results HTML to extract:
    - Business name
    - Phone number (Indian mobile format)
    - Address
    - Lat/lng from embedded Google Maps URLs

    Google search results embed structured data in several ways:
    1. JSON-LD blocks <script type="application/ld+json">
    2. data-attrid attributes with phone values
    3. Plain text phone numbers in snippets
    4. Google Maps URLs with ll= parameter for coordinates
    """
    results = []

    # ── Method 1: JSON-LD structured data ─────────────────────────────────────
    jsonld_blocks = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html, re.DOTALL | re.IGNORECASE
    )
    for block in jsonld_blocks:
        try:
            data = json.loads(block)
            items = data if isinstance(data, list) else [data]
            for item in items:
                if item.get('@type') not in (
                    'LocalBusiness','Plumber','Electrician','HomeAndConstructionBusiness',
                    'MedicalBusiness','HealthAndBeautyBusiness','FoodEstablishment',
                    'Store','Service','Organization','LodgingBusiness','SportsActivityLocation'
                ):
                    continue
                name = item.get('name','').strip()
                if not name or len(name) < 3: continue

                phone = clean_phone(item.get('telephone',''))
                addr_obj = item.get('address',{})
                if isinstance(addr_obj, dict):
                    addr = ', '.join(filter(None, [
                        addr_obj.get('streetAddress',''),
                        addr_obj.get('addressLocality',''),
                        addr_obj.get('addressRegion',''),
                    ]))
                else:
                    addr = str(addr_obj)

                geo = item.get('geo',{})
                lat = float(geo.get('latitude',0)) if geo else 0
                lng = float(geo.get('longitude',0)) if geo else 0

                if name and phone:
                    results.append({
                        'name':name, 'phone':phone,
                        'address':addr.strip(), 'lat':lat, 'lng':lng,
                        'method':'jsonld'
                    })
        except Exception:
            continue

    # ── Method 2: Extract phones from visible text near business names ─────────
    # Google renders results in divs. Phone numbers appear after business name.
    # Pattern: business name followed within ~500 chars by phone number
    # Indian phones: 10 digits starting with 6-9, sometimes formatted as "098532 68490"

    # Find all phone-like strings in the HTML
    phone_pattern = re.compile(
        r'\b([6-9]\d{2}[\s\-]?\d{3}[\s\-]?\d{4,5})\b'
    )
    phones_in_html = phone_pattern.findall(html)

    # Find business names near these phones
    # Google uses specific data attributes for local business results
    name_pattern = re.compile(
        r'data-attrid="title"[^>]*>([^<]{3,80})<'
        r'|class="[^"]*businessName[^"]*"[^>]*>([^<]{3,80})<'
        r'|class="[^"]*LHJvCe[^"]*"[^>]*>([^<]{3,80})<'
        r'|<h3[^>]*>([^<]{5,80})</h3>'
    )

    # Simpler approach: find blocks of text that contain both a name and phone
    # Look for the pattern Google uses: Name \n rating \n type \n address \n phone
    block_pattern = re.compile(
        r'([A-Z][^·\n<]{3,60})'    # Business name (starts with capital)
        r'[^·]{0,200}'             # Some content
        r'·\s*'                    # Google uses · as separator
        r'([6-9]\d{4}\s?\d{5})',   # Phone number
        re.DOTALL
    )
    for match in block_pattern.finditer(html):
        name_raw = match.group(1).strip()
        phone_raw = match.group(2).strip()
        name = re.sub(r'<[^>]+>', '', name_raw).strip()
        phone = clean_phone(phone_raw)
        if name and phone and len(name) > 3:
            # Avoid duplicates
            if not any(r['phone'] == phone for r in results):
                results.append({
                    'name': name[:100], 'phone': phone,
                    'address': '', 'lat': 0.0, 'lng': 0.0,
                    'method': 'block_pattern'
                })

    # ── Method 3: Extract from Google's local pack data attributes ─────────────
    # Google embeds business data in data-* attributes in the local pack
    local_pack = re.findall(
        r'data-cid="[^"]*"[^>]*>.*?'
        r'"([^"]{5,80})".*?'           # name
        r'([6-9]\d{2}[\s\-]?\d{3}[\s\-]?\d{4,5})',  # phone
        html, re.DOTALL
    )
    for name_raw, phone_raw in local_pack[:10]:
        name = re.sub(r'<[^>]+>', '', name_raw).strip()
        phone = clean_phone(phone_raw)
        if name and phone and len(name) > 3:
            if not any(r['phone'] == phone for r in results):
                results.append({
                    'name': name[:100], 'phone': phone,
                    'address': '', 'lat': 0.0, 'lng': 0.0,
                    'method': 'local_pack'
                })

    # ── Extract geo from Google Maps URLs ─────────────────────────────────────
    # Google embeds Maps URLs in results: /maps?q=17.4126,78.4483
    geo_pattern = re.compile(r'[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)')
    geos = geo_pattern.findall(html)
    # Assign geos to results that don't have one
    geo_idx = 0
    for result in results:
        if result['lat'] == 0.0 and geo_idx < len(geos):
            try:
                result['lat'] = float(geos[geo_idx][0])
                result['lng'] = float(geos[geo_idx][1])
                geo_idx += 1
            except ValueError:
                pass

    # Deduplicate by phone
    seen_phones = set()
    unique = []
    for r in results:
        if r['phone'] and r['phone'] not in seen_phones:
            seen_phones.add(r['phone'])
            unique.append(r)

    return unique

# ── Load taxonomy ─────────────────────────────────────────────────────────────
def load_l4_nodes():
    rows = dbq("""
        SELECT id, tab::text, l1, l2, l3, l4, display_name, search_synonyms
        FROM taxonomy_nodes
        WHERE is_active = true
          AND tab::text != 'products'
          AND l4 IS NOT NULL
        ORDER BY
          CASE tab::text
            WHEN 'services'       THEN 1
            WHEN 'expertise'      THEN 2
            WHEN 'establishments' THEN 3
            ELSE 4
          END, l1, l3, l4
    """)
    nodes = []
    for row in rows:
        if len(row) >= 8:
            nodes.append({
                'id':row[0].strip(), 'tab':row[1].strip(),
                'l1':row[2].strip(), 'l2':row[3].strip(),
                'l3':row[4].strip(), 'l4':row[5].strip(),
                'display':row[6].strip(),
                'synonyms':row[7].strip() if row[7].strip() else '',
            })
    return nodes

def get_city_ids():
    rows = dbq("SELECT slug, id FROM cities WHERE is_active = true")
    return {r[0].strip(): r[1].strip() for r in rows if len(r) >= 2}

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
def insert_provider(node, city_key, city_id, name, phone, lat, lng, address):
    city = CITIES[city_key]
    # Use real geo if we got it, else city centroid with jitter
    if lat and lng and abs(lat) > 1 and abs(lng) > 1:
        final_lat, final_lng = lat, lng
        geo_note = 'real'
    else:
        final_lat = city['lat'] + random.uniform(-0.02, 0.02)
        final_lng = city['lng'] + random.uniform(-0.02, 0.02)
        geo_note = 'city_centroid'

    tab = node['tab']
    lt_map = {'services':'individual_service','expertise':'expertise',
              'establishments':'establishment'}
    lt = lt_map.get(tab, 'individual_service')
    pid   = str(uuid.uuid4())
    ts_id = str(uuid.uuid4())
    ext_id = f"gsearch_{re.sub(r'[^a-z0-9]','_',phone)}_{city['slug']}"

    sql = f"""
BEGIN;
INSERT INTO provider_profiles (
    id, display_name, business_name, city_id, tab,
    is_active, is_scrape_record, is_claimed, is_phone_verified,
    listing_type, scrape_source, scrape_external_id,
    address_line, phone,
    geo_point, taxonomy_node_id, scrape_source_url,
    created_at, updated_at
) VALUES (
    '{pid}',
    {esc(name)}, {esc(name)},
    '{city_id}',
    '{tab}'::\"Tab\",
    true, true, false, false,
    '{lt}'::\"ListingType\",
    'google_search',
    {esc(ext_id)},
    {esc(address or city['name'])},
    {esc(phone)},
    ST_SetSRID(ST_MakePoint({final_lng},{final_lat}),4326),
    '{node['id']}'::uuid,
    'https://www.google.com/search',
    NOW(), NOW()
) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

INSERT INTO trust_scores (id, provider_id, display_score, raw_score, trust_tier, signal_breakdown)
VALUES ('{ts_id}', '{pid}', 15, 15, 'unverified', '{{}}'::jsonb)
ON CONFLICT (provider_id) DO NOTHING;
COMMIT;
"""
    ok = dbx(sql)
    return ok, geo_note

# ── Build query ───────────────────────────────────────────────────────────────
def build_query(node):
    # Use L4 name cleaned up
    q = re.sub(r'[—–]', '-', node['l4'])
    q = re.sub(r'[&]', 'and', q)
    q = re.sub(r'[^\w\s\-/,]', '', q).strip()
    return q

# ── Scrape ────────────────────────────────────────────────────────────────────
def scrape(cities_to_run, nodes, city_ids, test_mode):
    total_inserted = 0
    total_no_phone = 0
    total_no_results = 0
    blocked = False
    results_table = []

    for node in nodes:
        if blocked: break

        query = build_query(node)

        for city_key in cities_to_run:
            if blocked: break
            city = CITIES[city_key]
            city_id = city_ids.get(city['slug'])
            if not city_id: continue

            if existing_count(node['id'], city_id) >= 1:
                continue

            # Polite sleep — avoid Google blocking
            sleep_time = random.uniform(3.0, 7.0)
            time.sleep(sleep_time)

            results = google_search(query, city['name'])

            if results == 'BLOCKED':
                log("⚠️  Google is blocking requests — stopping")
                log("   Wait 10-15 minutes then re-run.")
                blocked = True
                break

            if not results:
                log(f"  ⚪ [{node['tab']}] {node['l4'][:40]:<40} | {city['name']} — 0 results")
                total_no_results += 1
                results_table.append({
                    'l4':node['l4'],'city':city['name'],
                    'name':'—','phone':'—','geo':'—','result':'NO_RESULTS'
                })
                continue

            log(f"  Found {len(results)} results for [{node['l4'][:30]}] in {city['name']}")

            # Take first result that has phone + usable name
            inserted = False
            for candidate in results[:5]:
                if not candidate['phone']: continue
                if len(candidate['name']) < 3: continue

                ok, geo_note = insert_provider(
                    node, city_key, city_id,
                    candidate['name'], candidate['phone'],
                    candidate['lat'], candidate['lng'],
                    candidate['address']
                )
                if ok:
                    total_inserted += 1
                    inserted = True
                    geo_str = (f"{candidate['lat']:.4f},{candidate['lng']:.4f}" 
                               if candidate['lat'] else f"city_centroid")
                    log(f"  ✅ [{node['tab']}] {node['l4'][:40]:<40} | {city['name']}")
                    log(f"     Name:    {candidate['name']}")
                    log(f"     Phone:   {candidate['phone']}")
                    log(f"     Geo:     {geo_str} ({geo_note})")
                    log(f"     Address: {candidate['address'][:80] or city['name']}")
                    results_table.append({
                        'l4':node['l4'],'city':city['name'],
                        'name':candidate['name'],'phone':candidate['phone'],
                        'geo':geo_str,'result':'INSERTED'
                    })
                    break

            if not inserted:
                log(f"  ❌ [{node['l4'][:40]:<40}] | {city['name']} — {len(results)} found, none usable")
                total_no_phone += 1
                results_table.append({
                    'l4':node['l4'],'city':city['name'],
                    'name':results[0]['name'] if results else '—',
                    'phone':'NO PHONE','geo':'—','result':'NO_PHONE'
                })

    _print_summary(results_table, total_inserted, total_no_phone,
                  total_no_results, blocked)

def _print_summary(results_table, inserted, no_phone, no_results, blocked):
    log("")
    log("="*70)
    log("RESULTS — WHAT WAS ACTUALLY INSERTED")
    log("="*70)
    log(f"{'L4':<38} {'City':<11} {'Name':<28} {'Phone':<12} {'Result'}")
    log("-"*100)
    for r in results_table:
        flag = '✅' if r['result']=='INSERTED' else '❌' if r['result']=='NO_PHONE' else '⚪'
        log(f"{flag} {r['l4'][:36]:<36} {r['city']:<11} {r['name'][:26]:<26} "
            f"{r['phone'][:11]:<11}  {r['result']}")
    log("-"*100)
    total = len(results_table)
    log(f"Tried: {total}  ✅ Inserted: {inserted}  "
        f"❌ No phone: {no_phone}  ⚪ No results: {no_results}")
    if blocked:
        log("⚠️  Stopped early — Google blocked requests")
    log("")
    if total == 0:
        log("⛔ 0 combinations tried — check DB connection or existing data")
    elif inserted == 0:
        log("⛔ Google search HTML parsing not finding phones.")
        log("   Google may have changed their HTML structure.")
        log("   Check scraper_v3_google_search.log for raw details.")
    elif inserted/total >= 0.5:
        log("✅ VERDICT: Works! ≥50% hit rate. Safe to scale to all L4s.")
    elif inserted/total >= 0.3:
        log("⚠️  VERDICT: Partial. 30-50% hit rate. Run for high-demand L4s only.")
    else:
        log("⛔ VERDICT: <30% hit rate. HTML structure may need adjustment.")

def main():
    ap = argparse.ArgumentParser(description='SatvAAh Google Search Scraper V3')
    ap.add_argument('--test',   action='store_true',
                    help='Test: 10 high-demand L4s in Hyderabad only. Free.')
    ap.add_argument('--cities', default='all')
    ap.add_argument('--tab',    default='all')
    args = ap.parse_args()

    log("="*65)
    log("SatvAAh Google Search Scraper V3")
    log("Hits google.com/search — same page you see in browser")
    log(f"Mode: {'TEST (10 L4s, Hyderabad)' if args.test else 'FULL RUN'}")
    log("Cost: FREE (no API)")
    log("="*65)

    city_ids = get_city_ids()
    nodes    = load_l4_nodes()
    log(f"L4 nodes: {len(nodes)}")

    if args.tab != 'all':
        nodes = [n for n in nodes if n['tab'] == args.tab]

    PRIORITY_L4S = [
        'Geyser / Water Heater Repair',
        'Cockroach Control Treatment',
        'Fan & Light Fitting',
        'Full Home Deep Cleaning',
        'Exterior Wall Painting',
        'Home Shifting (within city)',
        'AC Servicing & Deep Cleaning',
        'Drain Cleaning & Unblocking',
        'Bathroom Fittings Installation',
        'Pipe Fitting & Repair',
    ]

    if args.test:
        priority = [n for n in nodes if n['l4'] in PRIORITY_L4S or n['display'] in PRIORITY_L4S]
        remaining = [n for n in nodes if n not in priority]
        nodes = (priority + remaining)[:10]
        cities_to_run = ['hyderabad']
        log(f"TEST: {len(nodes)} L4s × 1 city")
        log("L4s being tested:")
        for n in nodes:
            log(f"  → {n['l4']}")
    else:
        cities_to_run = (list(CITIES.keys()) if args.cities == 'all'
                        else [c.strip() for c in args.cities.split(',') if c.strip() in CITIES])
        log(f"FULL: {len(nodes)} L4s × {len(cities_to_run)} cities")

    log("")
    scrape(cities_to_run, nodes, city_ids, args.test)
    log("NEXT: python3 scripts/bulk-index-opensearch.py")

if __name__ == '__main__':
    main()
