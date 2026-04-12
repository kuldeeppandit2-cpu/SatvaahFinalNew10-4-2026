/**
 * ProviderSubscriptionScreen.tsx
 * Phase 24 — Provider Verification
 *
 * Bronze ₹2,000/yr | Silver ₹3,000/yr | Gold ₹4,000/yr | Platinum ₹5,000/yr
 * "₹0 commission on every lead. Legal commitment in MOA/AOA."
 *
 * Payments via Razorpay (services/payment port 3007).
 * All amounts stored in PAISE. Never float. Never rupees in DB.
 * Idempotency key on every order creation.
 * Verify Razorpay webhook HMAC-SHA256 before processing (done server-side).
 *
 * V015 subscription_plans: plan_id, user_type, tier, price_paise,
 *       leads_allocated, features JSONB
 * V015 subscription_records: user_id, plan_id, status, razorpay_order_id,
 *       idempotency_key
 */

import React, { useEffect, useRef, useState } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Alert,
  ActivityIndicator,
  StatusBar,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import RazorpayCheckout from '../../__stubs__/razorpay';
import { useAuthStore } from '../../stores/auth.store';
import { useProviderStore } from '../../stores/provider.store';
import { apiClient } from '../../api/client';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { ProviderStackParamList } from '../../navigation/ProviderStack';
import { SubscriptionTier } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type NavProp = NativeStackNavigationProp<ProviderStackParamList, 'ProviderSubscription'>;

interface SubscriptionPlan {
  plan_id: string;
  tier: SubscriptionTier;
  pricePaise: number; // ALWAYS PAISE
  leadsAllocated: number;
  features: string[];
  badge_color: string;
  badge_icon: string;
  is_popular: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// FALLBACK_PLANS: Rule #20 — these seed values are overridden on mount by
// GET /api/v1/subscriptions/plans?user_type=provider (V015 subscription_plans table).
// If API fails, these paise values are shown so UI never breaks at launch.
// SubscriptionTier enum: free | silver | gold ONLY (V036 migration — bronze/platinum do not exist)
const FALLBACK_PLANS: SubscriptionPlan[] = [
  {
    plan_id: 'plan_silver_annual',
    tier: 'silver',
    pricePaise: 300000, // ₹3,000 in paise
    leadsAllocated: 40,
    badge_color: '#A8A9AD',
    badge_icon: '🥈',
    is_popular: false,
    features: [
      'Profile visible on SatvAAh',
      '40 leads per year',
      'Full analytics dashboard',
      'AI narration (weekly insights)',
      'Search priority boost',
      '₹0 commission. Always.',
    ],
  },
  {
    plan_id: 'plan_gold_annual',
    tier: 'gold',
    pricePaise: 400000, // ₹4,000 in paise
    leadsAllocated: 80,
    badge_color: '#C8691A',
    badge_icon: '🥇',
    is_popular: true,
    features: [
      'Everything in Silver',
      '80 leads per year',
      'Top search placement',
      'Priority credential review',
      'Dedicated customer success',
      '₹0 commission. Always.',
    ],
  },
];

const formatRupees = (paise: number): string => {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN')}`;
};

// ─── Plan card component ──────────────────────────────────────────────────────

interface PlanCardProps {
  plan: SubscriptionPlan;
  isCurrentTier: boolean;
  onSelect: (plan: SubscriptionPlan) => void;
  loading: boolean;
}

const PlanCard: React.FC<PlanCardProps> = ({ plan, isCurrentTier, onSelect, loading }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      friction: 8,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          cardStyles.card,
          plan.is_popular && cardStyles.cardPopular,
          isCurrentTier && cardStyles.cardCurrent,
        ]}
        onPress={() => !isCurrentTier && onSelect(plan)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.95}
        disabled={isCurrentTier || loading}
      >
        {plan.is_popular && (
          <View style={cardStyles.popularBadge}>
            <Text style={cardStyles.popularBadgeText}>Most Popular</Text>
          </View>
        )}
        {isCurrentTier && (
          <View style={[cardStyles.popularBadge, { backgroundColor: COLORS.verdigris }]}>
            <Text style={cardStyles.popularBadgeText}>Current Plan</Text>
          </View>
        )}

        {/* Header */}
        <View style={cardStyles.header}>
          <View style={cardStyles.tierInfo}>
            <Text style={cardStyles.tierIcon}>{plan.badge_icon}</Text>
            <Text style={[cardStyles.tierName, { color: plan.badge_color }]}>
              {plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)}
            </Text>
          </View>
          <View style={cardStyles.priceInfo}>
            <Text style={cardStyles.price}>{formatRupees(plan.pricePaise)}</Text>
            <Text style={cardStyles.priceUnit}>/year</Text>
          </View>
        </View>

        {/* Leads */}
        <View style={cardStyles.leadsRow}>
          <Text style={cardStyles.leadsNum}>{plan.leadsAllocated}</Text>
          <Text style={cardStyles.leadsLabel}>leads/year</Text>
        </View>

        {/* Features */}
        <View style={cardStyles.features}>
          {plan.features.map((f, i) => (
            <View key={i} style={cardStyles.featureRow}>
              <Text
                style={[
                  cardStyles.featureCheck,
                  f.includes('₹0 commission') && { color: COLORS.saffron },
                ]}
              >
                {f.includes('₹0 commission') ? '★' : '✓'}
              </Text>
              <Text
                style={[
                  cardStyles.featureText,
                  f.includes('₹0 commission') && cardStyles.featureTextHighlight,
                ]}
              >
                {f}
              </Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        {!isCurrentTier && (
          <View
            style={[cardStyles.selectBtn, { backgroundColor: plan.badge_color + '18' }]}
          >
            <Text style={[cardStyles.selectBtnText, { color: plan.badge_color }]}>
              {loading ? 'Processing…' : `Get ${plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)}`}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1.5,
    borderColor: '#F0F0F5',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },
  cardPopular: {
    borderColor: COLORS.saffron,
    shadowColor: COLORS.saffron,
    shadowOpacity: 0.15,
  },
  cardCurrent: {
    borderColor: COLORS.verdigris,
  },
  popularBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: COLORS.saffron,
    borderRadius: 12,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  popularBadgeText: {
    fontFamily: FONTS.semiBold,
    fontSize: 11,
    color: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  tierInfo: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  tierIcon: { fontSize: 24 },
  tierName: { fontFamily: FONTS.bold, fontSize: 20 },
  priceInfo: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  price: {
    fontFamily: FONTS.bold,
    fontSize: 26,
    color: COLORS.deepInk,
  },
  priceUnit: {
    fontFamily: FONTS.regular,
    fontSize: 14,
    color: '#8888A0',
  },
  leadsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: SPACING.xs,
    marginBottom: SPACING.md,
  },
  leadsNum: {
    fontFamily: FONTS.bold,
    fontSize: 20,
    color: COLORS.verdigris,
  },
  leadsLabel: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: '#8888A0',
  },
  features: { gap: SPACING.xs, marginBottom: SPACING.md },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.xs,
  },
  featureCheck: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: COLORS.verdigris,
    width: 18,
    flexShrink: 0,
  },
  featureText: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: '#5A5A6E',
    flex: 1,
    lineHeight: 19,
  },
  featureTextHighlight: {
    fontFamily: FONTS.bold,
    color: COLORS.saffron,
  },
  selectBtn: {
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  selectBtnText: {
    fontFamily: FONTS.semiBold,
    fontSize: 15,
  },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export const ProviderSubscriptionScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();
  const { accessToken, user } = useAuthStore();
  const { subscriptionTier, refreshProfile } = useProviderStore();

  const [plans,       setPlans]       = useState<SubscriptionPlan[]>(FALLBACK_PLANS);
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commissionFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(commissionFade, {
      toValue: 1,
      duration: 700,
      useNativeDriver: true,
    }).start();
  }, []);

  // Fetch live plans — overrides FALLBACK_PLANS (Rule #20: nothing hardcoded)
  useEffect(() => {
    apiClient
      .get('/api/v1/subscriptions/plans', { params: { user_type: 'provider' } })
      .then((res) => {
        if (res.data?.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
          setPlans(res.data.data as SubscriptionPlan[]);
        }
      })
      .catch(() => {}); // silent — FALLBACK_PLANS remain
  }, []);

  const handleSelectPlan = async (plan: SubscriptionPlan) => {
    setLoadingPlanId(plan.id);
    setError(null);

    try {
      // 1. Create Razorpay order via services/payment
      const orderRes = await apiClient.post(
        '/api/v1/subscriptions/purchase',
        {
          plan_id: plan.id,
          // Idempotency key generated server-side, returned in response
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const {
        razorpay_order_id,
        amount_paise,
        razorpay_key_id,
        provider_name,
        provider_phone,
      } = orderRes.data;

      // 2. Open Razorpay checkout
      const options = {
        description: `SatvAAh ${plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)} — Annual Subscription`,
        image: 'https://satvaaah.com/logo.png',
        currency: 'INR',
        key: razorpay_key_id,
        amount: amount_paise, // in paise
        order_id: razorpay_order_id,
        name: 'SatvAAh Technologies',
        prefill: {
          name: provider_name,
          contact: provider_phone,
        },
        theme: { color: COLORS.verdigris },
        notes: { plan_id: plan.id },
      };

      const paymentData = await RazorpayCheckout.open(options);

      // 3. Confirm payment server-side (HMAC verified in webhook — idempotent)
      await apiClient.post(
        '/api/v1/subscriptions/confirm',
        {
          razorpay_order_id: paymentData.razorpay_order_id,
          razorpay_payment_id: paymentData.razorpay_payment_id,
          razorpay_signature: paymentData.razorpay_signature,
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      await refreshProfile();

      Alert.alert(
        '🎉 Subscription activated!',
        `You're now on SatvAAh ${plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)}. Your ${plan.leadsAllocated} leads are ready.`,
        [{ text: 'Great!', onPress: () => navigation.goBack() }]
      );
    } catch (err: any) {
      // User cancelled Razorpay checkout
      if (err?.code === 'PAYMENT_CANCELLED') {
        // Silently ignore cancellation
        return;
      }
      const msg =
        err?.response?.data?.message ||
        'Subscription failed. Please try again or contact support@satvaaah.com';
      setError(msg);
      Alert.alert('Payment failed', msg);
    } finally {
      setLoadingPlanId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.ivory} />
<ScreenHeader title="Subscription" onBack={() => navigation.goBack()} />

      {/* Nav */}
      <View style={styles.navBar}>
        <Text style={styles.navTitle}>Choose your plan</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Zero commission promise */}
        <Animated.View style={[styles.promiseCard, { opacity: commissionFade }]}>
          <View style={styles.promiseIconRow}>
            <Text style={styles.promiseIcon}>⚖️</Text>
            <Text style={styles.promiseIcon}>📜</Text>
          </View>
          <Text style={styles.promiseHeadline}>
            ₹0 commission on every lead.
          </Text>
          <Text style={styles.promiseSubline}>
            Legal commitment in MOA/AOA.
          </Text>
          <Text style={styles.promiseBody}>
            No matter how many leads you accept, SatvAAh takes ₹0 commission.
            Ever. This is not just a policy — it is written into our Memorandum
            of Association and Articles of Association as a founding constraint.
            Your earnings are 100% yours.
          </Text>
        </Animated.View>

        {/* Plans */}
        {plans.map(plan => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isCurrentTier={plan.tier === subscriptionTier}
            onSelect={handleSelectPlan}
            loading={loadingPlanId === plan.id}
          />
        ))}

        {/* FAQ */}
        <View style={styles.faqCard}>
          <Text style={styles.faqTitle}>Common questions</Text>

          {[
            {
              q: 'Can I upgrade later?',
              a: 'Yes. You can upgrade at any time. The price difference is prorated to the day.',
            },
            {
              q: 'What happens when leads run out?',
              a: 'You can purchase additional lead packs at any time from your dashboard.',
            },
            {
              q: 'Is there a refund policy?',
              a: 'Yes. If you request a refund within 7 days of purchase and have used 0 leads, we refund 100%.',
            },
            {
              q: 'How is zero commission guaranteed?',
              a: 'It is written into SatvAAh\'s MOA/AOA as a founding legal constraint. No future leadership can change it without dissolving the partnership.',
            },
          ].map(({ q, a }, i) => (
            <View key={i} style={styles.faqItem}>
              <Text style={styles.faqQ}>{q}</Text>
              <Text style={styles.faqA}>{a}</Text>
            </View>
          ))}
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.ivory },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.ivory,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8EF',
  },
  navBack: { fontFamily: FONTS.semiBold, fontSize: 20, color: COLORS.deepInk },
  navTitle: { fontFamily: FONTS.bold, fontSize: 17, color: COLORS.deepInk },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl * 2,
  },

  // Promise card
  promiseCard: {
    backgroundColor: COLORS.deepInk,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    marginBottom: SPACING.lg,
    alignItems: 'center',
  },
  promiseIconRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  promiseIcon: { fontSize: 28 },
  promiseHeadline: {
    fontFamily: FONTS.bold,
    fontSize: 24,
    color: COLORS.saffron,
    textAlign: 'center',
    marginBottom: 4,
  },
  promiseSubline: {
    fontFamily: FONTS.semiBold,
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  promiseBody: {
    fontFamily: FONTS.regular,
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    lineHeight: 21,
  },

  // FAQ
  faqCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  faqTitle: {
    fontFamily: FONTS.bold,
    fontSize: 16,
    color: COLORS.deepInk,
    marginBottom: SPACING.md,
  },
  faqItem: {
    marginBottom: SPACING.md,
    paddingBottom: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F5',
  },
  faqQ: {
    fontFamily: FONTS.semiBold,
    fontSize: 14,
    color: COLORS.deepInk,
    marginBottom: 4,
  },
  faqA: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: '#5A5A6E',
    lineHeight: 19,
  },

  // Error
  errorBanner: {
    backgroundColor: '#FFF3F3',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  errorText: { fontFamily: FONTS.medium, fontSize: 14, color: '#C0392B' },
});

export default ProviderSubscriptionScreen;
