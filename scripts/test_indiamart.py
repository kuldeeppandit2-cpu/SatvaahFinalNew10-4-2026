import re, requests, openpyxl, shutil
from datetime import datetime

s = requests.Session()
s.headers.update({'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'})
r = s.get('https://dir.indiamart.com/search.mp',
          params={'ss': 'battery powered sprayer', 'src_area': 'Hyderabad'}, timeout=12)
html = r.text
print(f"Status: {r.status_code}, Size: {len(html):,}")

# pns comes BEFORE companyname by 30 chars
# Anchor on pns, search forward for companyname/city/district
results = []
seen = set()
for m in re.finditer(r'"pns"\s*:\s*"(\d{10,12})"', html):
    phone = m.group(1)
    if len(phone)==12 and phone.startswith('91'): phone=phone[2:]
    if not (len(phone)==10 and phone[0] in '6789'): continue
    if phone in seen: continue
    seen.add(phone)
    chunk = html[m.start():m.start()+2000]
    cn_m   = re.search(r'"companyname"\s*:\s*"([^"]{3,80})"', chunk)
    city_m = re.search(r'"city"\s*:\s*"([^"]+)"', chunk)
    dist_m = re.search(r'"district"\s*:\s*"([^"]+)"', chunk)
    stat_m = re.search(r'"state"\s*:\s*"([^"]+)"', chunk)
    firm = cn_m.group(1) if cn_m else 'Unknown'
    loc  = ', '.join(filter(None,[
        dist_m.group(1) if dist_m else '',
        city_m.group(1) if city_m else '',
        stat_m.group(1) if stat_m else ''
    ]))
    results.append({'firm': firm, 'phone': phone, 'location': loc})

print(f"\nResults: {len(results)}")
print()
print(f"{'#':<3} {'Name of Firm':<45} {'Mobile':<12} {'Location'}")
print("-"*85)
for i, x in enumerate(results[:10]):
    print(f"{i+1:<3} {x['firm'][:44]:<45} {x['phone']:<12} {x['location']}")

if results and results[0]['firm'] != 'Unknown':
    src = 'satvaaah_taxonomy_synonyms.xlsx'
    shutil.copy(src, f'backup_{datetime.now().strftime("%H%M%S")}.xlsx')
    wb = openpyxl.load_workbook(src)
    if 'Database' in wb.sheetnames:
        ws = wb['Database']
        filled = 0
        for row in range(3, ws.max_row+1):
            if ws.cell(row,8).value: continue
            if filled >= len(results): break
            ws.cell(row,7).value = results[filled]['firm']
            ws.cell(row,8).value = results[filled]['phone']
            ws.cell(row,9).value = results[filled]['location']
            filled += 1
        wb.save(src)
        print(f"\nWritten {filled} rows to Database sheet")
    else:
        print("\nNo Database sheet in this file")
        print("You need the file that was uploaded to Claude, not the Downloads version")
        print("Sheets found:", wb.sheetnames)
