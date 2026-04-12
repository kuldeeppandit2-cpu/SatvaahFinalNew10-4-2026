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
                    "is_available":      {"type": "boolean"},
                    "availability_mode": {"type": "keyword"},
                    "profile_photo_s3_key": {"type": "keyword"},
                    "avg_rating":        {"type": "float"},
                    "review_count":      {"type": "integer"},
                    "years_of_experience": {"type": "integer"},
                    "tagline":           {"type": "text"},
                    "home_visit_available": {"type": "boolean"},
                    "area_name":         {"type": "keyword"},
                    "languages":         {"type": "keyword"},
                    "has_certificate":   {"type": "boolean"},
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
    COALESCE(ce_counts.contact_count::text, '0') as contact_count,
    pp.availability::text as availability_mode,
    CASE WHEN pp.availability = 'available' THEN 'true' ELSE 'false' END as is_available,
    COALESCE(pp.profile_photo_s3_key, '') as profile_photo_s3_key,
    COALESCE(pp.years_experience::text, '') as years_experience,
    COALESCE(pp.bio, '') as tagline,
    COALESCE(ratings_agg.avg_rating::text, '') as avg_rating,
    COALESCE(ratings_agg.review_count::text, '0') as review_count,
    pp.home_visit_available::text as home_visit_available,
    COALESCE(a.name, '') as area_name,
    COALESCE(pp.languages_spoken::text, '[]') as languages_spoken,
    CASE WHEN cr.id IS NOT NULL AND cr.is_revoked = false AND cr.is_suspended = false
         THEN 'true' ELSE 'false' END as has_certificate
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
LEFT JOIN (
    SELECT provider_id,
           ROUND(AVG(overall_stars)::numeric, 2) as avg_rating,
           COUNT(*) as review_count
    FROM ratings
    WHERE moderation_status = 'approved'
    GROUP BY provider_id
) ratings_agg ON ratings_agg.provider_id = pp.id
LEFT JOIN areas a ON a.id = pp.area_id
LEFT JOIN certificate_records cr ON cr.provider_id = pp.id
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
    
    # Pad to at least 35 to avoid index errors
    p = (parts + [''] * 35)
    provider_id         = p[0]
    display_name        = p[1]
    listing_type        = p[2]
    tab                 = p[3]
    city_id             = p[4]
    city_name           = p[5]
    area_id             = p[6]
    taxonomy_node_id    = p[7]
    taxonomy_name       = p[8]
    l1                  = p[9]
    l2                  = p[10]
    l3                  = p[11]
    l4                  = p[12]
    lat                 = p[13]
    lng                 = p[14]
    trust_score         = p[15]
    trust_tier          = p[16]
    is_phone_verified   = p[17]
    is_aadhaar_verified = p[18]
    is_geo_verified     = p[19]
    is_active           = p[20]
    is_claimed          = p[21]
    is_scrape_record    = p[22]
    contact_count       = p[23]
    availability_mode   = p[24]
    is_available_str    = p[25]
    profile_photo_s3_key = p[26]
    years_experience_str = p[27]
    tagline             = p[28]
    avg_rating_str      = p[29]
    review_count_str    = p[30]
    home_visit_str      = p[31]
    area_name           = p[32]
    languages_spoken_str = p[33]
    has_certificate_str = p[34]

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

    doc = {
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
        # availability — is_available true/false, availability_mode = available/by_appointment/unavailable
        "is_available":       availability_mode.strip().lower() == 'available',
        "availability_mode":  availability_mode.strip() or 'unavailable',
        # profile photo S3 key
        "profile_photo_s3_key": profile_photo_s3_key.strip() or None,
        # category_id alias — same as taxonomy_node_id (search requests category_id)
        "category_id":        None,  # set below
        # experience, tagline
        "years_of_experience": int(years_experience_str) if years_experience_str and years_experience_str.strip().isdigit() else None,
        "tagline":            tagline.strip() or None,
        # ratings
        "avg_rating":         float(avg_rating_str) if avg_rating_str and avg_rating_str.strip() else None,
        "review_count":       int(review_count_str) if review_count_str and review_count_str.strip().isdigit() else 0,
        # home_visit, area, languages, certificate
        "home_visit_available": home_visit_str.strip().lower() in ('t', 'true', '1'),
        "area_name":          area_name.strip() or None,
        "languages":          [l.strip().strip('"') for l in languages_spoken_str.strip('[]').split(',')
                               if l.strip().strip('"')] if languages_spoken_str.strip() not in ('', '[]') else [],
        "has_certificate":    has_certificate_str.strip().lower() == 'true',
        "synced_at":          time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    # category_id is requested by expandingRingSearch._source as alias for taxonomy_node_id
    doc["category_id"] = doc.get("taxonomy_node_id")
    return doc

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
