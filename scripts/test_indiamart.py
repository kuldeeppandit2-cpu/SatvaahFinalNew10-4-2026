import re, requests, openpyxl, shutil
from datetime import datetime

# City centroids — geo for product suppliers = search city centroid
# (supplier ships nationally, consumer never visits physically)
CITY_GEO = {
    'Hyderabad': '17.3850,78.4867',
    'Mumbai':    '19.0760,72.8777',
    'Delhi':     '28.6139,77.2090',
    'Chennai':   '13.0827,80.2707',
    'Bangalore': '12.9716,77.5946',
}

SEARCH_CITY = 'Hyderabad'
SEARCH_TERM = 'battery powered sprayer'

s = requests.Session()
s.headers.update({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-IN,en;q=0.9',
})
r = s.get('https://dir.indiamart.com/search.mp',
          params={'ss': SEARCH_TERM, 'src_area': SEARCH_CITY}, timeout=12)
html = r.text
print(f"IndiaMART: {r.status_code}, {len(html):,} bytes")

# pns comes BEFORE companyname — anchor on pns, look forward
results = []
seen = set()
for m in re.finditer(r'"pns"\s*:\s*"(\d{10,12})"', html):
    phone = m.group(1)
    if len(phone)==12 and phone.startswith('91'): phone=phone[2:]
    if not (len(phone)==10 and phone[0] in '6789'): continue
    if phone in seen: continue
    seen.add(phone)
    chunk = html[m.start():m.start()+2000]
    cn_m = re.search(r'"companyname"\s*:\s*"([^"]{3,80})"', chunk)
    firm = cn_m.group(1) if cn_m else 'Unknown'
    # Geo = city centroid of SEARCH city (supplier ships to this city)
    geo = CITY_GEO.get(SEARCH_CITY, '')
    # Address = supplier's actual city for reference
    city_m = re.search(r'"city"\s*:\s*"([^"]+)"', chunk)
    dist_m = re.search(r'"district"\s*:\s*"([^"]+)"', chunk)
    supplier_loc = ', '.join(filter(None,[
        dist_m.group(1) if dist_m else '',
        city_m.group(1) if city_m else '',
    ]))
    results.append({
        'firm':    firm,
        'phone':   phone,
        'address': supplier_loc,   # supplier's actual location
        'geo':     geo,            # search city centroid for geo search
    })

print(f"\nResults: {len(results)}")
print()
print(f"{'#':<3} {'Name of Firm':<40} {'Mobile':<12} {'Address':<20} {'Geo (search city)'}")
print("-"*95)
for i, x in enumerate(results[:10]):
    print(f"{i+1:<3} {x['firm'][:39]:<40} {x['phone']:<12} {x['address'][:19]:<20} {x['geo']}")

# Write to Excel
src = 'satvaaah_taxonomy_synonyms.xlsx'
import os
if not os.path.exists(src):
    print(f"\nFile not found: {src}")
    print("Download Satvaah_taxonomy_final.xlsx from Claude and save as satvaaah_taxonomy_synonyms.xlsx")
else:
    wb = openpyxl.load_workbook(src)
    if 'Database' not in wb.sheetnames:
        print("\nNo Database sheet found")
    elif results and results[0]['firm'] != 'Unknown':
        ws = wb['Database']
        filled = 0
        for row in range(2, ws.max_row+1):
            if ws.cell(row,8).value: continue
            if ws.cell(row,4).value != 'Battery-powered Sprayer': continue
            if ws.cell(row,11).value != SEARCH_CITY: continue
            if filled >= len(results): break
            ws.cell(row,7).value = results[filled]['firm']
            ws.cell(row,8).value = results[filled]['phone']
            ws.cell(row,9).value = results[filled]['address']
            ws.cell(row,10).value = results[filled]['geo']
            filled += 1
        wb.save(src)
        print(f"\nWritten {filled} rows to Database sheet")
        print("Open Excel → Database sheet → check cols G,H,I,J")
