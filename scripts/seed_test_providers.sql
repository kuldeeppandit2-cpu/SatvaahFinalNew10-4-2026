BEGIN;
-- Test providers seed for Hyderabad testing
-- Run: docker exec -i satvaaah-postgres psql -U satvaaah_user -d satvaaah < scripts/seed_test_providers.sql

DO $$
DECLARE
  v_city_id UUID;
  v_node_id UUID;
  v_provider_id UUID;
  v_trust_id UUID;
BEGIN
  -- Get Hyderabad city ID
  SELECT id INTO v_city_id FROM cities WHERE slug='hyderabad' LIMIT 1;
  IF v_city_id IS NULL THEN
    RAISE NOTICE 'Hyderabad city not found — run setup first';
    RETURN;
  END IF;


  -- Ravi Kumar Plumbing
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Pipe Fitting & Repair' AND tab::text = 'services' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Ravi Kumar Plumbing',
    'Ravi Kumar Plumbing',
    v_node_id,
    v_city_id,
    'services'::"Tab",
    'individual_service'::"ListingType",
    '9876543210',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_4c4ca30a',
    ST_SetSRID(ST_MakePoint(78.477, 17.395), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 72, 72, 'trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Srinivas Electricals
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Fan & Light Fitting' AND tab::text = 'services' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Srinivas Electricals',
    'Srinivas Electricals',
    v_node_id,
    v_city_id,
    'services'::"Tab",
    'individual_service'::"ListingType",
    '9876543211',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_6a3f2d86',
    ST_SetSRID(ST_MakePoint(78.492, 17.375), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 85, 85, 'highly_trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Lakshmi AC Services
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'AC Servicing & Deep Cleaning' AND tab::text = 'services' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Lakshmi AC Services',
    'Lakshmi AC Services',
    v_node_id,
    v_city_id,
    'services'::"Tab",
    'individual_service'::"ListingType",
    '9876543212',
    true, true, false, true,
    'offline'::"Availability",
    'test_seed', 'test_bd06deeb',
    ST_SetSRID(ST_MakePoint(78.468, 17.408), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 63, 63, 'trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Prasad Home Cleaning
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Full Home Deep Cleaning' AND tab::text = 'services' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Prasad Home Cleaning',
    'Prasad Home Cleaning',
    v_node_id,
    v_city_id,
    'services'::"Tab",
    'individual_service'::"ListingType",
    '9876543213',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_cb76345d',
    ST_SetSRID(ST_MakePoint(78.501, 17.382), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 55, 55, 'basic'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Anand Pest Control
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Cockroach Control Treatment' AND tab::text = 'services' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Anand Pest Control',
    'Anand Pest Control',
    v_node_id,
    v_city_id,
    'services'::"Tab",
    'individual_service'::"ListingType",
    '9876543214',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_83cf5bc1',
    ST_SetSRID(ST_MakePoint(78.456, 17.398), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 68, 68, 'trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Divya Maths Tutor
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Mathematics Tutor (Class 6–10)' AND tab::text = 'services' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Divya Maths Tutor',
    'Divya Maths Tutor',
    v_node_id,
    v_city_id,
    'services'::"Tab",
    'individual_service'::"ListingType",
    '9876543215',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_7055ac4b',
    ST_SetSRID(ST_MakePoint(78.488, 17.371), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 78, 78, 'trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Hyderabad Yoga Studio
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Morning Yoga (home sessions)' AND tab::text = 'services' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Hyderabad Yoga Studio',
    'Hyderabad Yoga Studio',
    v_node_id,
    v_city_id,
    'services'::"Tab",
    'individual_service'::"ListingType",
    '9876543216',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_beea7d1f',
    ST_SetSRID(ST_MakePoint(78.475, 17.415), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 82, 82, 'highly_trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Kavitha Beauty Parlour
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Facial & Bleach — home visit' AND tab::text = 'services' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Kavitha Beauty Parlour',
    'Kavitha Beauty Parlour',
    v_node_id,
    v_city_id,
    'services'::"Tab",
    'individual_service'::"ListingType",
    '9876543217',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_54fe8fe4',
    ST_SetSRID(ST_MakePoint(78.495, 17.388), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 74, 74, 'trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Mohammed Barber Home
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Haircut (men) — home visit' AND tab::text = 'services' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Mohammed Barber Home',
    'Mohammed Barber Home',
    v_node_id,
    v_city_id,
    'services'::"Tab",
    'individual_service'::"ListingType",
    '9876543218',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_7fa8d978',
    ST_SetSRID(ST_MakePoint(78.472, 17.362), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 51, 51, 'basic'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Sri Venkateshwara Kirana
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Kirana Store — Full Range Home Delivery' AND tab::text = 'establishments' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Sri Venkateshwara Kirana',
    'Sri Venkateshwara Kirana',
    v_node_id,
    v_city_id,
    'establishments'::"Tab",
    'establishment'::"ListingType",
    '9876543219',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_5fe17228',
    ST_SetSRID(ST_MakePoint(78.483, 17.392), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 66, 66, 'trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Bombay Biryani House
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Hyderabadi Dum Biryani Shop' AND tab::text = 'establishments' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Bombay Biryani House',
    'Bombay Biryani House',
    v_node_id,
    v_city_id,
    'establishments'::"Tab",
    'establishment'::"ListingType",
    '9876543220',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_860e42a8',
    ST_SetSRID(ST_MakePoint(78.498, 17.378), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 91, 91, 'highly_trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Ramaiah Medical Store
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Pharmacy — Full Medicine Range' AND tab::text = 'establishments' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Ramaiah Medical Store',
    'Ramaiah Medical Store',
    v_node_id,
    v_city_id,
    'establishments'::"Tab",
    'establishment'::"ListingType",
    '9876543221',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_520a84cb',
    ST_SetSRID(ST_MakePoint(78.462, 17.401), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 77, 77, 'trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Sunrise Diagnostic Lab
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Diagnostic Lab — Home Blood Collection' AND tab::text = 'establishments' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Sunrise Diagnostic Lab',
    'Sunrise Diagnostic Lab',
    v_node_id,
    v_city_id,
    'establishments'::"Tab",
    'establishment'::"ListingType",
    '9876543222',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_feae3bc0',
    ST_SetSRID(ST_MakePoint(78.487, 17.367), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 88, 88, 'highly_trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- CA Suresh Reddy
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Income Tax Return (ITR) Filing' AND tab::text = 'expertise' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'CA Suresh Reddy',
    'CA Suresh Reddy',
    v_node_id,
    v_city_id,
    'expertise'::"Tab",
    'expertise'::"ListingType",
    '9876543223',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_48e75f9a',
    ST_SetSRID(ST_MakePoint(78.478, 17.395), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 83, 83, 'highly_trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Adv. Priya Sharma
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Property Dispute Advocate' AND tab::text = 'expertise' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Adv. Priya Sharma',
    'Adv. Priya Sharma',
    v_node_id,
    v_city_id,
    'expertise'::"Tab",
    'expertise'::"ListingType",
    '9876543224',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_8ef1d3f2',
    ST_SetSRID(ST_MakePoint(78.503, 17.382), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 75, 75, 'trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Dr. Ramesh Cardiology
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'General Cardiologist' AND tab::text = 'expertise' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Dr. Ramesh Cardiology',
    'Dr. Ramesh Cardiology',
    v_node_id,
    v_city_id,
    'expertise'::"Tab",
    'expertise'::"ListingType",
    '9876543225',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_fdfb4757',
    ST_SetSRID(ST_MakePoint(78.469, 17.407), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 95, 95, 'highly_trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Fresh Veggies Hyderabad
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Spinach (Palak)' AND tab::text = 'products' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Fresh Veggies Hyderabad',
    'Fresh Veggies Hyderabad',
    v_node_id,
    v_city_id,
    'products'::"Tab",
    'individual_product'::"ListingType",
    '9876543226',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_e43b422c',
    ST_SetSRID(ST_MakePoint(78.481, 17.388), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 58, 58, 'basic'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- A2 Milk Farm Direct
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'A2 Cow Milk' AND tab::text = 'products' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'A2 Milk Farm Direct',
    'A2 Milk Farm Direct',
    v_node_id,
    v_city_id,
    'products'::"Tab",
    'individual_product'::"ListingType",
    '9876543227',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_b98a6fc4',
    ST_SetSRID(ST_MakePoint(78.494, 17.372), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 71, 71, 'trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Steel King Hardware
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'TMT Bars — Fe 500' AND tab::text = 'products' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Steel King Hardware',
    'Steel King Hardware',
    v_node_id,
    v_city_id,
    'products'::"Tab",
    'individual_product'::"ListingType",
    '9876543228',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_514df121',
    ST_SetSRID(ST_MakePoint(78.477, 17.418), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 64, 64, 'trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  -- Hyderabad Solar Panels
  SELECT id INTO v_node_id FROM taxonomy_nodes 
  WHERE l4 = 'Solar Panels (250W)' AND tab::text = 'products' LIMIT 1;
  
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id,
    'Hyderabad Solar Panels',
    'Hyderabad Solar Panels',
    v_node_id,
    v_city_id,
    'products'::"Tab",
    'individual_product'::"ListingType",
    '9876543229',
    true, true, false, true,
    'available'::"Availability",
    'test_seed', 'test_59eee21a',
    ST_SetSRID(ST_MakePoint(78.499, 17.361), 4326),
    NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;

  INSERT INTO trust_scores(
    id, provider_id, display_score, raw_score, trust_tier
  ) VALUES (
    v_trust_id, v_provider_id, 79, 79, 'trusted'::"TrustTier"
  ) ON CONFLICT (provider_id) DO NOTHING;


  RAISE NOTICE 'Test providers seeded successfully';
END $$;

COMMIT;
  -- ── Products tab providers ─────────────────────────────────────────────────

  -- Lakshmi Dairy Fresh
  SELECT id INTO v_node_id FROM taxonomy_nodes
  WHERE l4 = 'A2 Cow Milk' AND tab::text = 'products' LIMIT 1;
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id, 'Lakshmi Dairy Fresh', 'Lakshmi Dairy Fresh', v_node_id,
    v_city_id, 'products'::"Tab", 'individual_product'::"ListingType", '9876501001',
    true, true, false, true, 'available'::"Availability",
    'test_seed', 'test_prod_001',
    ST_SetSRID(ST_MakePoint(78.477, 17.395), 4326), NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id, provider_id, display_score, raw_score, trust_tier)
  VALUES (v_trust_id, v_provider_id, 78, 78, 'trusted'::"TrustTier")
  ON CONFLICT (provider_id) DO NOTHING;

  -- Gopal Organic Dairy
  SELECT id INTO v_node_id FROM taxonomy_nodes
  WHERE l4 = 'Cow Milk (packaged)' AND tab::text = 'products' LIMIT 1;
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id, 'Gopal Organic Dairy', 'Gopal Organic Dairy', v_node_id,
    v_city_id, 'products'::"Tab", 'individual_product'::"ListingType", '9876501002',
    true, true, false, true, 'available'::"Availability",
    'test_seed', 'test_prod_002',
    ST_SetSRID(ST_MakePoint(78.492, 17.375), 4326), NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id, provider_id, display_score, raw_score, trust_tier)
  VALUES (v_trust_id, v_provider_id, 65, 65, 'trusted'::"TrustTier")
  ON CONFLICT (provider_id) DO NOTHING;

  -- Krishna Vegetables
  SELECT id INTO v_node_id FROM taxonomy_nodes
  WHERE l4 = 'Spinach (Palak)' AND tab::text = 'products' LIMIT 1;
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id, 'Krishna Fresh Vegetables', 'Krishna Fresh Vegetables', v_node_id,
    v_city_id, 'products'::"Tab", 'individual_product'::"ListingType", '9876501003',
    true, false, false, true, 'available'::"Availability",
    'test_seed', 'test_prod_003',
    ST_SetSRID(ST_MakePoint(78.468, 17.408), 4326), NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id, provider_id, display_score, raw_score, trust_tier)
  VALUES (v_trust_id, v_provider_id, 42, 42, 'basic'::"TrustTier")
  ON CONFLICT (provider_id) DO NOTHING;

  -- Annapurna Rice Store
  SELECT id INTO v_node_id FROM taxonomy_nodes
  WHERE l4 = 'Basmati Long Grain' AND tab::text = 'products' LIMIT 1;
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id, 'Annapurna Rice & Grains', 'Annapurna Rice & Grains', v_node_id,
    v_city_id, 'products'::"Tab", 'individual_product'::"ListingType", '9876501004',
    true, true, false, true, 'available'::"Availability",
    'test_seed', 'test_prod_004',
    ST_SetSRID(ST_MakePoint(78.501, 17.382), 4326), NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id, provider_id, display_score, raw_score, trust_tier)
  VALUES (v_trust_id, v_provider_id, 71, 71, 'trusted'::"TrustTier")
  ON CONFLICT (provider_id) DO NOTHING;

  -- Hyderabad Dry Fruits
  SELECT id INTO v_node_id FROM taxonomy_nodes
  WHERE l4 = 'Cashew W240' AND tab::text = 'products' LIMIT 1;
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id, 'Hyderabad Dry Fruits Hub', 'Hyderabad Dry Fruits Hub', v_node_id,
    v_city_id, 'products'::"Tab", 'individual_product'::"ListingType", '9876501005',
    true, true, false, true, 'available'::"Availability",
    'test_seed', 'test_prod_005',
    ST_SetSRID(ST_MakePoint(78.456, 17.398), 4326), NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id, provider_id, display_score, raw_score, trust_tier)
  VALUES (v_trust_id, v_provider_id, 85, 85, 'highly_trusted'::"TrustTier")
  ON CONFLICT (provider_id) DO NOTHING;

  -- Spice Garden
  SELECT id INTO v_node_id FROM taxonomy_nodes
  WHERE l4 = 'Turmeric Powder' AND tab::text = 'products' LIMIT 1;
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id, 'Spice Garden Hyderabad', 'Spice Garden Hyderabad', v_node_id,
    v_city_id, 'products'::"Tab", 'individual_product'::"ListingType", '9876501006',
    true, false, false, true, 'available'::"Availability",
    'test_seed', 'test_prod_006',
    ST_SetSRID(ST_MakePoint(78.488, 17.371), 4326), NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id, provider_id, display_score, raw_score, trust_tier)
  VALUES (v_trust_id, v_provider_id, 38, 38, 'basic'::"TrustTier")
  ON CONFLICT (provider_id) DO NOTHING;

  -- Chicken Corner
  SELECT id INTO v_node_id FROM taxonomy_nodes
  WHERE l4 = 'Chicken (curry cut)' AND tab::text = 'products' LIMIT 1;
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id, 'Chicken Corner Tolichowki', 'Chicken Corner Tolichowki', v_node_id,
    v_city_id, 'products'::"Tab", 'individual_product'::"ListingType", '9876501007',
    true, true, false, true, 'available'::"Availability",
    'test_seed', 'test_prod_007',
    ST_SetSRID(ST_MakePoint(78.475, 17.415), 4326), NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id, provider_id, display_score, raw_score, trust_tier)
  VALUES (v_trust_id, v_provider_id, 55, 55, 'trusted'::"TrustTier")
  ON CONFLICT (provider_id) DO NOTHING;

  -- Fresh Eggs Direct
  SELECT id INTO v_node_id FROM taxonomy_nodes
  WHERE l4 = 'Egg (white, desi)' AND tab::text = 'products' LIMIT 1;
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id, 'Fresh Eggs Direct', 'Fresh Eggs Direct', v_node_id,
    v_city_id, 'products'::"Tab", 'individual_product'::"ListingType", '9876501008',
    true, false, false, true, 'available'::"Availability",
    'test_seed', 'test_prod_008',
    ST_SetSRID(ST_MakePoint(78.495, 17.388), 4326), NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id, provider_id, display_score, raw_score, trust_tier)
  VALUES (v_trust_id, v_provider_id, 29, 29, 'unverified'::"TrustTier")
  ON CONFLICT (provider_id) DO NOTHING;

  -- Naturals Coconut Water
  SELECT id INTO v_node_id FROM taxonomy_nodes
  WHERE l4 = 'Coconut Water (Naariyal Pani)' AND tab::text = 'products' LIMIT 1;
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id, 'Naturals Coconut Water', 'Naturals Coconut Water', v_node_id,
    v_city_id, 'products'::"Tab", 'individual_product'::"ListingType", '9876501009',
    true, true, false, true, 'available'::"Availability",
    'test_seed', 'test_prod_009',
    ST_SetSRID(ST_MakePoint(78.472, 17.362), 4326), NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id, provider_id, display_score, raw_score, trust_tier)
  VALUES (v_trust_id, v_provider_id, 61, 61, 'trusted'::"TrustTier")
  ON CONFLICT (provider_id) DO NOTHING;

  -- Maa Ki Dal
  SELECT id INTO v_node_id FROM taxonomy_nodes
  WHERE l4 = 'Toor Dal' AND tab::text = 'products' LIMIT 1;
  v_provider_id := gen_random_uuid();
  v_trust_id    := gen_random_uuid();
  INSERT INTO provider_profiles(
    id, display_name, business_name, taxonomy_node_id,
    city_id, tab, listing_type, phone,
    is_active, is_claimed, is_scrape_record,
    is_phone_verified, availability,
    scrape_source, scrape_external_id,
    geo_point, created_at, updated_at
  ) VALUES (
    v_provider_id, 'Maa Ki Dal & Pulses', 'Maa Ki Dal & Pulses', v_node_id,
    v_city_id, 'products'::"Tab", 'individual_product'::"ListingType", '9876501010',
    true, true, false, true, 'available'::"Availability",
    'test_seed', 'test_prod_010',
    ST_SetSRID(ST_MakePoint(78.483, 17.392), 4326), NOW(), NOW()
  ) ON CONFLICT (scrape_source, scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id, provider_id, display_score, raw_score, trust_tier)
  VALUES (v_trust_id, v_provider_id, 74, 74, 'trusted'::"TrustTier")
  ON CONFLICT (provider_id) DO NOTHING;

