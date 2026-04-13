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
  -- Wipe previous test-seed data so re-runs are fully idempotent
  -- trust_scores must be deleted first (FK child), then provider_profiles (FK parent)
  DELETE FROM trust_scores
    WHERE provider_id IN (
      SELECT id FROM provider_profiles WHERE scrape_source = 'test_seed'
    );
  DELETE FROM provider_profiles WHERE scrape_source = 'test_seed';
  RAISE NOTICE 'Cleared previous test_seed providers';

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



  -- ── Products tab providers ─────────────────────────────────────────────────

  -- A2 Cow Milk providers (5 total)
  SELECT id INTO v_node_id FROM taxonomy_nodes WHERE l4 = 'A2 Cow Milk' AND tab::text = 'products' LIMIT 1;
  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Lakshmi Dairy Fresh','Lakshmi Dairy Fresh',v_node_id,v_city_id,'products'::"Tab",'individual_product'::"ListingType",'9876501001',true,true,false,true,'available'::"Availability",'test_seed','test_prod_001',ST_SetSRID(ST_MakePoint(78.477,17.395),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,78,78,'trusted'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Gir Cow Dairy Hyderabad','Gir Cow Dairy Hyderabad',v_node_id,v_city_id,'products'::"Tab",'individual_product'::"ListingType",'9876505001',true,true,false,true,'available'::"Availability",'test_seed','test_a2_002',ST_SetSRID(ST_MakePoint(78.474,17.399),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,69,69,'trusted'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Pure A2 Milk Delivery','Pure A2 Milk Delivery',v_node_id,v_city_id,'products'::"Tab",'individual_product'::"ListingType",'9876505002',true,false,false,true,'available'::"Availability",'test_seed','test_a2_003',ST_SetSRID(ST_MakePoint(78.490,17.376),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,41,41,'basic'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Organic Farm Milk','Organic Farm Milk',v_node_id,v_city_id,'products'::"Tab",'individual_product'::"ListingType",'9876505003',true,true,false,true,'available'::"Availability",'test_seed','test_a2_004',ST_SetSRID(ST_MakePoint(78.465,17.407),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,77,77,'trusted'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Desi Cow Milk Co.','Desi Cow Milk Co.',v_node_id,v_city_id,'products'::"Tab",'individual_product'::"ListingType",'9876505004',true,true,false,true,'available'::"Availability",'test_seed','test_a2_005',ST_SetSRID(ST_MakePoint(78.497,17.384),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,88,88,'highly_trusted'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  -- Spinach (Palak)
  SELECT id INTO v_node_id FROM taxonomy_nodes WHERE l4 = 'Spinach (Palak)' AND tab::text = 'products' LIMIT 1;
  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Krishna Fresh Vegetables','Krishna Fresh Vegetables',v_node_id,v_city_id,'products'::"Tab",'individual_product'::"ListingType",'9876501003',true,false,false,true,'available'::"Availability",'test_seed','test_prod_003',ST_SetSRID(ST_MakePoint(78.468,17.408),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,42,42,'basic'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  -- Pipe Fitting & Repair (5 providers)
  SELECT id INTO v_node_id FROM taxonomy_nodes WHERE l4 = 'Pipe Fitting & Repair' AND tab::text = 'services' LIMIT 1;
  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Suresh Plumbing Works','Suresh Plumbing Works',v_node_id,v_city_id,'services'::"Tab",'individual_service'::"ListingType",'9876502001',true,true,false,true,'available'::"Availability",'test_seed','test_svc_s02',ST_SetSRID(ST_MakePoint(78.481,17.391),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,55,55,'trusted'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Mahesh Pipe Services','Mahesh Pipe Services',v_node_id,v_city_id,'services'::"Tab",'individual_service'::"ListingType",'9876502002',true,false,false,true,'available'::"Availability",'test_seed','test_svc_s03',ST_SetSRID(ST_MakePoint(78.471,17.401),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,38,38,'basic'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Ramesh Plumbing Hyderabad','Ramesh Plumbing Hyderabad',v_node_id,v_city_id,'services'::"Tab",'individual_service'::"ListingType",'9876502003',true,true,false,true,'available'::"Availability",'test_seed','test_svc_s04',ST_SetSRID(ST_MakePoint(78.486,17.378),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,67,67,'trusted'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Kumar Water Solutions','Kumar Water Solutions',v_node_id,v_city_id,'services'::"Tab",'individual_service'::"ListingType",'9876502004',true,false,false,true,'available'::"Availability",'test_seed','test_svc_s05',ST_SetSRID(ST_MakePoint(78.498,17.393),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,29,29,'unverified'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  -- General Cardiologist (5 providers)
  SELECT id INTO v_node_id FROM taxonomy_nodes WHERE l4 = 'General Cardiologist' AND tab::text = 'expertise' LIMIT 1;
  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Dr. Venkat Rao Cardiology','Dr. Venkat Rao Cardiology',v_node_id,v_city_id,'expertise'::"Tab",'individual_expertise'::"ListingType",'9876503001',true,true,false,true,'available'::"Availability",'test_seed','test_exp_e02',ST_SetSRID(ST_MakePoint(78.479,17.389),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,82,82,'highly_trusted'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Dr. Priya Heart Clinic','Dr. Priya Heart Clinic',v_node_id,v_city_id,'expertise'::"Tab",'individual_expertise'::"ListingType",'9876503002',true,true,false,true,'available'::"Availability",'test_seed','test_exp_e03',ST_SetSRID(ST_MakePoint(78.494,17.372),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,75,75,'trusted'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Apollo Heart Specialist','Apollo Heart Specialist',v_node_id,v_city_id,'expertise'::"Tab",'individual_expertise'::"ListingType",'9876503003',true,false,false,true,'available'::"Availability",'test_seed','test_exp_e04',ST_SetSRID(ST_MakePoint(78.462,17.404),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,44,44,'basic'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Dr. Anjali Cardiac Care','Dr. Anjali Cardiac Care',v_node_id,v_city_id,'expertise'::"Tab",'individual_expertise'::"ListingType",'9876503004',true,true,false,true,'available'::"Availability",'test_seed','test_exp_e05',ST_SetSRID(ST_MakePoint(78.489,17.368),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,61,61,'trusted'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  -- Kirana Store (5 providers)
  SELECT id INTO v_node_id FROM taxonomy_nodes WHERE l4 = 'Kirana Store — Full Range Home Delivery' AND tab::text = 'establishments' LIMIT 1;
  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Srinivas Kirana Store','Srinivas Kirana Store',v_node_id,v_city_id,'establishments'::"Tab",'establishment'::"ListingType",'9876504001',true,true,false,true,'available'::"Availability",'test_seed','test_est_e02',ST_SetSRID(ST_MakePoint(78.483,17.387),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,58,58,'trusted'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Laxmi General Store','Laxmi General Store',v_node_id,v_city_id,'establishments'::"Tab",'establishment'::"ListingType",'9876504002',true,false,false,true,'available'::"Availability",'test_seed','test_est_e03',ST_SetSRID(ST_MakePoint(78.475,17.396),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,35,35,'basic'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Ganesh Provisions','Ganesh Provisions',v_node_id,v_city_id,'establishments'::"Tab",'establishment'::"ListingType",'9876504003',true,true,false,true,'available'::"Availability",'test_seed','test_est_e04',ST_SetSRID(ST_MakePoint(78.491,17.381),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,71,71,'trusted'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  v_provider_id := gen_random_uuid(); v_trust_id := gen_random_uuid();
  INSERT INTO provider_profiles(id,display_name,business_name,taxonomy_node_id,city_id,tab,listing_type,phone,is_active,is_claimed,is_scrape_record,is_phone_verified,availability,scrape_source,scrape_external_id,geo_point,created_at,updated_at) VALUES(v_provider_id,'Balaji Mini Supermarket','Balaji Mini Supermarket',v_node_id,v_city_id,'establishments'::"Tab",'establishment'::"ListingType",'9876504004',true,true,false,true,'available'::"Availability",'test_seed','test_est_e05',ST_SetSRID(ST_MakePoint(78.468,17.411),4326),NOW(),NOW()) ON CONFLICT(scrape_source,scrape_external_id) DO NOTHING;
  INSERT INTO trust_scores(id,provider_id,display_score,raw_score,trust_tier) VALUES(v_trust_id,v_provider_id,84,84,'highly_trusted'::"TrustTier") ON CONFLICT(provider_id) DO NOTHING;

  RAISE NOTICE 'Test providers seeded successfully';
END $$;

COMMIT;