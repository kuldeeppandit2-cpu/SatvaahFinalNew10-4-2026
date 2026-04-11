#!/usr/bin/env python3
"""
scripts/scraper_google_places.py

SatvAAh Google Places Scraper
==============================
Uses Google Places Text Search API to find real local providers.
Costs ~$0.017 per request. $200 free credit = ~11,700 requests = ~234,000 results.

Run: python3 -u scripts/scraper_google_places.py --key YOUR_API_KEY
     python3 -u scripts/scraper_google_places.py --key YOUR_API_KEY --cities hyderabad --limit 50

Inserts directly into provider_profiles via docker exec psql (same as main scraper).
"""

import json, time, uuid, re, subprocess, sys, argparse, os
from datetime import datetime

try:
    import requests
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'requests', '-q'])
    import requests

# ── Cities ────────────────────────────────────────────────────────────────────
CITIES = {
    'hyderabad': {'name':'Hyderabad','state':'Telangana','lat':17.385,'lng':78.4867,'slug':'hyderabad'},
    'mumbai':    {'name':'Mumbai',   'state':'Maharashtra','lat':19.076,'lng':72.877,'slug':'mumbai'},
    'delhi':     {'name':'Delhi',    'state':'Delhi',      'lat':28.613,'lng':77.209,'slug':'delhi'},
    'chennai':   {'name':'Chennai',  'state':'Tamil Nadu', 'lat':13.082,'lng':80.270,'slug':'chennai'},
    'bangalore': {'name':'Bangalore','state':'Karnataka',  'lat':12.971,'lng':77.594,'slug':'bangalore'},
}

# ── Search terms — pulled from taxonomy (services + establishments + expertise) ──
# These are colloquial terms real consumers use — matches taxonomy L3/L4 nodes
SEARCH_TERMS = [
    # Home Services (high demand)
    'electrician','plumber','carpenter','painter','AC repair','pest control',
    'house cleaning','washing machine repair','refrigerator repair','CCTV installation',
    'waterproofing','false ceiling','tile work','plumbing repair','geyser repair',
    'chimney repair','RO water purifier service','inverter battery service',
    'sofa cleaning','carpet cleaning','bathroom cleaning','kitchen cleaning',
    # Local trades
    'tailor alteration','shoe repair cobbler','bicycle repair','mobile repair',
    'laptop repair','printer repair','TV repair','microwave repair',
    'lock repair locksmith','welding fabrication','glass fitting',
    # Daily needs / Kirana
    'kirana general store','grocery store','vegetable vendor','fruit vendor',
    'milk dairy vendor','bakery','sweet shop','pharmacy medical store',
    'flowers florist','laundry dry cleaning','courier service',
    # Food & Restaurant
    'restaurant','tiffin service','catering service','biryani restaurant',
    'dhaba','cafe coffee shop','juice shop','fast food','street food',
    'cloud kitchen','home cooked food delivery','south indian restaurant',
    # Healthcare
    'general physician doctor','dentist','physiotherapist','homeopathy doctor',
    'ayurvedic doctor','diagnostic lab','eye clinic','skin clinic dermatologist',
    'pediatrician child doctor','gynecologist','orthopedic doctor',
    'nursing home hospital','pharmacy','blood test home collection',
    # Education
    'tutor home teacher','coaching center','computer training',
    'driving school','yoga classes','dance classes','music classes',
    'spoken english classes','drawing art classes',
    # Personal Care
    'beauty parlour','hair salon','barber shop','spa massage',
    'bridal makeup artist','mehendi artist','nail art',
    # Professional
    'chartered accountant CA','lawyer advocate','insurance agent',
    'travel agent','property dealer','interior designer',
    'architect','event management','wedding photographer',
    'videographer','digital marketing',
    # Vehicle
    'car repair garage','bike repair','car wash','tyre puncture',
    'car AC repair','denting painting',
    # Fitness
    'gym fitness center','swimming pool','sports academy',
    # Pets
    'veterinary doctor pet','pet shop','dog grooming',
    # Construction
    'civil contractor','house construction','interior work',
    'modular kitchen','aluminium fabrication',
]

# ── DB helpers ────────────────────────────────────────────────────────────────
def dbq(sql):
    r = subprocess.run(
        ['docker','exec','satvaaah-postgres','psql','-U','satvaaah_user','-d','satvaaah',
         '-t','-A','-F','\t','-c', sql],
        capture_output=True, text=True, timeout=30)
    lines = [l for l in r.stdout.strip().split('\n') if l.strip()]
    return [l.split('\t') for l in lines]

def dbx(sql, verbose=False):
    r = subprocess.run(
        ['docker','exec','-i','satvaaah-postgres','psql','-U','satvaaah_user','-d','satvaaah'],
        input=sql, capture_output=True, text=True, timeout=120)
    ok = 'INSERT' in r.stdout or 'UPDATE' in r.stdout or 'COMMIT' in r.stdout
    if not ok and r.stderr.strip():
        print(f'    DB ERROR: {r.stderr.strip()[:200]}')
    if not ok and r.stdout.strip():
        print(f'    DB OUT: {r.stdout.strip()[:200]}')
    return ok

def esc(s):
    if s is None: return 'NULL'
    return "'" + str(s).replace("'","''").replace('\x00','')[:500] + "'"

def esc_phone(s):
    if not s: return 'NULL'
    digits = re.sub(r'[^\d+]', '', str(s))
    if len(digits) >= 10: return esc(digits[:15])
    return 'NULL'

# ── Setup ─────────────────────────────────────────────────────────────────────
def setup():
    rows = dbq("SELECT id, slug FROM cities WHERE is_active=true")
    return {row[1]: row[0] for row in rows if len(row) >= 2}

def load_taxonomy():
    """Load taxonomy nodes for category matching."""
    rows = dbq("SELECT id, display_name, l1, l2, l3, l4, tab FROM taxonomy_nodes WHERE is_active=true")
    nodes = []
    for row in rows:
        if len(row) >= 7:
            nodes.append({'id':row[0],'display_name':row[1],'l1':row[2],'l2':row[3],'l3':row[4],'l4':row[5],'tab':row[6]})
    return nodes

def match_taxonomy(name, search_term, nodes):
    """Match a business to the closest taxonomy node."""
    name_lower = (name + ' ' + search_term).lower()
    
    # Score each node
    best_id = None
    best_score = 0
    best_tab = 'services'
    
    for node in nodes:
        score = 0
        node_terms = ' '.join(filter(None, [node['l1'],node['l2'],node['l3'],node['l4'],node['display_name']])).lower()
        
        # Direct match in name
        for word in node_terms.split():
            if len(word) > 3 and word in name_lower:
                score += 2
        
        # Search term match
        for word in search_term.lower().split():
            if len(word) > 3 and word in node_terms:
                score += 3
                
        if score > best_score:
            best_score = score
            best_id = node['id']
            best_tab = node['tab']
    
    return best_id, best_tab

# ── Google Places API ─────────────────────────────────────────────────────────
def places_text_search(api_key, query, lat, lng, page_token=None):
    """Call Google Places Text Search API."""
    params = {
        'query': query,
        'location': f'{lat},{lng}',
        'radius': 15000,  # 15km radius
        'key': api_key,
        'language': 'en',
    }
    if page_token:
        params['pagetoken'] = page_token
    
    try:
        r = requests.get(
            'https://maps.googleapis.com/maps/api/place/textsearch/json',
            params=params, timeout=10
        )
        return r.json()
    except Exception as e:
        print(f'    API error: {e}')
        return {}

def get_place_details(api_key, place_id):
    """Get phone number and extra details for a place."""
    params = {
        'place_id': place_id,
        'fields': 'name,formatted_phone_number,international_phone_number,website,opening_hours,rating,user_ratings_total,formatted_address,geometry',
        'key': api_key,
    }
    try:
        r = requests.get(
            'https://maps.googleapis.com/maps/api/place/details/json',
            params=params, timeout=10
        )
        return r.json().get('result', {})
    except:
        return {}

# ── Insert provider ───────────────────────────────────────────────────────────
def insert_provider(city_id, city_key, place, search_term, taxonomy_node_id, tab):
    """Insert a Google Places result into provider_profiles."""
    pid = str(uuid.uuid4())
    
    name = (place.get('name') or '').replace("'","''")[:200]
    if not name:
        return False
    
    address = (place.get('formatted_address') or place.get('vicinity') or '').replace("'","''")[:500]
    phone = place.get('phone') or place.get('formatted_phone_number') or place.get('international_phone_number')
    website = (place.get('website') or '').replace("'","''")[:500]
    rating = place.get('rating')
    review_count = place.get('user_ratings_total', 0)
    
    # Geo coordinates
    geo = place.get('geometry', {}).get('location', {})
    lat = geo.get('lat')
    lng = geo.get('lng')
    
    geo_sql = f"ST_SetSRID(ST_MakePoint({lng},{lat}),4326)" if lat and lng else 'NULL'
    tab_val = tab if tab in ('services','products','expertise','establishments') else 'services'
    
    # Clean phone
    phone_clean = None
    if phone:
        digits = re.sub(r'[^\d]', '', str(phone))
        if len(digits) >= 10:
            phone_clean = digits[-10:]  # Last 10 digits
    
    node_sql = f"'{taxonomy_node_id}'::uuid" if taxonomy_node_id else 'NULL'
    
    # phone is NOT NULL in schema — use placeholder if no phone found
    phone_val = phone_clean if phone_clean else '0000000000'
    
    sql = f"""
INSERT INTO provider_profiles (
    id, display_name, business_name, city_id, tab,
    is_active, is_scrape_record, is_claimed, is_phone_verified,
    listing_type, scrape_source, scrape_external_id,
    address_line, phone, website_url,
    geo_point, taxonomy_node_id,
    created_at, updated_at
) VALUES (
    '{pid}',
    {esc(name)},
    {esc(name)},
    '{city_id}',
    '{tab_val}',
    true, true, false, false,
    'individual_service',
    'google_maps',
    {esc(place.get("place_id", "") or "")},
    {esc(address)},
    {esc(phone_val)},
    {esc(website) if website else 'NULL'},
    {geo_sql},
    {node_sql},
    NOW(), NOW()
)
ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;
"""
    
    ok = dbx(sql)
    
    # Insert trust_score row
    if ok:
        dbx(f"""
INSERT INTO trust_scores (id, provider_id, display_score, raw_score, trust_tier, signal_breakdown)
VALUES ('{str(uuid.uuid4())}', '{pid}', 10, 10, 'unverified', '{{}}'::jsonb)
ON CONFLICT (provider_id) DO NOTHING;
""")
    
    return ok

# ── Main scrape ───────────────────────────────────────────────────────────────
def scrape_city(api_key, city_key, city, city_id, search_terms, taxonomy_nodes, limit_per_term, get_details):
    total = 0
    api_calls = 0
    
    for term in search_terms:
        query = f"{term} in {city['name']}"
        page_token = None
        term_count = 0
        pages = 0
        
        while term_count < limit_per_term and pages < 3:  # Max 3 pages (60 results) per term
            if page_token:
                time.sleep(2)  # Required delay between page token requests
            
            data = places_text_search(api_key, query, city['lat'], city['lng'], page_token)
            api_calls += 1
            
            status = data.get('status')
            if status == 'REQUEST_DENIED':
                print(f'    ❌ API key denied: {data.get("error_message")}')
                return total, api_calls
            if status == 'OVER_QUERY_LIMIT':
                print(f'    ⚠️  Query limit hit — stopping')
                return total, api_calls
            if status not in ('OK', 'ZERO_RESULTS'):
                break
            
            results = data.get('results', [])
            if not results:
                break
            
            for place in results:
                if term_count >= limit_per_term:
                    break
                
                # Optionally get phone details (costs extra API call)
                if get_details and place.get('place_id'):
                    details = get_place_details(api_key, place['place_id'])
                    api_calls += 1
                    place.update(details)
                    time.sleep(0.1)
                
                # Match taxonomy
                tax_id, tab = match_taxonomy(place.get('name',''), term, taxonomy_nodes)
                
                if total == 0 and term_count == 0 and pages == 0:
                    print(f'    DEBUG first result: {json.dumps(place)[:300]}')
                ok = insert_provider(city_id, city_key, place, term, tax_id, tab)
                if ok:
                    total += 1
                    term_count += 1
            
            page_token = data.get('next_page_token')
            if not page_token:
                break
            pages += 1
            time.sleep(2)  # Required between pages
        
        if term_count > 0:
            print(f'    {term}: {term_count} inserted')
    
    return total, api_calls

def main():
    ap = argparse.ArgumentParser(description='SatvAAh Google Places Scraper')
    ap.add_argument('--key', required=True, help='Google Places API key')
    ap.add_argument('--cities', default='hyderabad,mumbai,delhi,chennai,bangalore')
    ap.add_argument('--limit', type=int, default=20, help='Max results per search term per city (default 20, max 60)')
    ap.add_argument('--details', action='store_true', help='Fetch phone numbers via Place Details API (uses more quota)')
    ap.add_argument('--terms', default='all', help='Comma-separated search terms, or "all"')
    args = ap.parse_args()

    print('=' * 65)
    print('  SatvAAh Google Places Scraper')
    print('=' * 65)

    # Validate API key first
    print('\n[0] Validating API key...')
    test = places_text_search(args.key, 'electrician in Hyderabad', 17.385, 78.486)
    if test.get('status') == 'REQUEST_DENIED':
        print(f'❌ API key invalid: {test.get("error_message")}')
        sys.exit(1)
    if test.get('status') not in ('OK', 'ZERO_RESULTS'):
        print(f'❌ Unexpected status: {test.get("status")}')
        sys.exit(1)
    print(f'  ✅ API key valid — test returned {len(test.get("results",[]))} results')

    # Setup DB
    print('\n[1] Loading city IDs from DB...')
    city_ids = setup()
    print(f'  Cities in DB: {list(city_ids.keys())}')

    # Load taxonomy
    print('\n[2] Loading taxonomy nodes...')
    taxonomy_nodes = load_taxonomy()
    print(f'  {len(taxonomy_nodes)} taxonomy nodes loaded')

    # Select cities and terms
    cities_to_run = [c.strip() for c in args.cities.split(',') if c.strip() in CITIES]
    terms_to_run = SEARCH_TERMS if args.terms == 'all' else [t.strip() for t in args.terms.split(',')]

    print(f'\n[3] Scraping {len(terms_to_run)} terms × {len(cities_to_run)} cities')
    print(f'    Limit: {args.limit} results per term per city')
    print(f'    Phone details: {"yes (costs extra quota)" if args.details else "no (faster, no phone numbers)"}')
    estimated_calls = len(terms_to_run) * len(cities_to_run)
    estimated_cost = estimated_calls * 0.032  # $0.032 per Text Search call
    print(f'    Est. API calls: ~{estimated_calls} (${estimated_cost:.2f} — well within $200 free tier)')
    print()

    total_inserted = 0
    total_api_calls = 0
    t0 = time.time()

    for city_key in cities_to_run:
        city = CITIES[city_key]
        city_id = city_ids.get(city['slug'])
        if not city_id:
            print(f'  ⚠️  {city_key} not found in DB — skipping')
            continue

        print(f'\n  ▶ {city["name"].upper()}')
        inserted, calls = scrape_city(
            args.key, city_key, city, city_id,
            terms_to_run, taxonomy_nodes,
            min(args.limit, 60), args.details
        )
        total_inserted += inserted
        total_api_calls += calls
        print(f'    ✅ {city["name"]}: {inserted} new providers ({calls} API calls)')

    elapsed = time.time() - t0
    
    # Final DB count
    rows = dbq("SELECT COUNT(*) FROM provider_profiles WHERE is_scrape_record=true AND scrape_source='google_maps'")
    google_total = rows[0][0] if rows else '?'
    
    rows2 = dbq("SELECT COUNT(*) FROM provider_profiles WHERE is_scrape_record=true")
    all_total = rows2[0][0] if rows2 else '?'

    print(f'\n{"="*65}')
    print(f'  Done in {elapsed:.0f}s')
    print(f'  Inserted this run: {total_inserted}')
    print(f'  Total API calls:   {total_api_calls}')
    print(f'  Google Maps in DB: {google_total}')
    print(f'  All scraped in DB: {all_total}')
    print(f'  Est. cost:         ${total_api_calls * 0.032:.2f}')
    print(f'{"="*65}\n')

if __name__ == '__main__':
    main()
