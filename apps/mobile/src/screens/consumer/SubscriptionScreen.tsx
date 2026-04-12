/**
 * SubscriptionScreen.tsx
 * Consumer subscription plan selection screen.
 *
 * Plans: Free / Bronze Rs49/yr / Silver Rs99/yr / Gold Rs299/yr
 * All prices and lead counts are fetched from GET /api/v1/subscriptions/plans?user_type=consumer
 * NEVER hardcoded — plans come from subscription_plans table.
 *
 * Navigates to RazorpayScreen on plan select (except Free which has no payment).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 ActivityIndicator,
 ScrollView,
 StyleSheet,
 Text,
 TouchableOpacity,
 View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import '../../__stubs__/get-random-values';
import { v4 as uuidv4 } from 'react-native-uuid';

import {
  ActiveSubscription,
  SubscriptionPlan,
  SubscriptionTier,
  fetchMySubscription,
  fetchSubscriptionPlans,
  paiseToRupees,
} from '../../api/subscription.api';

// ─── Brand tokens ──────────────────────────────────────────────────────────────
const SAFFRON = '#C8691A';
const DEEP_INK = '#1C1C2E';
const IVORY = '#FAF7F0';
const VERDIGRIS = '#2E7D72';
const LIGHT_VERDIGRIS = '#6BA89E';
const WARM_SAND = '#F0E4CC';

// ─── Tier config (cosmetic only — never prices or leads) ───────────────────────
const TIER_CONFIG: Record<
  SubscriptionTier,
  { color: string; badge: string; emoji: string; popular?: boolean }
> = {
  free:   { color: '#1C1C2E', badge: 'Free',   emoji: '🌱' },
  silver: { color: LIGHT_VERDIGRIS, badge: 'Silver', emoji: '🥈', popular: true },
  gold:   { color: SAFFRON, badge: 'Gold', emoji: '🥇' },
};

// ─── Navigation types ──────────────────────────────────────────────────────────
type RootStackParamList = {
  Subscription: undefined;
  Razorpay: {
    plan: SubscriptionPlan;
    idempotency_key: string;
  };
};
type Props = NativeStackScreenProps<RootStackParamList, 'ConsumerSubscription'>;

// ─── Plan card ─────────────────────────────────────────────────────────────────
interface PlanCardProps {
  plan: SubscriptionPlan;
  isCurrentTier: boolean;
  onSelect: (plan: SubscriptionPlan) => void;
}

function PlanCard({ plan, isCurrentTier, onSelect }: PlanCardProps) {
  const cfg = TIER_CONFIG[plan.tier];
  const isFree = plan.tier === 'free';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F0' }} edges={['top']}>
    <ScreenHeader title="My Subscription" onBack={() => navigation.goBack()} />
    <View style={[styles.planCard, isCurrentTier && styles.planCardActive]}>
      {/* Popular badge */}
      {cfg.popular && (
        <View style={styles.popularBadge}>
          <Text style={styles.popularText}>Most Popular</Text>
        </View>
      )}

      {/* Tier header */}
      <View style={styles.planHeader}>
        <Text style={styles.planEmoji}>{cfg.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.planTierName, { color: cfg.color }]}>{plan.displayName}</Text>
          {plan.tagline ? (
            <Text style={styles.planTagline}>{plan.tagline}</Text>
          ) : null}
        </View>
        {/* Price */}
        <View style={styles.priceBlock}>
          {isFree ? (
            <Text style={[styles.planPrice, { color: cfg.color }]}>Free</Text>
          ) : (
            <>
              <Text style={[styles.planPrice, { color: cfg.color }]}>
                {paiseToRupees(plan.pricePaise)}
              </Text>
              <Text style={styles.planPricePer}>/year</Text>
            </>
          )}
        </View>
      </View>

      {/* Features */}
      <View style={styles.featureList}>
        <FeatureRow
          label={
            plan.leadsAllocated === null
              ? 'Unlimited leads'
              : `${plan.leadsAllocated} leads/month`
          }
          included
        />
        <FeatureRow label="Saved providers" included={plan.features.saved_providers} />
        <FeatureRow label="Priority search results" included={plan.features.priority_search} />
        <FeatureRow label="Advanced filters" included={plan.features.advanced_filters} />
        <FeatureRow label="Slot booking (Gold)" included={plan.features.slot_booking} />
        <FeatureRow label="Lead rollover" included={plan.features.lead_rollover} />
      </View>

      {/* CTA */}
      {isCurrentTier ? (
        <View style={[styles.ctaBtn, styles.ctaActive]}>
          <Text style={styles.ctaTextActive}>✓ Current Plan</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.ctaBtn, { backgroundColor: isFree ? '#6B6560' : cfg.color }]}
          onPress={() => onSelect(plan)}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>{isFree ? 'Downgrade to Free' : `Get ${plan.displayName}`}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function FeatureRow({ label, included }: { label: string; included: boolean }) {
  return (
    <View style={styles.featureRow}>
      <Text style={{ color: included ? VERDIGRIS : '#C5C5C5', fontSize: 15 }}>
        {included ? '✓' : '✗'}
      </Text>
      <Text style={[styles.featureLabel, !included && styles.featureLabelDisabled]}>
        {label}
      </Text>
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────
export default function SubscriptionScreen({
  navigation }: Props) {
  const insets = useSafeAreaInsets();

  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [currentSub, setCurrentSub] = useState<ActiveSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Load plans + current subscription ──
  useEffect(() => {
    (async () => {
      try {
        const [plansData, subData] = await Promise.all([
          fetchSubscriptionPlans('consumer'),
          fetchMySubscription(),
        ]);
        // Sort: free < silver < gold
        const order: SubscriptionTier[] = ['free', 'silver', 'gold'];
        const sorted = [...plansData].sort(
          (a, b) => order.indexOf(a.tier) - order.indexOf(b.tier),
        );
        setPlans(sorted);
        setCurrentSub(subData);
      } catch {
        setError('Could not load subscription plans. Please check your connection.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Plan selection ──
  const handleSelectPlan = useCallback(
    (plan: SubscriptionPlan) => {
      if (plan.tier === 'free') {
        // Downgrade flow — no payment needed
        // (separate confirm → API call would go here)
        return;
      }
      // Generate idempotency key before navigating — ensures network retries don't double-charge
      const idempotency_key = uuidv4();
      navigation.navigate('Razorpay', { plan, idempotency_key });
    },
    [navigation],
  );

  // ── Render ──
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: IVORY }]}>
        <ActivityIndicator size="large" color={SAFFRON} />
        <Text style={styles.loadingText}>Loading plans…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: IVORY, paddingHorizontal: 32 }]}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: IVORY }}
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      <TouchableOpacity onPress={() => navigation.goBack()} style={{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingVertical:12}}>
        <Text style={{fontSize:16,color:'#C8691A',fontFamily:'PlusJakartaSans-SemiBold'}}>← Back</Text>
      </TouchableOpacity>

      {/* ── Header ── */}
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>SatvAAh Plans</Text>
        <Text style={styles.heroSubtitle}>
          Connect with trusted local providers.{'\n'}Zero commission. Always.
        </Text>

        {/* Trust differentiator callout */}
        <View style={styles.differentiator}>
          <Text style={styles.differentiatorText}>
            💡 Other platforms take 15–30%.{'\n'}
            <Text style={{ fontFamily: 'PlusJakartaSans-Bold', color: VERDIGRIS }}>
              We take 0%.
            </Text>
          </Text>
        </View>
      </View>

      {/* ── Current plan indicator ── */}
      {currentSub && (
        <View style={styles.currentPlanBanner}>
          <Text style={styles.currentPlanText}>
            Current plan:{' '}
            <Text style={{ fontFamily: 'PlusJakartaSans-Bold', color: SAFFRON }}>
              {currentSub.tier.charAt(0).toUpperCase() + currentSub.tier.slice(1)}
            </Text>
            {'  '}·{'  '}
            {currentSub.leads_remaining} leads remaining
          </Text>
        </View>
      )}

      {/* ── Plan cards ── */}
      {plans.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          isCurrentTier={currentSub?.tier === plan.tier}
          onSelect={handleSelectPlan}
        />
      ))}

      {/* ── Footer ── */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          All plans are annual. Leads refresh every month. Unused leads do not roll over unless
          your plan includes lead rollover.
        </Text>
        <Text style={[styles.footerText, { marginTop: 8 }]}>
          Payments are processed securely via Razorpay. SatvAAh never stores your card details.
        </Text>
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, backgroundColor: IVORY },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9E9E9E',
  },
  errorText: {
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    textAlign: 'center',
    lineHeight: 22,
  },

  hero: { marginBottom: 20, alignItems: 'center' },
  heroTitle: {
    fontSize: 26,
    fontFamily: 'PlusJakartaSans-Bold',
    color: DEEP_INK,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  differentiator: {
    backgroundColor: '#EFF8F7',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    width: '100%',
    borderLeftWidth: 3,
    borderLeftColor: VERDIGRIS,
  },
  differentiatorText: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: DEEP_INK,
    textAlign: 'center',
    lineHeight: 22,
  },

  currentPlanBanner: {
    backgroundColor: WARM_SAND,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  currentPlanText: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: DEEP_INK,
  },

  planCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
    borderWidth: 1,
    borderColor: 'transparent',
    position: 'relative',
    overflow: 'visible',
  },
  planCardActive: {
    borderColor: SAFFRON,
    borderWidth: 2,
  },

  popularBadge: {
    position: 'absolute',
    top: -12,
    right: 20,
    backgroundColor: SAFFRON,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  popularText: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Bold',
    color: '#fff',
  },

  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  planEmoji: { fontSize: 30 },
  planTierName: {
    fontSize: 18,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  planTagline: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9E9E9E',
    marginTop: 2,
  },
  priceBlock: { alignItems: 'flex-end' },
  planPrice: {
    fontSize: 22,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  planPricePer: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9E9E9E',
  },

  featureList: { marginBottom: 20, gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureLabel: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: DEEP_INK,
  },
  featureLabelDisabled: { color: '#C5C5C5' },

  ctaBtn: {
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaActive: { backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: VERDIGRIS },
  ctaText: { fontSize: 15, fontFamily: 'PlusJakartaSans-Bold', color: '#fff' },
  ctaTextActive: { fontSize: 15, fontFamily: 'PlusJakartaSans-SemiBold', color: VERDIGRIS },

  footer: {
    marginTop: 8,
    paddingHorizontal: 4,
  },
  footerText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9E9E9E',
    textAlign: 'center',
    lineHeight: 18,
  },
});
