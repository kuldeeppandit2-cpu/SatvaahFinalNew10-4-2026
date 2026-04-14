import requests, re, time

s = requests.Session()
s.headers.update({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-IN,en;q=0.9',
})

print("Testing IndiaMART city filtering...")
print()

# Method 1: City directory URL - dir.indiamart.com/{city}/{slug}.html
url1 = 'https://dir.indiamart.com/hyderabad/battery-powered-sprayer.html'
r1 = s.get(url1, timeout=12)
phones1 = re.findall(r'[6-9]\d{9}', r1.text)
companies1 = re.findall(r'"companyname"\s*:\s*"([^"]{3,60})"', r1.text)
cities1 = re.findall(r'"city"\s*:\s*"([^"]+)"', r1.text)
print(f"Method 1 — dir.indiamart.com/hyderabad/battery-powered-sprayer.html")
print(f"  Status: {r1.status_code}, Size: {len(r1.text):,} bytes")
print(f"  Phones: {len(phones1)}, Companies: {len(companies1)}")
print(f"  Cities in results: {set(cities1[:20])}")
print(f"  Sample companies: {companies1[:3]}")
print(f"  Sample phones: {phones1[:3]}")
print()

time.sleep(3)

# Method 2: search.mp with city in query text
r2 = s.get('https://dir.indiamart.com/search.mp',
           params={'ss': 'battery powered sprayer hyderabad', 'src_area': 'Hyderabad'},
           timeout=12)
phones2 = re.findall(r'[6-9]\d{9}', r2.text)
companies2 = re.findall(r'"companyname"\s*:\s*"([^"]{3,60})"', r2.text)
cities2 = re.findall(r'"city"\s*:\s*"([^"]+)"', r2.text)
print(f"Method 2 — search.mp ss='battery powered sprayer hyderabad'")
print(f"  Status: {r2.status_code}, Size: {len(r2.text):,} bytes")
print(f"  Phones: {len(phones2)}, Companies: {len(companies2)}")
print(f"  Cities in results: {set(cities2[:20])}")
print(f"  Sample companies: {companies2[:3]}")
print()

# Which method has more Hyderabad results?
hyd1 = [c for c in cities1 if 'hyderabad' in c.lower() or 'secunderabad' in c.lower()]
hyd2 = [c for c in cities2 if 'hyderabad' in c.lower() or 'secunderabad' in c.lower()]
print(f"VERDICT:")
print(f"  Method 1 Hyderabad cities: {len(hyd1)}")
print(f"  Method 2 Hyderabad cities: {len(hyd2)}")
print(f"  Best method: {'Method 1 (directory URL)' if len(hyd1) >= len(hyd2) else 'Method 2 (search.mp)'}")
