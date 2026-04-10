# SESSION_20_PHASE20_CONSUMER_RATING_SUBSCRIPTION_20260404.md
**SatvAAh — Phase 20: Consumer Rating & Subscription Screens**
Date: 2026-04-04 | Status: COMPLETE (1 session)

---

## FILES DELIVERED (6)

```
apps/mobile/src/api/
  rating.api.ts
  subscription.api.ts

apps/mobile/src/screens/consumer/
  RateProviderScreen.tsx
  OpenRatingScreen.tsx
  SubscriptionScreen.tsx
  RazorpayScreen.tsx
```

---

## 1. rating.api.ts — services/rating port 3005

### Exports
| Function | Endpoint | Description |
|---|---|---|
| `fetchRatingEligibility(providerId)` | GET `/api/v1/ratings/eligibility/:id` | Eligibility gate before showing RateProviderScreen |
| `submitVerifiedRating(payload)` | POST `/api/v1/ratings` | weight=1.0, linked to contact_event |
| `submitOpenRating(payload)` | POST `/api/v1/ratings/open` | weight=0.5, open community |
| `fetchDailyRatingUsage(tab)` | GET `/api/v1/ratings/daily-usage?tab=` | Today's count vs limit |
| `flagRating(payload)` | POST `/api/v1/ratings/:id/flag` | Moderation flag |

### Key types
- `RatingEligibility` — includes `skip_count`, `rating_bonus_leads`, `rating_dimensions[]`, `expires_at`
- `RatingDimension` — `{ key, label, icon? }` from taxonomy_node.rating_dimensions JSONB
- `DimensionRating` — `{ key, stars }` submitted with overall rating

---

## 2. subscription.api.ts — services/payment port 3007

### Exports
| Function | Endpoint | Description |
|---|---|---|
| `fetchSubscriptionPlans(userType)` | GET `/api/v1/subscriptions/plans?user_type=consumer` | ALL prices from DB — never hardcoded |
| `createSubscriptionOrder(payload)` | POST `/api/v1/subscriptions/purchase` | Returns Razorpay order_id + key_id |
| `verifyPayment(payload)` | POST `/api/v1/payments/verify` | Belt-and-suspenders; webhook is primary |
| `fetchMySubscription()` | GET `/api/v1/subscriptions/me` | Current plan + leads remaining |
| `paiseToRupees(paise)` | — | 4900 → "₹49"; all amounts stay paise in transit |

### Money rule enforced
All `price_paise` fields are integer paise. `paiseToRupees()` is the only conversion point. No float arithmetic anywhere.

### idempotency_key
Generated client-side with `uuid v4` **before** navigation to RazorpayScreen. Prevents duplicate Razorpay orders on network retry.

---

## 3. RateProviderScreen.tsx

### Trigger
FCM push notification 24h after contact_event status = `accepted`.

### Flow
```
Mount → GET /ratings/eligibility/:id
  ├── ineligible → show reason + go back
  └── eligible →
      Show screen:
        [expiry nudge if skip_count ≥ 3]
        5 large Saffron stars (overall)
        Dimension ratings (from taxonomy_node.rating_dimensions JSONB)
        Optional review text (500 char limit, character counter)
        Optional photos (up to 3, presigned S3 upload)
        Bonus leads nudge (+2 leads)
        [Submit] → POST /ratings
        [Skip for now] → navigation.goBack()
```

### Key behaviors
- **Eligibility gate**: Checks `GET /api/v1/ratings/eligibility/:providerId` before rendering any UI. Ineligible consumers see a clear message, not a broken form.
- **Expiry nudge**: Banner shown when `skip_count >= 3` ("This rating expires in 24 hours") — sourced from `rating_expiry_after_skips=3` config.
- **Dimension ratings**: Dynamically rendered from `eligibility.rating_dimensions` (JSONB). No hardcoded dimension keys. Only dimensions with `stars > 0` are submitted.
- **Photo upload**: Presigned URL flow — `POST /ratings/photo-upload-url` → PUT to S3 → submit S3 key. Max 3 photos.
- **Bonus leads**: `rating_bonus_leads` read from eligibility response (system_config). Shown pre-submit and confirmed in success alert.
- **Star visual**: `fontSize: 52` Saffron `★` characters with `#D4C5A9` inactive state. No third-party star library dependency.

---

## 4. OpenRatingScreen.tsx

### Constraints enforced
- **Tab restriction**: Accepts only `tab: 'products' | 'establishments'` as nav param. Services and Expertise tabs cannot reach this screen.
- **Weight disclosure**: Persistent banner "Community Rating · Not linked to a SatvAAh contact · Contributes 0.5× weight" with Verdigris left border.
- **Daily usage indicator**: Pill badge showing "Products rated today: X of Y". Green when under limit, red when at limit.
- **Limit gate**: If `used >= limit` on mount, shows a block screen ("Daily limit reached — come back tomorrow").
- **Server-side enforcement**: Daily limit checks via `GET /api/v1/ratings/daily-usage?tab=` on mount. Server enforces limits independently on POST.

### Daily limits (from system_config — never hardcoded)
- Products: 10/day
- Establishments: 8/day

---

## 5. SubscriptionScreen.tsx

### Plan display
- Plans fetched from `GET /api/v1/subscriptions/plans?user_type=consumer`
- Sorted: free → bronze → silver → gold
- Silver marked "Most Popular" (cosmetic only — no price/lead data is hardcoded)
- `paiseToRupees()` used for all price rendering

### Key UI elements
- **Differentiator callout**: "Other platforms take 15–30%. We take 0%." — Verdigris bordered card
- **Current plan banner**: Shows active tier + leads remaining (from `GET /api/v1/subscriptions/me`)
- **Plan cards**: Each shows all features with ✓/✗. Features come from `plan.features` JSONB.
- **Free plan**: Shows "Downgrade to Free" CTA. No payment flow (downgrade handled separately).

### Navigation to Razorpay
`uuid v4` idempotency key generated **before** `navigation.navigate('Razorpay', { plan, idempotency_key })`. This ensures safe retries.

---

## 6. RazorpayScreen.tsx

### Payment states
| State | Trigger | UI |
|---|---|---|
| `creating_order` | Mount | Spinner "Setting up your order…" |
| `checkout_open` | Order created | Spinner "Opening payment screen…" + Razorpay SDK open |
| `verifying` | SDK returns success | Spinner "Confirming payment…" |
| `success` | Verify returns OK | Verdigris ✓ circle + "+N leads added" + valid until date |
| `failure` | SDK error / user cancel | Terracotta ✕ + error message + Retry |
| `upi_timeout` | 5 min timer fires | Clock icon + "Your account has not been charged" + Retry |
| `network_error` | Verify call fails | 📡 + "Activation happens when payment is confirmed" (webhook) |

### UPI-first method ordering
```javascript
config.display.blocks = {
  upi: { instruments: [{ method: 'upi' }] },
  other: { instruments: [card, netbanking, wallet, emi] }
}
sequence: ['block.upi', 'block.other']
```

### UPI timeout
5-minute `setTimeout` starts when Razorpay SDK opens. Cleared on any SDK callback (success or error). Fires `setState('upi_timeout')` if UPI collection window expires.

### Webhook safety
`network_error` state explicitly tells the user activation happens via webhook. Prevents panic/duplicate payment attempts. The `/api/v1/payments/webhook/razorpay` endpoint (services/payment:3007) is the authoritative activation path — HMAC-SHA256 verified per Critical Rule 9.

### Success screen
- Verdigris circle checkmark (`#2E7D72` background, `✓` text, `fontSize: 44`)
- "+N leads added to your account" in Verdigris badge
- Human-readable valid_until date in `en-IN` locale

---

## ARCHITECTURE DECISIONS

### Why presigned S3 for photos
Photos uploaded directly from device to S3 via presigned URL. The API server never proxies binary data — reduces load on services/rating and avoids 10MB+ payloads through Express.

### Why idempotency key generated on client pre-navigation
If the user navigates to Razorpay and the order creation fails, tapping "Retry" reuses the same key. The payment service deduplicates on `idempotency_key` — same key = same order, no double-charge.

### Why `network_error` state instead of showing failure
Razorpay's SDK returns success after the user pays. If our verify call times out, the payment is almost certainly through. Showing "failure" would cause users to pay twice. `network_error` state + webhook activation is the correct pattern.

### Dimension ratings are dynamic, never hardcoded
`rating_dimensions` JSONB comes from `taxonomy_nodes` table via the eligibility endpoint. Adding a new dimension for a category requires zero code changes — only a DB update.

---

## BRAND COMPLIANCE

| Token | Value | Used in |
|---|---|---|
| Saffron | `#C8691A` | Stars, CTAs, expiry nudge border, plan prices |
| Deep Ink | `#1C1C2E` | All body text, headings |
| Ivory | `#FAF7F0` | Screen backgrounds |
| Verdigris | `#2E7D72` | Success checkmark, community banner, feature ticks |
| Warm Sand | `#F0E4CC` | Text input backgrounds, current plan banner |
| Terracotta | `#C0392B` | Failure state, char limit warning |
| Light Verdigris | `#6BA89E` | Silver plan tier colour |

Font: `PlusJakartaSans-*` variants (Regular, Medium, SemiBold, Bold) throughout.

---

## CRITICAL RULES RESPECTED

| Rule | How |
|---|---|
| Amounts in paise | All API types use `_paise` suffix. `paiseToRupees()` is single conversion point. |
| Never hardcode prices | `SubscriptionScreen` shows plans only after API response. No fallback constants. |
| HMAC-SHA256 webhook | Noted in RazorpayScreen comments; verify call is belt-and-suspenders only. |
| Config-driven | `rating_bonus_leads`, `rating_expiry_after_skips`, daily limits all read from API (system_config). |
| FCM only for product events | RateProviderScreen triggered by FCM push, not WhatsApp. |
| Eligibility gate | RateProviderScreen always calls eligibility API before rendering form. |

---

## DEPENDENCIES REQUIRED

```
react-native-razorpay          # Razorpay SDK wrapper
expo-image-picker              # Photo picker
react-native-safe-area-context # insets
uuid + react-native-get-random-values  # idempotency key generation
```

All already in use elsewhere in the project (Phase 19 confirmed react-native-safe-area-context and expo-image-picker).

---

## PHASE 21 NEXT STEPS (suggested)

- Provider subscription screen (different plan tiers)
- Consumer trust score screen (`GET /api/v1/consumers/me/trust`)
- Lead balance widget (persistent header badge across consumer screens)
- Rating history screen (consumer's submitted ratings)
- Dispute flow for flagged ratings

---

*SESSION_20_PHASE20_CONSUMER_RATING_SUBSCRIPTION_20260404.md*
*SatvAAh Technologies — CONFIDENTIAL*
