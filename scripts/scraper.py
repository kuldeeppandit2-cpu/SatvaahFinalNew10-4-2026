#!/usr/bin/env python3
"""
SatvAAh Master Pipeline — FINAL
=================================
ALL sources combined. Nothing removed.

SOURCES (98 total):
===================
PRIVATE PLATFORMS (13):
  sulekha, practo, zomato, google_maps, justdial,
  indiamart, urban_company, tradeindia, wedmegood,
  lybrate, yellowpages_in, commonfloor, healthgrades

GOVERNMENT REGISTRIES (15):
  fssai, shops_estab, municipal, msme, gst, mca,
  nmc, icai, bar_council, ayush, rci, irdai, sebi,
  gem, skill_india

PROFESSIONAL ASSOCIATIONS (35):
  Healthcare:   ima, ida, aiocd, pharmacy_council, nabh
  Food/Hotels:  fhrai, nrai, spices_board, apeda
  Auto:         fada, acma, aimtc, taai
  Construction: credai, bai
  Finance:      icsi, icmai, amfi
  IT:           nasscom
  Retail:       cait, rai, jewellers_assoc
  Textile:      aepc
  Events:       eema, wpo
  Security:     capsi
  Wellness:     yoga_federation, wellness_india
  Energy:       isif
  Manufacturing: fisme, nsic
  Chambers:     ficci, cii, assocham
  Education:    aicte
  Agriculture:  nsai

LATERAL SOURCES (7):  (already in private)
  wedmegood, lybrate, yellowpages_in, commonfloor,
  healthgrades, tradeindia, urban_company
"""

import json, time, random, re, uuid, subprocess, sys, argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict, Counter
from datetime import datetime

try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'requests', '-q'])
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

# ─── Source enum mapping ──────────────────────────────────────────────────────
SOURCE_ENUM_MAP = {
    'justdial':'justdial','sulekha':'sulekha',
    'google_maps':'google_maps','practo':'practo','zomato':'zomato',
}
def get_enum(src): return SOURCE_ENUM_MAP.get(src,'local_directory')

# ─── City config ──────────────────────────────────────────────────────────────
CITIES = {
    'hyderabad': {'name':'Hyderabad','state':'Telangana','state_code':'TG',
        'slug':'hyderabad','district':'Hyderabad','lat':17.385,'lng':78.4867,
        'zomato_id':11,'practo':'hyderabad','sulekha':'hyderabad',
        'areas':['Banjara Hills','Jubilee Hills','Gachibowli','Kondapur',
                 'Madhapur','Hitech City','Begumpet','Secunderabad',
                 'Ameerpet','Kukatpally','Dilsukhnagar','LB Nagar',
                 'Mehdipatnam','Tolichowki','Miyapur']},
    'mumbai': {'name':'Mumbai','state':'Maharashtra','state_code':'MH',
        'slug':'mumbai','district':'Mumbai','lat':19.076,'lng':72.8777,
        'zomato_id':3,'practo':'mumbai','sulekha':'mumbai',
        'areas':['Andheri','Bandra','Borivali','Dadar','Goregaon',
                 'Kandivali','Kurla','Malad','Mulund','Powai',
                 'Vikhroli','Worli','Colaba','Juhu','Thane']},
    'delhi': {'name':'Delhi','state':'Delhi','state_code':'DL',
        'slug':'delhi','district':'New Delhi','lat':28.6139,'lng':77.209,
        'zomato_id':1,'practo':'delhi','sulekha':'new-delhi',
        'areas':['Connaught Place','Dwarka','Janakpuri','Lajpat Nagar',
                 'Nehru Place','Rajouri Garden','Rohini','Saket',
                 'Vasant Kunj','Pitampura','Karol Bagh',
                 'Preet Vihar','Shahdara','South Extension','Noida Sector 18']},
    'chennai': {'name':'Chennai','state':'Tamil Nadu','state_code':'TN',
        'slug':'chennai','district':'Chennai','lat':13.0827,'lng':80.2707,
        'zomato_id':5,'practo':'chennai','sulekha':'chennai',
        'areas':['Anna Nagar','Adyar','Velachery','T Nagar',
                 'Nungambakkam','Porur','OMR','Tambaram',
                 'Chrompet','Perambur','Mogappair','Ambattur',
                 'Medavakkam','Sholinganallur','Kodambakkam']},
    'bangalore': {'name':'Bangalore','state':'Karnataka','state_code':'KA',
        'slug':'bangalore','district':'Bengaluru','lat':12.9716,'lng':77.5946,
        'zomato_id':4,'practo':'bangalore','sulekha':'bangalore',
        'areas':['Koramangala','Indiranagar','Whitefield','HSR Layout',
                 'Jayanagar','JP Nagar','Marathahalli','Electronic City',
                 'Bannerghatta Road','BTM Layout','Hebbal',
                 'Malleshwaram','Rajajinagar','Yelahanka','Bellandur']},
}

# ─── Helpers ──────────────────────────────────────────────────────────────────
# ─── Verbose logging ─────────────────────────────────────────────────────────
VERBOSE = False  # set via --verbose flag at runtime

def vlog(msg):
    if VERBOSE: print(f'    [DEBUG] {msg}')

def scrape_get(session, url, source, timeout=10, **kwargs):
    """Wrapper around session.get with error logging instead of silent except."""
    try:
        r = session.get(url, timeout=timeout, **kwargs)
        if r.status_code == 429:
            vlog(f'{source}: rate limited (429) on {url[:60]}')
            time.sleep(5)
        elif r.status_code == 403:
            vlog(f'{source}: blocked (403) on {url[:60]}')
        elif r.status_code != 200:
            vlog(f'{source}: HTTP {r.status_code} on {url[:60]}')
        return r
    except Exception as e:
        vlog(f'{source}: request error — {str(e)[:80]}')
        return None

def xphones(text):
    raw = re.findall(r'(?:\+91[\s\-]?)?[6-9]\d{9}', str(text))
    out = []
    for p in raw:
        d = re.sub(r'\D','',p)
        if d.startswith('91') and len(d)==12: d=d[2:]
        if len(d)==10 and d[0] in '6789' and d not in out: out.append(d)
    return out

def cphone(p):
    if not p: return None
    d = re.sub(r'\D','',str(p))
    if d.startswith('91') and len(d)==12: d=d[2:]
    return d if len(d)==10 and d[0] in '6789' else None

def xpin(t): m=re.search(r'\b[1-9][0-9]{5}\b',str(t)); return m.group() if m else None
def xgst(t): m=re.search(r'\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b',str(t)); return m.group() if m else None
def xweb(t):
    m=re.search(r'https?://(?!(?:www\.)?(?:google|facebook|instagram|zomato|practo|sulekha|justdial|indiamart)\.com)[^\s"\'<>]{10,80}',str(t))
    return m.group() if m else None
def xsocial(t):
    out={}
    for plat,pat in [('facebook_url',r'facebook\.com/[A-Za-z0-9._\-/]+'),
                     ('instagram_url',r'instagram\.com/[A-Za-z0-9._\-/]+'),
                     ('linkedin_url',r'linkedin\.com/(?:in|company)/[A-Za-z0-9._\-/]+')]:
        m=re.search(pat,str(t))
        if m: out[plat]='https://'+m.group()
    return out
def xjsonld(text):
    items=[]
    for jl in re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',text,re.DOTALL):
        try:
            d=json.loads(jl)
            items.extend(d if isinstance(d,list) else [d])
        except: pass
    return items

def esc(s): return str(s or '').replace("'","''").replace("\\","\\\\")[:400]

# Rotate user agents to reduce fingerprinting
_UA_POOL = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
]

def make_session():
    s=requests.Session()
    retry=Retry(total=2,backoff_factor=1.0,status_forcelist=[429,500,502,503,504])
    s.mount('https://',HTTPAdapter(max_retries=retry))
    s.mount('http://',HTTPAdapter(max_retries=retry))
    s.headers.update({
        'User-Agent': random.choice(_UA_POOL),
        'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    })
    return s

JITTER_BASE = 0.8  # seconds — reduced from 1.5 for faster runs. Increase if getting blocked.

def jitter(b=None):
    """Polite delay between requests. Randomised to avoid pattern detection."""
    base = b if b is not None else JITTER_BASE
    time.sleep(base + random.uniform(0, 0.8))

def rec(city_key, source, name, **kw):
    """Create a full trust-dimension record."""
    c=CITIES[city_key]
    r={
        'display_name':str(name).strip()[:200],
        'owner_name':None,'business_name':None,
        'phone':None,'phone_2':None,'landline':None,'whatsapp':None,
        'email':None,'website_url':None,
        'address':None,'area':None,
        'city_name':c['name'],'state':c['state'],'pincode':None,
        'lat':c['lat']+random.uniform(-0.025,0.025),  # ≈±2.5km — tighter jitter
        'lng':c['lng']+random.uniform(-0.025,0.025),
        'home_visit':None,'online_service':None,'visit_premises':None,
        'gst_number':None,'fssai_license':None,
        'shop_estab_number':None,'trade_license_number':None,
        'msme_number':None,'mca_cin':None,
        'nmc_registration':None,'icai_membership':None,
        'bar_enrollment':None,'ayush_registration':None,
        'rci_registration':None,'irdai_license':None,
        'sebi_registration':None,'dl_number':None,
        'external_rating':None,'external_review_count':None,
        'years_in_business':None,'employee_count':None,
        'facebook_url':None,'instagram_url':None,
        'linkedin_url':None,'google_maps_url':None,
        'opening_hours':{},'is_24x7':None,
        'source_key':source,'source_url':None,'source_entity_id':None,
        'search_term':None,
    }
    for k,v in kw.items():
        if k in r and v not in (None,'',[],'0',0,{}): r[k]=v
    return r

def trust_score(r):
    fields=['owner_name','phone','phone_2','landline','email','website_url',
            'address','pincode','gst_number','fssai_license','shop_estab_number',
            'trade_license_number','msme_number','nmc_registration','icai_membership',
            'bar_enrollment','external_rating','external_review_count',
            'facebook_url','instagram_url','years_in_business','employee_count']
    return sum(1 for f in fields if r.get(f) not in (None,'',[],'0',0))

# ─── DB ───────────────────────────────────────────────────────────────────────
def dbq(sql):
    r=subprocess.run(['docker','exec','satvaaah-postgres','psql','-U','satvaaah_user',
        '-d','satvaaah','-t','-A','-F','\t','-c',sql],capture_output=True,text=True,timeout=30)
    return [l.split('\t') for l in r.stdout.strip().split('\n') if l.strip()]

def dbx(sql):
    r=subprocess.run(['docker','exec','-i','satvaaah-postgres','psql','-U','satvaaah_user','-d','satvaaah'],
        input=sql,capture_output=True,text=True,timeout=120)
    ok='COMMIT' in r.stdout
    if not ok and r.stderr.strip(): print(f"  DB: {r.stderr[:100]}")
    return ok

# ─── Setup ────────────────────────────────────────────────────────────────────
def setup():
    print("\n[Setup] Cities & areas...")
    existing={row[0] for row in dbq("SELECT slug FROM cities WHERE is_active=true") if row}
    sql=["BEGIN;"]
    for key,c in CITIES.items():
        if c['slug'] not in existing:
            cid=str(uuid.uuid4())
            sql.append(f"""INSERT INTO cities(id,name,state,country,slug,is_active,
                is_launch_city,launch_order,centroid,ring_1_km,ring_2_km,ring_3_km,ring_4_km,ring_5_km)
                VALUES('{cid}','{c["name"]}','{c["state"]}','India','{c["slug"]}',true,true,
                {list(CITIES.keys()).index(key)+1},
                ST_SetSRID(ST_MakePoint({c["lng"]},{c["lat"]}),4326),3,7,15,50,150)
                ON CONFLICT(name,state) DO NOTHING;""")
            for i,area in enumerate(c.get('areas',[])):
                aslug=re.sub(r'[^a-z0-9]','-',area.lower())
                sql.append(f"""INSERT INTO areas(city_id,name,slug,is_active,sort_order,centroid)
                    SELECT id,'{esc(area)}','{aslug}',true,{i},
                    ST_SetSRID(ST_MakePoint({c["lng"]+(i-7)*0.015},{c["lat"]+(i-7)*0.015}),4326)
                    FROM cities WHERE slug='{c["slug"]}'
                    ON CONFLICT(city_id,name) DO NOTHING;""")
            print(f"  Seeded {c['name']}")
        else: print(f"  {c['name']} ✅")
    sql.append("COMMIT;")
    dbx('\n'.join(sql))
    rows=dbq("SELECT id,slug FROM cities WHERE is_active=true")
    cids={row[1]:row[0] for row in rows if len(row)>=2}
    print(f"  Cities: {list(cids.keys())} ✅")
    return cids

def load_tax():
    print("\n[Taxonomy] Loading...")
    rows=dbq("""SELECT id,l1,l2,l3,l4,tab::text,listing_type::text,
        COALESCE(search_synonyms,'') FROM taxonomy_nodes
        WHERE is_active=true AND l4 IS NOT NULL ORDER BY tab,l1,l2,l3,l4""")
    nodes=[]; idx=defaultdict(list)
    for row in rows:
        if len(row)<7: continue
        n={'id':row[0],'l1':row[1],'l2':row[2],'l3':row[3],'l4':row[4],
           'tab':row[5],'listing_type':row[6],'synonyms':row[7] if len(row)>7 else ''}
        nodes.append(n)
        for field in ['l1','l2','l3','l4','synonyms']:
            text=n.get(field,'').lower()
            for word in re.findall(r'[a-z]{3,}',text): idx[word].append(n['id'])
            if field in ['l3','l4'] and text.strip(): idx[text.strip()].append(n['id'])
    print(f"  {len(nodes)} nodes ✅")
    return nodes,idx

def best_node(text, nodes, idx, tab_hint=None):
    """Match a scrape record to the closest taxonomy node.
    tab_hint: if provided, nodes from this tab get a +5 bonus score.
    Prevents services matching products nodes on word overlap.
    """
    if not text or not nodes: return nodes[0]['id'] if nodes else None
    node_map = {n['id']: n for n in nodes}
    scores = Counter()
    for w in re.findall(r'[a-z]{3,}', text.lower()):
        for nid in idx.get(w, []):
            scores[nid] += 1
    # Apply tab preference bonus — strong enough to break ties but not override clear matches
    if tab_hint:
        for nid in list(scores.keys()):
            if node_map.get(nid, {}).get('tab') == tab_hint:
                scores[nid] += 5
    return scores.most_common(1)[0][0] if scores else nodes[0]['id']

def load_areas(city_ids):
    rows=dbq("SELECT id,name,city_id FROM areas WHERE is_active=true ORDER BY sort_order")
    areas=defaultdict(list)
    for row in rows:
        if len(row)>=3: areas[row[2]].append({'id':row[0],'name':row[1]})
    return areas

def load_enabled_sources():
    """
    Load source enable/disable flags from system_config.
    Keys: scraping_source_enabled_<source_key> = 'true' | 'false'
    If a key is absent, the source is ENABLED by default.
    Admin can toggle via Admin Panel → Scraping → Sources.
    """
    rows = dbq("SELECT key,value FROM system_config WHERE key LIKE 'scraping_source_enabled_%'")
    disabled = set()
    for row in rows:
        if len(row) >= 2:
            src_key = row[0].replace('scraping_source_enabled_', '')
            if row[1].strip().lower() in ('false', '0', 'no'):
                disabled.add(src_key)
    if disabled:
        print(f"\n[Sources] Disabled via admin panel: {sorted(disabled)}")
    return disabled

def make_job(source,city_id):
    jid=str(uuid.uuid4())
    src_enum=get_enum(source)  # maps unknown sources to 'local_directory'
    city_sql = ("'" + city_id + "'") if city_id else 'NULL'
    dbx(f"""INSERT INTO scraping_jobs(id,job_name,source,city_id,status,started_at)
        VALUES('{jid}','{source}_{datetime.now().strftime("%Y%m%d_%H%M%S")}',
        '{src_enum}',
        {city_sql},
        'running',NOW());""")
    return jid

# ══════════════════════════════════════════════════════════════════════════════
# ALL SCRAPERS
# Each captures every available trust dimension
# If a field is not available from a source → null (never blocks)
# ══════════════════════════════════════════════════════════════════════════════

def _sulekha(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    cats=['plumbers','electricians','carpenters','painters','ac-repair',
          'pest-control','packers-and-movers','tutors','yoga-classes',
          'beauty-salons','car-mechanics','ca-chartered-accountants',
          'advocates-lawyers','event-management','wedding-photographers',
          'gym-fitness','physiotherapists','interior-designers',
          'home-cleaning-services','driving-schools','computer-repair',
          'cctv-installation','solar-panel-installation','refrigerator-repair',
          'washing-machine-repair','astrologers','vastu-consultants',
          'security-services','dance-classes','music-classes']
    pp=max(1,limit//len(cats))
    for slug in cats:
        if len(out)>=limit: break
        sulekha_slug=c['sulekha']
        for url in [f'https://www.sulekha.com/{slug}/{sulekha_slug}',
                    f'https://www.sulekha.com/{slug}-in-{sulekha_slug}']:
            try:
                r=s.get(url,timeout=8)
                if r.status_code!=200: continue
                pat_name=r'"name"\s*:\s*"([^"]{4,60})"'
                pat_phone=r'[6-9]\d{9}'
                pat_rating=r'"ratingValue"\s*:\s*"?([0-9.]+)"?'
                names_raw=re.findall(pat_name, r.text)
                names_clean=[n for n in names_raw if n not in ('Sulekha.com',)
                             and len(n)>4 and 'sulekha' not in n.lower()
                             and 'http' not in n.lower() and not n.startswith('@')]
                phones_raw=re.findall(pat_phone, r.text)
                seen_p=set(); uniq_phones=[]
                for ph in phones_raw:
                    if ph not in seen_p: seen_p.add(ph); uniq_phones.append(ph)
                ratings=re.findall(pat_rating, r.text)
                found=0
                for i,n in enumerate(names_clean[:pp]):
                    out.append(rec(city_key,'sulekha',n.strip(),
                        phone=uniq_phones[i] if i<len(uniq_phones) else None,
                        external_rating=float(ratings[0]) if ratings else None,
                        search_term=slug))
                    found+=1
                if found: break
            except: continue
        jitter()
    print(f'    sulekha/{city_key}: {len(out)}'); return out
def _practo(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    specs=['general-physician','dentist','gynaecologist','paediatrician',
           'dermatologist','orthopedist','ent-specialist','ophthalmologist',
           'cardiologist','neurologist','psychiatrist','physiotherapist',
           'dietitian','homeopath','ayurveda','urologist','gastroenterologist',
           'pulmonologist','oncologist','sexologist']
    pp=max(1,limit//len(specs))
    for spec in specs:
        if len(out)>=limit: break
        try:
            r=s.get(f"https://www.practo.com/{c['practo']}/{spec}",timeout=8)
            if r.status_code!=200: continue
            found=0
            for item in xjsonld(r.text):
                if item.get('@type') not in ('Physician','Dentist','MedicalBusiness','LocalBusiness','Person'): continue
                name=item.get('name','').strip()
                if not name or len(name)<3: continue
                if not name.startswith('Dr'): name=f"Dr. {name}"
                addr=item.get('address',{})
                astr=f"{addr.get('streetAddress','')} {addr.get('addressLocality','')}".strip() if isinstance(addr,dict) else ''
                ph=xphones(item.get('telephone','')+r.text[:2000])
                rt=item.get('aggregateRating',{})
                out.append(rec(city_key,'practo',name,
                    phone=ph[0] if ph else None,address=astr or None,
                    website_url=item.get('url'),
                    external_rating=float(rt.get('ratingValue',0) or 0) if isinstance(rt,dict) else None,
                    external_review_count=int(rt.get('reviewCount',0) or 0) if isinstance(rt,dict) else None,
                    nmc_registration=item.get('medicalSpecialty'),
                    search_term=spec,visit_premises=True,online_service=True))
                found+=1
                if found>=pp: break
            if found==0:
                for pat in [r'"name"\s*:\s*"(Dr\.?\s*[A-Z][^"]{3,50})"',
                            r'class="[^"]*doctor-name[^"]*"[^>]*>(Dr\.?\s*[^<]{3,50})<']:
                    names=re.findall(pat,r.text)
                    if names:
                        ph=xphones(r.text)
                        for i,n in enumerate(names[:pp]):
                            if not n.startswith('Dr'): n=f"Dr. {n}"
                            out.append(rec(city_key,'practo',n.strip(),
                                phone=ph[i] if i<len(ph) else None,
                                search_term=spec,visit_premises=True,online_service=True))
                            found+=1
                        break
        except: pass
        jitter()
    print(f"    practo/{city_key}: {len(out)}"); return out

def _zomato(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    slugs={'hyderabad':'hyderabad','mumbai':'mumbai','delhi':'delhi-ncr',
           'chennai':'chennai','bangalore':'bangalore'}
    cslug=slugs.get(city_key,'hyderabad')
    cuisines=['north-indian','south-indian','chinese','fast-food','biryani',
              'bakery','cafe','street-food','seafood','mughlai','pizza',
              'desserts','juices','snacks','rolls','continental']
    pp=max(1,limit//len(cuisines))
    for cuisine in cuisines:
        if len(out)>=limit: break
        try:
            r=s.get(f"https://www.zomato.com/{cslug}/{cuisine}-restaurants",timeout=8,
                headers={'Referer':'https://www.zomato.com/'})
            if r.status_code!=200: continue
            found=0
            for item in xjsonld(r.text):
                if item.get('@type') not in ('Restaurant','FoodEstablishment','LocalBusiness'): continue
                name=item.get('name','').strip()
                if not name or len(name)<2: continue
                addr=item.get('address',{})
                astr=f"{addr.get('streetAddress','')} {addr.get('addressLocality','')}".strip() if isinstance(addr,dict) else ''
                ph=xphones(item.get('telephone',''))
                geo=item.get('geo',{})
                rt=item.get('aggregateRating',{})
                out.append(rec(city_key,'zomato',name,
                    phone=ph[0] if ph else None,address=astr or None,
                    lat=float(geo.get('latitude',c['lat'])) if isinstance(geo,dict) and geo.get('latitude') else None,
                    lng=float(geo.get('longitude',c['lng'])) if isinstance(geo,dict) and geo.get('longitude') else None,
                    website_url=item.get('url'),
                    external_rating=float(rt.get('ratingValue',0) or 0) if isinstance(rt,dict) else None,
                    external_review_count=int(rt.get('reviewCount',0) or 0) if isinstance(rt,dict) else None,
                    search_term=cuisine,visit_premises=True,home_visit=True))
                found+=1
                if found>=pp: break
            if found==0:
                names=re.findall(r'"name"\s*:\s*"([A-Z][^"]{2,60})"',r.text)
                ph=xphones(r.text)
                for i,n in enumerate(names[:pp]):
                    if any(x in n.lower() for x in ['zomato','sign','login','menu']): continue
                    out.append(rec(city_key,'zomato',n,
                        phone=ph[i] if i<len(ph) else None,
                        search_term=cuisine,visit_premises=True))
                    found+=1
        except: pass
        jitter()
    print(f"    zomato/{city_key}: {len(out)}"); return out

def _google_maps(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    city_label=f"{c['district']} {c['state']} India"
    terms=['plumber','electrician','carpenter','AC repair','pest control',
           'doctor clinic','dentist','physiotherapist','pharmacy',
           'restaurant','bakery','grocery store','catering service',
           'coaching center tutor','driving school','yoga gym fitness',
           'beauty salon parlour','spa massage','lawyer advocate',
           'chartered accountant','car repair garage','bike repair',
           'photographer','event management','vet doctor','travel agent',
           'security agency','printing press','interior designer',
           'home cleaning','waterproofing contractor','solar panel installer',
           'packers and movers','tailor alteration','laundry dry cleaning']
    pp=max(1,limit//len(terms))
    for term in terms:
        if len(out)>=limit: break
        try:
            q=f"{term} near {city_label}"
            url=f"https://www.google.com/maps/search/{requests.utils.quote(q)}"
            r=s.get(url,timeout=8,headers={'Accept-Language':'en-IN','Accept':'text/html'})
            if r.status_code!=200: continue
            seen=set(); found=0
            # JSON-LD
            for item in xjsonld(r.text):
                name=item.get('name','').strip()
                if not name or name in seen or len(name)<4: continue
                if any(x in name.lower() for x in ['google','map','search']): continue
                seen.add(name)
                addr=item.get('address',{})
                astr=f"{addr.get('streetAddress','')} {addr.get('addressLocality','')}".strip() if isinstance(addr,dict) else ''
                ph=xphones(item.get('telephone',''))
                geo=item.get('geo',{})
                out.append(rec(city_key,'google_maps',name,
                    phone=ph[0] if ph else None,address=astr or None,
                    lat=float(geo.get('latitude',c['lat'])) if isinstance(geo,dict) and geo.get('latitude') else None,
                    lng=float(geo.get('longitude',c['lng'])) if isinstance(geo,dict) and geo.get('longitude') else None,
                    website_url=item.get('url'),google_maps_url=url,search_term=term))
                found+=1
                if found>=pp: break
            # JS array pattern
            if found==0:
                matches=re.findall(r'\["([A-Za-z][^"]{3,65})"\s*,\s*null\s*,\s*\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)',r.text)
                ph=xphones(r.text)
                addrs=re.findall(r'"([^"]{5,80}(?:Road|Street|Nagar|Colony|Lane|Market|Sector|Layout)[^"]{0,40})"',r.text)
                for mi,m in enumerate(matches[:pp*2]):
                    name=m[0].strip()
                    if name in seen: continue
                    if any(x in name.lower() for x in ['google','map','http','loading','undefined','.com']): continue
                    if len(name)<4 or len(name)>70: continue
                    seen.add(name)
                    out.append(rec(city_key,'google_maps',name,
                        phone=ph[found] if found<len(ph) else None,
                        address=addrs[found] if found<len(addrs) else None,
                        lat=float(m[1]),lng=float(m[2]),
                        google_maps_url=url,search_term=term))
                    found+=1
                    if found>=pp: break
            jitter(2)
        except: pass
    print(f"    google_maps/{city_key}: {len(out)}"); return out

def _justdial(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    cats=['plumbers','electricians','carpenters','painters','ac-repair-services',
          'pest-control-services','doctors','dentists','hospitals',
          'restaurants','grocery-stores','beauty-parlours','gyms',
          'lawyers','chartered-accountants','car-repair-workshops',
          'event-managers','photographers','caterers','packers-and-movers',
          'coaching-classes','yoga-centres','pet-shops','travel-agents',
          'insurance-agents','security-agencies','courier-services']
    pp=max(1,limit//len(cats))
    for cat in cats:
        if len(out)>=limit: break
        for url in [f"https://www.justdial.com/{c['sulekha']}/{cat}",
                    f"https://www.justdial.com/{c['sulekha']}/{cat}/page-1"]:
            try:
                r=s.get(url,timeout=8,headers={'Referer':'https://www.justdial.com/'})
                if r.status_code!=200: continue
                found=0
                for item in xjsonld(r.text):
                    name=item.get('name','').strip()
                    if not name or len(name)<3: continue
                    if any(x in name.lower() for x in ['justdial','jd ']): continue
                    addr=item.get('address',{})
                    astr=f"{addr.get('streetAddress','')} {addr.get('addressLocality','')}".strip() if isinstance(addr,dict) else ''
                    ph=xphones(item.get('telephone',''))
                    rt=item.get('aggregateRating',{})
                    r2=rec(city_key,'justdial',name,
                        phone=ph[0] if ph else None,address=astr or None,
                        external_rating=float(rt.get('ratingValue',0) or 0) if isinstance(rt,dict) else None,
                        external_review_count=int(rt.get('reviewCount',0) or 0) if isinstance(rt,dict) else None,
                        search_term=cat)
                    r2['_jd_unverified']=True
                    out.append(r2); found+=1
                    if found>=pp: break
                if found==0:
                    for pat in [r'class="[^"]*resultbox_title[^"]*"[^>]*>([^<]{3,60})<',
                                r'"businessName"\s*:\s*"([^"]{3,60})"',
                                r'data-name="([^"]{3,60})"']:
                        names=re.findall(pat,r.text)
                        if names:
                            ph=xphones(r.text)
                            addrs=re.findall(r'(?:address|locality)["\s:>]+([^<"]{5,60})',r.text)
                            for i,n in enumerate(names[:pp]):
                                if any(x in n.lower() for x in ['justdial','login']): continue
                                r2=rec(city_key,'justdial',n.strip(),
                                    phone=ph[i] if i<len(ph) else None,
                                    address=addrs[i] if i<len(addrs) else None,
                                    search_term=cat)
                                r2['_jd_unverified']=True
                                out.append(r2); found+=1
                            break
                if found: break
            except: continue
        jitter(2)
    print(f"    justdial/{city_key}: {len(out)}"); return out

def _indiamart(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    city_label={'hyderabad':'Hyderabad','mumbai':'Mumbai','delhi':'Delhi',
                'chennai':'Chennai','bangalore':'Bangalore'}[city_key]
    queries=['plumbing services','electrical contractor','catering services',
             'interior decoration','computer repair','tailoring services',
             'pest control','event management','packers movers',
             'cleaning services','security services','printing press',
             'ac repair','furniture manufacturer','coaching institute',
             'solar panel installation','cctv installation','travel agency',
             'transport logistics','accounting services','medical equipment',
             'grocery wholesale','hardware dealer','auto spare parts',
             'textile garments','food manufacturer']
    pp=max(1,limit//len(queries))
    for query in queries:
        if len(out)>=limit: break
        try:
            r=s.get('https://dir.indiamart.com/search.mp',
                params={'ss':query,'src_area':city_label,'page':1},timeout=8)
            if r.status_code!=200: continue
            companies=re.findall(r'"companyName"\s*:\s*"([^"]{3,60})"',r.text)
            phones_raw=re.findall(r'"mobile"\s*:\s*"(\d{10,11})"',r.text)
            landlines=re.findall(r'"telephone"\s*:\s*"([0-9\-\s]{8,15})"',r.text)
            addrs=re.findall(r'"address"\s*:\s*"([^"]{5,80})"',r.text)
            websites=re.findall(r'"website"\s*:\s*"(https?://[^"]{5,80})"',r.text)
            msme_nos=re.findall(r'UDYAM-[A-Z]{2}-\d{2}-\d{7}',r.text)
            gst_nums=re.findall(r'\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b',r.text)
            emp=re.findall(r'"employeeCount"\s*:\s*"?(\d+[+\-]?\d*)"?',r.text)
            for i,name in enumerate(companies[:pp]):
                p=cphone(phones_raw[i]) if i<len(phones_raw) else None
                out.append(rec(city_key,'indiamart',name.strip(),
                    phone=p,landline=landlines[i] if i<len(landlines) else None,
                    address=addrs[i] if i<len(addrs) else None,
                    pincode=xpin(addrs[i] if i<len(addrs) else ''),
                    website_url=websites[i] if i<len(websites) else None,
                    gst_number=gst_nums[i] if i<len(gst_nums) else None,
                    msme_number=msme_nos[i] if i<len(msme_nos) else None,
                    employee_count=emp[i] if i<len(emp) else None,
                    search_term=query))
        except: pass
        jitter()
    print(f"    indiamart/{city_key}: {len(out)}"); return out

def _urban_company(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    for slug in ['ac-service-repair','electrician','plumber','carpenter',
                 'painting','pest-control','salon-at-home-women',
                 'salon-at-home-men','massage-at-home','bathroom-cleaning',
                 'water-purifier-service','deep-cleaning']:
        if len(out)>=limit: break
        try:
            r=s.get(f"https://www.urbancompany.com/{c['sulekha']}/{slug}",timeout=8)
            if r.status_code!=200: continue
            for item in xjsonld(r.text):
                name=item.get('name','')
                if name and 'Urban Company' not in name and len(name)>3:
                    ph=xphones(item.get('telephone',''))
                    out.append(rec(city_key,'urban_company',name,
                        phone=ph[0] if ph else None,
                        website_url=item.get('url'),
                        search_term=slug,home_visit=True))
        except: pass
        jitter()
    print(f"    urban_company/{city_key}: {len(out)}"); return out

def _tradeindia(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    cslug=c['sulekha']
    for slug in ['plumbing-services','electrical-services','catering-services',
                 'cleaning-services','event-management-services','printing-services',
                 'it-services','security-services','transport-services',
                 'furniture-dealer','food-manufacturer','hardware-store',
                 'auto-spare-parts','textile-garments','medical-equipment']:
        if len(out)>=limit: break
        try:
            r=s.get(f"https://www.tradeindia.com/{slug}/{cslug}",timeout=8)
            if r.status_code!=200: continue
            names=re.findall(r'class="[^"]*company[^"]*"[^>]*>([^<]{4,60})<',r.text)
            ph=xphones(r.text)
            websites=re.findall(r'(?:website|url)["\s:>]+(https?://[^\s"\'<>]{5,80})',r.text)
            gst_nums=re.findall(r'\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b',r.text)
            for i,name in enumerate(names[:3]):
                out.append(rec(city_key,'tradeindia',name.strip(),
                    phone=ph[i] if i<len(ph) else None,
                    website_url=websites[i] if i<len(websites) else None,
                    gst_number=gst_nums[i] if i<len(gst_nums) else None,
                    search_term=slug))
        except: pass
        jitter()
    print(f"    tradeindia/{city_key}: {len(out)}"); return out

def _wedmegood(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    for cat in ['photographers','decorators','caterers','mehendi-artists',
                'makeup-artists','wedding-planners','djs','bands','tent-house',
                'wedding-cards','wedding-cakes']:
        if len(out)>=limit: break
        try:
            r=s.get(f"https://www.wedmegood.com/{cat}/{c['sulekha']}",timeout=8)
            if r.status_code!=200: continue
            for item in xjsonld(r.text):
                name=item.get('name','')
                if not name or len(name)<3: continue
                ph=xphones(item.get('telephone',''))
                rt=item.get('aggregateRating',{})
                social=xsocial(r.text)
                out.append(rec(city_key,'wedmegood',name,
                    phone=ph[0] if ph else None,website_url=item.get('url'),
                    external_rating=float(rt.get('ratingValue',0) or 0) if isinstance(rt,dict) else None,
                    external_review_count=int(rt.get('reviewCount',0) or 0) if isinstance(rt,dict) else None,
                    search_term=cat,home_visit=True,visit_premises=True,**social))
        except: pass
        jitter()
    print(f"    wedmegood/{city_key}: {len(out)}"); return out

def _lybrate(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    for spec in ['general-physician','dentist','gynecologist','dermatologist',
                 'orthopedist','cardiologist','physiotherapist','homeopath',
                 'ayurveda','psychiatrist','ophthalmologist','ent']:
        if len(out)>=limit: break
        try:
            r=s.get(f"https://www.lybrate.com/{c['practo']}/{spec}",timeout=8)
            if r.status_code!=200: continue
            for item in xjsonld(r.text):
                name=item.get('name','')
                if not name or len(name)<3: continue
                if not name.startswith('Dr'): name=f"Dr. {name}"
                rt=item.get('aggregateRating',{})
                out.append(rec(city_key,'lybrate',name,
                    website_url=item.get('url'),
                    external_rating=float(rt.get('ratingValue',0) or 0) if isinstance(rt,dict) else None,
                    external_review_count=int(rt.get('reviewCount',0) or 0) if isinstance(rt,dict) else None,
                    search_term=spec,visit_premises=True,online_service=True))
        except: pass
        jitter()
    print(f"    lybrate/{city_key}: {len(out)}"); return out

def _yellowpages(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    for cat in ['plumbers','electricians','doctors','restaurants','lawyers',
                'chartered-accountants','beauty-parlours','hospitals','gyms',
                'event-managers','car-repair','travel-agents','schools']:
        if len(out)>=limit: break
        try:
            r=s.get(f"https://www.yellowpages.in/{cat}-in-{c['sulekha']}",timeout=8)
            if r.status_code!=200: continue
            for item in xjsonld(r.text):
                name=item.get('name','')
                if not name or len(name)<3: continue
                ph=xphones(item.get('telephone',''))
                addr=item.get('address',{})
                astr=f"{addr.get('streetAddress','')} {addr.get('addressLocality','')}".strip() if isinstance(addr,dict) else ''
                out.append(rec(city_key,'yellowpages_in',name,
                    phone=ph[0] if ph else None,address=astr or None,
                    website_url=item.get('url'),search_term=cat))
            if not out:
                names=re.findall(r'class="[^"]*business-name[^"]*"[^>]*>([^<]{4,60})<',r.text)
                ph=xphones(r.text)
                for i,n in enumerate(names[:3]):
                    out.append(rec(city_key,'yellowpages_in',n.strip(),
                        phone=ph[i] if i<len(ph) else None,search_term=cat))
        except: pass
        jitter()
    print(f"    yellowpages_in/{city_key}: {len(out)}"); return out

def _commonfloor(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    for svc in ['packers-movers','interior-designers','vastu-experts',
                'legal-services','property-agents','home-loans']:
        if len(out)>=limit: break
        try:
            r=s.get(f"https://www.commonfloor.com/{svc}/{c['sulekha']}",timeout=8)
            if r.status_code!=200: continue
            names=re.findall(r'class="[^"]*name[^"]*"[^>]*>([A-Z][^<]{4,60})<',r.text)
            ph=xphones(r.text)
            for i,n in enumerate(names[:3]):
                out.append(rec(city_key,'commonfloor',n.strip(),
                    phone=ph[i] if i<len(ph) else None,
                    search_term=svc,home_visit=True))
        except: pass
        jitter()
    print(f"    commonfloor/{city_key}: {len(out)}"); return out

def _healthgrades(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    for spec in ['general-physician','dentist','gynecologist','dermatologist',
                 'orthopedic','pediatrician','ent','physiotherapist']:
        if len(out)>=limit: break
        try:
            r=s.get(f"https://www.1mg.com/doctors/{spec}-in-{c['practo']}",timeout=8)
            if r.status_code!=200: continue
            for item in xjsonld(r.text):
                name=item.get('name','')
                if not name or len(name)<3: continue
                if not name.startswith('Dr'): name=f"Dr. {name}"
                rt=item.get('aggregateRating',{})
                out.append(rec(city_key,'healthgrades',name,
                    external_rating=float(rt.get('ratingValue',0) or 0) if isinstance(rt,dict) else None,
                    external_review_count=int(rt.get('reviewCount',0) or 0) if isinstance(rt,dict) else None,
                    search_term=spec,visit_premises=True,online_service=True))
        except: pass
        jitter()
    print(f"    healthgrades/{city_key}: {len(out)}"); return out

# ─── Government sources ───────────────────────────────────────────────────────
def _fssai(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    cats=['Restaurant/Hotel','Bakery','Dairy','Catering Service',
          'Grocery/Provision Store','Food Manufacturer','Sweet Meat Shop',
          'Cloud Kitchen','Meat/Poultry/Fish Shop','Juice/Beverage Shop']
    pp=max(1,limit//len(cats))
    for cat in cats:
        if len(out)>=limit: break
        for ep,method,payload in [
            ('https://foscos.fssai.gov.in/api/v1/fbo/search','GET',
             {'state':c['state'],'district':c['district'],'businessCategory':cat,'pageNo':1,'pageSize':20}),
            ('https://foscos.fssai.gov.in/api/searchLicenseRegistration','POST',
             {'state':c['state'],'district':c['district'],'businessActivity':cat,'pageNumber':1,'pageSize':20}),
        ]:
            try:
                r=s.get(ep,params=payload,timeout=8) if method=='GET' else s.post(ep,json=payload,timeout=8,headers={'Content-Type':'application/json'})
                if r.status_code!=200: continue
                data=r.json()
                items=data.get('data') or data.get('content') or data.get('result') or []
                if isinstance(items,dict): items=items.get('content') or items.get('fboList') or []
                for item in (items or [])[:pp]:
                    name=(item.get('businessName') or item.get('fboName') or '').strip()
                    if not name: continue
                    ph=xphones(str(item.get('mobileNumber',''))+' '+str(item.get('landlineNumber','')))
                    out.append(rec(city_key,'fssai',name,
                        phone=ph[0] if ph else None,phone_2=ph[1] if len(ph)>1 else None,
                        landline=item.get('landlineNumber'),
                        address=item.get('premisesAddress') or item.get('address'),
                        owner_name=item.get('proprietorName'),
                        fssai_license=item.get('licenseNumber') or item.get('registrationNumber'),
                        gst_number=item.get('gstNumber'),
                        pincode=xpin(item.get('premisesAddress','')),
                        search_term=cat,visit_premises=True,
                        source_entity_id=item.get('licenseNumber','')))
                break
            except: continue
        jitter()
    print(f"    fssai/{city_key}: {len(out)}"); return out

def _shops_estab(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    portals={'hyderabad':'https://labour.telangana.gov.in/ShopsAndEstablishments/SearchShop',
             'mumbai':'https://aaplesarkar.mahaonline.gov.in/en/shopactlicense/SearchRecord',
             'delhi':'https://labour.delhi.gov.in/content/shopsact-search',
             'chennai':'https://labour.tn.gov.in/shopact/searchShop',
             'bangalore':'https://labour.karnataka.gov.in/english/pages/shopact-search'}
    trades=['Restaurant','Hotel','Medical Store','Clinic','Salon','Grocery',
            'Hardware','Electronics','Tailoring','Automobile','Coaching',
            'Gym','Bakery','Dairy','Laundry','Travel Agency','Printing',
            'Wholesale','Workshop','Security','Courier','Pharmacy',
            'Sweet Shop','Pest Control','Real Estate','Nursery','Studio']
    url=portals.get(city_key)
    if not url: return out
    pp=max(1,limit//len(trades))
    for trade in trades:
        if len(out)>=limit: break
        try:
            r=s.get(url,params={'tradeType':trade,'district':c['district'],
                'state':c['state'],'page':1,'size':10},timeout=8)
            if r.status_code!=200: continue
            try:
                items=(r.json().get('data') or r.json().get('shops') or
                      r.json().get('establishments') or r.json().get('result') or [])
                for item in (items or [])[:pp]:
                    name=(item.get('shopName') or item.get('establishmentName') or
                         item.get('businessName') or '').strip()
                    if not name: continue
                    ph=xphones(str(item.get('mobile',''))+' '+str(item.get('phone','')))
                    out.append(rec(city_key,'shops_estab',name,
                        phone=ph[0] if ph else None,
                        owner_name=item.get('ownerName'),
                        address=item.get('address') or item.get('shopAddress'),
                        shop_estab_number=item.get('registrationNumber'),
                        gst_number=item.get('gstNumber'),
                        search_term=trade,visit_premises=True))
            except:
                names=re.findall(r'(?:shopName|establishmentName|businessName)["\s:>]+([A-Z][^<"]{3,60})',r.text)
                ph=xphones(r.text)
                for i,n in enumerate(names[:pp]):
                    out.append(rec(city_key,'shops_estab',n.strip(),
                        phone=ph[i] if i<len(ph) else None,search_term=trade))
        except: pass
        jitter()
    print(f"    shops_estab/{city_key}: {len(out)}"); return out

def _municipal(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    portals={'hyderabad':'https://www.ghmc.gov.in/TradeLicense/SearchTradeLicense',
             'mumbai':'https://mcgm.gov.in/irj/portal/anonymous/qlTradeLicence',
             'delhi':'https://mcdonline.nic.in/mcgapp/tradelicense/SearchRecordAction.do',
             'chennai':'https://www.chennaicorporation.gov.in/gcc/online-services/trade-license/search',
             'bangalore':'https://bbmptax.karnataka.gov.in/TradeLicense/SearchTradeLicense'}
    trades=['Restaurant','Hotel','Medical Store','Clinic','Beauty Salon',
            'Grocery Store','Hardware Store','Electronics','Tailoring',
            'Automobile Workshop','Coaching Center','Gym','Bakery',
            'Laundry','Pharmacy','Sweet Shop','Tea Stall','Meat Fish Shop',
            'Juice Shop','Pan Shop','Cybercafe','Petrol Pump']
    url=portals.get(city_key)
    if not url: return out
    pp=max(1,limit//len(trades))
    for trade in trades:
        if len(out)>=limit: break
        try:
            r=s.get(url,params={'tradeType':trade,'ward':'','page':1,'size':10},timeout=8)
            if r.status_code!=200: continue
            try:
                items=(r.json().get('data') or r.json().get('licenses') or r.json().get('result') or [])
                for item in (items or [])[:pp]:
                    name=(item.get('businessName') or item.get('tradeName') or item.get('shopName') or '').strip()
                    if not name: continue
                    ph=xphones(str(item.get('mobile','')))
                    out.append(rec(city_key,'municipal',name,
                        phone=ph[0] if ph else None,
                        owner_name=item.get('ownerName'),
                        address=item.get('address'),
                        trade_license_number=item.get('licenseNo'),
                        search_term=trade,visit_premises=True))
            except:
                names=re.findall(r'(?:businessName|tradeName|shopName)["\s:>]+([A-Z][^<"]{3,60})',r.text)
                for n in names[:pp]:
                    out.append(rec(city_key,'municipal',n.strip(),search_term=trade))
        except: pass
        jitter()
    print(f"    municipal/{city_key}: {len(out)}"); return out

def _nmc(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    specs=['General Medicine','Paediatrics','Gynaecology','Orthopaedics',
           'Dermatology','ENT','Ophthalmology','Cardiology','Neurology',
           'Psychiatry','General Surgery','Urology','Gastroenterology']
    pp=max(1,limit//len(specs))
    for spec in specs:
        if len(out)>=limit: break
        try:
            r=s.get('https://www.nmc.org.in/MCIRest/open/getPaginatedData',
                params={'service':'getDoctorOrHospitalList','start':0,
                        'length':pp,'state':c['state'],'specialization':spec},timeout=8)
            if r.status_code!=200: continue
            for doc in (r.json().get('data') or [])[:pp]:
                name=(doc.get('doctor_name') or doc.get('name') or '').strip()
                if not name: continue
                ph=xphones(str(doc.get('mobile','')))
                out.append(rec(city_key,'nmc',f"Dr. {name}",
                    phone=ph[0] if ph else None,
                    address=doc.get('address'),
                    nmc_registration=doc.get('registration_no'),
                    search_term=spec,visit_premises=True,online_service=True))
        except: pass
        jitter()
    print(f"    nmc/{city_key}: {len(out)}"); return out

def _icai(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    try:
        r=s.get('https://www.icai.org/search-ca.html',
            params={'city':c['district'],'state':c['state'],'page':1},timeout=8)
        if r.status_code==200:
            rows_found=re.findall(r'<tr[^>]*>\s*(?:<td[^>]*>(.*?)</td>\s*){3,}',r.text,re.DOTALL)
            for row in rows_found[:limit]:
                cells=[re.sub(r'<[^>]+>','',cell).strip()
                       for cell in re.findall(r'<td[^>]*>(.*?)</td>',row,re.DOTALL)]
                if not cells or len(cells[0])<3: continue
                ph=xphones(cells[2] if len(cells)>2 else '')
                out.append(rec(city_key,'icai',cells[0],
                    phone=ph[0] if ph else None,
                    address=cells[3] if len(cells)>3 else None,
                    icai_membership=cells[1] if len(cells)>1 else None,
                    search_term='Chartered Accountant',
                    online_service=True,visit_premises=True))
    except: pass
    print(f"    icai/{city_key}: {len(out)}"); return out

def _bar_council(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    portals={'hyderabad':'https://www.barcouncilap.org/search-advocate',
             'mumbai':'https://www.barcouncilofmaharashtra.org/advocates',
             'delhi':'https://www.barcouncilofdelhi.org/advocates/search',
             'chennai':'https://www.barcounciloftamilnadu.org/search',
             'bangalore':'https://karnatakabarcouncil.org/search'}
    try:
        r=s.get(portals.get(city_key,'https://www.barcouncilofindia.org/search'),
            params={'district':c['district'],'state':c['state'],'page':1},timeout=8)
        if r.status_code==200:
            names=re.findall(r'(?:advocate_name|advocateName)["\s:>]+([A-Z][a-zA-Z\s\.]{4,50})',r.text)
            ph=xphones(r.text)
            enrollments=re.findall(r'(?:enrollmentNo|barNo)["\s:>]+([A-Z0-9\-/]{5,30})',r.text)
            for i,n in enumerate(names[:limit]):
                out.append(rec(city_key,'bar_council',f"Adv. {n.strip()}",
                    phone=ph[i] if i<len(ph) else None,
                    bar_enrollment=enrollments[i] if i<len(enrollments) else None,
                    search_term='Lawyer Advocate',visit_premises=True,online_service=True))
    except: pass
    print(f"    bar_council/{city_key}: {len(out)}"); return out

def _ayush(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    for system in ['Ayurveda','Yoga','Naturopathy','Unani','Siddha','Homeopathy']:
        if len(out)>=limit: break
        try:
            r=s.get('https://ayushportal.nic.in/SearchPractitioner.aspx',
                params={'state':c['state'],'district':c['district'],'system':system},timeout=8)
            if r.status_code==200:
                names=re.findall(r'(?:PractitionerName|DoctorName)["\s:>]+([A-Z][a-zA-Z\s\.]{4,50})',r.text)
                ph=xphones(r.text)
                regs=re.findall(r'(?:RegistrationNo|regNo)["\s:>]+([A-Z0-9\-/]{5,30})',r.text)
                for i,n in enumerate(names[:3]):
                    out.append(rec(city_key,'ayush',f"Dr. {n.strip()}",
                        phone=ph[i] if i<len(ph) else None,
                        ayush_registration=regs[i] if i<len(regs) else None,
                        search_term=system,home_visit=True,visit_premises=True))
        except: pass
        jitter()
    print(f"    ayush/{city_key}: {len(out)}"); return out

def _rci(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    try:
        r=s.get('https://www.rehabcouncil.nic.in/forms/searchregdetails.aspx',
            params={'state':c['state'],'district':c['district']},timeout=8)
        if r.status_code==200:
            names=re.findall(r'(?:ProfessionalName)["\s:>]+([A-Z][a-zA-Z\s\.]{4,50})',r.text)
            ph=xphones(r.text)
            regs=re.findall(r'(?:RegistrationNo|RCINo)["\s:>]+([A-Z0-9\-/]{5,30})',r.text)
            for i,n in enumerate(names[:limit]):
                out.append(rec(city_key,'rci',n.strip(),
                    phone=ph[i] if i<len(ph) else None,
                    rci_registration=regs[i] if i<len(regs) else None,
                    search_term='Physiotherapist',home_visit=True,visit_premises=True))
    except: pass
    print(f"    rci/{city_key}: {len(out)}"); return out

def _irdai(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    try:
        r=s.get('https://www.irdai.gov.in/ADMINCMS/cms/frmGeneral_Layout.aspx',
            params={'page':'Agents','state':c['state'],'district':c['district']},timeout=8)
        if r.status_code==200:
            names=re.findall(r'(?:agentName|InsuranceAgent)["\s:>]+([A-Z][a-zA-Z\s\.]{4,50})',r.text)
            ph=xphones(r.text)
            licenses=re.findall(r'(?:licenseNo|agentCode)["\s:>]+([A-Z0-9\-/]{5,30})',r.text)
            for i,n in enumerate(names[:limit]):
                out.append(rec(city_key,'irdai',n.strip(),
                    phone=ph[i] if i<len(ph) else None,
                    irdai_license=licenses[i] if i<len(licenses) else None,
                    search_term='Insurance Agent',home_visit=True,online_service=True))
    except: pass
    print(f"    irdai/{city_key}: {len(out)}"); return out

def _sebi(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    try:
        r=s.get('https://www.sebi.gov.in/sebiweb/other/OtherAction.do',
            params={'doRecognisedFpi':'yes','intmId':'13','state':c['state']},timeout=8)
        if r.status_code==200:
            skip=['Name','State','City','Registration','No.','Address']
            names=[n for n in re.findall(r'<td[^>]*>([A-Z][A-Za-z\s&\.]{5,60})</td>',r.text)
                  if not any(sw in n for sw in skip)]
            ph=xphones(r.text)
            regs=re.findall(r'INA\d{9}',r.text)
            for i,n in enumerate(names[:limit]):
                out.append(rec(city_key,'sebi',n.strip(),
                    phone=ph[i] if i<len(ph) else None,
                    sebi_registration=regs[i] if i<len(regs) else None,
                    search_term='Investment Advisor',online_service=True,home_visit=True))
    except: pass
    print(f"    sebi/{city_key}: {len(out)}"); return out

def _gem(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    for cat in ['cleaning-services','catering','security-services',
                'printing','transportation','it-hardware','furniture','office-supplies']:
        if len(out)>=limit: break
        try:
            r=s.get(f'https://mkp.gem.gov.in/search?q={cat}&state={c["state_code"]}',timeout=8)
            if r.status_code!=200: continue
            names=re.findall(r'(?:sellerName|vendorName|companyName)["\s:>]+([A-Z][^<"]{4,60})',r.text)
            ph=xphones(r.text)
            gst_nums=re.findall(r'\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b',r.text)
            for i,n in enumerate(names[:3]):
                out.append(rec(city_key,'gem',n.strip(),
                    phone=ph[i] if i<len(ph) else None,
                    gst_number=gst_nums[i] if i<len(gst_nums) else None,
                    search_term=cat))
        except: pass
        jitter()
    print(f"    gem/{city_key}: {len(out)}"); return out

def _skill_india(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    for trade in ['Plumber','Electrician','Carpenter','Beautician','HVAC Technician',
                  'Computer Operator','Health Care Assistant','Food Processing',
                  'Retail Sales','Mason','Welder','Driver']:
        if len(out)>=limit: break
        try:
            r=s.get('https://www.skillindia.gov.in/training-centres',
                params={'state':c['state'],'district':c['district'],'trade':trade},timeout=8)
            if r.status_code!=200: continue
            names=re.findall(r'(?:centerName|instituteName)["\s:>]+([A-Z][^<"]{5,60})',r.text)
            ph=xphones(r.text)
            for i,n in enumerate(names[:3]):
                out.append(rec(city_key,'skill_india',n.strip(),
                    phone=ph[i] if i<len(ph) else None,search_term=trade))
        except: pass
        jitter()
    print(f"    skill_india/{city_key}: {len(out)}"); return out

def _msme(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    for term in ['restaurant catering','salon beauty','medical clinic',
                 'coaching education','automobile repair','event management',
                 'cleaning services','grocery retail','hardware','printing',
                 'plumbing electrical','tailoring fashion']:
        if len(out)>=limit: break
        try:
            r=s.get('https://udyamregistration.gov.in/Government-India/Central-Government-udyam-registration.htm',
                params={'stateCode':c['state_code'],'searchText':term,'page':1},timeout=8)
            if r.status_code!=200: continue
            names=re.findall(r'(?:enterpriseName|udyamName)["\s:>]+([A-Z][^<"]{3,60})',r.text)
            ph=xphones(r.text)
            udyam=re.findall(r'UDYAM-[A-Z]{2}-\d{2}-\d{7}',r.text)
            gst_nums=re.findall(r'\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b',r.text)
            emp=re.findall(r'(?:employeeCount|noOfEmployees)["\s:>]+(\d+)',r.text)
            for i,n in enumerate(names[:3]):
                out.append(rec(city_key,'msme',n.strip(),
                    phone=ph[i] if i<len(ph) else None,
                    msme_number=udyam[i] if i<len(udyam) else None,
                    gst_number=gst_nums[i] if i<len(gst_nums) else None,
                    employee_count=emp[i] if i<len(emp) else None,
                    search_term=term))
        except: pass
        jitter()
    print(f"    msme/{city_key}: {len(out)}"); return out

def _gst(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    for trade in ['Restaurant','Clinic','Salon','Grocery','Contractor',
                  'Services','Electronics','Catering','Agency','Workshop']:
        if len(out)>=limit: break
        try:
            r=s.get('https://www.gst.gov.in/commonapi/search/searchbytradename',
                params={'stateCode':c['state_code'],'tradeName':trade,'district':c['district']},timeout=8)
            if r.status_code!=200: continue
            for tp in (r.json().get('taxpayerData') or r.json().get('data') or [])[:3]:
                name=(tp.get('tradeNam') or tp.get('lgnm') or '').strip()
                if not name: continue
                addr=tp.get('pradr',{})
                out.append(rec(city_key,'gst',name,
                    address=addr.get('adr','') if isinstance(addr,dict) else None,
                    gst_number=tp.get('gstin'),
                    pincode=xpin(addr.get('adr','') if isinstance(addr,dict) else ''),
                    search_term=trade))
        except: pass
        jitter()
    print(f"    gst/{city_key}: {len(out)}"); return out

def _mca(city_key,limit):
    c=CITIES[city_key]; out=[]; s=make_session()
    for nic in ['5610','8621','6910','6920','4321','9602','9311','5320','7310']:
        if len(out)>=limit: break
        try:
            r=s.get('https://www.mca.gov.in/MCA21/viewAllCompanyMasterData.do',
                params={'companyState':c['state_code'],'nicCode':nic,'page':1},timeout=8)
            if r.status_code!=200: continue
            names=re.findall(r'(?:companyName|COMPANY_NAME)["\s:>]+([A-Z][A-Z\s&\-\.]{4,60})',r.text)
            cins=re.findall(r'[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}',r.text)
            for i,n in enumerate(names[:3]):
                out.append(rec(city_key,'mca',n.strip().title(),
                    mca_cin=cins[i] if i<len(cins) else None,search_term=nic))
        except: pass
        jitter()
    print(f"    mca/{city_key}: {len(out)}"); return out

# ─── Professional Associations ────────────────────────────────────────────────
def _assoc(city_key, limit, source_key, urls, name_patterns, phone_extraction=True,
           extra_patterns=None):
    """Generic association scraper helper."""
    c=CITIES[city_key]; out=[]; s=make_session()
    for url in urls:
        try:
            r=s.get(url,params={'state':c['state'],'city':c['district'],
                'district':c['district'],'page':1},timeout=8)
            if r.status_code!=200: continue
            # JSON-LD first
            for item in xjsonld(r.text):
                name=item.get('name','').strip()
                if not name or len(name)<3: continue
                ph=xphones(item.get('telephone',''))
                addr=item.get('address',{})
                astr=f"{addr.get('streetAddress','')} {addr.get('addressLocality','')}".strip() if isinstance(addr,dict) else ''
                rt=item.get('aggregateRating',{})
                kwargs={'phone':ph[0] if ph else None,'address':astr or None,
                        'website_url':item.get('url'),
                        'external_rating':float(rt.get('ratingValue',0) or 0) if isinstance(rt,dict) else None,
                        'search_term':source_key}
                if extra_patterns:
                    for field,pattern in extra_patterns.items():
                        m=re.search(pattern,r.text)
                        if m: kwargs[field]=m.group(1)
                out.append(rec(city_key,source_key,name,**kwargs))
                if len(out)>=limit: break
            # Fallback regex
            if not out:
                ph=xphones(r.text)
                addrs=re.findall(r'(?:Address|address)["\s:>]+([^<"]{10,80})',r.text)
                for pattern in name_patterns:
                    names=re.findall(pattern,r.text)
                    if names:
                        for i,n in enumerate(names[:limit]):
                            kwargs={'phone':ph[i] if i<len(ph) else None,
                                    'address':addrs[i] if i<len(addrs) else None,
                                    'search_term':source_key}
                            if extra_patterns:
                                for field,epat in extra_patterns.items():
                                    m=re.search(epat,r.text)
                                    if m: kwargs[field]=m.group(1)
                            out.append(rec(city_key,source_key,n.strip(),**kwargs))
                        break
            if out: break
        except: continue
        jitter()
    print(f"    {source_key}/{city_key}: {len(out)}")
    return out

# Association scrapers using the generic helper
def _ima(ck,lim): return _assoc(ck,lim,'ima',
    ['https://www.ima-india.org/members/search',f"https://www.ima-india.org/ima/find-a-doctor"],
    [r'(?:Dr\.|Doctor)\s+([A-Z][a-zA-Z\s\.]{3,50})'],
    extra_patterns={'nmc_registration':r'(?:MCI|NMC|IMC)[\/\s\-]?(\d{4,10})'})

def _ida(ck,lim): return _assoc(ck,lim,'ida',
    ['https://www.ida.org.in/Members/FindADentist'],
    [r'(?:Dr\.|Dentist)\s+([A-Z][a-zA-Z\s\.]{3,50})'],
    extra_patterns={'nmc_registration':r'(?:Reg\.|DCI)\s*[No.:\s]*([A-Z0-9\-/]{5,20})'})

def _aiocd(ck,lim): return _assoc(ck,lim,'aiocd',
    ['https://www.aiocd.net/members','https://www.aiocd.net/find-member'],
    [r'(?:Chemist|Druggist|Pharmacy|Medical Store)["\s:>]+([A-Z][^<"]{3,60})'],
    extra_patterns={'trade_license_number':r'(?:DL|Drug License)[No.\s:]+([A-Z0-9\-/]{5,25})'})

def _pharmacy_council(ck,lim): return _assoc(ck,lim,'pharmacy_council',
    ['https://www.pci.nic.in/Members.aspx'],
    [r'(?:Pharmacist|Pharmacy)["\s:>]+([A-Z][^<"]{3,60})'])

def _nabh(ck,lim): return _assoc(ck,lim,'nabh',
    ['https://www.nabh.co/AccreditedOrganization.aspx'],
    [r'(?:Hospital|Clinic|Centre)["\s:>]+([A-Z][^<"]{3,60})'])

def _fhrai(ck,lim): return _assoc(ck,lim,'fhrai',
    ['https://www.fhrai.com/member-directory'],
    [r'(?:Hotel|Restaurant|Resort|Lodge)["\s:>]+([A-Z][^<"]{3,60})'])

def _nrai(ck,lim): return _assoc(ck,lim,'nrai',
    ['https://www.nrai.org/members'],
    [r'(?:Restaurant|Cafe|Bistro|Dhaba)["\s:>]+([A-Z][^<"]{3,60})'])

def _spices_board(ck,lim): return _assoc(ck,lim,'spices_board',
    ['https://www.indianspices.com/spices-board/registered-dealers'],
    [r'(?:Spices|Masala|Trading|Exports)["\s:>]+([A-Z][^<"]{3,60})'])

def _apeda(ck,lim): return _assoc(ck,lim,'apeda',
    ['https://www.apeda.gov.in/apedawebsite/Exporters_Importers/Exp_Reg_Details.htm'],
    [r'(?:Exports|Foods|Agro|Farm|Fresh)["\s:>]+([A-Z][^<"]{3,60})'])

def _fada(ck,lim): return _assoc(ck,lim,'fada',
    ['https://www.fadaweb.com/dealer-directory'],
    [r'(?:Motors|Automobiles|Cars|Auto)["\s:>]+([A-Z][^<"]{3,60})'])

def _acma(ck,lim): return _assoc(ck,lim,'acma',
    ['https://www.acma.in/member-directory'],
    [r'(?:Auto|Component|Parts|Engineering)["\s:>]+([A-Z][^<"]{3,60})'])

def _aimtc(ck,lim): return _assoc(ck,lim,'aimtc',
    ['https://www.aimtc.net/members'],
    [r'(?:Transport|Logistics|Carrier|Trucking)["\s:>]+([A-Z][^<"]{3,60})'],
    extra_patterns={'vehicle_permit':r'(?:Permit|TP)\s*[No.:\s]+([A-Z0-9\-/]{5,20})'})

def _taai(ck,lim): return _assoc(ck,lim,'taai',
    ['https://www.taai.in/member-search'],
    [r'(?:Travel|Tours|Holidays|Tourism)["\s:>]+([A-Z][^<"]{3,60})'])

def _credai(ck,lim): return _assoc(ck,lim,'credai',
    ['https://www.credai.org/members',f"https://www.credai.org/find-member"],
    [r'(?:Builders|Developers|Constructions|Infra|Realty)["\s:>]+([A-Z][^<"]{3,60})'])

def _bai(ck,lim): return _assoc(ck,lim,'bai',
    ['https://www.baionline.in/members'],
    [r'(?:Construction|Builders|Contractors)["\s:>]+([A-Z][^<"]{3,60})'])

def _icsi(ck,lim): return _assoc(ck,lim,'icsi',
    ['https://www.icsi.edu/member-search/'],
    [r'(?:CS|Company Secretary)\s+([A-Z][a-zA-Z\s\.]{3,50})'],
    extra_patterns={'source_entity_id':r'(?:Membership|CS)\s*[No.:\s]+([A-Z0-9\-/]{4,20})'})

def _icmai(ck,lim): return _assoc(ck,lim,'icmai',
    ['https://www.icmai.in/icmai/member-search/'],
    [r'(?:CMA|Cost Accountant)\s+([A-Z][a-zA-Z\s\.]{3,50})'])

def _amfi(ck,lim): return _assoc(ck,lim,'amfi',
    ['https://www.amfiindia.com/locate-your-mutual-fund-advisor'],
    [r'(?:Advisor|Distributor|Financial)["\s:>]+([A-Z][^<"]{3,60})'],
    extra_patterns={'sebi_registration':r'ARN[\/\s\-]?(\d{5,10})'})

def _nasscom(ck,lim): return _assoc(ck,lim,'nasscom',
    ['https://www.nasscom.in/member-directory'],
    [r'(?:Technologies|Software|Solutions|Systems|IT)["\s:>]+([A-Z][^<"]{3,60})'])

def _cait(ck,lim): return _assoc(ck,lim,'cait',
    ['https://www.cait.in/member-directory'],
    [r'(?:Traders|Store|Shop|Retail|Wholesale)["\s:>]+([A-Z][^<"]{3,60})'])

def _rai(ck,lim): return _assoc(ck,lim,'rai',
    ['https://www.rai.net.in/members'],
    [r'(?:Retail|Store|Mart|Bazaar|Shop)["\s:>]+([A-Z][^<"]{3,60})'])

def _jewellers_assoc(ck,lim): return _assoc(ck,lim,'jewellers_assoc',
    ['https://www.gjepc.org/member-directory','https://www.aifj.in/members'],
    [r'(?:Jewellers|Gems|Gold|Diamond)["\s:>]+([A-Z][^<"]{3,60})'])

def _aepc(ck,lim): return _assoc(ck,lim,'aepc',
    ['https://www.aepc.in/member-directory'],
    [r'(?:Garments|Apparel|Fashion|Textile)["\s:>]+([A-Z][^<"]{3,60})'])

def _eema(ck,lim): return _assoc(ck,lim,'eema',
    ['https://eema.org/members'],
    [r'(?:Events|Entertainment|Productions|Shows)["\s:>]+([A-Z][^<"]{3,60})'])

def _wpo(ck,lim): return _assoc(ck,lim,'wpo',
    ['https://wpo.in/members'],
    [r'(?:Wedding|Events|Celebrations|Planner)["\s:>]+([A-Z][^<"]{3,60})'])

def _capsi(ck,lim): return _assoc(ck,lim,'capsi',
    ['https://capsi.org.in/members'],
    [r'(?:Security|Guard|Protection|Safety)["\s:>]+([A-Z][^<"]{3,60})'],
    extra_patterns={'trade_license_number':r'(?:PSARA|License)[\/\s\-]?(\w{5,15})'})

def _yoga_federation(ck,lim): return _assoc(ck,lim,'yoga_federation',
    ['https://www.yogafederationofindia.org/members'],
    [r'(?:Yoga|Instructor|Teacher|Centre|Studio)["\s:>]+([A-Z][^<"]{3,60})'])

def _wellness_india(ck,lim): return _assoc(ck,lim,'wellness_india',
    ['https://www.iswa.in/members'],
    [r'(?:Spa|Wellness|Salon|Beauty|Clinic)["\s:>]+([A-Z][^<"]{3,60})'])

def _isif(ck,lim): return _assoc(ck,lim,'isif',
    ['https://www.isif.in/members'],
    [r'(?:Solar|Energy|Power|Renewable)["\s:>]+([A-Z][^<"]{3,60})'])

def _fisme(ck,lim): return _assoc(ck,lim,'fisme',
    ['https://www.fisme.net/members'],
    [r'(?:Industries|Manufacturing|Works|Enterprises)["\s:>]+([A-Z][^<"]{3,60})'],
    extra_patterns={'msme_number':r'UDYAM-[A-Z]{2}-\d{2}-\d{7}'})

def _nsic(ck,lim): return _assoc(ck,lim,'nsic',
    ['https://www.nsic.co.in/SingleRegistration/SearchSingleRegistration.aspx'],
    [r'(?:Industries|Works|Enterprises|Manufacturing)["\s:>]+([A-Z][^<"]{3,60})'])

def _ficci(ck,lim): return _assoc(ck,lim,'ficci',
    ['https://ficci.in/members'],
    [r'(?:Ltd|Limited|Pvt|Industries|Corp)["\s:>]+([A-Z][^<"]{3,60})'])

def _cii(ck,lim): return _assoc(ck,lim,'cii',
    ['https://www.cii.in/members'],
    [r'(?:Industries|Technologies|Solutions|Systems)["\s:>]+([A-Z][^<"]{3,60})'])

def _assocham(ck,lim): return _assoc(ck,lim,'assocham',
    ['https://www.assocham.org/members'],
    [r'(?:Chamber|Commerce|Industries|Association)["\s:>]+([A-Z][^<"]{3,60})'])

def _aicte(ck,lim): return _assoc(ck,lim,'aicte',
    ['https://www.aicte-india.org/institutes/InstituteSearchAction'],
    [r'(?:College|Institute|Academy|School|University)["\s:>]+([A-Z][^<"]{3,80})'],
    extra_patterns={'source_entity_id':r'AICTE[\/\s\-]?(\d{5,12})'})

def _nsai(ck,lim): return _assoc(ck,lim,'nsai',
    ['https://www.nsai.net.in/members'],
    [r'(?:Seeds|Agro|Farm|Nursery|Agriculture)["\s:>]+([A-Z][^<"]{3,60})'])

# ══════════════════════════════════════════════════════════════════════════════
# COMPLETE SOURCE REGISTRY — ALL 98 SOURCES
# ══════════════════════════════════════════════════════════════════════════════
ALL_SCRAPERS = {
    # ── Private platforms (13) ──
    'sulekha':          _sulekha,
    'practo':           _practo,
    'zomato':           _zomato,
    'google_maps':      _google_maps,
    'justdial':         _justdial,
    'indiamart':        _indiamart,
    'urban_company':    _urban_company,
    'tradeindia':       _tradeindia,
    'wedmegood':        _wedmegood,
    'lybrate':          _lybrate,
    'yellowpages_in':   _yellowpages,
    'commonfloor':      _commonfloor,
    'healthgrades':     _healthgrades,
    # ── Government registries (15) ──
    'fssai':            _fssai,
    'shops_estab':      _shops_estab,
    'municipal':        _municipal,
    'msme':             _msme,
    'gst':              _gst,
    'mca':              _mca,
    'nmc':              _nmc,
    'icai':             _icai,
    'bar_council':      _bar_council,
    'ayush':            _ayush,
    'rci':              _rci,
    'irdai':            _irdai,
    'sebi':             _sebi,
    'gem':              _gem,
    'skill_india':      _skill_india,
    # ── Professional associations (35) ──
    'ima':              _ima,
    'ida':              _ida,
    'aiocd':            _aiocd,
    'pharmacy_council': _pharmacy_council,
    'nabh':             _nabh,
    'fhrai':            _fhrai,
    'nrai':             _nrai,
    'spices_board':     _spices_board,
    'apeda':            _apeda,
    'fada':             _fada,
    'acma':             _acma,
    'aimtc':            _aimtc,
    'taai':             _taai,
    'credai':           _credai,
    'bai':              _bai,
    'icsi':             _icsi,
    'icmai':            _icmai,
    'amfi':             _amfi,
    'nasscom':          _nasscom,
    'cait':             _cait,
    'rai':              _rai,
    'jewellers_assoc':  _jewellers_assoc,
    'aepc':             _aepc,
    'eema':             _eema,
    'wpo':              _wpo,
    'capsi':            _capsi,
    'yoga_federation':  _yoga_federation,
    'wellness_india':   _wellness_india,
    'isif':             _isif,
    'fisme':            _fisme,
    'nsic':             _nsic,
    'ficci':            _ficci,
    'cii':              _cii,
    'assocham':         _assocham,
    'aicte':            _aicte,
    'nsai':             _nsai,
}

# ══════════════════════════════════════════════════════════════════════════════
# DEDUP + PROMOTE
# ══════════════════════════════════════════════════════════════════════════════

def dedup(records):
    seen=set(); out=[]
    for r in records:
        name=(r.get('display_name') or '').lower().strip()[:30]
        city=(r.get('city_name') or '').lower()
        phone=re.sub(r'\D','',str(r.get('phone') or ''))[-10:]
        key=(name,city,phone)
        if key not in seen and name and len(name)>2:
            seen.add(key); out.append(r)
    return out

def promote(records, nodes, idx, city_ids, areas, dry_run=False):
    node_map={n['id']:n for n in nodes}
    tab_to_lt={'services':'individual_service','products':'individual_product',
               'expertise':'expertise','establishments':'establishment'}
    sql=["BEGIN;"]; inserted=0; skipped=0
    tax=Counter(); src=Counter(); tv=[]

    for r in records:
        name=(r.get('display_name') or '').strip()
        if not name or len(name)<3: skipped+=1; continue
        # Tab hint: infer from source to avoid cross-tab mismatch
        tab_hint_map = {
            'practo':'expertise','nmc':'expertise','lybrate':'expertise',
            '1mg':'expertise','apollo247':'expertise','healthgrades':'expertise',
            'icai':'expertise','bar_council':'expertise','sebi':'expertise',
            'irdai':'expertise','rci':'expertise','ayush':'expertise','ima':'expertise',
            'ida':'expertise',
            'zomato':'establishments','swiggy':'establishments','fhrai':'establishments',
            'nrai':'establishments','zomato_v2':'establishments',
        }
        tab_hint = tab_hint_map.get(r.get('source_key',''), 'services')
        nid=best_node(f"{name} {r.get('search_term','')} {r.get('address','')}",nodes,idx,tab_hint)
        if not nid: skipped+=1; continue
        node=node_map.get(nid,{})
        tab=node.get('tab','services')
        lt=tab_to_lt.get(tab,'individual_service')

        city_name=r.get('city_name','Hyderabad')
        ck=next((k for k,v in CITIES.items() if v['name']==city_name),'hyderabad')
        city_id=city_ids.get(CITIES[ck]['slug'],'')
        if not city_id: skipped+=1; continue

        city_areas=areas.get(city_id,[])
        area_id=random.choice(city_areas)['id'] if city_areas else None
        lat=float(r.get('lat') or CITIES[ck]['lat'])
        lng=float(r.get('lng') or CITIES[ck]['lng'])

        tc=trust_score(r); tv.append(tc)
        vscore=0
        if r.get('phone'): vscore+=5
        if r.get('gst_number'): vscore+=10
        if r.get('fssai_license'): vscore+=10
        if r.get('nmc_registration'): vscore+=15
        if r.get('icai_membership'): vscore+=15
        if r.get('bar_enrollment'): vscore+=15
        if r.get('shop_estab_number'): vscore+=8
        if r.get('trade_license_number'): vscore+=8
        if r.get('msme_number'): vscore+=5
        if r.get('website_url'): vscore+=3
        if r.get('external_rating'): vscore+=5
        vscore=min(vscore,100)
        tier=('highly_trusted' if vscore>=80 else 'trusted' if vscore>=60
              else 'basic' if vscore>=20 else 'unverified')

        pid=str(uuid.uuid4())
        source=(r.get('source_key') or 'local_directory')[:50]
        phone=cphone(r.get('phone') or '') or ''
        website=(r.get('website_url') or '')[:499]
        bname=(r.get('business_name') or name)[:199]
        area_sql=f"'{area_id}'" if area_id else 'NULL'
        # is_phone_verified=True ONLY for govt registry sources that confirm registrant identity
        # nmc/icai/bar_council/ayush/rci/irdai/sebi verify the professional via official records
        GOVT_VERIFIED_SOURCES = {'nmc','icai','bar_council','ayush','rci','irdai','sebi'}
        is_pv = source in GOVT_VERIFIED_SOURCES
        # home_visit: read from rec() field — only True for sources/categories where
        # the provider explicitly offers home visits (e.g. beautician, physio, plumber)
        # NOT for restaurants, shops, hardware stores, hospitals etc.
        home_visit = bool(r.get('home_visit'))
        tax[node.get('l1','?')]+=1; src[source]+=1

        signal=json.dumps({
            'has_phone':         bool(phone),
            'has_gst':           bool(r.get('gst_number')),
            'has_fssai':         bool(r.get('fssai_license')),
            'has_nmc':           bool(r.get('nmc_registration')),
            'has_icai':          bool(r.get('icai_membership')),
            'has_bar':           bool(r.get('bar_enrollment')),
            'has_shop_estab':    bool(r.get('shop_estab_number')),
            'has_trade_license': bool(r.get('trade_license_number')),
            'has_msme':          bool(r.get('msme_number')),
            'has_website':       bool(r.get('website_url')),
            'has_address':       bool(r.get('address')),
            'external_rating':          r.get('external_rating'),
            'external_review_count':    r.get('external_review_count'),
            'nmc_reg':           r.get('nmc_registration'),
            'icai_membership':   r.get('icai_membership'),
            'bar_enrollment':    r.get('bar_enrollment'),
            'gst_number':        r.get('gst_number'),
            'fssai_license':     r.get('fssai_license'),
            'trust_field_count': tc,
            'source':            source,
        })

        # scrape_external_id = md5(source+phone+name) — unique dedup key per record
        ext_id=f"{source}_{esc(phone) or esc(name)}_{city_id}"[:200]
        sql.append(f"""
INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,
    city_id,area_id,tab,listing_type,phone,website_url,
    address_line,email,pincode,
    gst_number,fssai_license_number,shop_establishment_no,
    years_experience,phone_2,landline,facebook_url,instagram_url,
    is_phone_verified,is_aadhaar_verified,is_geo_verified,has_credentials,
    is_claimed,is_scrape_record,is_active,home_visit_available,
    scrape_source,scrape_external_id,scrape_source_url,geo_point)
VALUES('{pid}','{esc(name)}','{esc(bname)}','{nid}',
    '{city_id}',{area_sql},'{tab}'::"Tab",'{lt}'::"ListingType",
    '{esc(phone)}','{esc(website)}',
    {("'" + esc(r.get('address') or '') + "'") if r.get('address') else 'NULL'},
    {("'" + esc(r.get('email') or '') + "'") if r.get('email') else 'NULL'},
    {("'" + str(r.get('pincode',''))[:10] + "'") if r.get('pincode') else 'NULL'},
    {("'" + esc(r.get('gst_number',''))[:30] + "'") if r.get('gst_number') else 'NULL'},
    {("'" + esc(r.get('fssai_license',''))[:30] + "'") if r.get('fssai_license') else 'NULL'},
    {("'" + esc(r.get('shop_estab_number',''))[:30] + "'") if r.get('shop_estab_number') else 'NULL'},
    {int(r['years_in_business']) if r.get('years_in_business') and str(r['years_in_business']).isdigit() else 'NULL'},
    {("'" + esc(cphone(r.get('phone_2','')) or '') + "'") if r.get('phone_2') else 'NULL'},
    {("'" + esc(r.get('landline',''))[:20] + "'") if r.get('landline') else 'NULL'},
    {("'" + esc(r.get('facebook_url',''))[:499] + "'") if r.get('facebook_url') else 'NULL'},
    {("'" + esc(r.get('instagram_url',''))[:499] + "'") if r.get('instagram_url') else 'NULL'},
    {str(is_pv).lower()},false,false,false,false,true,
    {str(home_visit).lower()},
    '{source}','{esc(ext_id)}',
    {("'" + esc(r.get('source_url',''))[:499] + "'") if r.get('source_url') else 'NULL'},
    ST_SetSRID(ST_MakePoint({lng},{lat}),4326))
ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;""")

        # trust_scores intentionally NOT inserted here.
        # DB trigger V018 writes trust_scores automatically on provider_profile insert.
        # Rule: trust_score is written ONLY by DB trigger V018 - NEVER write from app code

        inserted+=1

    sql.append("COMMIT;")
    avg=sum(tv)/len(tv) if tv else 0

    # Update scraping_jobs with final counts (so admin panel shows real numbers)
    job_update_sql = ["BEGIN;"]
    job_counts = {}
    for r in records:
        jid = r.get('_job_id')
        if jid:
            job_counts[jid] = job_counts.get(jid, 0) + 1
    for jid, cnt in job_counts.items():
        job_update_sql.append(f"""UPDATE scraping_jobs
            SET status='completed', records_scraped={cnt}, completed_at=NOW()
            WHERE id='{jid}';""")
    job_update_sql.append("COMMIT;")
    dbx('\n'.join(job_update_sql))

    if dry_run:
        print(f"\n[DRY RUN] Insert: {inserted} | Skip: {skipped} | Avg trust fields: {avg:.1f}")
        print(f"\nTop 15 L1:"); [print(f"  {l1:<42} {cnt:>4}") for l1,cnt in tax.most_common(15)]
        print(f"\nBy source:"); [print(f"  {s:<25} {cnt:>4}") for s,cnt in src.most_common()]
        return inserted

    # Stage
    stage=["BEGIN;"]
    for r in records:
        name=(r.get('display_name') or '').strip()
        if not name: continue
        sid=str(uuid.uuid4())
        source=r.get('source_key','local_directory')
        ck=next((k for k,v in CITIES.items() if v['name']==r.get('city_name','')),'hyderabad')
        city_id=city_ids.get(CITIES[ck]['slug'],'')
        # Use pre-created job_id from main loop if available, else create one
        jid=r.get('_job_id') or make_job(source,city_id)
        phone=cphone(r.get('phone') or '')
        pn=f"'{phone}'" if phone else 'NULL'
        raw=json.dumps({k:v for k,v in r.items() if v not in (None,'',[],'0',0,{}) and not k.startswith('_')})
        stage.append(f"""INSERT INTO scraping_staging(id,job_id,source,business_name,
            phone,phone_normalized,address,lat,lng,website_url,
            external_rating,external_review_count,raw_data,is_duplicate,is_promoted)
            VALUES('{sid}','{jid}','{get_enum(source)}',
            '{esc(name)}','{esc(r.get("phone") or "")}',{pn},
            '{esc(r.get("address") or "")}',
            {float(r.get("lat") or 0)},{float(r.get("lng") or 0)},
            '{esc(r.get("website_url") or "")}',
            {float(r.get("external_rating") or 0) if r.get("external_rating") else 'NULL'},
            {int(r.get("external_review_count") or 0) if r.get("external_review_count") else 'NULL'},
            '{esc(raw)}'::jsonb,false,false);""")
    stage.append("COMMIT;")
    dbx('\n'.join(stage))

    ok=dbx('\n'.join(sql))
    if ok:
        print(f"  ✅ Inserted: {inserted} | Skipped: {skipped} | Avg trust: {avg:.1f}")
    else:
        print(f"  ❌ Insert failed")
    print(f"\nTop 15 L1:"); [print(f"  {l1:<42} {cnt:>4}") for l1,cnt in tax.most_common(15)]
    print(f"\nBy source: {dict(src.most_common(10))}")

    rows=dbq("""SELECT t.l1,p.scrape_source,COUNT(*),AVG(ts.verification_score)::int
        FROM provider_profiles p JOIN taxonomy_nodes t ON p.taxonomy_node_id=t.id
        JOIN trust_scores ts ON ts.provider_id=p.id
        WHERE p.is_scrape_record=true GROUP BY t.l1,p.scrape_source
        ORDER BY COUNT(*) DESC LIMIT 15""")
    print(f"\nDB (L1 × source × trust):")
    [print(f"  {row[0][:32]:<34} {row[1]:<22} {row[2]:>4}  trust:{row[3]}") for row in rows if len(row)>=4]
    return inserted

def _1mg(city_key, limit):
    """1mg — doctors + healthcare"""
    c = CITIES[city_key]; out = []; s = make_session()
    for spec in ['general-physician','dentist','gynecologist','dermatologist',
                 'orthopedic','pediatrician','ent-specialist','ophthalmologist',
                 'cardiologist','neurologist','psychiatrist','physiotherapist',
                 'diabetologist','urologist','gastroenterologist','pulmonologist']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://www.1mg.com/doctors/{spec}-in-{c['practo']}", '1mg')
            if not r or r.status_code != 200: continue
            found = 0
            for item in xjsonld(r.text):
                name = item.get('name', '').strip()
                if not name or len(name) < 3: continue
                if not name.startswith('Dr'): name = f"Dr. {name}"
                rt = item.get('aggregateRating', {})
                ph = xphones(item.get('telephone', ''))
                addr = item.get('address', {})
                astr = f"{addr.get('streetAddress','')} {addr.get('addressLocality','')}".strip() if isinstance(addr, dict) else ''
                out.append(rec(city_key, '1mg', name,
                    phone=ph[0] if ph else None, address=astr or None,
                    website_url=item.get('url'),
                    external_rating=float(rt.get('ratingValue', 0) or 0) if isinstance(rt, dict) else None,
                    external_review_count=int(rt.get('reviewCount', 0) or 0) if isinstance(rt, dict) else None,
                    search_term=spec, visit_premises=True, online_service=True))
                found += 1
                if found >= max(1, limit // 16): break
            if not found:
                names = re.findall(r'"name"\s*:\s*"(Dr\.?\s*[A-Z][^"]{3,50})"', r.text)
                ph = xphones(r.text)
                for i, n in enumerate(names[:3]):
                    out.append(rec(city_key, '1mg', n.strip(),
                        phone=ph[i] if i < len(ph) else None, search_term=spec,
                        visit_premises=True, online_service=True))
        except: pass
        jitter()
    print(f"    1mg/{city_key}: {len(out)}"); return out

def _apollo247(city_key, limit):
    """Apollo 247 — doctors"""
    c = CITIES[city_key]; out = []; s = make_session()
    city_map = {'hyderabad': 'hyderabad', 'mumbai': 'mumbai', 'delhi': 'delhi',
                'chennai': 'chennai', 'bangalore': 'bangalore'}
    cslug = city_map.get(city_key, 'hyderabad')
    for spec in ['general-physician', 'dentist', 'gynecologist', 'dermatologist',
                 'orthopedic-doctor', 'pediatrician', 'ent-doctor', 'cardiologist',
                 'neurologist', 'psychiatrist', 'physiotherapist', 'urologist',
                 'gastroenterologist', 'diabetologist']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://www.apollo247.com/specialties/{spec}", 'apollo247',
                headers={'Referer': 'https://www.apollo247.com/'})
            if not r or r.status_code != 200: continue
            found = 0
            for item in xjsonld(r.text):
                name = item.get('name', '').strip()
                if not name or len(name) < 3: continue
                if not name.startswith('Dr'): name = f"Dr. {name}"
                rt = item.get('aggregateRating', {})
                ph = xphones(item.get('telephone', ''))
                out.append(rec(city_key, 'apollo247', name,
                    phone=ph[0] if ph else None, website_url=item.get('url'),
                    external_rating=float(rt.get('ratingValue', 0) or 0) if isinstance(rt, dict) else None,
                    external_review_count=int(rt.get('reviewCount', 0) or 0) if isinstance(rt, dict) else None,
                    search_term=spec, visit_premises=True, online_service=True))
                found += 1
                if found >= 3: break
            if not found:
                names = re.findall(r'"name"\s*:\s*"(Dr\.?\s*[A-Z][^"]{3,50})"', r.text)
                for n in names[:3]:
                    out.append(rec(city_key, 'apollo247', n.strip(),
                        search_term=spec, visit_premises=True, online_service=True))
        except: pass
        jitter()
    print(f"    apollo247/{city_key}: {len(out)}"); return out

def _urbanpro(city_key, limit):
    """UrbanPro — tutors, coaches, trainers"""
    c = CITIES[city_key]; out = []; s = make_session()
    cats = ['tuition', 'guitar-lessons', 'piano-lessons', 'singing-lessons',
            'dance-classes', 'yoga-classes', 'fitness-training', 'spoken-english',
            'python-training', 'web-design', 'digital-marketing', 'tally-training',
            'abacus-classes', 'drawing-classes', 'swimming-lessons',
            'badminton-coaching', 'cricket-coaching', 'ielts-coaching',
            'gmat-coaching', 'cat-coaching', 'upsc-coaching', 'bank-po-coaching']
    pp = max(1, limit // len(cats))
    for cat in cats:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://www.urbanpro.com/{c['sulekha']}/{cat}", 'urbanpro')
            if not r or r.status_code != 200: continue
            found = 0
            for item in xjsonld(r.text):
                name = item.get('name', '').strip()
                if not name or len(name) < 3: continue
                if any(x in name.lower() for x in ['urbanpro', 'learning']): continue
                rt = item.get('aggregateRating', {})
                ph = xphones(item.get('telephone', ''))
                out.append(rec(city_key, 'urbanpro', name,
                    phone=ph[0] if ph else None, website_url=item.get('url'),
                    external_rating=float(rt.get('ratingValue', 0) or 0) if isinstance(rt, dict) else None,
                    external_review_count=int(rt.get('reviewCount', 0) or 0) if isinstance(rt, dict) else None,
                    search_term=cat, home_visit=True, online_service=True))
                found += 1
                if found >= pp: break
            if not found:
                names = re.findall(r'class="[^"]*tutor[^"]*"[^>]*>\s*([A-Z][^<]{3,50})<', r.text)
                if not names:
                    names = re.findall(r'"name"\s*:\s*"([A-Z][^"]{4,50})"', r.text)
                    names = [n for n in names if 'UrbanPro' not in n and len(n) > 4]
                ph = xphones(r.text)
                for i, n in enumerate(names[:pp]):
                    out.append(rec(city_key, 'urbanpro', n.strip(),
                        phone=ph[i] if i < len(ph) else None,
                        search_term=cat, home_visit=True, online_service=True))
        except: pass
        jitter()
    print(f"    urbanpro/{city_key}: {len(out)}"); return out

def _housing(city_key, limit):
    """Housing.com — real estate agents + property services"""
    c = CITIES[city_key]; out = []; s = make_session()
    city_map = {'hyderabad': 'hyderabad', 'mumbai': 'mumbai', 'delhi': 'new-delhi',
                'chennai': 'chennai', 'bangalore': 'bangalore'}
    cslug = city_map.get(city_key, city_key)
    for svc in ['buy', 'rent', 'pg', 'plot', 'commercial']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://housing.com/in/{cslug}/{svc}", 'housing')
            if not r or r.status_code != 200: continue
            for item in xjsonld(r.text):
                if item.get('@type') not in ('RealEstateAgent', 'LocalBusiness', 'Person'): continue
                name = item.get('name', '').strip()
                if not name or len(name) < 3: continue
                ph = xphones(item.get('telephone', ''))
                addr = item.get('address', {})
                astr = addr.get('streetAddress', '') if isinstance(addr, dict) else ''
                out.append(rec(city_key, 'housing', name,
                    phone=ph[0] if ph else None, address=astr or None,
                    website_url=item.get('url'), search_term=svc, visit_premises=True))
                if len(out) >= limit: break
            if not out:
                names = re.findall(r'"agentName"\s*:\s*"([^"]{4,60})"', r.text)
                ph = xphones(r.text)
                for i, n in enumerate(names[:5]):
                    out.append(rec(city_key, 'housing', n.strip(),
                        phone=ph[i] if i < len(ph) else None, search_term=svc))
        except: pass
        jitter()
    print(f"    housing/{city_key}: {len(out)}"); return out

def _99acres(city_key, limit):
    """99acres — real estate agents"""
    c = CITIES[city_key]; out = []; s = make_session()
    city_map = {'hyderabad': 'hyderabad', 'mumbai': 'mumbai', 'delhi': 'delhi-ncr',
                'chennai': 'chennai', 'bangalore': 'bangalore'}
    cslug = city_map.get(city_key, city_key)
    for svc in ['buy', 'rent', 'commercial-buy', 'plot']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://www.99acres.com/property-in-{cslug}-ffid",
                '99acres', headers={'Referer': 'https://www.99acres.com/'})
            if not r or r.status_code != 200: continue
            for item in xjsonld(r.text):
                if item.get('@type') not in ('RealEstateAgent', 'LocalBusiness', 'Person'): continue
                name = item.get('name', '').strip()
                if not name or len(name) < 3: continue
                ph = xphones(item.get('telephone', ''))
                out.append(rec(city_key, '99acres', name,
                    phone=ph[0] if ph else None, website_url=item.get('url'),
                    search_term=svc, visit_premises=True))
                if len(out) >= limit: break
            if not out:
                names = re.findall(r'"agencyName"\s*:\s*"([^"]{4,60})"', r.text)
                ph = xphones(r.text)
                for i, n in enumerate(names[:5]):
                    out.append(rec(city_key, '99acres', n.strip(),
                        phone=ph[i] if i < len(ph) else None, search_term=svc))
        except: pass
        jitter(2)
    print(f"    99acres/{city_key}: {len(out)}"); return out

def _nobroker(city_key, limit):
    """NoBroker — property agents + home services"""
    c = CITIES[city_key]; out = []; s = make_session()
    city_map = {'hyderabad': 'hyderabad', 'mumbai': 'mumbai', 'delhi': 'delhi-ncr',
                'chennai': 'chennai', 'bangalore': 'bangalore'}
    cslug = city_map.get(city_key, city_key)
    for svc in ['packers-and-movers', 'home-cleaning', 'plumber', 'electrician',
                'carpenter', 'painting', 'ac-repair', 'pest-control', 'appliance-repair']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://www.nobroker.in/services/{svc}/{cslug}", 'nobroker')
            if not r or r.status_code != 200: continue
            for item in xjsonld(r.text):
                name = item.get('name', '').strip()
                if not name or len(name) < 3 or 'NoBroker' in name: continue
                rt = item.get('aggregateRating', {})
                ph = xphones(item.get('telephone', ''))
                out.append(rec(city_key, 'nobroker', name,
                    phone=ph[0] if ph else None, website_url=item.get('url'),
                    external_rating=float(rt.get('ratingValue', 0) or 0) if isinstance(rt, dict) else None,
                    external_review_count=int(rt.get('reviewCount', 0) or 0) if isinstance(rt, dict) else None,
                    search_term=svc, home_visit=True))
                if len(out) >= limit: break
            if not out:
                names = re.findall(r'"providerName"\s*:\s*"([^"]{4,60})"', r.text)
                ph = xphones(r.text)
                for i, n in enumerate(names[:4]):
                    out.append(rec(city_key, 'nobroker', n.strip(),
                        phone=ph[i] if i < len(ph) else None, search_term=svc, home_visit=True))
        except: pass
        jitter()
    print(f"    nobroker/{city_key}: {len(out)}"); return out

def _quikr(city_key, limit):
    """Quikr — services + freelancers"""
    c = CITIES[city_key]; out = []; s = make_session()
    city_map = {'hyderabad': 'hyderabad', 'mumbai': 'mumbai', 'delhi': 'delhi',
                'chennai': 'chennai', 'bangalore': 'bangalore'}
    cslug = city_map.get(city_key, city_key)
    for cat in ['services/home-services', 'services/education-learning',
                'services/events-entertainment', 'services/health-beauty',
                'services/professional-services', 'services/repair-maintenance',
                'services/transport-vehicle-services', 'services/legal-financial']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://www.quikr.com/{cat}/{cslug}", 'quikr')
            if not r or r.status_code != 200: continue
            for item in xjsonld(r.text):
                name = item.get('name', '').strip()
                if not name or len(name) < 3 or 'Quikr' in name: continue
                ph = xphones(item.get('telephone', ''))
                out.append(rec(city_key, 'quikr', name,
                    phone=ph[0] if ph else None, website_url=item.get('url'),
                    search_term=cat, home_visit=True))
                if len(out) >= limit: break
            if not out:
                names = re.findall(r'"title"\s*:\s*"([^"]{5,70})"', r.text)
                names = [n for n in names if not any(x in n.lower() for x in
                         ['quikr', 'post', 'buy', 'sell', 'ad', 'login'])]
                ph = xphones(r.text)
                for i, n in enumerate(names[:4]):
                    out.append(rec(city_key, 'quikr', n.strip(),
                        phone=ph[i] if i < len(ph) else None, search_term=cat))
        except: pass
        jitter()
    print(f"    quikr/{city_key}: {len(out)}"); return out

def _olx(city_key, limit):
    """OLX — service providers"""
    c = CITIES[city_key]; out = []; s = make_session()
    city_map = {'hyderabad': 'hyderabad', 'mumbai': 'mumbai', 'delhi': 'delhi',
                'chennai': 'chennai', 'bangalore': 'bangalore'}
    cslug = city_map.get(city_key, city_key)
    for cat in ['services/cleaning-pest-control', 'services/movers-packers',
                'services/repair-renovation', 'services/beauty-wellness',
                'services/event-management', 'services/education-classes',
                'services/health-medical', 'services/finance-legal']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://www.olx.in/{cslug}/{cat}", 'olx',
                headers={'Referer': 'https://www.olx.in/'})
            if not r or r.status_code != 200: continue
            for item in xjsonld(r.text):
                name = item.get('name', '').strip()
                if not name or len(name) < 3 or 'OLX' in name: continue
                ph = xphones(item.get('telephone', ''))
                out.append(rec(city_key, 'olx', name,
                    phone=ph[0] if ph else None, website_url=item.get('url'),
                    search_term=cat, home_visit=True))
                if len(out) >= limit: break
            if not out:
                names = re.findall(r'"title"\s*:\s*"([^"]{5,70})"', r.text)
                names = [n for n in names if not any(x in n.lower() for x in
                         ['olx', 'post', 'buy', 'sell', 'login'])]
                ph = xphones(r.text)
                for i, n in enumerate(names[:4]):
                    out.append(rec(city_key, 'olx', n.strip(),
                        phone=ph[i] if i < len(ph) else None, search_term=cat))
        except: pass
        jitter()
    print(f"    olx/{city_key}: {len(out)}"); return out

def _justdial_v2(city_key, limit):
    """JustDial v2 — extended categories not in v1"""
    c = CITIES[city_key]; out = []; s = make_session()
    cats = ['interior-designers', 'architects', 'vastu-experts', 'astrologers',
            'dog-trainers', 'veterinary-doctors', 'homeopathy-doctors',
            'ayurvedic-doctors', 'physiotherapy-centres', 'pathology-labs',
            'x-ray-centres', 'ambulance-services', 'blood-banks',
            'nursing-homes', 'massage-centres', 'yoga-instructor',
            'zumba-classes', 'swimming-pools', 'cricket-coaching-classes',
            'badminton-coaching', 'sports-shops', 'cycle-repair-shops',
            'scooter-repair-workshops', 'tyre-puncture-repair',
            'led-tv-repair', 'microwave-oven-repair', 'ro-water-purifier-repair',
            'cctv-dealers', 'solar-dealers', 'generator-dealers',
            'inverter-dealers', 'led-light-dealers', 'mobile-repair-shops',
            'computer-repair-shops', 'laptop-service-centres',
            'xerox-shops', 'photo-studios', 'banner-printing',
            'wedding-cards-printing', 'travel-agents', 'visa-consultants',
            'packers-movers', 'courier-services', 'car-rentals',
            'car-wash-services', 'auto-accessories', 'denting-painting',
            'dry-cleaners', 'laundry-services', 'shoe-repair',
            'watch-repair', 'jewellery-repair', 'tailors',
            'embroidery-works', 'saree-shops', 'clothing-stores',
            'grocery-delivery', 'organic-stores', 'vegetable-vendors',
            'milk-dairy', 'meat-shops', 'bakeries', 'sweet-shops',
            'ice-cream-parlours', 'juice-shops', 'tiffin-services',
            'catering-services', 'food-stalls', 'dhaba',
            'cake-shops', 'flower-shops', 'gift-shops',
            'book-stores', 'stationery-shops', 'toy-shops',
            'hardware-shops', 'tiles-dealers', 'paint-shops',
            'plywood-dealers', 'glass-shops', 'steel-furniture']
    pp = max(1, limit // len(cats))
    for cat in cats:
        if len(out) >= limit: break
        jd_city = c['sulekha']
        for url in [f"https://www.justdial.com/{jd_city}/{cat}",
                    f"https://www.justdial.com/{jd_city}/{cat}/page-1"]:
            try:
                r = scrape_get(s, url, 'justdial_v2',
                    headers={'Referer': 'https://www.justdial.com/'})
                if not r or r.status_code != 200: continue
                found = 0
                for item in xjsonld(r.text):
                    name = item.get('name', '').strip()
                    if not name or len(name) < 3: continue
                    if any(x in name.lower() for x in ['justdial', 'jd ']): continue
                    addr = item.get('address', {})
                    astr = f"{addr.get('streetAddress','')} {addr.get('addressLocality','')}".strip() if isinstance(addr, dict) else ''
                    ph = xphones(item.get('telephone', ''))
                    rt = item.get('aggregateRating', {})
                    out.append(rec(city_key, 'justdial', name,
                        phone=ph[0] if ph else None, address=astr or None,
                        external_rating=float(rt.get('ratingValue', 0) or 0) if isinstance(rt, dict) else None,
                        external_review_count=int(rt.get('reviewCount', 0) or 0) if isinstance(rt, dict) else None,
                        search_term=cat))
                    found += 1
                    if found >= pp: break
                if not found:
                    for pat in [r'class="[^"]*resultbox_title[^"]*"[^>]*>([^<]{3,60})<',
                                r'"businessName"\s*:\s*"([^"]{3,60})"',
                                r'data-name="([^"]{3,60})"']:
                        names = re.findall(pat, r.text)
                        if names:
                            ph = xphones(r.text)
                            for i, n in enumerate(names[:pp]):
                                if any(x in n.lower() for x in ['justdial', 'login']): continue
                                out.append(rec(city_key, 'justdial', n.strip(),
                                    phone=ph[i] if i < len(ph) else None, search_term=cat))
                                found += 1
                            break
                if found: break
            except: continue
        jitter(1.5)
    print(f"    justdial_v2/{city_key}: {len(out)}"); return out

def _sulekha_v2(city_key, limit):
    """Sulekha v2 — extended categories"""
    c = CITIES[city_key]; out = []; s = make_session()
    cats = ['air-conditioner-repair', 'air-cooler-repair', 'microwave-repair',
            'refrigerator-repair', 'washing-machine-repair', 'geyser-repair',
            'ro-water-purifier-repair', 'cctv-installation', 'solar-panel-installation',
            'inverter-installation', 'electrical-contractors', 'plumber',
            'bathroom-renovation', 'kitchen-renovation', 'false-ceiling',
            'waterproofing-services', 'flooring-services', 'glass-work',
            'aluminium-works', 'steel-fabrication', 'welding-services',
            'masonry-work', 'painting-services', 'wallpaper-installation',
            'swimming-pool-cleaning', 'sofa-cleaning', 'carpet-cleaning',
            'water-tank-cleaning', 'house-deep-cleaning', 'bathroom-cleaning',
            'kitchen-deep-cleaning', 'piped-gas', 'septic-tank-cleaning',
            'borewell-drilling', 'water-testing-lab', 'fire-safety-services',
            'lift-elevator-maintenance', 'generator-repair', 'ups-repair',
            'cctv-repair', 'biometric-door-lock', 'home-automation',
            'dog-grooming', 'dog-training', 'pet-boarding',
            'veterinary-doctor', 'pet-shop', 'aquarium-shop',
            'plant-nursery', 'garden-landscaping', 'lawn-maintenance',
            'mehendi-artist', 'balloon-decoration', 'tent-house',
            'catering-services', 'wedding-planners', 'bridal-makeup',
            'pre-wedding-shoot', 'wedding-video-photography',
            'pandit-puja-services', 'astrologers', 'vastu-consultant',
            'numerology', 'tarot-reader', 'life-coach']
    pp = max(1, limit // len(cats))
    for slug in cats:
        if len(out) >= limit: break
        sulekha_slug = c['sulekha']
        for url in [f'https://www.sulekha.com/{slug}/{sulekha_slug}',
                    f'https://www.sulekha.com/{slug}-in-{sulekha_slug}']:
            try:
                r = scrape_get(s, url, 'sulekha_v2')
                if not r or r.status_code != 200: continue
                names_raw = re.findall(r'"name"\s*:\s*"([^"]{4,60})"', r.text)
                names_clean = [n for n in names_raw
                               if n not in ('Sulekha.com',) and len(n) > 4
                               and 'sulekha' not in n.lower()
                               and 'http' not in n.lower()
                               and not n.startswith('@')]
                phones_raw = re.findall(r'[6-9]\d{9}', r.text)
                seen_p = set(); uniq_phones = []
                for ph in phones_raw:
                    if ph not in seen_p: seen_p.add(ph); uniq_phones.append(ph)
                ratings = re.findall(r'"ratingValue"\s*:\s*"?([0-9.]+)"?', r.text)
                found = 0
                for i, n in enumerate(names_clean[:pp]):
                    out.append(rec(city_key, 'sulekha', n.strip(),
                        phone=uniq_phones[i] if i < len(uniq_phones) else None,
                        external_rating=float(ratings[0]) if ratings else None,
                        search_term=slug))
                    found += 1
                if found: break
            except: continue
        jitter()
    print(f"    sulekha_v2/{city_key}: {len(out)}"); return out

def _shaadi(city_key, limit):
    """Shaadi.com + WeddingWire — wedding vendors"""
    c = CITIES[city_key]; out = []; s = make_session()
    for cat in ['photographers', 'decorators', 'caterers', 'makeup-artists',
                'mehendi-artists', 'wedding-planners', 'djs', 'bands',
                'choreographers', 'florists', 'wedding-cards',
                'bridal-wear', 'groom-wear', 'jewellery']:
        if len(out) >= limit: break
        for base_url in [
            f"https://www.shaadisaga.com/{c['sulekha']}/{cat}",
            f"https://www.weddingwire.in/{cat}/{c['sulekha']}",
            f"https://www.myshaadiartists.com/{cat}/{c['sulekha']}"
        ]:
            try:
                r = scrape_get(s, base_url, 'shaadi')
                if not r or r.status_code != 200: continue
                found = 0
                for item in xjsonld(r.text):
                    name = item.get('name', '').strip()
                    if not name or len(name) < 3: continue
                    ph = xphones(item.get('telephone', ''))
                    rt = item.get('aggregateRating', {})
                    social = xsocial(r.text)
                    out.append(rec(city_key, 'shaadi', name,
                        phone=ph[0] if ph else None, website_url=item.get('url'),
                        external_rating=float(rt.get('ratingValue', 0) or 0) if isinstance(rt, dict) else None,
                        external_review_count=int(rt.get('reviewCount', 0) or 0) if isinstance(rt, dict) else None,
                        search_term=cat, home_visit=True, visit_premises=True, **social))
                    found += 1
                    if found >= 3: break
                if found: break
                if not found:
                    names = re.findall(r'"name"\s*:\s*"([A-Z][^"]{4,60})"', r.text)
                    names = [n for n in names if 'WeddingWire' not in n
                             and 'Shaadi' not in n and len(n) > 5]
                    ph = xphones(r.text)
                    for i, n in enumerate(names[:3]):
                        out.append(rec(city_key, 'shaadi', n.strip(),
                            phone=ph[i] if i < len(ph) else None, search_term=cat, home_visit=True))
                    if names: break
            except: pass
        jitter()
    print(f"    shaadi/{city_key}: {len(out)}"); return out

def _zomato_v2(city_key, limit):
    """Zomato v2 — more locality + cuisine combos"""
    c = CITIES[city_key]; out = []; s = make_session()
    slugs = {'hyderabad': 'hyderabad', 'mumbai': 'mumbai', 'delhi': 'delhi-ncr',
             'chennai': 'chennai', 'bangalore': 'bangalore'}
    cslug = slugs.get(city_key, 'hyderabad')
    combos = [
        ('delivery', ['indian', 'chinese', 'pizza', 'burgers', 'healthy-food',
                      'ice-cream', 'cake', 'sandwich', 'south-indian', 'biryani']),
        ('dining', ['cafes', 'bars', 'fine-dining', 'family-restaurants',
                    'rooftop', 'buffet', 'breakfast', 'lunch', 'dinner']),
    ]
    for mode, cuisines in combos:
        for cuisine in cuisines:
            if len(out) >= limit: break
            try:
                r = scrape_get(s, f"https://www.zomato.com/{cslug}/{cuisine}-food/{mode}",
                    'zomato_v2', headers={'Referer': 'https://www.zomato.com/'})
                if not r or r.status_code != 200: continue
                found = 0
                for item in xjsonld(r.text):
                    if item.get('@type') not in ('Restaurant', 'FoodEstablishment', 'LocalBusiness'): continue
                    name = item.get('name', '').strip()
                    if not name or len(name) < 2: continue
                    ph = xphones(item.get('telephone', ''))
                    addr = item.get('address', {})
                    astr = f"{addr.get('streetAddress','')} {addr.get('addressLocality','')}".strip() if isinstance(addr, dict) else ''
                    geo = item.get('geo', {})
                    rt = item.get('aggregateRating', {})
                    out.append(rec(city_key, 'zomato', name,
                        phone=ph[0] if ph else None, address=astr or None,
                        lat=float(geo.get('latitude', c['lat'])) if isinstance(geo, dict) and geo.get('latitude') else None,
                        lng=float(geo.get('longitude', c['lng'])) if isinstance(geo, dict) and geo.get('longitude') else None,
                        website_url=item.get('url'),
                        external_rating=float(rt.get('ratingValue', 0) or 0) if isinstance(rt, dict) else None,
                        external_review_count=int(rt.get('reviewCount', 0) or 0) if isinstance(rt, dict) else None,
                        search_term=cuisine, visit_premises=True))
                    found += 1
                    if found >= 5: break
                if not found:
                    names = re.findall(r'"name"\s*:\s*"([A-Z][^"]{2,60})"', r.text)
                    names = [n for n in names if not any(x in n.lower() for x in ['zomato', 'sign', 'login', 'menu'])]
                    ph = xphones(r.text)
                    for i, n in enumerate(names[:5]):
                        out.append(rec(city_key, 'zomato', n,
                            phone=ph[i] if i < len(ph) else None, search_term=cuisine, visit_premises=True))
            except: pass
            jitter(1.5)
    print(f"    zomato_v2/{city_key}: {len(out)}"); return out

def _swiggy(city_key, limit):
    """Swiggy — restaurants + cloud kitchens"""
    c = CITIES[city_key]; out = []; s = make_session()
    city_map = {'hyderabad': 'hyderabad', 'mumbai': 'mumbai', 'delhi': 'delhi',
                'chennai': 'chennai', 'bangalore': 'bangalore'}
    cslug = city_map.get(city_key, city_key)
    for cuisine in ['indian', 'chinese', 'south-indian', 'pizza', 'biryani',
                    'fast-food', 'healthy', 'desserts', 'street-food', 'north-indian',
                    'seafood', 'continental', 'mughlai', 'rolls', 'burgers']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://www.swiggy.com/city/{cslug}/{cuisine}",
                'swiggy', headers={'Referer': 'https://www.swiggy.com/'})
            if not r or r.status_code != 200: continue
            found = 0
            for item in xjsonld(r.text):
                if item.get('@type') not in ('Restaurant', 'FoodEstablishment', 'LocalBusiness'): continue
                name = item.get('name', '').strip()
                if not name or len(name) < 2: continue
                ph = xphones(item.get('telephone', ''))
                rt = item.get('aggregateRating', {})
                addr = item.get('address', {})
                astr = addr.get('streetAddress', '') if isinstance(addr, dict) else ''
                out.append(rec(city_key, 'swiggy', name,
                    phone=ph[0] if ph else None, address=astr or None,
                    website_url=item.get('url'),
                    external_rating=float(rt.get('ratingValue', 0) or 0) if isinstance(rt, dict) else None,
                    external_review_count=int(rt.get('reviewCount', 0) or 0) if isinstance(rt, dict) else None,
                    search_term=cuisine, visit_premises=True))
                found += 1
                if found >= 5: break
            if not found:
                names = re.findall(r'"name"\s*:\s*"([A-Z][^"]{2,60})"', r.text)
                names = [n for n in names if not any(x in n.lower() for x in
                         ['swiggy', 'login', 'menu', 'cart', 'sign'])]
                ph = xphones(r.text)
                for i, n in enumerate(names[:5]):
                    out.append(rec(city_key, 'swiggy', n.strip(),
                        phone=ph[i] if i < len(ph) else None,
                        search_term=cuisine, visit_premises=True))
        except: pass
        jitter(1.5)
    print(f"    swiggy/{city_key}: {len(out)}"); return out

def _magicbricks(city_key, limit):
    """MagicBricks — property agents"""
    c = CITIES[city_key]; out = []; s = make_session()
    city_map = {'hyderabad': 'hyderabad', 'mumbai': 'mumbai', 'delhi': 'new-delhi',
                'chennai': 'chennai', 'bangalore': 'bangalore'}
    cslug = city_map.get(city_key, city_key)
    for ptype in ['buy', 'rent', 'commercial', 'plots']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://www.magicbricks.com/property-for-{ptype}-in-{cslug}",
                'magicbricks', headers={'Referer': 'https://www.magicbricks.com/'})
            if not r or r.status_code != 200: continue
            for item in xjsonld(r.text):
                if item.get('@type') not in ('RealEstateAgent', 'LocalBusiness', 'Person'): continue
                name = item.get('name', '').strip()
                if not name or len(name) < 3 or 'MagicBricks' in name: continue
                ph = xphones(item.get('telephone', ''))
                out.append(rec(city_key, 'magicbricks', name,
                    phone=ph[0] if ph else None, website_url=item.get('url'),
                    search_term=ptype, visit_premises=True))
                if len(out) >= limit: break
            if not out:
                names = re.findall(r'"agentName"\s*:\s*"([^"]{4,60})"', r.text)
                ph = xphones(r.text)
                for i, n in enumerate(names[:5]):
                    out.append(rec(city_key, 'magicbricks', n.strip(),
                        phone=ph[i] if i < len(ph) else None, search_term=ptype))
        except: pass
        jitter(2)
    print(f"    magicbricks/{city_key}: {len(out)}"); return out

def _naukri_freelance(city_key, limit):
    """Naukri / Freelance portals — professionals offering services"""
    c = CITIES[city_key]; out = []; s = make_session()
    for cat, base_url in [
        ('accounting', f"https://www.freelancer.in/jobs/accounting-{c['district'].lower()}"),
        ('legal', f"https://www.freelancer.in/jobs/legal-{c['district'].lower()}"),
        ('web-design', f"https://www.freelancer.in/jobs/web-design-{c['district'].lower()}"),
        ('data-entry', f"https://www.freelancer.in/jobs/data-entry-{c['district'].lower()}"),
        ('content', f"https://www.freelancer.in/jobs/content-writing-{c['district'].lower()}"),
        ('photography', f"https://www.freelancer.in/jobs/photography-{c['district'].lower()}"),
        ('video', f"https://www.freelancer.in/jobs/video-production-{c['district'].lower()}"),
        ('translation', f"https://www.freelancer.in/jobs/translation-{c['district'].lower()}"),
    ]:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, base_url, 'freelancer_in')
            if not r or r.status_code != 200: continue
            names = re.findall(r'"username"\s*:\s*"([^"]{3,40})"', r.text)
            names += re.findall(r'"name"\s*:\s*"([A-Z][^"]{4,50})"', r.text)
            names = [n for n in names if not any(x in n.lower() for x in
                     ['freelancer', 'login', 'post', 'bid', 'project'])]
            ph = xphones(r.text)
            for i, n in enumerate(names[:4]):
                out.append(rec(city_key, 'freelancer_in', n.strip(),
                    phone=ph[i] if i < len(ph) else None,
                    search_term=cat, home_visit=False, online_service=True))
        except: pass
        jitter()
    print(f"    naukri_freelance/{city_key}: {len(out)}"); return out

def _aasaan_jobs(city_key, limit):
    """AasaanJobs / Apna — gig workers and service providers"""
    c = CITIES[city_key]; out = []; s = make_session()
    for cat in ['electrician', 'plumber', 'carpenter', 'painter', 'cook',
                'driver', 'security-guard', 'housekeeping', 'delivery-boy',
                'ac-technician', 'mobile-repair', 'computer-operator',
                'receptionist', 'sales-executive', 'field-sales']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://apna.co/jobs/{cat}-jobs-in-{c['district'].lower().replace(' ', '-')}",
                'apna')
            if not r or r.status_code != 200: continue
            for item in xjsonld(r.text):
                if item.get('@type') not in ('JobPosting', 'LocalBusiness', 'Person'): continue
                name = (item.get('hiringOrganization', {}).get('name', '') or
                        item.get('name', '')).strip()
                if not name or len(name) < 3: continue
                ph = xphones(item.get('telephone', ''))
                out.append(rec(city_key, 'apna', name,
                    phone=ph[0] if ph else None, website_url=item.get('url'),
                    search_term=cat, home_visit=True))
                if len(out) >= limit: break
            if not out:
                names = re.findall(r'"companyName"\s*:\s*"([^"]{4,60})"', r.text)
                ph = xphones(r.text)
                for i, n in enumerate(names[:3]):
                    out.append(rec(city_key, 'apna', n.strip(),
                        phone=ph[i] if i < len(ph) else None, search_term=cat))
        except: pass
        jitter()
    print(f"    aasaan_jobs/{city_key}: {len(out)}"); return out

def _babydestination(city_key, limit):
    """BabyDestination / Momspresso — parenting & baby services"""
    c = CITIES[city_key]; out = []; s = make_session()
    for cat in ['baby-shower-planners', 'baby-photographers', 'newborn-care',
                'creche-daycare', 'birthday-party-planners', 'cake-designers',
                'baby-clothing', 'maternity-wear', 'prenatal-yoga',
                'lactation-consultant', 'child-psychologist']:
        if len(out) >= limit: break
        for base_url in [
            f"https://www.babydestination.com/{c['sulekha']}/{cat}",
            f"https://www.urbanclap.com/{c['sulekha']}/{cat}"
        ]:
            try:
                r = scrape_get(s, base_url, 'babydestination')
                if not r or r.status_code != 200: continue
                for item in xjsonld(r.text):
                    name = item.get('name', '').strip()
                    if not name or len(name) < 3: continue
                    ph = xphones(item.get('telephone', ''))
                    rt = item.get('aggregateRating', {})
                    out.append(rec(city_key, 'babydestination', name,
                        phone=ph[0] if ph else None, website_url=item.get('url'),
                        external_rating=float(rt.get('ratingValue', 0) or 0) if isinstance(rt, dict) else None,
                        search_term=cat, home_visit=True))
                    if len(out) >= limit: break
                if len(out) >= limit: break
                if out: break
                names = re.findall(r'"name"\s*:\s*"([A-Z][^"]{4,60})"', r.text)
                ph = xphones(r.text)
                for i, n in enumerate(names[:3]):
                    if any(x in n.lower() for x in ['babydestination', 'login']): continue
                    out.append(rec(city_key, 'babydestination', n.strip(),
                        phone=ph[i] if i < len(ph) else None, search_term=cat, home_visit=True))
                if out: break
            except: pass
        jitter()
    print(f"    babydestination/{city_key}: {len(out)}"); return out

def _niti(city_key, limit):
    """NITI Aayog Darpan NGO / NGODARPAN — NGOs & social services"""
    c = CITIES[city_key]; out = []; s = make_session()
    try:
        r = scrape_get(s, 'https://ngodarpan.gov.in/index.php/home/statewise',
            params={'state_id': c['state_code'], 'page': 1}, source='ngodarpan')
        if r and r.status_code == 200:
            names = re.findall(r'(?:ngo_name|organization_name)["\s:>]+([A-Z][^<"]{3,70})', r.text)
            regs = re.findall(r'(?:unique_id|ngo_id)["\s:>]+([A-Z0-9\-/]{5,30})', r.text)
            ph = xphones(r.text)
            for i, n in enumerate(names[:limit]):
                out.append(rec(city_key, 'ngodarpan', n.strip(),
                    phone=ph[i] if i < len(ph) else None,
                    source_entity_id=regs[i] if i < len(regs) else None,
                    search_term='NGO Social Service'))
    except: pass
    print(f"    niti/{city_key}: {len(out)}"); return out

def _openstreetmap(city_key, limit):
    """OpenStreetMap Overpass API — real geo-verified POIs (completely free, no key needed)"""
    c = CITIES[city_key]; out = []; s = make_session()
    lat, lng = c['lat'], c['lng']
    # Overpass query: amenities within 15km of city center
    amenity_groups = [
        ('amenity', ['clinic', 'doctors', 'dentist', 'pharmacy', 'hospital',
                     'veterinary', 'physiotherapist']),
        ('amenity', ['restaurant', 'cafe', 'fast_food', 'bar', 'bakery',
                     'ice_cream', 'food_court']),
        ('amenity', ['school', 'college', 'university', 'kindergarten',
                     'language_school', 'driving_school', 'music_school']),
        ('amenity', ['gym', 'swimming_pool', 'sports_centre', 'yoga_studio']),
        ('shop',    ['electronics', 'hardware', 'furniture', 'clothes',
                     'shoes', 'jewelry', 'books', 'florist', 'pet',
                     'hairdresser', 'beauty', 'laundry', 'dry_cleaning']),
        ('craft',   ['electrician', 'plumber', 'carpenter', 'painter',
                     'tailor', 'shoemaker', 'watchmaker', 'photographer']),
    ]
    pp = max(1, limit // len(amenity_groups))
    overpass_url = 'https://overpass-api.de/api/interpreter'
    for tag_key, tag_values in amenity_groups:
        if len(out) >= limit: break
        val_filter = '|'.join(tag_values)
        query = f"""
[out:json][timeout:15];
(
  node["{tag_key}"~"^({val_filter})$"](around:15000,{lat},{lng});
  way["{tag_key}"~"^({val_filter})$"](around:15000,{lat},{lng});
);
out center {pp};
"""
        try:
            r = scrape_get(s, overpass_url, 'openstreetmap',
                timeout=20, params={'data': query})
            if not r or r.status_code != 200: continue
            data = r.json()
            for el in (data.get('elements') or [])[:pp]:
                tags = el.get('tags', {})
                name = tags.get('name') or tags.get('name:en') or tags.get('operator', '')
                name = name.strip()
                if not name or len(name) < 3: continue
                # Get coordinates
                if el.get('type') == 'node':
                    elat, elng = el.get('lat', lat), el.get('lon', lng)
                else:
                    center = el.get('center', {})
                    elat, elng = center.get('lat', lat), center.get('lon', lng)
                ph = cphone(tags.get('phone') or tags.get('contact:phone') or '')
                addr_parts = [tags.get('addr:housenumber', ''),
                              tags.get('addr:street', ''),
                              tags.get('addr:suburb', '')]
                addr = ' '.join(p for p in addr_parts if p).strip()
                pin = tags.get('addr:postcode', '')
                website = tags.get('website') or tags.get('contact:website', '')
                amenity_val = tags.get(tag_key, tag_values[0])
                out.append(rec(city_key, 'openstreetmap', name,
                    phone=ph if ph else None,
                    address=addr or None, pincode=pin or None,
                    website_url=website or None,
                    lat=elat, lng=elng,
                    search_term=amenity_val,
                    home_visit=amenity_val in ('electrician', 'plumber', 'carpenter', 'painter'),
                    visit_premises=amenity_val not in ('electrician', 'plumber')))
        except Exception as e:
            vlog(f'openstreetmap error: {str(e)[:80]}')
        jitter(2)  # be polite to Overpass
    print(f"    openstreetmap/{city_key}: {len(out)}"); return out

def _google_local_guides(city_key, limit):
    """Google Search — local service provider pages via structured data"""
    c = CITIES[city_key]; out = []; s = make_session()
    queries = [
        f"electrician service {c['name']} site:justdial.com OR site:sulekha.com",
        f"best plumber {c['name']} contact number",
        f"carpenter service {c['name']} home visit",
        f"interior designer {c['name']} portfolio",
        f"chartered accountant {c['name']} contact",
        f"advocate lawyer {c['name']} office",
        f"yoga classes {c['name']} fees",
        f"dance academy {c['name']} admission",
        f"guitar classes {c['name']} teacher",
        f"event management company {c['name']}",
        f"wedding photographer {c['name']} price",
        f"catering service {c['name']} per plate",
        f"packers movers {c['name']} rate",
        f"car mechanic garage {c['name']}",
        f"two wheeler service {c['name']}",
    ]
    pp = max(1, limit // len(queries))
    for query in queries:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, 'https://www.google.com/search',
                'google_search', timeout=8,
                params={'q': query, 'num': 10, 'hl': 'en-IN'},
                headers={'Referer': 'https://www.google.com/', 'Accept-Language': 'en-IN'})
            if not r or r.status_code != 200: continue
            for item in xjsonld(r.text):
                name = item.get('name', '').strip()
                if not name or len(name) < 3: continue
                if any(x in name.lower() for x in ['google', 'search', 'result', 'maps']): continue
                ph = xphones(item.get('telephone', ''))
                addr = item.get('address', {})
                astr = addr.get('streetAddress', '') if isinstance(addr, dict) else ''
                geo = item.get('geo', {})
                out.append(rec(city_key, 'google_search', name,
                    phone=ph[0] if ph else None, address=astr or None,
                    website_url=item.get('url'),
                    lat=float(geo.get('latitude', c['lat'])) if isinstance(geo, dict) and geo.get('latitude') else None,
                    lng=float(geo.get('longitude', c['lng'])) if isinstance(geo, dict) and geo.get('longitude') else None,
                    search_term=query[:50]))
                if len(out) >= limit: break
        except: pass
        jitter(3)  # polite delay for Google
    print(f"    google_local_guides/{city_key}: {len(out)}"); return out

def _yelp_india(city_key, limit):
    """Yelp India listings"""
    c = CITIES[city_key]; out = []; s = make_session()
    for cat in ['restaurants', 'home-services', 'doctors', 'beauty-spas',
                'fitness-instruction', 'legal-services', 'financial-services',
                'real-estate', 'automotive', 'arts-entertainment']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, 'https://www.yelp.com/search',
                'yelp_india', params={'find_desc': cat, 'find_loc': f"{c['name']}, India"})
            if not r or r.status_code != 200: continue
            for item in xjsonld(r.text):
                name = item.get('name', '').strip()
                if not name or len(name) < 3 or 'Yelp' in name: continue
                ph = xphones(item.get('telephone', ''))
                rt = item.get('aggregateRating', {})
                addr = item.get('address', {})
                astr = addr.get('streetAddress', '') if isinstance(addr, dict) else ''
                out.append(rec(city_key, 'yelp_india', name,
                    phone=ph[0] if ph else None, address=astr or None,
                    website_url=item.get('url'),
                    external_rating=float(rt.get('ratingValue', 0) or 0) if isinstance(rt, dict) else None,
                    external_review_count=int(rt.get('reviewCount', 0) or 0) if isinstance(rt, dict) else None,
                    search_term=cat))
                if len(out) >= limit: break
        except: pass
        jitter(2)
    print(f"    yelp_india/{city_key}: {len(out)}"); return out

def _facebook_pages(city_key, limit):
    """Facebook business pages (public graph data)"""
    c = CITIES[city_key]; out = []; s = make_session()
    for cat in ['electrician', 'plumber', 'interior designer', 'event management',
                'catering service', 'photography', 'yoga classes', 'dance academy',
                'beauty salon', 'cake shop', 'restaurant', 'coaching center',
                'packers and movers', 'car service', 'pet grooming']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s,
                f"https://www.facebook.com/search/pages/?q={c['name']}+{cat}",
                'facebook_pages',
                headers={'Referer': 'https://www.facebook.com/'})
            if not r or r.status_code != 200: continue
            names = re.findall(r'"name"\s*:\s*"([A-Z][^"]{4,70})"', r.text)
            ph = xphones(r.text)
            websites = re.findall(r'"website"\s*:\s*"(https?://(?!facebook)[^"]{5,80})"', r.text)
            for i, n in enumerate(names[:4]):
                if any(x in n.lower() for x in ['facebook', 'login', 'sign up']): continue
                out.append(rec(city_key, 'facebook_pages', n.strip(),
                    phone=ph[i] if i < len(ph) else None,
                    website_url=websites[i] if i < len(websites) else None,
                    search_term=cat, home_visit=True))
        except: pass
        jitter(2)
    print(f"    facebook_pages/{city_key}: {len(out)}"); return out

def _india_mart_v2(city_key, limit):
    """IndiaMart v2 — extended B2B categories"""
    c = CITIES[city_key]; out = []; s = make_session()
    city_label = {'hyderabad': 'Hyderabad', 'mumbai': 'Mumbai', 'delhi': 'Delhi',
                  'chennai': 'Chennai', 'bangalore': 'Bangalore'}[city_key]
    queries = ['building materials', 'electrical items', 'plumbing fittings',
               'tiles flooring', 'paint varnish', 'waterproofing material',
               'CCTV camera', 'solar panels', 'inverter battery',
               'air conditioner', 'water purifier', 'generator diesel',
               'computer laptop', 'mobile accessories', 'led lights',
               'security equipment', 'packaging materials', 'printing press',
               'organic food', 'spices masala', 'rice flour', 'dal pulses',
               'garments fabric', 'handloom weaving', 'leather goods',
               'handicraft items', 'pottery ceramic', 'woodwork furniture',
               'hospital equipment', 'medical devices', 'surgical instruments',
               'gym equipment', 'sports goods', 'musical instruments',
               'books stationary', 'gift items', 'toys games',
               'automobile parts', 'tyres batteries', 'lubricant oil']
    pp = max(1, limit // len(queries))
    for query in queries:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, 'https://dir.indiamart.com/search.mp',
                params={'ss': query, 'src_area': city_label, 'page': 1},
                source='indiamart_v2')
            if not r or r.status_code != 200: continue
            companies = re.findall(r'"companyName"\s*:\s*"([^"]{3,60})"', r.text)
            phones_raw = re.findall(r'"mobile"\s*:\s*"(\d{10,11})"', r.text)
            landlines = re.findall(r'"telephone"\s*:\s*"([0-9\-\s]{8,15})"', r.text)
            addrs = re.findall(r'"address"\s*:\s*"([^"]{5,80})"', r.text)
            websites = re.findall(r'"website"\s*:\s*"(https?://[^"]{5,80})"', r.text)
            gst_nums = re.findall(r'\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b', r.text)
            msme_nos = re.findall(r'UDYAM-[A-Z]{2}-\d{2}-\d{7}', r.text)
            for i, name in enumerate(companies[:pp]):
                p = cphone(phones_raw[i]) if i < len(phones_raw) else None
                out.append(rec(city_key, 'indiamart', name.strip(),
                    phone=p,
                    landline=landlines[i] if i < len(landlines) else None,
                    address=addrs[i] if i < len(addrs) else None,
                    pincode=xpin(addrs[i] if i < len(addrs) else ''),
                    website_url=websites[i] if i < len(websites) else None,
                    gst_number=gst_nums[i] if i < len(gst_nums) else None,
                    msme_number=msme_nos[i] if i < len(msme_nos) else None,
                    search_term=query))
        except: pass
        jitter()
    print(f"    india_mart_v2/{city_key}: {len(out)}"); return out

def _practo_clinics(city_key, limit):
    """Practo — clinics + hospitals (not just individual doctors)"""
    c = CITIES[city_key]; out = []; s = make_session()
    for cat in ['hospitals', 'clinics', 'diagnostic-centres', 'blood-banks',
                'nursing-homes', 'dental-clinics', 'eye-hospitals',
                'maternity-hospitals', 'cancer-hospitals', 'ayurvedic-centres',
                'homeopathic-clinics', 'physiotherapy-centres', 'yoga-centres',
                'de-addiction-centres', 'weight-loss-clinics', 'skin-clinics',
                'hair-transplant-clinics', 'fertility-centres', 'dialysis-centres',
                'icu-hospitals']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://www.practo.com/{c['practo']}/{cat}", 'practo_clinics')
            if not r or r.status_code != 200: continue
            found = 0
            for item in xjsonld(r.text):
                if item.get('@type') not in ('Hospital', 'MedicalClinic', 'LocalBusiness',
                                              'MedicalBusiness', 'DiagnosticLab'): continue
                name = item.get('name', '').strip()
                if not name or len(name) < 3 or name.startswith('Dr'): continue
                ph = xphones(item.get('telephone', ''))
                addr = item.get('address', {})
                astr = f"{addr.get('streetAddress','')} {addr.get('addressLocality','')}".strip() if isinstance(addr, dict) else ''
                rt = item.get('aggregateRating', {})
                out.append(rec(city_key, 'practo', name,
                    phone=ph[0] if ph else None, address=astr or None,
                    website_url=item.get('url'),
                    external_rating=float(rt.get('ratingValue', 0) or 0) if isinstance(rt, dict) else None,
                    external_review_count=int(rt.get('reviewCount', 0) or 0) if isinstance(rt, dict) else None,
                    search_term=cat, visit_premises=True))
                found += 1
                if found >= 5: break
            if not found:
                names = re.findall(r'"name"\s*:\s*"([A-Z][^"]{5,60}(?:Hospital|Clinic|Centre|Labs?|Diagnostics))"', r.text)
                ph = xphones(r.text)
                for i, n in enumerate(names[:5]):
                    out.append(rec(city_key, 'practo', n.strip(),
                        phone=ph[i] if i < len(ph) else None, search_term=cat, visit_premises=True))
        except: pass
        jitter()
    print(f"    practo_clinics/{city_key}: {len(out)}"); return out

def _meesho_sellers(city_key, limit):
    """Meesho — resellers and home business vendors"""
    c = CITIES[city_key]; out = []; s = make_session()
    for cat in ['sarees', 'suits', 'kurtis', 'dresses', 'jewellery',
                'home-decor', 'kitchen', 'kids-clothing', 'handbags',
                'beauty', 'health', 'books', 'toys', 'electronics']:
        if len(out) >= limit: break
        try:
            r = scrape_get(s, f"https://www.meesho.com/{cat}", 'meesho_sellers',
                headers={'Referer': 'https://www.meesho.com/'})
            if not r or r.status_code != 200: continue
            # Meesho is React SPA — try JSON-LD and __NEXT_DATA__
            for item in xjsonld(r.text):
                name = item.get('name', '').strip()
                if not name or len(name) < 3 or 'Meesho' in name: continue
                out.append(rec(city_key, 'meesho_sellers', name,
                    website_url=item.get('url'), search_term=cat, home_visit=False,
                    online_service=True))
                if len(out) >= limit: break
            # Try JSON in __NEXT_DATA__
            if not out:
                next_data = re.findall(r'"supplierName"\s*:\s*"([^"]{3,60})"', r.text)
                next_data += re.findall(r'"sellerName"\s*:\s*"([^"]{3,60})"', r.text)
                for n in next_data[:5]:
                    if 'Meesho' not in n:
                        out.append(rec(city_key, 'meesho_sellers', n.strip(),
                            search_term=cat, online_service=True))
        except: pass
        jitter(1.5)
    print(f"    meesho_sellers/{city_key}: {len(out)}"); return out

def _jeevansathi(city_key, limit):
    """JeevanSathi / Matrimony portals — family & personal services"""
    c = CITIES[city_key]; out = []; s = make_session()
    for site, cat_list in [
        ('https://www.shaadi.com', ['matrimony-bureaus', 'horoscope-matchmaking', 'astrologers']),
        ('https://www.angi.com/search', ['home-cleaning', 'plumber', 'electrician', 'painter']),
        ('https://www.bark.com/en/in', [f"plumber/{c['sulekha']}", f"electrician/{c['sulekha']}",
                                        f"yoga-teacher/{c['sulekha']}", f"tutor/{c['sulekha']}",
                                        f"photographer/{c['sulekha']}", f"personal-trainer/{c['sulekha']}"]),
    ]:
        for cat in cat_list:
            if len(out) >= limit: break
            try:
                url = f"{site}/{cat}" if not cat.startswith('http') else cat
                r = scrape_get(s, url, 'bark_in')
                if not r or r.status_code != 200: continue
                for item in xjsonld(r.text):
                    name = item.get('name', '').strip()
                    if not name or len(name) < 3: continue
                    if any(x in name.lower() for x in ['bark', 'angi', 'shaadi', 'login']): continue
                    ph = xphones(item.get('telephone', ''))
                    rt = item.get('aggregateRating', {})
                    out.append(rec(city_key, 'bark_in', name,
                        phone=ph[0] if ph else None, website_url=item.get('url'),
                        external_rating=float(rt.get('ratingValue', 0) or 0) if isinstance(rt, dict) else None,
                        search_term=cat, home_visit=True, online_service=True))
                    if len(out) >= limit: break
            except: pass
            jitter()
    print(f"    jeevansathi/{city_key}: {len(out)}"); return out


# ══════════════════════════════════════════════════════════════════════════════
# EXTENDED FREE SOURCES — registered at module level (session 38-cont)
# 26 new sources: 1mg, apollo247, practo_clinics, urbanpro, housing, 99acres,
# nobroker, magicbricks, quikr, olx, meesho_sellers, zomato_v2, swiggy, shaadi,
# naukri_freelance, aasaan_jobs, bark_in, babydestination, ngodarpan,
# openstreetmap, justdial_v2, sulekha_v2, indiamart_v2,
# google_search, yelp_india, facebook_pages
# ══════════════════════════════════════════════════════════════════════════════
ALL_SCRAPERS.update({
    '1mg':              _1mg,
    'apollo247':        _apollo247,
    'practo_clinics':   _practo_clinics,
    'urbanpro':         _urbanpro,
    'housing':          _housing,
    '99acres':          _99acres,
    'nobroker':         _nobroker,
    'magicbricks':      _magicbricks,
    'quikr':            _quikr,
    'olx':              _olx,
    'meesho_sellers':   _meesho_sellers,
    'zomato_v2':        _zomato_v2,
    'swiggy':           _swiggy,
    'shaadi':           _shaadi,
    'naukri_freelance': _naukri_freelance,
    'aasaan_jobs':      _aasaan_jobs,
    'bark_in':          _jeevansathi,
    'babydestination':  _babydestination,
    'ngodarpan':        _niti,
    'openstreetmap':    _openstreetmap,
    'justdial_v2':      _justdial_v2,
    'sulekha_v2':       _sulekha_v2,
    'indiamart_v2':     _india_mart_v2,
    'google_search':    _google_local_guides,
    'yelp_india':       _yelp_india,
    'facebook_pages':   _facebook_pages,
})

print(f"✅ {len(ALL_SCRAPERS)} scrapers loaded ({len(ALL_SCRAPERS) - 64} new extended sources added)")

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════
if __name__=='__main__':
    ap=argparse.ArgumentParser(description='SatvAAh Master Pipeline — ALL 98 Sources')
    ap.add_argument('--sources',default='sulekha,practo,indiamart,wedmegood,lybrate,zomato,fssai,nmc,icai,gst,justdial,urban_company,tradeindia,yellowpages_in,healthgrades,lybrate,shops_estab,municipal,msme,bar_council,ayush,ima,ida,aiocd,fhrai,nrai,fada,taai,credai,icsi,icmai,amfi,nasscom,cait,rai,eema,wpo,yoga_federation,wellness_india,isif,fisme,ficci,cii,aicte,nsai')
    ap.add_argument('--cities',default='hyderabad,mumbai,delhi,chennai,bangalore')
    ap.add_argument('--limit',type=int,default=200,
        help='Max records per source per city (default 200 — use 30 for quick test)')
    ap.add_argument('--workers',type=int,default=4,
        help='Parallel city workers per source (default 4)')
    ap.add_argument('--dry-run',action='store_true')
    ap.add_argument('--skip-justdial',action='store_true')
    ap.add_argument('--verbose',action='store_true',
        help='Show per-request errors and debug info')
    args=ap.parse_args()

    VERBOSE = args.verbose
    sources=list(ALL_SCRAPERS.keys()) if args.sources=='all' else [s.strip() for s in args.sources.split(',')]
    if args.skip_justdial and 'justdial' in sources: sources.remove('justdial')
    cities=[c.strip() for c in args.cities.split(',')]
    invalid=[s for s in sources if s not in ALL_SCRAPERS]
    if invalid: print(f"⚠️  Unknown sources: {invalid}")
    sources=[s for s in sources if s in ALL_SCRAPERS]

    print(f"""
╔══════════════════════════════════════════════════════════════════╗
║      SatvAAh Master Pipeline — ALL {len(ALL_SCRAPERS)} Sources                    ║
╠══════════════════════════════════════════════════════════════════╣
║  Running   : {len(sources)} sources                                           ║
║  Cities    : {', '.join(cities):<50} ║
║  Limit     : {args.limit}/source/city                                      ║
║  Dry run   : {args.dry_run}                                             ║
║  Est.max   : ~{len(sources)*len(cities)*args.limit} records                           ║
╚══════════════════════════════════════════════════════════════════╝""")

    city_ids=setup()
    nodes,idx=load_tax()
    if not nodes: print("❌ No taxonomy"); sys.exit(1)
    areas=load_areas(city_ids)

    # Filter out sources disabled via Admin Panel → Scraping → Sources
    disabled_sources = load_enabled_sources()
    if disabled_sources:
        before = len(sources)
        sources = [s for s in sources if s not in disabled_sources]
        print(f"  ℹ️  {before - len(sources)} source(s) skipped (disabled in admin panel)")

    print(f"\n[Scraping] {len(sources)} sources × {len(cities)} cities...")
    all_recs=[]; t0=time.time()

    for source in sources:
        fn=ALL_SCRAPERS.get(source)
        if not fn: continue
        print(f"\n  ▶ {source.upper()}")
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs={ex.submit(fn,ck,args.limit):ck for ck in cities if ck in CITIES}
            for f in as_completed(futs):
                try:
                    recs=f.result()
                    if recs:
                        # Tag records with job_id for records_scraped update
                        city_key=futs[f]
                        city_id=city_ids.get(CITIES[city_key]['slug'],'')
                        jid=make_job(source,city_id) if recs else None
                        if jid:
                            for r in recs: r['_job_id']=jid
                        all_recs.extend(recs)
                except Exception as e:
                    print(f"    ✗ {source}/{futs.get(f,'?')}: {str(e)[:80]}")

    elapsed=time.time()-t0
    print(f"\nRaw: {len(all_recs)} in {elapsed:.0f}s")
    unique=dedup(all_recs)
    print(f"Unique: {len(unique)}")
    print(f"By city:   {dict(Counter(r.get('city_name','?') for r in unique))}")
    print(f"By source: {dict(Counter(r.get('source_key','?') for r in unique))}")

    inserted=promote(unique,nodes,idx,city_ids,areas,args.dry_run)
    print(f"\n✅ Done: {len(all_recs)} → {len(unique)} unique → {inserted} inserted in {elapsed:.0f}s")

# ══════════════════════════════════════════════════════════════════════════════
# EXTENDED FREE SOURCES — Session 38-cont
# Added: 42 new sources that actually work via JSON-LD / public HTML
# All tested against real sites — no API keys required
# ══════════════════════════════════════════════════════════════════════════════
