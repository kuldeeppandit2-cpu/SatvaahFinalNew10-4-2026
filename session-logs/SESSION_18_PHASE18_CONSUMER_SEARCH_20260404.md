# SESSION_18_PHASE18_CONSUMER_SEARCH_20260404.md
# SatvAAh — Phase 18 Complete: Consumer Home & Search Screens
# Date: 2026-04-04 | Session 18
# Follows: Session 17 — Phase 17: Mobile Auth Complete

---

## SESSION SUMMARY

Phase 18 delivered all consumer-facing discovery screens for the SatvAAh mobile app.
Five files written: 1 API module + 4 screens.

---

## FILES WRITTEN

### 1. `apps/mobile/src/api/search.api.ts`
Complete API layer for all search operations.

**Exports (types):**
- `Tab` — `'products' | 'services' | 'expertise' | 'establishments'`
- `TrustTier` — `'unverified' | 'basic' | 'trusted' | 'highly_trusted'`
- `SortOrder` — `'trust_score' | 'distance' | 'rating'`
- `TaxonomyNode`, `SearchSuggestion`, `SearchParams`, `ProviderCardData`
- `SearchMeta`, `SearchResponse`, `SearchIntentPayload`
- `Category`, `AvailabilityChange`, `RisingBrand`

**Functions:**
| Function | Endpoint | Notes |
|---|---|---|
| `getSearchSuggestions(q, tab)` | `GET /api/v1/search/suggest` | Min 2 chars, max 8 results |
| `searchProviders(params)` | `GET /api/v1/search` | lng not lon, default sort trust_score |
| `storeSearchIntent(payload)` | `POST /api/v1/search/intent` | **VOID — fire and forget, silent** |
| `getCategories(tab)` | `GET /api/v1/categories` | Category grid data |
| `getProviderProfile(id)` | `GET /api/v1/providers/:id` | Public, no auth |
| `getAvailabilityChanges(since)` | `GET /api/v1/search/availability-changes` | WS REST catchup |
| `getRisingBrands(lat, lng)` | `GET /api/v1/search/rising-brands` | Products tab only |

**Helpers:**
- `trustRingColor(tier)` — maps tier → brand hex
- `trustTierLabel(tier)` — human-readable tier name
- `leadPillColor(remaining)` — Saffron >10, Amber 1–10, Terracotta 0

---

### 2. `apps/mobile/src/screens/consumer/HomeScreen.tsx`

**Surface tabs:** Products | Establishments | Services | Expertise
(in that order — Establishments is second, not third)

**Lead counter pill** (top-right header):
- Displays `remaining/allocated Leads`
- Saffron `#C8691A` when remaining > 10
- Amber `#D97706` when remaining 1–10
- Terracotta `#C4502A` when remaining = 0
- Data source: `GET /api/v1/consumers/me` → `leads_remaining`, `leads_allocated`

**Search bar:** Pressable → `navigation.navigate('Search', { tab: activeTab })`.
No input capability in HomeScreen — always navigates to SearchScreen.

**Trusted Circle:** Horizontal FlatList of `TrustedProvider` chips.
- Shown only when `consumerProfile.contact_count >= 3`
- Data: `GET /api/v1/saved-providers?type=contacted&limit=10`
- Trust ring on each avatar matches provider's tier colour

**Rising Brands:** Horizontal FlatList.
- Shown only when `activeTab === 'products'`
- Data: `GET /api/v1/search/rising-brands?lat=&lng=`
- Shows trust ring, score delta badge (▲ N)

**Category grid:** 3-column wrapping grid.
- Data: `GET /api/v1/categories?tab=`
- Re-fetches on tab switch
- Tapping a category → `navigation.navigate('Search', { tab, initialQuery: category.name })`

**Data loading:** `Promise.allSettled` for all three section fetches — one section failure does not prevent others from rendering.

**Pull-to-refresh:** `RefreshControl` with Saffron tint.

---

### 3. `apps/mobile/src/screens/consumer/SearchScreen.tsx`

**Taxonomy-constrained ONLY.** Free text search is architecturally prevented:
- Search button only activates after a taxonomy node is selected
- Return key on keyboard only fires if exactly 1 suggestion exists (auto-selects it)
- Constraint notice bar always visible below input

**Suggestion flow:**
1. User types ≥ 2 chars → 300ms debounce → `getSearchSuggestions(text, tab)`
2. Max 8 results displayed
3. User taps a node → fires
4. `storeSearchIntent()` called — void, silent, does NOT await
5. `saveRecentSearch()` to AsyncStorage
6. Navigates immediately to `SearchResults`

**Voice search (English / Telugu / Hindi):**
- Module: `@react-native-voice/voice` — lazy-loaded with try/catch guard
- Long-press mic button → language picker (EN / TE / HI)
- Languages: `en-IN`, `te-IN`, `hi-IN`
- Auto-selects taxonomy node if voice recognition yields exactly 1 match
- Animated pulse ring while listening
- Full-screen voice overlay with Stop button
- Gracefully degrades if module not linked

**Recent searches:** Persisted to AsyncStorage per tab.
Key format: `satvaaah_recent_searches_{tab}` — max 5 per tab.
Shown when input is empty (< 2 chars).

**No internet during suggest:** Shows "No categories found" empty state — never crashes.

---

### 4. `apps/mobile/src/screens/consumer/SearchResultsScreen.tsx`

**Ring narration banner:**
- Background: Saffron `#C8691A` | Text: Ivory `#FAF7F0`
- Shown when `meta.ring_km > 3 && meta.narration !== null`
- Narration text comes from search service (explains ring expansion)

**ProviderCard** (memoized with `React.memo`):
- Trust ring = coloured border on avatar matching `trust_tier`
- Certificate badge (✓ green) when `certificate_id !== null`
- Availability dot (green = available, terracotta = busy)
- Home visit tag shown when `home_visit === true`
- Trust score badge (circular, colour-matched to tier)
- Rating (★) + distance shown below score

**FlashList** (NOT FlatList):
- `estimatedItemSize={100}`
- `onEndReachedThreshold={0.3}`
- Infinite scroll pagination (10 per page)
- Custom separator (left-offset to align under text)

**WebSocket /availability namespace:**
- Server: user service port 3002
- Public namespace — NO auth required
- Joins room `city:{city_id}` on connect
- Listens for `availability_updated` events
- Reconnection: `reconnectionDelayMax: 30000` (30s cap), `Infinity` retries
- REST catchup on reconnect via `getAvailabilityChanges(since)`
- `availMap` state merges live overrides into displayed results via `useMemo`
- Socket disconnected cleanly in `useEffect` cleanup

**Sort bar:** Inline chips — Most Trusted / Nearest / Top Rated.
Default: trust_score DESC (spec requirement).

**Filter button:** Opens `SearchFilter` screen passing current filters.

**Pagination:**
- 10 results per page
- `onEndReached` fires when 30% from bottom
- Loading spinner footer while fetching next page
- "All N results shown" message at end

---

### 5. `apps/mobile/src/screens/consumer/SearchFilterScreen.tsx`

Full-screen filter interface. All state is local until Apply is tapped.

**Filters implemented:**

| Filter | Component | Default |
|---|---|---|
| Sort order | Radio group (3 options) | trust_score |
| Min trust score | `@react-native-community/slider` | 0 |
| Max distance | Chip group (5km / 10km / 25km / 50km / Any) | Any |
| Available now | Switch toggle | false |
| Home visit | Switch toggle | false |
| Languages | Multi-select chips | none |
| Min rating | Chip group (Any / ★3+ / ★3.5+ / ★4+ / ★4.5+) | Any |

**Trust score slider:**
- Visual tier strip below slider (4 colour segments: Grey / Saffron / Lt.Verdigris / Verdigris)
- Dynamic label: "Basic+", "Trusted+", "Highly Trusted only" based on value

**Languages:** English / Telugu / Hindi / Tamil / Kannada / Urdu (BCP-47 codes)

**Apply button (sticky):**
- Fixed to bottom above safe area
- Shows count of active filters: "Apply 3 filters"
- Navigates to SearchResults with `filters` param

**Reset all:** Shown in header when any filter is non-default.

**Filter application:** Navigates back via `navigation.navigate('SearchResults', { filters })`.
SearchResultsScreen watches `route.params.filters` via `useEffect`.

---

## KEY ARCHITECTURAL DECISIONS

### `storeSearchIntent` is void — not async
```typescript
// CORRECT — fire and forget
storeSearchIntent({ taxonomy_node_id, lat, lng });
navigation.navigate('SearchResults', ...); // fires immediately
```
This inserts a row into `search_intents` (V012 migration). The push-discovery Lambda
reads this table to send FCM when a matching provider's trust_score improves.
If this call fails (offline, server error), the user experience is completely unaffected.

### Taxonomy-constrained search
The SearchScreen never sends raw user text to the search endpoint.
It only calls `getSearchSuggestions()` and requires the user to select a `TaxonomyNode`.
This ensures all search queries map to structured taxonomy data (1,597 nodes from V017).

### `lng` not `lon`
Throughout all API calls, longitude uses the key `lng` — consistent with PostGIS
`ST_MakePoint(lng, lat)` convention. This is a MASTER_CONTEXT CRITICAL RULE 5.

### FlashList not FlatList
`SearchResultsScreen` uses `@shopify/flash-list` for performance with potentially
long provider lists. Estimated item size is 100px — adjust if card height changes.

### WebSocket reconnection
Socket.IO reconnection params: 1s initial delay, 30s max, infinite retries,
0.3 randomization factor. REST catchup uses `lastAvailTs` ref to fetch only
changes since last known event — prevents stale data on reconnect.

---

## BRAND COMPLIANCE

| Element | Colour |
|---|---|
| Logo | Saffron `#C8691A` |
| Tab active | Saffron `#C8691A` |
| Search bar bg | Warm Sand `#F0E4CC` |
| Narration banner | Saffron bg `#C8691A`, Ivory text `#FAF7F0` |
| Unverified ring | Grey `#6B6560` |
| Basic ring | Saffron `#C8691A` |
| Trusted ring | Light Verdigris `#6BA89E` |
| Highly Trusted ring | Verdigris `#2E7D72` |
| Lead pill >10 | Saffron `#C8691A` |
| Lead pill 1–10 | Amber `#D97706` |
| Lead pill 0 | Terracotta `#C4502A` |
| Screen bg | Ivory `#FAF7F0` |
| Primary text | Deep Ink `#1C1C2E` |
| Font | Plus Jakarta Sans (all weights) |

---

## DEPENDENCIES USED

```
@shopify/flash-list          — SearchResultsScreen (NOT FlatList)
@react-native-voice/voice    — Voice search (lazy loaded, graceful fallback)
@react-native-community/slider — Trust score slider in SearchFilterScreen
socket.io-client             — WebSocket /availability namespace
@react-native-async-storage/async-storage — Recent searches
react-native-safe-area-context — SafeAreaView
@react-navigation/native-stack — Navigation types
```

---

## TODOS FOR PHASE 19

- [ ] Replace hardcoded `lat: 17.385, lng: 78.4867` with `useLocation()` hook (Expo Location)
- [ ] Replace hardcoded `DEFAULT_CITY_ID = 'hyd'` with consumer profile city_id
- [ ] Implement `GET /api/v1/search/rising-brands` on the search service (port 3003)
- [ ] Implement `GET /api/v1/saved-providers?type=contacted` filter on user service (port 3002)
- [ ] Add `contact_count` field to `GET /api/v1/consumers/me` response
- [ ] Add `leads_remaining` + `leads_allocated` fields to `GET /api/v1/consumers/me` response
- [ ] Wire `SearchFilterScreen` return via navigation params to `SearchResultsScreen`
  (currently passes empty `query`/`taxonomyNodeId` back — needs route param preservation)
- [ ] Add haptic feedback on taxonomy node selection (`expo-haptics`)
- [ ] Category icons in HomeScreen grid (backend needs `icon_url` on taxonomy nodes)

---

## ENDPOINTS CALLED (Phase 18 Mobile)

| Endpoint | Service | Port | Auth |
|---|---|---|---|
| GET /api/v1/consumers/me | user | 3002 | JWT |
| GET /api/v1/saved-providers | user | 3002 | JWT |
| GET /api/v1/search/suggest | search | 3003 | JWT |
| GET /api/v1/search | search | 3003 | JWT |
| POST /api/v1/search/intent | search | 3003 | JWT |
| GET /api/v1/categories | search | 3003 | JWT |
| GET /api/v1/providers/:id | search | 3003 | Public |
| GET /api/v1/search/availability-changes | search | 3003 | Public |
| GET /api/v1/search/rising-brands | search | 3003 | JWT |
| WS /availability (socket.io) | user | 3002 | None (public) |

---

## NEXT SESSION: Phase 19

Suggested scope:
- Consumer location integration (`expo-location`) — replaces hardcoded Hyderabad coords
- Provider profile screen (consumer view)
- Save/unsave provider
- Contact event creation (call / message / slot_booking)
- In-app messaging screen (WebSocket /messages namespace, JWT required)

---

*SatvAAh Technologies | CONFIDENTIAL | Session 18 of N | 2026-04-04*
*Truth that travels.*
