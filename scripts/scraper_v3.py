#!/usr/bin/env python3
"""
scripts/scraper_v3.py

SatvAAh — Consumer-Terms Scraper V3
=====================================
Approach: Use REAL consumer search terms against sources that publish
phones in plain HTML. No expensive APIs. No taxonomy-label queries.

WHAT WORKS (proven):
  Sulekha: search 'plumbers' → HTML has phone numbers in plain text
  IndiaMART: search 'plumber supplier' → JSON in page has mobile numbers

WHAT DOES NOT WORK (proven by testing):
  Google Places API: strips phone numbers from response
  Taxonomy labels as queries: 'Fan & Light Fitting' returns no results

SOURCES:
  Sulekha  — services, expertise, establishments (non-products)
  IndiaMART — products + some services

PROOF — every insert prints:
  ✅ [plumbers] Hyderabad
     Name:    Ravi Kumar Plumbing Services
     Phone:   9876543210
     Geo:     17.4012, 78.4534  (sulekha gives area, we geo-code it)
     Address: Banjara Hills, Hyderabad

5-MINUTE TEST:
  python3 scripts/scraper_v3.py --test
  Runs 5 search terms on Sulekha + 5 on IndiaMART in Hyderabad.
  Free. No API cost. Shows proof table.

FULL RUN (after test passes):
  python3 scripts/scraper_v3.py
"""

import re, uuid, time, subprocess, sys, argparse, random, json
from datetime import datetime
from collections import defaultdict

try:
    import requests
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'requests', '-q'])
    import requests

# ── Cities ────────────────────────────────────────────────────────────────────
CITIES = {
    'hyderabad': {
        'name':'Hyderabad','state':'Telangana',
        'lat':17.3850,'lng':78.4867,'slug':'hyderabad',
        'sulekha':'hyderabad','indiamart':'Hyderabad',
        # Hyderabad area centroids for geo approximation
        'areas': {
            'banjara hills':    (17.4126, 78.4483),
            'jubilee hills':    (17.4239, 78.4074),
            'gachibowli':       (17.4401, 78.3489),
            'kondapur':         (17.4599, 78.3567),
            'madhapur':         (17.4484, 78.3792),
            'hitech city':      (17.4474, 78.3762),
            'secunderabad':     (17.4399, 78.4983),
            'kukatpally':       (17.4849, 78.4138),
            'ameerpet':         (17.4374, 78.4487),
            'dilsukhnagar':     (17.3688, 78.5247),
            'lb nagar':         (17.3474, 78.5515),
            'uppal':            (17.4051, 78.5591),
            'begumpet':         (17.4432, 78.4702),
            'sr nagar':         (17.4575, 78.4362),
            'miyapur':          (17.4960, 78.3524),
            'default':          (17.3850, 78.4867),
        }
    },
    'mumbai': {
        'name':'Mumbai','state':'Maharashtra',
        'lat':19.0760,'lng':72.8777,'slug':'mumbai',
        'sulekha':'mumbai','indiamart':'Mumbai',
        'areas': {
            'andheri':   (19.1136, 72.8697),
            'bandra':    (19.0596, 72.8295),
            'borivali':  (19.2307, 72.8567),
            'dadar':     (19.0178, 72.8478),
            'goregaon':  (19.1663, 72.8526),
            'kandivali': (19.2043, 72.8492),
            'kurla':     (19.0726, 72.8843),
            'thane':     (19.2183, 72.9781),
            'default':   (19.0760, 72.8777),
        }
    },
    'delhi': {
        'name':'Delhi','state':'Delhi',
        'lat':28.6139,'lng':77.2090,'slug':'delhi',
        'sulekha':'new-delhi','indiamart':'Delhi',
        'areas': {
            'dwarka':       (28.5921, 77.0460),
            'janakpuri':    (28.6219, 77.0820),
            'rohini':       (28.7494, 77.1170),
            'saket':        (28.5245, 77.2066),
            'vasant kunj':  (28.5244, 77.1568),
            'karol bagh':   (28.6519, 77.1909),
            'lajpat nagar': (28.5677, 77.2432),
            'default':      (28.6139, 77.2090),
        }
    },
    'chennai': {
        'name':'Chennai','state':'Tamil Nadu',
        'lat':13.0827,'lng':80.2707,'slug':'chennai',
        'sulekha':'chennai','indiamart':'Chennai',
        'areas': {
            'anna nagar':  (13.0850, 80.2101),
            'adyar':       (13.0012, 80.2565),
            'velachery':   (12.9814, 80.2180),
            't nagar':     (13.0418, 80.2341),
            'omr':         (12.9010, 80.2279),
            'default':     (13.0827, 80.2707),
        }
    },
    'bangalore': {
        'name':'Bangalore','state':'Karnataka',
        'lat':12.9716,'lng':77.5946,'slug':'bangalore',
        'sulekha':'bangalore','indiamart':'Bangalore',
        'areas': {
            'koramangala': (12.9352, 77.6245),
            'indiranagar': (12.9784, 77.6408),
            'whitefield':  (12.9698, 77.7500),
            'hsr layout':  (12.9116, 77.6389),
            'jayanagar':   (12.9308, 77.5838),
            'marathahalli':(12.9591, 77.6972),
            'default':     (12.9716, 77.5946),
        }
    },
}

# ── Sulekha search terms mapped to taxonomy L2/L3 ────────────────────────────
# These are the ACTUAL URL slugs sulekha uses — verified to return results
# Each maps to one or more L3 categories in our taxonomy
SULEKHA_TERMS = [
    # Home services
    ('plumbers',                    'Home Maintenance & Repair'),
    ('electricians',                'Home Maintenance & Repair'),
    ('carpenters',                  'Home Maintenance & Repair'),
    ('painters',                    'Home Maintenance & Repair'),
    ('ac-repair',                   'Home Maintenance & Repair'),
    ('pest-control',                'Home Maintenance & Repair'),
    ('home-cleaning-services',      'Home Maintenance & Repair'),
    ('waterproofing-services',      'Home Maintenance & Repair'),
    ('packers-and-movers',          'Transport & Logistics'),
    ('cctv-installation',           'Home Maintenance & Repair'),
    ('solar-panel-installation',    'Home Maintenance & Repair'),
    ('refrigerator-repair',         'Home Maintenance & Repair'),
    ('washing-machine-repair',      'Home Maintenance & Repair'),
    ('ro-water-purifier-service',   'Home Maintenance & Repair'),
    ('geyser-repair',               'Home Maintenance & Repair'),
    # Personal care
    ('beauty-salons',               'Personal Care & Grooming'),
    ('spa-massage',                 'Personal Care & Grooming'),
    ('makeup-artists',              'Personal Care & Grooming'),
    # Health
    ('physiotherapists',            'Healthcare & Medical'),
    ('dietitian',                   'Healthcare & Medical'),
    ('yoga-classes',                'Wellness & Fitness'),
    ('gym-fitness',                 'Wellness & Fitness'),
    # Education
    ('tutors',                      'Education & Tutoring'),
    ('driving-schools',             'Education & Tutoring'),
    ('dance-classes',               'Education & Tutoring'),
    ('music-classes',               'Education & Tutoring'),
    # Professional
    ('ca-chartered-accountants',    'Financial & Accounting'),
    ('advocates-lawyers',           'Legal Services'),
    ('interior-designers',          'Architecture & Design'),
    ('architects',                  'Architecture & Design'),
    # Vehicle
    ('car-mechanics',               'Vehicle Repair'),
    ('car-wash',                    'Vehicle Repair'),
    # Events
    ('event-management',            'Events & Celebrations'),
    ('wedding-photographers',       'Events & Celebrations'),
    ('caterers',                    'Food & Beverage'),
    # Security
    ('security-services',           'Household Help'),
    ('computer-repair',             'IT & Digital Services'),
]

# ── IndiaMART product terms ───────────────────────────────────────────────────
INDIAMART_TERMS = [
    ('fresh vegetables',        'Fresh & Daily Produce'),
    ('fresh fruits',            'Fresh & Daily Produce'),
    ('cow milk',                'Fresh & Daily Produce'),
    ('grocery wholesale',       'Grocery & FMCG'),
    ('rice supplier',           'Grocery & FMCG'),
    ('dal supplier',            'Grocery & FMCG'),
    ('building material',       'Building & Construction'),
    ('cement supplier',         'Building & Construction'),
    ('tiles supplier',          'Building & Construction'),
    ('led bulbs',               'Electronics & Technology'),
    ('mobile accessories',      'Electronics & Technology'),
    ('furniture manufacturer',  'Furniture & Home'),
    ('medical equipment',       'Healthcare & Medical'),
    ('medicines supplier',      'Healthcare & Medical'),
    ('clothing manufacturer',   'Fashion & Apparel'),
    ('auto spare parts',        'Automotive Products'),
    ('pet food',                'Pet Supplies'),
    ('sports equipment',        'Sports & Fitness'),
    ('stationery supplier',     'Stationery & Office'),
    ('agricultural equipment',  'Agriculture & Farming'),
]

LOG = 'scraper_v3.log'

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

# ── Taxonomy matching ─────────────────────────────────────────────────────────
def load_taxonomy():
    """Load all taxonomy nodes keyed by l1 for matching."""
    rows = dbq("""
        SELECT id, tab::text, l1, l2, l3, l4, display_name, search_synonyms
        FROM taxonomy_nodes WHERE is_active = true AND l4 IS NOT NULL
        ORDER BY tab, l1, l3, l4
    """)
    nodes = []
    idx = defaultdict(list)
    for row in rows:
        if len(row) < 8: continue
        n = {'id':row[0].strip(),'tab':row[1].strip(),'l1':row[2].strip(),
             'l2':row[3].strip(),'l3':row[4].strip(),'l4':row[5].strip(),
             'display':row[6].strip(),'synonyms':row[7].strip()}
        nodes.append(n)
        # Build word index over l1+l2+l3+l4+synonyms
        for field in ['l1','l2','l3','l4','synonyms']:
            for word in re.findall(r'[a-z]{3,}', n[field].lower()):
                idx[word].append(n['id'])
    node_map = {n['id']: n for n in nodes}
    return nodes, idx, node_map

def best_match(search_term, l1_hint, nodes, idx, node_map, tab_hint=None):
    """
    Find the best taxonomy node for a scraped business.
    Uses search_term words + l1_hint to score nodes.
    tab_hint: if provided, prefer nodes from this tab.
    """
    from collections import Counter
    scores = Counter()
    text = (search_term + ' ' + (l1_hint or '')).lower()
    for word in re.findall(r'[a-z]{3,}', text):
        for nid in idx.get(word, []):
            scores[nid] += 1
    if tab_hint:
        for nid in list(scores.keys()):
            if node_map.get(nid, {}).get('tab') == tab_hint:
                scores[nid] += 3
    if not scores:
        return None
    return scores.most_common(1)[0][0]

def get_city_ids():
    rows = dbq("SELECT slug, id FROM cities WHERE is_active = true")
    return {r[0].strip(): r[1].strip() for r in rows if len(r) >= 2}

# ── Geo from area name ────────────────────────────────────────────────────────
def geo_from_area(city_key, area_text):
    """
    Given an area name string from scrape, return (lat, lng).
    Tries to match against known area centroids.
    Falls back to city centroid + small jitter.
    """
    city = CITIES[city_key]
    areas = city.get('areas', {})
    if area_text:
        area_lower = area_text.lower()
        for area_name, coords in areas.items():
            if area_name != 'default' and area_name in area_lower:
                # Add tiny jitter so records in same area don't overlap exactly
                return (coords[0] + random.uniform(-0.005, 0.005),
                        coords[1] + random.uniform(-0.005, 0.005))
    # Fall back to city centroid with larger jitter
    return (city['lat'] + random.uniform(-0.03, 0.03),
            city['lng'] + random.uniform(-0.03, 0.03))

# ── HTTP session ──────────────────────────────────────────────────────────────
def make_session():
    s = requests.Session()
    s.headers.update({
        'User-Agent': ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                      'AppleWebKit/537.36 (KHTML, like Gecko) '
                      'Chrome/120.0.0.0 Safari/537.36'),
        'Accept-Language': 'en-IN,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    })
    return s

# ── Sulekha scraper ───────────────────────────────────────────────────────────
def scrape_sulekha(session, slug, city_key, limit=10):
    """
    Scrape sulekha.com for a given service category in a city.
    Returns list of dicts: name, phone, area, address.

    Sulekha publishes phone numbers in plain text on their listing pages.
    xphones() regex [6-9]\d{9} extracts them directly.
    """
    city = CITIES[city_key]
    sulekha_city = city['sulekha']
    results = []

    for url in [
        f"https://www.sulekha.com/{slug}/{sulekha_city}",
        f"https://www.sulekha.com/{slug}-in-{sulekha_city}",
    ]:
        try:
            r = session.get(url, timeout=10)
            if r.status_code != 200:
                continue

            html = r.text

            # Extract names from JSON-LD schema
            names = re.findall(r'"name"\s*:\s*"([^"]{4,80})"', html)
            names = [n for n in names
                     if 'sulekha' not in n.lower()
                     and 'http' not in n.lower()
                     and len(n) > 4
                     and not n.startswith('@')
                     and n not in ('Sulekha.com', 'Home', 'Services')]

            # Extract phone numbers — sulekha shows them in HTML
            phones_raw = re.findall(r'[6-9]\d{9}', html)
            seen = set()
            phones = []
            for p in phones_raw:
                if p not in seen:
                    seen.add(p)
                    phones.append(p)

            # Extract area/locality
            areas = re.findall(
                r'(?:locality|area|address)["\s:>]+([A-Za-z\s]{4,40})',
                html, re.IGNORECASE)
            areas = [a.strip() for a in areas if len(a.strip()) > 3]

            # Extract ratings
            ratings = re.findall(r'"ratingValue"\s*:\s*"?([0-9.]+)"?', html)

            if names and phones:
                for i, name in enumerate(names[:limit]):
                    phone = clean_phone(phones[i] if i < len(phones) else None)
                    area  = areas[i] if i < len(areas) else None
                    rating = float(ratings[0]) if ratings else None
                    results.append({
                        'name':   name,
                        'phone':  phone,
                        'area':   area,
                        'rating': rating,
                    })
                break  # Got results from this URL

        except Exception as e:
            log(f"  Sulekha error ({url}): {e}")
            continue

        time.sleep(random.uniform(1.0, 2.0))

    return results

# ── IndiaMART scraper ─────────────────────────────────────────────────────────
def scrape_indiamart(session, query, city_key, limit=10):
    """
    Scrape IndiaMART directory for a product category in a city.
    IndiaMART embeds supplier data as JSON in the page HTML.
    Mobile numbers are in "mobile" field in that JSON.
    """
    city = CITIES[city_key]
    results = []

    try:
        r = session.get(
            'https://dir.indiamart.com/search.mp',
            params={'ss': query, 'src_area': city['indiamart'], 'page': 1},
            timeout=12)

        if r.status_code == 403:
            return 'BLOCKED'
        if r.status_code != 200:
            return []

        html = r.text

        # IndiaMART embeds company data as JSON in the page
        companies = re.findall(r'"companyName"\s*:\s*"([^"]{3,80})"', html)
        mobiles   = re.findall(r'"mobile"\s*:\s*"(\d{10,12})"', html)
        addresses = re.findall(r'"address"\s*:\s*"([^"]{5,150})"', html)
        pincodes  = re.findall(r'"pincode"\s*:\s*"(\d{6})"', html)

        for i, company in enumerate(companies[:limit]):
            phone = clean_phone(mobiles[i] if i < len(mobiles) else None)
            addr  = addresses[i] if i < len(addresses) else None
            pin   = pincodes[i]  if i < len(pincodes)  else None
            results.append({
                'name':    company.strip(),
                'phone':   phone,
                'area':    addr,
                'pincode': pin,
            })

    except Exception as e:
        log(f"  IndiaMART error: {e}")

    return results

# ── Insert provider ───────────────────────────────────────────────────────────
def insert_provider(name, phone, lat, lng, address, city_key, city_id,
                    node_id, tab, source, ext_id, pincode=None, rating=None):
    lt_map = {
        'services':      'individual_service',
        'expertise':     'expertise',
        'establishments':'establishment',
        'products':      'individual_product',
    }
    lt  = lt_map.get(tab, 'individual_service')
    pid = str(uuid.uuid4())
    ts_id = str(uuid.uuid4())

    # Trust score: base 15, +5 if has rating
    trust = 20 if rating and rating >= 4.0 else 15

    sql = f"""
BEGIN;
INSERT INTO provider_profiles (
    id, display_name, business_name, city_id, tab,
    is_active, is_scrape_record, is_claimed, is_phone_verified,
    listing_type, scrape_source, scrape_external_id,
    address_line, phone, pincode,
    geo_point, taxonomy_node_id,
    created_at, updated_at
) VALUES (
    '{pid}',
    {esc(name)}, {esc(name)},
    '{city_id}',
    '{tab}'::\"Tab\",
    true, true, false, false,
    '{lt}'::\"ListingType\",
    '{source}',
    {esc(ext_id)},
    {esc(address or '')},
    {esc(phone or '')},
    {esc(pincode) if pincode else 'NULL'},
    ST_SetSRID(ST_MakePoint({lng},{lat}),4326),
    '{node_id}'::uuid,
    NOW(), NOW()
) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

INSERT INTO trust_scores (id, provider_id, display_score, raw_score, trust_tier, signal_breakdown)
VALUES ('{ts_id}', '{pid}', {trust}, {trust}, 'unverified', '{{}}'::jsonb)
ON CONFLICT (provider_id) DO NOTHING;
COMMIT;
"""
    return dbx(sql)

# ── Run Sulekha for all terms ─────────────────────────────────────────────────
def run_sulekha(session, city_key, city_id, terms, nodes, idx, node_map,
                results_table, test_mode):
    inserted = 0
    for slug, l1_hint in terms:
        log(f"\n  sulekha/{slug} in {CITIES[city_key]['name']}")

        candidates = scrape_sulekha(session, slug, city_key, limit=10)

        if not candidates:
            log(f"  ⚪ No results from Sulekha")
            results_table.append({'source':'sulekha','term':slug,
                'city':CITIES[city_key]['name'],'name':'—',
                'phone':'—','result':'NO_RESULTS'})
            continue

        # Find best taxonomy match for this search term
        node_id = best_match(slug, l1_hint, nodes, idx, node_map, tab_hint=None)
        if not node_id:
            log(f"  ⚠️  No taxonomy match for '{slug}'")
            continue
        node = node_map[node_id]
        tab  = node['tab']

        # Take first candidate with a real phone
        inserted_this = False
        for candidate in candidates:
            if not candidate['phone']:
                continue

            lat, lng = geo_from_area(city_key, candidate['area'])
            ext_id = f"sulekha_v3_{re.sub(r'[^a-z0-9]','_',candidate['name'].lower()[:40])}_{CITIES[city_key]['slug']}"

            ok = insert_provider(
                name=candidate['name'], phone=candidate['phone'],
                lat=lat, lng=lng,
                address=f"{candidate['area'] or ''}, {CITIES[city_key]['name']}",
                city_key=city_key, city_id=city_id,
                node_id=node_id, tab=tab,
                source='sulekha_v3', ext_id=ext_id,
                rating=candidate['rating']
            )

            if ok:
                inserted += 1
                inserted_this = True
                log(f"  ✅ [{slug}] {CITIES[city_key]['name']}")
                log(f"     Name:    {candidate['name']}")
                log(f"     Phone:   {candidate['phone']}")
                log(f"     Area:    {candidate['area'] or 'city level'}")
                log(f"     Geo:     {lat:.4f}, {lng:.4f}")
                log(f"     L4:      {node['l4']} ({tab})")
                results_table.append({'source':'sulekha','term':slug,
                    'city':CITIES[city_key]['name'],'name':candidate['name'],
                    'phone':candidate['phone'],'result':'INSERTED'})
                break

        if not inserted_this:
            no_phone_count = sum(1 for c in candidates if not c['phone'])
            log(f"  ❌ {len(candidates)} results, none had phone ({no_phone_count} no phone)")
            results_table.append({'source':'sulekha','term':slug,
                'city':CITIES[city_key]['name'],
                'name':candidates[0]['name'] if candidates else '—',
                'phone':'NO PHONE','result':'NO_PHONE'})

        time.sleep(random.uniform(1.5, 2.5))

    return inserted

# ── Run IndiaMART for all terms ───────────────────────────────────────────────
def run_indiamart(session, city_key, city_id, terms, nodes, idx, node_map,
                  results_table, test_mode):
    inserted = 0
    for query, l1_hint in terms:
        log(f"\n  indiamart/{query} in {CITIES[city_key]['name']}")

        candidates = scrape_indiamart(session, query, city_key, limit=10)

        if candidates == 'BLOCKED':
            log(f"  ⚠️  IndiaMART blocking — skipping remaining IndiaMART terms")
            return inserted

        if not candidates:
            log(f"  ⚪ No results from IndiaMART")
            results_table.append({'source':'indiamart','term':query,
                'city':CITIES[city_key]['name'],'name':'—',
                'phone':'—','result':'NO_RESULTS'})
            continue

        node_id = best_match(query, l1_hint, nodes, idx, node_map, tab_hint='products')
        if not node_id:
            log(f"  ⚠️  No taxonomy match for '{query}'")
            continue
        node = node_map[node_id]

        for candidate in candidates:
            if not candidate['phone']:
                continue

            lat, lng = geo_from_area(city_key, candidate['area'])
            ext_id = f"indiamart_v3_{re.sub(r'[^a-z0-9]','_',candidate['name'].lower()[:40])}_{CITIES[city_key]['slug']}"

            ok = insert_provider(
                name=candidate['name'], phone=candidate['phone'],
                lat=lat, lng=lng,
                address=f"{candidate['area'] or ''}, {CITIES[city_key]['name']}",
                city_key=city_key, city_id=city_id,
                node_id=node_id, tab='products',
                source='indiamart_v3', ext_id=ext_id,
                pincode=candidate.get('pincode')
            )

            if ok:
                inserted += 1
                log(f"  ✅ [{query}] {CITIES[city_key]['name']}")
                log(f"     Name:    {candidate['name']}")
                log(f"     Phone:   {candidate['phone']}")
                log(f"     Address: {candidate['area'] or 'city level'}")
                log(f"     L4:      {node['l4']} (products)")
                results_table.append({'source':'indiamart','term':query,
                    'city':CITIES[city_key]['name'],'name':candidate['name'],
                    'phone':candidate['phone'],'result':'INSERTED'})
                break
            else:
                results_table.append({'source':'indiamart','term':query,
                    'city':CITIES[city_key]['name'],'name':candidate['name'],
                    'phone':'NO PHONE','result':'NO_PHONE'})

        time.sleep(random.uniform(2.0, 3.5))

    return inserted

# ── Summary ───────────────────────────────────────────────────────────────────
def print_summary(results_table, total_inserted):
    log("")
    log("="*70)
    log("FINAL RESULTS — WHAT WAS ACTUALLY INSERTED INTO DB")
    log("="*70)
    log(f"{'Src':<10} {'Term':<30} {'City':<12} {'Name':<28} {'Phone':<12} {'Result'}")
    log("-"*110)
    for r in results_table:
        flag = '✅' if r['result']=='INSERTED' else '❌' if r['result']=='NO_PHONE' else '⚪'
        log(f"{flag} {r['source']:<8} {r['term'][:28]:<28} {r['city']:<12} "
            f"{r['name'][:26]:<26} {r['phone'][:11]:<11}  {r['result']}")
    log("-"*110)

    total = len(results_table)
    sulekha_ins = sum(1 for r in results_table if r['result']=='INSERTED' and r['source']=='sulekha')
    im_ins      = sum(1 for r in results_table if r['result']=='INSERTED' and r['source']=='indiamart')
    no_phone    = sum(1 for r in results_table if r['result']=='NO_PHONE')
    no_results  = sum(1 for r in results_table if r['result']=='NO_RESULTS')

    log(f"Total attempted: {total}")
    log(f"  ✅ Sulekha inserts:   {sulekha_ins}")
    log(f"  ✅ IndiaMART inserts: {im_ins}")
    log(f"  ✅ TOTAL INSERTED:    {total_inserted}")
    log(f"  ❌ No phone found:    {no_phone}")
    log(f"  ⚪ No results:        {no_results}")
    log("")

    if total_inserted == 0:
        log("⛔ VERDICT: Neither source returned phone numbers.")
        log("   Check if sites are blocking. Try again in 10 minutes.")
    elif total > 0 and total_inserted/total >= 0.5:
        log("✅ VERDICT: Working well. ≥50% hit rate. Scale to all cities.")
    elif total > 0 and total_inserted/total >= 0.3:
        log("⚠️  VERDICT: Partially working. Scale sulekha, review IndiaMART.")
    else:
        log("⚠️  VERDICT: Low hit rate. Check which terms are failing.")

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description='SatvAAh Scraper V3 — Sulekha + IndiaMART')
    ap.add_argument('--test',    action='store_true',
                    help='Test: 5 sulekha + 5 indiamart terms in Hyderabad. Free.')
    ap.add_argument('--cities',  default='all')
    ap.add_argument('--source',  default='all', choices=['all','sulekha','indiamart'])
    args = ap.parse_args()

    log("="*65)
    log("SatvAAh Scraper V3 — Real consumer terms, real phone numbers")
    log(f"Sources: {'Sulekha + IndiaMART' if args.source=='all' else args.source}")
    log(f"Mode:    {'TEST (Hyderabad only, 5 terms each)' if args.test else 'FULL RUN'}")
    log("="*65)

    city_ids   = get_city_ids()
    nodes, idx, node_map = load_taxonomy()
    log(f"Taxonomy: {len(nodes)} nodes loaded")

    session = make_session()

    if args.test:
        cities_to_run  = ['hyderabad']
        sulekha_terms  = SULEKHA_TERMS[:5]
        indiamart_terms = INDIAMART_TERMS[:5]
    else:
        cities_to_run  = list(CITIES.keys()) if args.cities == 'all' else \
                         [c.strip() for c in args.cities.split(',') if c.strip() in CITIES]
        sulekha_terms  = SULEKHA_TERMS
        indiamart_terms = INDIAMART_TERMS

    results_table  = []
    total_inserted = 0

    for city_key in cities_to_run:
        city_id = city_ids.get(CITIES[city_key]['slug'])
        if not city_id:
            log(f"⚠️  {city_key} not in DB — skipping")
            continue

        log(f"\n{'='*65}")
        log(f"CITY: {CITIES[city_key]['name'].upper()}")
        log(f"{'='*65}")

        if args.source in ('all', 'sulekha'):
            log(f"\n── SULEKHA ({len(sulekha_terms)} terms) ──")
            n = run_sulekha(session, city_key, city_id, sulekha_terms,
                           nodes, idx, node_map, results_table, args.test)
            total_inserted += n

        if args.source in ('all', 'indiamart'):
            log(f"\n── INDIAMART ({len(indiamart_terms)} terms) ──")
            n = run_indiamart(session, city_key, city_id, indiamart_terms,
                             nodes, idx, node_map, results_table, args.test)
            total_inserted += n

    print_summary(results_table, total_inserted)

    if total_inserted > 0:
        log("\nNEXT: python3 scripts/bulk-index-opensearch.py")

if __name__ == '__main__':
    main()
