-- V052: Populate search_synonyms for top 50 taxonomy nodes
-- Covers Hindi/Hinglish/Telugu colloquial terms consumers use in India
-- Safe to re-run: only updates rows where search_synonyms IS NULL
BEGIN;

UPDATE taxonomy_nodes 
SET search_synonyms = 'bijli wala, electric repair, wiring work, light fitting, switchboard repair, vidyut karigar, electrician near me',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%electrician%'
    OR LOWER(l2) LIKE '%electrician%'
    OR LOWER(l3) LIKE '%electrician%'
    OR LOWER(l4) LIKE '%electrician%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'plumber, pipe repair, nali wala, leakage repair, tap repair, paani ka kaam, bathroom fittings',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%plumber%'
    OR LOWER(l2) LIKE '%plumber%'
    OR LOWER(l3) LIKE '%plumber%'
    OR LOWER(l4) LIKE '%plumber%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'carpenter, wood work, furniture repair, almirah repair, door repair, lakdi ka kaam, badhai',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%carpenter%'
    OR LOWER(l2) LIKE '%carpenter%'
    OR LOWER(l3) LIKE '%carpenter%'
    OR LOWER(l4) LIKE '%carpenter%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'painter, wall painting, colour wala, house painting, rang wala, paint work',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%painter%'
    OR LOWER(l2) LIKE '%painter%'
    OR LOWER(l3) LIKE '%painter%'
    OR LOWER(l4) LIKE '%painter%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'ac repair, air conditioner repair, ac service, cooling repair, ac mechanic, ac wala',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%ac repair%'
    OR LOWER(l2) LIKE '%ac repair%'
    OR LOWER(l3) LIKE '%ac repair%'
    OR LOWER(l4) LIKE '%ac repair%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'pest control, cockroach spray, termite treatment, kide maar, insect control, bed bug spray',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%pest control%'
    OR LOWER(l2) LIKE '%pest control%'
    OR LOWER(l3) LIKE '%pest control%'
    OR LOWER(l4) LIKE '%pest control%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'maid, bai, kaamwali, house help, housemaid, ghar ka kaam, jhadu pocha, servant',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%domestic help%'
    OR LOWER(l2) LIKE '%domestic help%'
    OR LOWER(l3) LIKE '%domestic help%'
    OR LOWER(l4) LIKE '%domestic help%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'cook, khana banane wala, chef, tiffin service, home cook, rasoi wali, bawarch',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%cook%'
    OR LOWER(l2) LIKE '%cook%'
    OR LOWER(l3) LIKE '%cook%'
    OR LOWER(l4) LIKE '%cook%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'driver, car driver, chauffeur, personal driver, gaadi chalane wala',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%driver%'
    OR LOWER(l2) LIKE '%driver%'
    OR LOWER(l3) LIKE '%driver%'
    OR LOWER(l4) LIKE '%driver%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'security guard, chowkidar, watchman, security wala, gate keeper',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%security guard%'
    OR LOWER(l2) LIKE '%security guard%'
    OR LOWER(l3) LIKE '%security guard%'
    OR LOWER(l4) LIKE '%security guard%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'gardener, mali, garden maintenance, plants care, bagicha wala',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%gardener%'
    OR LOWER(l2) LIKE '%gardener%'
    OR LOWER(l3) LIKE '%gardener%'
    OR LOWER(l4) LIKE '%gardener%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'laundry, dry cleaning, kapde dhone wala, washing, iron wala, clothes washing',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%laundry%'
    OR LOWER(l2) LIKE '%laundry%'
    OR LOWER(l3) LIKE '%laundry%'
    OR LOWER(l4) LIKE '%laundry%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'doctor, physician, general doctor, GP, family doctor, davakhana, vaidya, daktar',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%doctor%'
    OR LOWER(l2) LIKE '%doctor%'
    OR LOWER(l3) LIKE '%doctor%'
    OR LOWER(l4) LIKE '%doctor%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'dentist, teeth doctor, dant doctor, dental clinic, dantchikitsak',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%dentist%'
    OR LOWER(l2) LIKE '%dentist%'
    OR LOWER(l3) LIKE '%dentist%'
    OR LOWER(l4) LIKE '%dentist%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'physiotherapy, physio, rehabilitation, body pain treatment, exercise therapy',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%physiotherapist%'
    OR LOWER(l2) LIKE '%physiotherapist%'
    OR LOWER(l3) LIKE '%physiotherapist%'
    OR LOWER(l4) LIKE '%physiotherapist%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'homeopathy doctor, homeo doctor, homeopathic treatment, tiny pills doctor',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%homeopathy%'
    OR LOWER(l2) LIKE '%homeopathy%'
    OR LOWER(l3) LIKE '%homeopathy%'
    OR LOWER(l4) LIKE '%homeopathy%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'ayurveda doctor, vaidya, herbal treatment, natural medicine, ayurvedic clinic',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%ayurvedic%'
    OR LOWER(l2) LIKE '%ayurvedic%'
    OR LOWER(l3) LIKE '%ayurvedic%'
    OR LOWER(l4) LIKE '%ayurvedic%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'beauty parlour, parlour, ladies salon, beauty salon, facial, beauty wali, makeup',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%beauty parlour%'
    OR LOWER(l2) LIKE '%beauty parlour%'
    OR LOWER(l3) LIKE '%beauty parlour%'
    OR LOWER(l4) LIKE '%beauty parlour%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'hair cutting, salon, hair stylist, baal katna, hair cut, hairdresser',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%hair salon%'
    OR LOWER(l2) LIKE '%hair salon%'
    OR LOWER(l3) LIKE '%hair salon%'
    OR LOWER(l4) LIKE '%hair salon%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'barber, nai, naai, hair cut, shaving, dadhi banana, baal katna, haircut',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%barber%'
    OR LOWER(l2) LIKE '%barber%'
    OR LOWER(l3) LIKE '%barber%'
    OR LOWER(l4) LIKE '%barber%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'mehendi, henna, mehendi wali, mehendi design, bridal mehendi, mehndi',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%mehendi%'
    OR LOWER(l2) LIKE '%mehendi%'
    OR LOWER(l3) LIKE '%mehendi%'
    OR LOWER(l4) LIKE '%mehendi%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'tailor, darzi, stitching, kapde silai, blouse stitching, alterations, silai kaam',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%tailor%'
    OR LOWER(l2) LIKE '%tailor%'
    OR LOWER(l3) LIKE '%tailor%'
    OR LOWER(l4) LIKE '%tailor%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'restaurant, hotel, dhaba, khana ghar, food place, bhojanalaya, eating place',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%restaurant%'
    OR LOWER(l2) LIKE '%restaurant%'
    OR LOWER(l3) LIKE '%restaurant%'
    OR LOWER(l4) LIKE '%restaurant%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'tiffin, dabba, lunch box, home food, tiffin service, ghar ka khana, dabba service',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%tiffin%'
    OR LOWER(l2) LIKE '%tiffin%'
    OR LOWER(l3) LIKE '%tiffin%'
    OR LOWER(l4) LIKE '%tiffin%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'catering, party food, event catering, khana banane wala, wedding catering',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%catering%'
    OR LOWER(l2) LIKE '%catering%'
    OR LOWER(l3) LIKE '%catering%'
    OR LOWER(l4) LIKE '%catering%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'bakery, cake shop, bread shop, pastry shop, cake wala',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%bakery%'
    OR LOWER(l2) LIKE '%bakery%'
    OR LOWER(l3) LIKE '%bakery%'
    OR LOWER(l4) LIKE '%bakery%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'mobile repair, phone repair, screen repair, mobile service, phone fix',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%mobile repair%'
    OR LOWER(l2) LIKE '%mobile repair%'
    OR LOWER(l3) LIKE '%mobile repair%'
    OR LOWER(l4) LIKE '%mobile repair%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'laptop repair, computer repair, PC repair, laptop service, computer fix',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%laptop repair%'
    OR LOWER(l2) LIKE '%laptop repair%'
    OR LOWER(l3) LIKE '%laptop repair%'
    OR LOWER(l4) LIKE '%laptop repair%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'washing machine repair, washer repair, washing machine service, kapde dhone ki machine',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%washing machine repair%'
    OR LOWER(l2) LIKE '%washing machine repair%'
    OR LOWER(l3) LIKE '%washing machine repair%'
    OR LOWER(l4) LIKE '%washing machine repair%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'fridge repair, refrigerator service, cooling problem, compressor repair, fridge wala',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%refrigerator repair%'
    OR LOWER(l2) LIKE '%refrigerator repair%'
    OR LOWER(l3) LIKE '%refrigerator repair%'
    OR LOWER(l4) LIKE '%refrigerator repair%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'tutor, home teacher, private tuition, padhai, coaching, teacher at home, home tuition',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%tutor%'
    OR LOWER(l2) LIKE '%tutor%'
    OR LOWER(l3) LIKE '%tutor%'
    OR LOWER(l4) LIKE '%tutor%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'coaching, tuition center, coaching classes, study center, padhai center',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%coaching%'
    OR LOWER(l2) LIKE '%coaching%'
    OR LOWER(l3) LIKE '%coaching%'
    OR LOWER(l4) LIKE '%coaching%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'yoga, yoga classes, yoga instructor, yoga teacher, pranayama, meditation',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%yoga%'
    OR LOWER(l2) LIKE '%yoga%'
    OR LOWER(l3) LIKE '%yoga%'
    OR LOWER(l4) LIKE '%yoga%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'dance, dance classes, dance teacher, dance academy, nritya, dancing',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%dance%'
    OR LOWER(l2) LIKE '%dance%'
    OR LOWER(l3) LIKE '%dance%'
    OR LOWER(l4) LIKE '%dance%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'CA, chartered accountant, accountant, tax filing, GST filing, income tax, CA near me',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%chartered accountant%'
    OR LOWER(l2) LIKE '%chartered accountant%'
    OR LOWER(l3) LIKE '%chartered accountant%'
    OR LOWER(l4) LIKE '%chartered accountant%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'lawyer, advocate, vakil, attorney, legal advice, court case, kanoon wala',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%lawyer%'
    OR LOWER(l2) LIKE '%lawyer%'
    OR LOWER(l3) LIKE '%lawyer%'
    OR LOWER(l4) LIKE '%lawyer%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'insurance, LIC agent, insurance advisor, bima, policy, insurance near me',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%insurance%'
    OR LOWER(l2) LIKE '%insurance%'
    OR LOWER(l3) LIKE '%insurance%'
    OR LOWER(l4) LIKE '%insurance%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'interior design, home design, interior decorator, ghar sajana, room design',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%interior designer%'
    OR LOWER(l2) LIKE '%interior designer%'
    OR LOWER(l3) LIKE '%interior designer%'
    OR LOWER(l4) LIKE '%interior designer%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'car repair, garage, mechanic, car service, auto repair, gaadi repair, car mechanic',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%car repair%'
    OR LOWER(l2) LIKE '%car repair%'
    OR LOWER(l3) LIKE '%car repair%'
    OR LOWER(l4) LIKE '%car repair%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'bike repair, motorcycle repair, two wheeler repair, scooter repair, bike mechanic',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%bike repair%'
    OR LOWER(l2) LIKE '%bike repair%'
    OR LOWER(l3) LIKE '%bike repair%'
    OR LOWER(l4) LIKE '%bike repair%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'car wash, car cleaning, vehicle wash, gaadi dhona, auto wash',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%car wash%'
    OR LOWER(l2) LIKE '%car wash%'
    OR LOWER(l3) LIKE '%car wash%'
    OR LOWER(l4) LIKE '%car wash%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'photographer, photo, wedding photographer, event photographer, photo wala, photography',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%photographer%'
    OR LOWER(l2) LIKE '%photographer%'
    OR LOWER(l3) LIKE '%photographer%'
    OR LOWER(l4) LIKE '%photographer%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'event planner, wedding planner, event organizer, party organizer, event wala',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%event management%'
    OR LOWER(l2) LIKE '%event management%'
    OR LOWER(l3) LIKE '%event management%'
    OR LOWER(l4) LIKE '%event management%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'decorator, decoration, flower decoration, event decoration, sajawat, saja',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%decorator%'
    OR LOWER(l2) LIKE '%decorator%'
    OR LOWER(l3) LIKE '%decorator%'
    OR LOWER(l4) LIKE '%decorator%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'contractor, construction, civil work, building contractor, ghar banana, nirman',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%contractor%'
    OR LOWER(l2) LIKE '%contractor%'
    OR LOWER(l3) LIKE '%contractor%'
    OR LOWER(l4) LIKE '%contractor%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'waterproofing, leakage repair, seepage fix, damp proof, water seepage',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%waterproofing%'
    OR LOWER(l2) LIKE '%waterproofing%'
    OR LOWER(l3) LIKE '%waterproofing%'
    OR LOWER(l4) LIKE '%waterproofing%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'CCTV, camera installation, security camera, surveillance, cctv wala, camera lagana',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%cctv%'
    OR LOWER(l2) LIKE '%cctv%'
    OR LOWER(l3) LIKE '%cctv%'
    OR LOWER(l4) LIKE '%cctv%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'packers movers, shifting, relocation, house shifting, saman uthana, transport',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%packers movers%'
    OR LOWER(l2) LIKE '%packers movers%'
    OR LOWER(l3) LIKE '%packers movers%'
    OR LOWER(l4) LIKE '%packers movers%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'gym, fitness center, exercise, workout, vyayamshala, body building, fitness',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%gym%'
    OR LOWER(l2) LIKE '%gym%'
    OR LOWER(l3) LIKE '%gym%'
    OR LOWER(l4) LIKE '%gym%'
  );

UPDATE taxonomy_nodes 
SET search_synonyms = 'vet, veterinary doctor, pet doctor, animal doctor, janwar doctor, pashu chikitsak',
    updated_at = NOW()
WHERE search_synonyms IS NULL 
  AND is_active = true
  AND (
    LOWER(display_name) LIKE '%veterinary%'
    OR LOWER(l2) LIKE '%veterinary%'
    OR LOWER(l3) LIKE '%veterinary%'
    OR LOWER(l4) LIKE '%veterinary%'
  );

COMMIT;

-- Verify
SELECT COUNT(*) as nodes_with_synonyms FROM taxonomy_nodes WHERE search_synonyms IS NOT NULL;