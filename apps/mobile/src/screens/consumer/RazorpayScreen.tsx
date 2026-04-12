/**
 * RazorpayScreen.tsx
 * Razorpay payment SDK wrapper for subscription purchase.
 *
 * Flow:
 *  1. POST /api/v1/subscriptions/purchase → razorpay_order_id + amount_paise
 *  2. Open Razorpay checkout (UPI first, then Cards, Net Banking, Wallets, EMI)
 *  3a. Success → POST /api/v1/payments/verify → show Verdigris checkmark + leads added
 *  3b. Failure → show error + retry button
 *  3c. UPI timeout (5 min) → "Your account has not been charged"
 *  3d. Network error during verify → "Activation happens when payment is confirmed"
 *       (webhook handles actual activation: POST /api/v1/payments/webhook/razorpay)
 *
 * RULES:
 *  - Razorpay webhook verifies HMAC-SHA256. Verify endpoint is belt-and-suspenders.
 *  - idempotency_key generated BEFORE navigation to prevent duplicate orders.
 *  - All amounts in paise; display in rupees.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
 ActivityIndicator,
 StyleSheet,
 Text,
 TouchableOpacity,
 View,,
  StatusBar,} from 'react-native';
import RazorpayCheckout from '../../__stubs__/razorpay';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SubscriptionPlan,
  VerifyPaymentResponse,
  createSubscriptionOrder,
  paiseToRupees,
  verifyPayment,
} from '../../api/subscription.api';

// ─── Brand tokens ──────────────────────────────────────────────────────────────
const SAFFRON = '#C8691A';
const DEEP_INK = '#1C1C2E';
const IVORY = '#FAF7F0';
const VERDIGRIS = '#2E7D72';
const TERRACOTTA = '#C0392B';

// ─── Navigation types ──────────────────────────────────────────────────────────
type RootStackParamList = {
  Subscription: undefined;
  Razorpay: {
    plan: SubscriptionPlan;
  };
};
type Props = NativeStackScreenProps<RootStackParamList, 'Razorpay'>;

// ─── Screen states ─────────────────────────────────────────────────────────────
type ScreenState =
  | 'creating_order'    // POST /subscriptions/purchase
  | 'checkout_open'     // Razorpay SDK is open
  | 'verifying'         // POST /payments/verify
  | 'success'
  | 'failure'
  | 'upi_timeout'
  | 'network_error';

// UPI timeout: 5 minutes
const UPI_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Main screen ───────────────────────────────────────────────────────────────
export default function RazorpayScreen({ route, navigation }: Props) {
  const { plan } = route.params;
  const insets = useSafeAreaInsets();

  const [state, setState] = useState<ScreenState>('creating_order');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<VerifyPaymentResponse | null>(null);

  // Track subscription_record_id and order details across async steps
  const orderRef = useRef<{
    razorpayOrderId: string;
    razorpayKeyId: string;
    amountPaise: number;
    subscriptionRecordId: string;
  } | null>(null);

  const upiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      <ScreenHeader title="Checkout" onBack={() => navigation.goBack()} />
      if (upiTimeoutRef.current) clearTimeout(upiTimeoutRef.current);
    };
  }, []);

  // ── Create order + open Razorpay ──
  const initiatePayment = useCallback(async () => {
    setState('creating_order');
    setErrorMessage(null);

    try {
      const orderData = await createSubscriptionOrder({
        planId: plan.id,  // server field is id not planId
      });

      orderRef.current = {
        razorpayOrderId: orderData.razorpayOrderId,
        razorpayKeyId: orderData.razorpayKeyId,
        amountPaise: orderData.amountPaise,
        subscriptionRecordId: orderData.subscriptionRecordId,
      };

      setState('checkout_open');

      // ── Set UPI timeout (5 min) ──
      upiTimeoutRef.current = setTimeout(() => {
        setState('upi_timeout');
      }, UPI_TIMEOUT_MS);

      // ── Open Razorpay SDK ──
      // UPI is listed first — Razorpay shows methods in the order provided.
      const options = {
        description: `SatvAAh ${plan.name} Plan`,
        image: 'https://satvaaah.com/assets/logo-razorpay.png',
        currency: 'INR',
        key: orderData.razorpayKeyId,
        amount: String(orderData.amountPaise), // Razorpay SDK expects string
        orderId: orderData.razorpayOrderId,
        name: 'SatvAAh Technologies',
        prefill: {
          // Populated from user profile in a production implementation
          // Kept minimal to avoid storing PII unnecessarily
        },
        theme: { color: SAFFRON },
        // Payment methods: UPI first (most common in India)
        config: {
          display: {
            blocks: {
              upi: { name: 'UPI', instruments: [{ method: 'upi' }] },
              other: {
                name: 'Other Methods',
                instruments: [
                  { method: 'card' },
                  { method: 'netbanking' },
                  { method: 'wallet' },
                  { method: 'emi' },
                ],
              },
            },
            sequence: ['block.upi', 'block.other'],
            preferences: { show_default_blocks: false },
          },
        },
      };

      let checkoutData: { razorpayPaymentId: string; razorpaySignature: string };
      try {
        checkoutData = await RazorpayCheckout.open(options);
      } catch (err: any) {
        // Clear UPI timeout — checkout closed
        if (upiTimeoutRef.current) clearTimeout(upiTimeoutRef.current);

        // Razorpay error codes: https://razorpay.com/docs/payments/payments/handle-payment-success/#handle-errors
        const code = err?.code;
        const description = err?.description ?? 'Payment was cancelled or failed.';

        if (code === 0) {
          // User dismissed the checkout
          setState('failure');
          setErrorMessage('Payment cancelled. No charge was made.');
        } else {
          setState('failure');
          setErrorMessage(description);
        }
        return;
      }

      // Clear UPI timeout — payment returned before timeout
      if (upiTimeoutRef.current) clearTimeout(upiTimeoutRef.current);

      // ── Verify payment with backend ──
      setState('verifying');
      try {
        const verifyResult = await verifyPayment({
          razorpayOrderId:      orderRef.current!.razorpayOrderId,
          razorpayPaymentId:    checkoutData.razorpayPaymentId,
          razorpaySignature:    checkoutData.razorpaySignature,
          subscriptionRecordId: orderRef.current!.subscriptionRecordId,
        });

        setSuccessResult(verifyResult);
        setState('success');
      } catch (verifyErr: any) {
        // Network error during verify — webhook will handle activation
        // Do NOT show a failure — payment likely went through
        setState('network_error');
      }
    } catch (orderErr: any) {
      const msg =
        orderErr?.response?.data?.error?.message ??
        'Could not initiate payment. Please try again.';
      setState('failure');
      setErrorMessage(msg);
    }
  }, [plan]);

  // ── Auto-initiate on mount ──
  useEffect(() => {
    initiatePayment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // Render states
  // ────────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F0' }} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />

    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>

      {/* ── Creating order ── */}
      {(state === 'creating_order' || state === 'checkout_open' || state === 'verifying') && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={SAFFRON} />
          <Text style={styles.loadingTitle}>
            {state === 'creating_order'
              ? 'Setting up your order…'
              : state === 'verifying'
              ? 'Confirming payment…'
              : 'Opening payment screen…'}
          </Text>
          <Text style={styles.loadingSubtitle}>
            {paiseToRupees(plan.amountPaise)} · {plan.name} Plan
          </Text>
        </View>
      )}

      {/* ── Success ── */}
      {state === 'success' && successResult && (
        <View style={styles.center}>
          <View style={styles.checkmarkCircle}>
            <Text style={styles.checkmark}>✓</Text>
          </View>
          <Text style={styles.successTitle}>Payment Successful!</Text>
          <Text style={styles.successPlan}>{plan.name} Plan Activated</Text>
          <View style={styles.leadsAddedBadge}>
            <Text style={styles.leadsAddedText}>
              Subscription activated successfully
            </Text>
          </View>
          <Text style={styles.validUntil}>
            Valid until{' '}
            {/* Expiry shown on Subscription screen */}
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.navigate('ConsumerSubscription')}
          >
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Failure ── */}
      {state === 'failure' && (
        <View style={styles.center}>
          <View style={styles.failCircle}>
            <Text style={styles.failIcon}>✕</Text>
          </View>
          <Text style={styles.failTitle}>Payment Failed</Text>
          {errorMessage && <Text style={styles.failMessage}>{errorMessage}</Text>}
          <TouchableOpacity style={styles.primaryBtn} onPress={initiatePayment}>
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.secondaryBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── UPI timeout ── */}
      {state === 'upi_timeout' && (
        <View style={styles.center}>
          <Text style={styles.timeoutIcon}>⏱</Text>
          <Text style={styles.timeoutTitle}>Payment Timed Out</Text>
          <Text style={styles.timeoutBody}>
            Your account has not been charged.{'\n'}
            UPI payments expire after 5 minutes.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={initiatePayment}>
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.secondaryBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Network error (payment likely went through; webhook handles activation) ── */}
      {state === 'network_error' && (
        <View style={styles.center}>
          <Text style={styles.networkIcon}>📡</Text>
          <Text style={styles.networkTitle}>We're confirming your payment</Text>
          <Text style={styles.networkBody}>
            Your payment was processed but we couldn't get instant confirmation.{'\n\n'}
            Your account will be activated automatically once payment is confirmed.
            This usually takes a few minutes.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.navigate('ConsumerSubscription')}
          >
            <Text style={styles.primaryBtnText}>Got it</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: IVORY,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  // Loading
  loadingTitle: {
    marginTop: 20,
    fontSize: 18,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: DEEP_INK,
    textAlign: 'center',
  },
  loadingSubtitle: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9E9E9E',
  },

  // Success
  checkmarkCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: VERDIGRIS,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    shadowColor: VERDIGRIS,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  checkmark: { fontSize: 44, color: '#fff', fontFamily: 'PlusJakartaSans-Bold' },
  successTitle: {
    fontSize: 24,
    fontFamily: 'PlusJakartaSans-Bold',
    color: DEEP_INK,
    marginBottom: 6,
  },
  successPlan: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: SAFFRON,
    marginBottom: 20,
  },
  leadsAddedBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 12,
  },
  leadsAddedText: {
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: VERDIGRIS,
  },
  validUntil: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#9E9E9E',
    marginBottom: 32,
  },

  // Failure
  failCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: TERRACOTTA,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  failIcon: { fontSize: 36, color: '#fff', fontFamily: 'PlusJakartaSans-Bold' },
  failTitle: {
    fontSize: 22,
    fontFamily: 'PlusJakartaSans-Bold',
    color: DEEP_INK,
    marginBottom: 12,
  },
  failMessage: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },

  // UPI timeout
  timeoutIcon: { fontSize: 56, marginBottom: 20 },
  timeoutTitle: {
    fontSize: 22,
    fontFamily: 'PlusJakartaSans-Bold',
    color: DEEP_INK,
    marginBottom: 12,
  },
  timeoutBody: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },

  // Network error
  networkIcon: { fontSize: 56, marginBottom: 20 },
  networkTitle: {
    fontSize: 20,
    fontFamily: 'PlusJakartaSans-Bold',
    color: DEEP_INK,
    marginBottom: 12,
    textAlign: 'center',
  },
  networkBody: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    color: '#1C1C2E',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },

  // Buttons
  primaryBtn: {
    backgroundColor: SAFFRON,
    borderRadius: 14,
    height: 54,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'PlusJakartaSans-Bold', color: '#fff' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#D4C5A9',
    borderRadius: 14,
    height: 50,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#1C1C2E',
  },
});
