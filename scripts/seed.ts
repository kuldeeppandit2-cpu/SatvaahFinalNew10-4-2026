/**
 * scripts/seed.ts
 * SatvAAh — Reference data seed
 * Run from Mac: DATABASE_URL="postgresql://satvaaah_user:Kkp1234%23%23@localhost:5432/satvaaah?schema=public" npx tsx scripts/seed.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['warn', 'error'] });

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  console.log('🌱 SatvAAh seed starting...\n');

  // ── 1. Hyderabad city ──────────────────────────────────────────────
  console.log('Cities...');
  const hyd = await prisma.city.upsert({
    where:  { slug: 'hyderabad' },
    update: {},
    create: {
      name:          'Hyderabad',
      state:         'Telangana',
      slug:          'hyderabad',
      country_code:  'IND',
      is_active:     true,
      is_launch_city: true,
    },
  });
  console.log(`  ✅ City: ${hyd.name}`);

  // ── 2. Areas ───────────────────────────────────────────────────────
  console.log('Areas...');
  const areaNames = [
    'Banjara Hills', 'Jubilee Hills', 'Gachibowli', 'Kondapur', 'Madhapur',
    'Hitech City', 'Begumpet', 'Secunderabad', 'Ameerpet', 'Kukatpally',
    'KPHB Colony', 'Miyapur', 'Kompally', 'Uppal', 'L B Nagar',
    'Dilsukhnagar', 'Mehdipatnam', 'Tolichowki', 'Manikonda', 'Nanakramguda',
    'Somajiguda', 'Panjagutta', 'Himayatnagar', 'Narayanguda', 'Abids',
    'Charminar', 'Malakpet', 'Santoshnagar', 'Saroornagar', 'Hayathnagar',
  ];
  for (const aname of areaNames) {
    const aslug = slugify(aname);
    await prisma.area.upsert({
      where:  { city_id_slug: { city_id: hyd.id, slug: aslug } },
      update: {},
      create: { city_id: hyd.id, name: aname, slug: aslug },
    });
  }
  console.log(`  ✅ ${areaNames.length} areas`);

  // ── 3. Taxonomy nodes ──────────────────────────────────────────────
  console.log('Taxonomy nodes...');
  const nodes = [
    { l1: 'Home Repair', l2: 'Plumbing',   l3: 'Pipe Repair',   l4: 'Leakage Fix',        tab: 'services' as const, listing_type: 'individual_service' as const },
    { l1: 'Home Repair', l2: 'Plumbing',   l3: 'Pipe Repair',   l4: 'Pipe Replacement',   tab: 'services' as const, listing_type: 'individual_service' as const },
    { l1: 'Home Repair', l2: 'Electrical', l3: 'Wiring',        l4: 'Home Wiring',        tab: 'services' as const, listing_type: 'individual_service' as const },
    { l1: 'Home Repair', l2: 'Electrical', l3: 'Appliances',    l4: 'AC Service',         tab: 'services' as const, listing_type: 'individual_service' as const },
    { l1: 'Cleaning',    l2: 'Home',       l3: 'Deep Clean',    l4: 'Full Home',           tab: 'services' as const, listing_type: 'individual_service' as const },
    { l1: 'Home Repair', l2: 'Painting',   l3: 'Interior',      l4: 'Room Painting',      tab: 'services' as const, listing_type: 'individual_service' as const },
    { l1: 'Daily Needs', l2: 'Milk',       l3: 'Home Delivery', l4: 'Cow Milk',           tab: 'products' as const, listing_type: 'individual_product' as const },
    { l1: 'Daily Needs', l2: 'Vegetables', l3: 'Home Delivery', l4: 'Fresh Vegetables',   tab: 'products' as const, listing_type: 'individual_product' as const },
    { l1: 'Healthcare',  l2: 'Doctors',    l3: 'Cardiologist',  l4: 'Cardiologist',       tab: 'expertise' as const, listing_type: 'expertise' as const },
    { l1: 'Healthcare',  l2: 'Doctors',    l3: 'Dermatologist', l4: 'Dermatologist',      tab: 'expertise' as const, listing_type: 'expertise' as const },
    { l1: 'Food',        l2: 'Restaurant', l3: 'Biryani',       l4: 'Hyderabadi Biryani', tab: 'establishments' as const, listing_type: 'establishment' as const },
    { l1: 'Food',        l2: 'Bakery',     l3: 'Cakes',         l4: 'Custom Cakes',       tab: 'establishments' as const, listing_type: 'establishment' as const },
  ];

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const slug = slugify([n.l1, n.l2, n.l3, n.l4].filter(Boolean).join('-'));
    await prisma.taxonomyNode.upsert({
      where:  { slug },
      update: {},
      create: {
        l1:           n.l1,
        l2:           n.l2,
        l3:           n.l3,
        l4:           n.l4,
        slug,
        display_name: n.l4 ?? n.l3 ?? n.l2 ?? n.l1,
        tab:          n.tab,
        listing_type: n.listing_type,
        sort_order:   i,
        is_active:    true,
      },
    });
  }
  console.log(`  ✅ ${nodes.length} taxonomy nodes`);

  // ── 4. Subscription plans ──────────────────────────────────────────
  console.log('Subscription plans...');
  const plans = [
    { user_type: 'consumer', tier: 'free'   as const, display_name: 'Consumer Free',   price_paise: 0,     leads_allocated: 10, validity_days: 30,  description: 'Free plan for consumers',   features: {} },
    { user_type: 'consumer', tier: 'silver' as const, display_name: 'Consumer Silver',  price_paise: 9900,  leads_allocated: 25, validity_days: 30,  description: 'Silver plan for consumers',  features: { slot_booking: false, priority_search: true } },
    { user_type: 'consumer', tier: 'gold'   as const, display_name: 'Consumer Gold',    price_paise: 19900, leads_allocated: 60, validity_days: 30,  description: 'Gold plan for consumers',    features: { slot_booking: true, priority_search: true } },
    { user_type: 'provider', tier: 'free'   as const, display_name: 'Provider Free',   price_paise: 0,     leads_allocated: 5,  validity_days: 30,  description: 'Free plan for providers',    features: {} },
    { user_type: 'provider', tier: 'silver' as const, display_name: 'Provider Silver',  price_paise: 9900,  leads_allocated: 30, validity_days: 30,  description: 'Silver plan for providers',  features: { priority_search: true } },
    { user_type: 'provider', tier: 'gold'   as const, display_name: 'Provider Gold',    price_paise: 19900, leads_allocated: 100, validity_days: 30, description: 'Gold plan for providers',    features: { priority_search: true, certificate_eligible: true } },
  ];

  for (const p of plans) {
    await prisma.subscriptionPlan.upsert({
      where:  { user_type_tier: { user_type: p.user_type, tier: p.tier } },
      update: {},
      create: p,
    });
  }
  console.log(`  ✅ ${plans.length} subscription plans`);

  // ── 5. Trust score config ──────────────────────────────────────────
  console.log('Trust score config...');
  const trustConfigs = [
    { listing_type: 'individual_service' as const, signal_name: 'phone_otp_verified',    max_pts: 10, raw_max_total: 100, description: 'Phone OTP verified' },
    { listing_type: 'individual_service' as const, signal_name: 'aadhaar_verified',       max_pts: 30, raw_max_total: 100, description: 'Aadhaar verified via DigiLocker' },
    { listing_type: 'individual_service' as const, signal_name: 'geo_verified',           max_pts: 20, raw_max_total: 100, description: 'Location verified' },
    { listing_type: 'individual_service' as const, signal_name: 'profile_photo',          max_pts: 5,  raw_max_total: 100, description: 'Profile photo uploaded' },
    { listing_type: 'individual_service' as const, signal_name: 'credential_verified',    max_pts: 20, raw_max_total: 100, description: 'Professional credential verified' },
    { listing_type: 'expertise' as const,          signal_name: 'phone_otp_verified',    max_pts: 5,  raw_max_total: 100, description: 'Phone OTP verified' },
    { listing_type: 'expertise' as const,          signal_name: 'aadhaar_verified',       max_pts: 20, raw_max_total: 100, description: 'Aadhaar verified via DigiLocker' },
    { listing_type: 'expertise' as const,          signal_name: 'credential_verified',    max_pts: 40, raw_max_total: 100, description: 'Professional licence verified' },
  ];

  for (const tc of trustConfigs) {
    await prisma.trustScoreConfig.upsert({
      where:  { listing_type_signal_name: { listing_type: tc.listing_type, signal_name: tc.signal_name } },
      update: {},
      create: tc,
    });
  }
  console.log(`  ✅ ${trustConfigs.length} trust_score_config rows`);

  console.log('\n✅ Seed complete!\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
