#!/usr/bin/env python3
"""
scripts/bulk-index-opensearch.py

Bulk indexes all provider_profiles from postgres into OpenSearch.
Run from repo root: python3 scripts/bulk-index-opensearch.py

Uses docker exec to connect to postgres (same as scraper.py).
Connects to OpenSearch directly on localhost:9200.
"""

import json
import subprocess
import sys
import time
import urllib.request
import urllib.error

OPENSEARCH_URL = "http://localhost:9200"
INDEX = "satvaaah_providers"
BATCH_SIZE = 100

def psql(sql):
    r = subprocess.run(
        ['docker', 'exec', '-i', 'satvaaah-postgres',
         'psql', '-U', 'satvaaah_user', '-d', 'satvaaah',
         '-t', '-A', '-F', '\t', '-c', sql],
        capture_output=True, text=True, timeout=60
    )
    if r.returncode != 0:
        print(f"  DB ERROR: {r.stderr[:200]}")
        return []
    lines = [l for l in r.stdout.strip().split('\n') if l.strip()]
    return lines

def os_request(method, path, body=None):
    url = f"{OPENSEARCH_URL}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {'Content-Type': 'application/json'}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())
    except Exception as e:
        print(f"  OS ERROR: {e}")
        return {}

def ensure_index():
    """Create index with correct mapping if it doesn't exist."""
    r = os_request('HEAD', f'/{INDEX}')
    # HEAD returns nothing on success, check by trying GET
    r = os_request('GET', f'/{INDEX}/_mapping')
    if 'error' in r:
        print(f"  Creating index {INDEX}...")
        mapping = {
            "mappings": {
                "properties": {
                    "provider_id":       {"type": "keyword"},
                    "display_name":      {"type": "text", "analyzer": "standard",
                                          "fields": {"keyword": {"type": "keyword"}}},
                    "listing_type":      {"type": "keyword"},
                    "tab":               {"type": "keyword"},
                    "city_id":           {"type": "keyword"},
                    "city_name":         {"type": "keyword"},
                    "area_id":           {"type": "keyword"},
                    "taxonomy_node_id":  {"type": "keyword"},
                    "taxonomy_l1":       {"type": "keyword"},
                    "taxonomy_l2":       {"type": "keyword"},
                    "taxonomy_l3":       {"type": "keyword"},
                    "taxonomy_l4":       {"type": "keyword"},
                    "taxonomy_name":     {"type": "text"},
                    "geo_point":         {"type": "geo_point"},
                    "trust_score":       {"type": "integer"},
                    "trust_tier":        {"type": "keyword"},
                    "is_phone_verified": {"type": "boolean"},
                    "is_aadhaar_verified":{"type": "boolean"},
                    "is_geo_verified":   {"type": "boolean"},
                    "is_active":         {"type": "boolean"},
                    "is_claimed":        {"type": "boolean"},
                    "is_scrape_record":  {"type": "boolean"},
                    "contact_count":     {"type": "integer"},
                    "created_at":        {"type": "date"},
                    "updated_at":        {"type": "date"},
                    "synced_at":         {"type": "date"},
                }
            },
            "settings": {"number_of_shards": 1, "number_of_replicas": 0}
        }
        r = os_request('PUT', f'/{INDEX}', mapping)
        if r.get('acknowledged'):
            print(f"  Index created.")
        else:
            print(f"  Index creation response: {r}")
    else:
        print(f"  Index {INDEX} already exists.")

def fetch_providers():
    """Fetch all providers with geo data from postgres."""
    print("\n[1] Fetching providers from postgres...")
    
    sql = """
SELECT 
    pp.id,
    pp.display_name,
    pp.listing_type,
    pp.tab,
    pp.city_id,
    c.name as city_name,
    pp.area_id,
    pp.taxonomy_node_id,
    tn.display_name as taxonomy_name,
    tn.l1, tn.l2, tn.l3, tn.l4,
    COALESCE(ST_Y(pp.geo_point::geometry)::text, '') as lat,
    COALESCE(ST_X(pp.geo_point::geometry)::text, '') as lng,
    COALESCE(ts.display_score::text, '0') as trust_score,
    COALESCE(ts.trust_tier::text, 'unverified') as trust_tier,
    pp.is_phone_verified::text,
    pp.is_aadhaar_verified::text,
    pp.is_geo_verified::text,
    pp.is_active::text,
    pp.is_claimed::text,
    pp.is_scrape_record::text,
    COALESCE(ce_counts.contact_count::text, '0') as contact_count
FROM provider_profiles pp
LEFT JOIN cities c ON c.id = pp.city_id
LEFT JOIN taxonomy_nodes tn ON tn.id = pp.taxonomy_node_id
LEFT JOIN trust_scores ts ON ts.provider_id = pp.id
LEFT JOIN (
    SELECT provider_id, COUNT(*) as contact_count
    FROM contact_events
    WHERE provider_status = 'accepted'
    GROUP BY provider_id
) ce_counts ON ce_counts.provider_id = pp.id
WHERE pp.is_active = true
ORDER BY pp.created_at
"""
    rows = psql(sql)
    print(f"  Fetched {len(rows)} providers")
    return rows

def parse_row(row):
    parts = row.split('\t')
    if len(parts) < 22:
        return None
    
    provider_id, display_name, listing_type, tab, city_id, city_name, \
    area_id, taxonomy_node_id, taxonomy_name, l1, l2, l3, l4, \
    lat, lng, trust_score, trust_tier, is_phone_verified, \
    is_aadhaar_verified, is_geo_verified, is_active, \
    is_claimed, is_scrape_record, contact_count = parts[:24] if len(parts) >= 24 else (parts + [''] * 24)[:24]

    # Build geo_point only if both lat and lng are present and valid
    geo_point = None
    try:
        if lat and lng and lat != '' and lng != '':
            lat_f = float(lat)
            lng_f = float(lng)
            if -90 <= lat_f <= 90 and -180 <= lng_f <= 180:
                geo_point = {"lat": lat_f, "lon": lng_f}
    except (ValueError, TypeError):
        pass

    def to_bool(v):
        return v.strip().lower() in ('t', 'true', '1')

    return {
        "provider_id":        provider_id,
        "display_name":       display_name or '',
        "listing_type":       listing_type or 'free',
        "tab":                tab or 'services',
        "city_id":            city_id or '',
        "city_name":          city_name or '',
        "area_id":            area_id or None,
        "taxonomy_node_id":   taxonomy_node_id or None,
        "taxonomy_name":      taxonomy_name or None,
        "taxonomy_l1":        l1 or None,
        "taxonomy_l2":        l2 or None,
        "taxonomy_l3":        l3 or None,
        "taxonomy_l4":        l4 or None,
        "geo_point":          geo_point,
        "trust_score":        int(trust_score) if trust_score and trust_score.isdigit() else 0,
        "trust_tier":         trust_tier or 'unverified',
        "is_phone_verified":  to_bool(is_phone_verified),
        "is_aadhaar_verified":to_bool(is_aadhaar_verified),
        "is_geo_verified":    to_bool(is_geo_verified),
        "is_active":          to_bool(is_active),
        "is_claimed":         to_bool(is_claimed),
        "is_scrape_record":   to_bool(is_scrape_record),
        "contact_count":      int(contact_count) if contact_count and contact_count.strip().isdigit() else 0,
        "synced_at":          time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }

def bulk_index(docs):
    """Send bulk index request to OpenSearch."""
    body_lines = []
    for doc in docs:
        body_lines.append(json.dumps({"index": {"_index": INDEX, "_id": doc["provider_id"]}}))
        body_lines.append(json.dumps(doc))
    
    body = '\n'.join(body_lines) + '\n'
    data = body.encode('utf-8')
    
    url = f"{OPENSEARCH_URL}/_bulk"
    req = urllib.request.Request(
        url, data=data,
        headers={'Content-Type': 'application/x-ndjson'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            r = json.loads(resp.read())
            errors = [item for item in r.get('items', []) if item.get('index', {}).get('error')]
            return len(docs) - len(errors), len(errors)
    except Exception as e:
        print(f"  Bulk error: {e}")
        return 0, len(docs)

def main():
    print("=" * 60)
    print("  SatvAAh — Bulk Index Providers into OpenSearch")
    print("=" * 60)

    # Check OpenSearch is up
    health = os_request('GET', '/_cluster/health')
    if not health.get('status'):
        print("ERROR: OpenSearch not reachable at localhost:9200")
        sys.exit(1)
    print(f"\n  OpenSearch: {health.get('status')} ({health.get('number_of_nodes')} node)")

    # Ensure index exists with correct mapping
    ensure_index()

    # Fetch all providers
    rows = fetch_providers()
    if not rows:
        print("ERROR: No providers found in postgres")
        sys.exit(1)

    # Parse and filter
    docs = []
    skipped = 0
    for row in rows:
        doc = parse_row(row)
        if doc:
            docs.append(doc)
        else:
            skipped += 1

    with_geo  = sum(1 for d in docs if d['geo_point'])
    without_geo = sum(1 for d in docs if not d['geo_point'])
    print(f"\n[2] Parsed {len(docs)} docs — {with_geo} with geo, {without_geo} without geo")
    if skipped:
        print(f"    Skipped {skipped} malformed rows")

    # Bulk index in batches
    print(f"\n[3] Indexing in batches of {BATCH_SIZE}...")
    total_ok = 0
    total_err = 0
    for i in range(0, len(docs), BATCH_SIZE):
        batch = docs[i:i+BATCH_SIZE]
        ok, err = bulk_index(batch)
        total_ok += ok
        total_err += err
        pct = int((i + len(batch)) / len(docs) * 100)
        print(f"  [{pct:3d}%] Batch {i//BATCH_SIZE + 1}: {ok} indexed, {err} errors")

    # Final count
    time.sleep(2)  # Let OpenSearch refresh
    count_r = os_request('GET', f'/{INDEX}/_count')
    final_count = count_r.get('count', '?')

    print(f"\n{'='*60}")
    print(f"  Done: {total_ok} indexed, {total_err} errors")
    print(f"  OpenSearch {INDEX} total docs: {final_count}")
    print(f"  Providers with geo coordinates (searchable): {with_geo}")
    print(f"  Providers without geo (visible but no ring filter): {without_geo}")
    print(f"{'='*60}\n")

    if int(final_count) > 2000:
        print("  ✅ Search should now return real scraped providers")
    else:
        print("  ⚠️  Count seems low — check errors above")

if __name__ == '__main__':
    main()
