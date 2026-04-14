"""
test_indiamart_city2.py

We know Method 2 works: search.mp with city in query.
45 companies found, 20 are Hyderabad/Secunderabad.

This script:
1. Fetches the page
2. Anchors on pns (phone), searches forward for companyname + city
3. Separates LOCAL (Hyderabad/Secunderabad) from FALLBACK (Pune/Indore etc)
4. Sorts LOCAL first, FALLBACK after
5. Prints the full table showing which rows go to which city
"""
import requests, re, time

CITY_KEYWORDS = {
    'Hyderabad':  ['hyderabad', 'secunderabad', 'telangana'],
    'Mumbai':     ['mumbai', 'thane', 'navi mumbai', 'maharashtra'],
    'Delhi':      ['delhi', 'new delhi', 'gurgaon', 'noida', 'faridabad'],
    'Chennai':    ['chennai', 'tamil nadu'],
    'Bangalore':  ['bangalore', 'bengaluru', 'karnataka'],
}

def is_local(city_str, target_city):
    keywords = CITY_KEYWORDS.get(target_city, [target_city.lower()])
    return any(k in city_str.lower() for k in keywords)

s = requests.Session()
s.headers.update({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-IN,en;q=0.9',
})

TARGET_CITY = 'Hyderabad'
L4 = 'battery powered sprayer'

r = s.get('https://dir.indiamart.com/search.mp',
          params={'ss': f'{L4} {TARGET_CITY}', 'src_area': TARGET_CITY},
          timeout=12)
print(f"Status: {r.status_code}, Size: {len(r.text):,} bytes")

html = r.text
results = []
seen = set()

for m in re.finditer(r'"pns"\s*:\s*"(\d{10,12})"', html):
    raw = m.group(1)
    if raw.startswith('91') and len(raw)==12: raw=raw[2:]
    if not (len(raw)==10 and raw[0] in '6789'): continue
    if raw in seen: continue
    seen.add(raw)

    chunk = html[m.start():m.start()+2000]
    cn  = re.search(r'"companyname"\s*:\s*"([^"]{3,80})"', chunk)
    cy  = re.search(r'"city"\s*:\s*"([^"]+)"', chunk)
    di  = re.search(r'"district"\s*:\s*"([^"]+)"', chunk)
    st  = re.search(r'"state"\s*:\s*"([^"]+)"', chunk)

    firm = cn.group(1).strip() if cn else 'Unknown'
    supplier_city = cy.group(1) if cy else ''
    district      = di.group(1) if di else ''
    state         = st.group(1) if st else ''

    address = ', '.join(filter(None, [district, supplier_city, state]))
    local   = is_local(address, TARGET_CITY)

    results.append({
        'firm': firm, 'phone': raw,
        'address': address, 'local': local,
        'geo': '17.3850,78.4867'
    })

# Sort: local first
results.sort(key=lambda x: (0 if x['local'] else 1))

print(f"\nTotal results: {len(results)}")
local_count = sum(1 for r in results if r['local'])
print(f"LOCAL ({TARGET_CITY}): {local_count}")
print(f"FALLBACK (national): {len(results)-local_count}")
print()
print(f"{'#':<3} {'LOCAL':<6} {'Name of Firm':<42} {'Phone':<12} {'Address'}")
print("-"*95)
for i, r in enumerate(results, 1):
    tag = '✅ HYD' if r['local'] else '📦 NAT'
    print(f"{i:<3} {tag:<6} {r['firm'][:41]:<42} {r['phone']:<12} {r['address']}")
