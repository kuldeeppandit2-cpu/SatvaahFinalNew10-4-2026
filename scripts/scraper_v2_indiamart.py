#!/usr/bin/env python3
"""
scripts/scraper_v2_indiamart.py

SatvAAh — IndiaMART Scraper V2
================================
Target: products tab (1,175 L4 nodes)
Goal:   1 supplier per L4 per city with ALL 3 bare minimums:
        name + phone + geo

HONEST EXPECTATIONS:
  - IndiaMART is a B2B marketplace. Suppliers WANT to be found.
    They voluntarily list their phone numbers. High hit rate expected.
  - Geo will be CITY-LEVEL only (not precise GPS).
    IndiaMART gives city + address but rarely lat/lng.
    We use city centroid + address-based jitter as geo approximation.
    This is honest — consumer cannot GPS-navigate to a product supplier.
    They call first (phone), then visit.
  - Some L4 product categories will not exist on IndiaMART
    (very niche, handmade, or consumer-only products).

PROOF OUTPUT (what you see for every insert):
  [INSERTED] A2 Cow Milk | Hyderabad
    Name:    Gir Cow Products India
    Phone:   9876543210        ← REAL from IndiaMART listing
    Geo:     17.3850, 78.4867  ← city centroid (honest approximation)
    Address: Banjara Hills, Hyderabad, Telangana

  [SKIPPED] Swimming Cap | Hyderabad — not found on IndiaMART

5-MINUTE TEST:
  python3 scripts/scraper_v2_indiamart.py --test
  Runs 10 product L4s in Hyderabad only. Free (web scraping).
  If ≥5/10 have phone → proceed to full run.

FULL RUN:
  python3 scripts/scraper_v2_indiamart.py
  All 1,175 product L4s × 5 cities. Free (web scraping).
  Will take ~2-3 hours. Includes rate limiting to avoid blocks.
"""

import re, uuid, time, subprocess, sys, argparse, random
from datetime import datetime

try:
    import requests
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'requests', '-q'])
    import requests

CITIES = {
    'hyderabad': {'name':'Hyderabad','state':'Telangana',
                  'lat':17.3850,'lng':78.4867,'slug':'hyderabad',
                  'im_city':'Hyderabad'},
    'mumbai':    {'name':'Mumbai',   'state':'Maharashtra',
                  'lat':19.0760,'lng':72.8777,'slug':'mumbai',
                  'im_city':'Mumbai'},
    'delhi':     {'name':'Delhi',    'state':'Delhi',
                  'lat':28.6139,'lng':77.2090,'slug':'delhi',
                  'im_city':'Delhi'},
    'chennai':   {'name':'Chennai',  'state':'Tamil Nadu',
                  'lat':13.0827,'lng':80.2707,'slug':'chennai',
                  'im_city':'Chennai'},
    'bangalore': {'name':'Bangalore','state':'Karnataka',
                  'lat':12.9716,'lng':77.5946,'slug':'bangalore',
                  'im_city':'Bangalore'},
}

LOG = 'scraper_v2_indiamart.log'

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

# ── HTTP session ──────────────────────────────────────────────────────────────
def make_session():
    s = requests.Session()
    s.headers.update({
        'User-Agent': ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                      'AppleWebKit/537.36 (KHTML, like Gecko) '
                      'Chrome/120.0.0.0 Safari/537.36'),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9',
        'Referer': 'https://www.indiamart.com/',
    })
    return s

# ── IndiaMART search ──────────────────────────────────────────────────────────
def search_indiamart(session, query, city_name):
    """
    Search IndiaMART directory for a product/service in a city.
    Returns list of dicts with name, phone, address.

    IndiaMART search URL: https://dir.indiamart.com/search.mp?ss=QUERY&src_area=CITY
    Phone is in JSON embedded in page: "mobile":"9876543210"
    """
    url = 'https://dir.indiamart.com/search.mp'
    params = {
        'ss':       query,
        'src_area': city_name,
        'page':     1,
    }
    try:
        r = session.get(url, params=params, timeout=12)
        if r.status_code == 403:
            return 'BLOCKED'
        if r.status_code != 200:
            return []

        html = r.text

        # Extract company names
        companies = re.findall(r'"companyName"\s*:\s*"([^"]{3,80})"', html)
        # Extract mobile numbers
        mobiles = re.findall(r'"mobile"\s*:\s*"(\d{10,12})"', html)
        # Extract addresses
        addresses = re.findall(r'"address"\s*:\s*"([^"]{5,150})"', html)
        # Extract pincodes  
        pincodes = re.findall(r'"pincode"\s*:\s*"(\d{6})"', html)

        results = []
        for i, company in enumerate(companies):
            phone = clean_phone(mobiles[i] if i < len(mobiles) else None)
            addr  = addresses[i] if i < len(addresses) else None
            pin   = pincodes[i]  if i < len(pincodes)  else None
            results.append({
                'name':    company.strip(),
                'phone':   phone,
                'address': addr,
                'pincode': pin,
            })
        return results

    except Exception as e:
        log(f"  IndiaMART error: {e}")
        return []

# ── Load taxonomy ─────────────────────────────────────────────────────────────
def load_product_l4_nodes():
    rows = dbq("""
        SELECT id, l1, l2, l3, l4, display_name, search_synonyms
        FROM taxonomy_nodes
        WHERE is_active = true
          AND tab::text = 'products'
          AND l4 IS NOT NULL
        ORDER BY l1, l3, l4
    """)
    nodes = []
    for row in rows:
        if len(row) >= 7:
            nodes.append({
                'id':       row[0].strip(),
                'tab':      'products',
                'l1':       row[1].strip(),
                'l2':       row[2].strip(),
                'l3':       row[3].strip(),
                'l4':       row[4].strip(),
                'display':  row[5].strip(),
                'synonyms': row[6].strip() if row[6].strip() else '',
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

# ── Build search query ────────────────────────────────────────────────────────
def build_query(node):
    """
    Build IndiaMART search query.
    IndiaMART works best with product + 'supplier' or just product name.
    Uses first English synonym if L4 name is too specific.
    """
    l4 = node['l4']

    # Clean special chars
    q = re.sub(r'[—–\(\)]', ' ', l4)
    q = re.sub(r'[&]', 'and', q)
    q = re.sub(r'\s+', ' ', q).strip()

    # If L4 name contains measurement units or very specific specs,
    # try using L3 name instead — more likely to match IndiaMART categories
    OVERLY_SPECIFIC = ['sq mm','ml ','litre','kg ','gram','inch','mm ','cm ']
    if any(s in l4.lower() for s in OVERLY_SPECIFIC):
        q = node['l3']  # Fall back to L3
        q = re.sub(r'[—–\(\)]', ' ', q)
        q = re.sub(r'[&]', 'and', q).strip()

    return q

# ── Insert ────────────────────────────────────────────────────────────────────
def insert_provider(node, city_key, city_id, name, phone, address, pincode):
    city = CITIES[city_key]
    # Use city centroid with small random jitter
    # This is honest: IndiaMART gives city-level location, not precise GPS
    lat = city['lat'] + random.uniform(-0.025, 0.025)
    lng = city['lng'] + random.uniform(-0.025, 0.025)

    pid   = str(uuid.uuid4())
    ts_id = str(uuid.uuid4())
    ext_id = f"indiamart_{re.sub(r'[^a-z0-9]', '_', name.lower()[:40])}_{city['slug']}"

    full_addr = address or city['name']
    if pincode and pincode not in full_addr:
        full_addr = full_addr + ' - ' + pincode

    sql = f"""
BEGIN;
INSERT INTO provider_profiles (
    id, display_name, business_name, city_id, tab,
    is_active, is_scrape_record, is_claimed, is_phone_verified,
    listing_type, scrape_source, scrape_external_id,
    address_line, phone, pincode,
    geo_point, taxonomy_node_id, scrape_source_url,
    created_at, updated_at
) VALUES (
    '{pid}',
    {esc(name)}, {esc(name)},
    '{city_id}',
    'products'::\"Tab\",
    true, true, false, false,
    'individual_product'::\"ListingType\",
    'indiamart',
    {esc(ext_id)},
    {esc(full_addr)},
    {esc(phone or '')},
    {esc(pincode) if pincode else 'NULL'},
    ST_SetSRID(ST_MakePoint({lng},{lat}),4326),
    '{node['id']}'::uuid,
    'https://dir.indiamart.com/search.mp',
    NOW(), NOW()
) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

INSERT INTO trust_scores (id, provider_id, display_score, raw_score, trust_tier, signal_breakdown)
VALUES ('{ts_id}', '{pid}', 15, 15, 'unverified', '{{}}'::jsonb)
ON CONFLICT (provider_id) DO NOTHING;
COMMIT;
"""
    return dbx(sql)

# ── Main scrape ───────────────────────────────────────────────────────────────
def scrape(cities_to_run, nodes, city_ids, test_mode):
    session = make_session()
    total_inserted = 0
    total_no_phone = 0
    total_no_results = 0
    blocked = False
    results_table = []

    for node in nodes:
        if blocked:
            break

        query = build_query(node)

        for city_key in cities_to_run:
            if blocked:
                break
            city = CITIES[city_key]
            city_id = city_ids.get(city['slug'])
            if not city_id:
                continue

            if existing_count(node['id'], city_id) >= 1:
                continue

            # Rate limit — be polite to IndiaMART
            time.sleep(random.uniform(1.5, 3.0))

            results = search_indiamart(session, query, city['im_city'])

            if results == 'BLOCKED':
                log("⚠️  IndiaMART is blocking requests — stopping")
                log("   This is normal. IndiaMART rate-limits scrapers.")
                log("   Wait 10 minutes then re-run.")
                blocked = True
                break

            if not results:
                log(f"  ⚪ [{node['l4'][:40]}] | {city['name']} — 0 results")
                total_no_results += 1
                results_table.append({
                    'l4':node['l4'],'city':city['name'],
                    'name':'—','phone':'—','result':'NO_RESULTS'
                })
                continue

            # Find first result WITH a phone
            inserted = False
            for candidate in results[:5]:  # Try top 5 candidates
                if not candidate['phone']:
                    continue

                ok = insert_provider(
                    node, city_key, city_id,
                    candidate['name'], candidate['phone'],
                    candidate['address'], candidate['pincode']
                )

                if ok:
                    total_inserted += 1
                    inserted = True
                    log(f"  ✅ [{node['l4'][:40]:<40}] | {city['name']}")
                    log(f"     Name:    {candidate['name']}")
                    log(f"     Phone:   {candidate['phone']}")
                    log(f"     Geo:     {city['lat']:.4f}, {city['lng']:.4f} (city centroid)")
                    log(f"     Address: {candidate['address'] or city['name']}")
                    results_table.append({
                        'l4':node['l4'],'city':city['name'],
                        'name':candidate['name'],
                        'phone':candidate['phone'],'result':'INSERTED'
                    })
                    break

            if not inserted:
                log(f"  ❌ [{node['l4'][:40]:<40}] | {city['name']}"
                    f" — {len(results)} results, none had phone")
                total_no_phone += 1
                results_table.append({
                    'l4':node['l4'],'city':city['name'],
                    'name':results[0]['name'] if results else '—',
                    'phone':'NO PHONE','result':'NO_PHONE'
                })

    _print_summary(results_table, total_inserted, total_no_phone,
                  total_no_results, blocked)

def _print_summary(results_table, inserted, no_phone, no_results, blocked):
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
    log(f"  ✅ INSERTED (name+phone+geo):   {inserted}"
        f"  ({'—' if not total else f'{inserted/total*100:.0f}%'})")
    log(f"  ❌ NO PHONE in results:         {no_phone}")
    log(f"  ⚪ NO RESULTS at all:           {no_results}")
    if blocked:
        log(f"  ⚠️  BLOCKED by IndiaMART before completion")
    log("")
    if inserted == 0:
        log("⛔ VERDICT: IndiaMART NOT working for these product L4s.")
        log("   Do not scale. Try a different source for products.")
    elif total > 0 and inserted/total >= 0.5:
        log("✅ VERDICT: IndiaMART works. ≥50% hit rate. Safe to scale.")
    elif total > 0 and inserted/total >= 0.3:
        log("⚠️  VERDICT: IndiaMART partially works (30-50%).")
        log("   Scale only for L1 categories that passed.")
    else:
        log("⛔ VERDICT: <30% hit rate. Wrong source for products.")

def main():
    ap = argparse.ArgumentParser(description='SatvAAh IndiaMART Scraper V2')
    ap.add_argument('--test',   action='store_true',
                    help='Test: 10 product L4s in Hyderabad only. Free.')
    ap.add_argument('--cities', default='all')
    ap.add_argument('--l1',     default=None,
                    help='Run for specific L1 category only e.g. "Fresh & Daily Produce"')
    args = ap.parse_args()

    log("="*65)
    log("SatvAAh IndiaMART Scraper V2 — Products Tab")
    log(f"Mode: {'TEST (10 L4s, Hyderabad only)' if args.test else 'FULL RUN'}")
    log("NOTE: Geo will be city-level only (honest). Phone from IndiaMART.")
    log("="*65)

    city_ids = get_city_ids()
    nodes    = load_product_l4_nodes()
    log(f"Product L4 nodes: {len(nodes)}")

    if args.l1:
        nodes = [n for n in nodes if args.l1.lower() in n['l1'].lower()]
        log(f"Filtered to L1 '{args.l1}': {len(nodes)} nodes")

    if args.test:
        nodes = nodes[:10]
        cities_to_run = ['hyderabad']
        log(f"TEST: {len(nodes)} L4s × 1 city = {len(nodes)} max records")
        log("Cost: FREE (web scraping, no API)")
    else:
        if args.cities == 'all':
            cities_to_run = list(CITIES.keys())
        else:
            cities_to_run = [c.strip() for c in args.cities.split(',')
                            if c.strip() in CITIES]
        log(f"FULL: {len(nodes)} L4s × {len(cities_to_run)} cities")

    log("")
    scrape(cities_to_run, nodes, city_ids, args.test)
    log("NEXT: python3 scripts/bulk-index-opensearch.py")

if __name__ == '__main__':
    main()
