'use client';
/**
 * adminClient.ts — typed API client for admin service (port 3009)
 * All requests include Firebase ID token in Authorization header.
 * FIXED: All API paths now match admin.routes.ts exactly.
 */

import { auth } from './firebase';

const BASE = process.env.NEXT_PUBLIC_ADMIN_API_URL ?? 'http://localhost:3009';

async function getToken(): Promise<string> {
  // Use RS256 JWT from token exchange (stored at login)
  const token = sessionStorage.getItem('admin_token');
  if (!token) throw new Error('Not authenticated — please sign in again');
  return token;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error?.message ?? err.error?.code ?? err.message ?? `HTTP ${res.status}`);
  }
  const json = await res.json();
  return (json.data ?? json) as T;
}

export const adminApi = {
  // Dashboard
  getDashboardStats: (period = 'mtd') => request<DashboardStats>('GET', `/api/v1/admin/analytics/platform?period=${period}`),

  // System Config — FIXED: was /admin/config, now /admin/system-config
  getConfig:    ()                            => request<ConfigRow[]>('GET', '/api/v1/admin/system-config'),
  updateConfig: (key: string, value: string)  => request<void>('PUT', `/api/v1/admin/system-config/${key}`, { value }),

  // Trust Config — FIXED: save now uses batch format, no :id in path
  getTrustConfig:    ()                                => request<{raw: TrustConfigRow[]; grouped: Record<string,TrustConfigRow[]>}>('GET', '/api/v1/admin/trust-config').then(d => Array.isArray(d) ? d : d.raw) as Promise<TrustConfigRow[]>,
  updateTrustConfig: (id: string, maxPts: number)      => request<void>('PUT', `/api/v1/admin/trust-config`, { updates: [{ id, max_pts: maxPts }] }),

  // Disputes — FIXED: was POST /:id/resolve, now PATCH /:id with reason not note
  getDisputes:    ()                                              => request<Dispute[]>('GET', '/api/v1/admin/disputes'),
  resolveDispute: (id: string, outcome: string, note: string)    => request<void>('PATCH', `/api/v1/admin/disputes/${id}`, { outcome, reason: note }),

  // Credentials — FIXED: was POST /:id/review, now PATCH /:id with action not status
  getCredentialQueue: ()                                                           => request<Credential[]>('GET', '/api/v1/admin/credentials'),
  reviewCredential:   (id: string, status: 'approved'|'rejected', reason?: string) =>
    request<void>('PATCH', `/api/v1/admin/credentials/${id}`, { action: status === 'approved' ? 'approve' : 'reject', reason }),

  // Providers
  searchProviders: (q: string, page = 1, listingType?: string, isClaimed?: boolean) => {
    const params = new URLSearchParams({ q: q ?? '', page: String(page) });
    if (listingType !== undefined && listingType !== '') params.set('listing_type', listingType);
    if (isClaimed   !== undefined) params.set('is_claimed', String(isClaimed));
    return request<ProviderPage>('GET', `/api/v1/admin/providers?${params}`);
  },
  resyncProvider:  (id: string)          => request<void>('POST', `/api/v1/admin/opensearch/resync`, { provider_id: id }),

  // Cities — routes exist in user service via admin
  getCities:   ()                     => request<City[]>('GET', '/api/v1/admin/cities'),
  addCity:     (data: NewCityPayload) => request<City>('POST', '/api/v1/admin/cities', data),
  updateCity:  (id: string, data: Partial<City>) => request<City>('PUT', `/api/v1/admin/cities/${id}`, data),

  // TSaaS
  getTsaasKeys:  ()           => request<TsaasKey[]>('GET', '/api/v1/admin/tsaas'),
  approveTsaas:  (id: string) => request<void>('POST', `/api/v1/admin/tsaas/${id}/approve`),
  revokeTsaas:   (id: string) => request<void>('POST', `/api/v1/admin/tsaas/${id}/revoke`),

  // Notifications — FIXED: was /notifications, now /notification-log
  getNotifications: (channel?: string, eventType?: string, page = 1) => {
    const params = new URLSearchParams({ page: String(page) });
    if (channel)   params.set('channel', channel);
    if (eventType) params.set('event_type', eventType);
    return request<NotifPage>('GET', `/api/v1/admin/notification-log?${params}`);
  },
  resendNotif:      (id: string) => request<void>('POST', `/api/v1/admin/notifications/${id}/resend`),

  // Scraping — FIXED: was /scraping/jobs, now /scraping/status
  getScrapingJobs:     () => request<ScrapingStatus>('GET', '/api/v1/admin/scraping/status'),
  getScrapingSources:  () => request<ScrapingSource[]>('GET', '/api/v1/admin/scraping/sources'),
  toggleScrapingSource:(key: string, enabled: boolean) =>
    request<ScrapingSource>('PATCH', `/api/v1/admin/scraping/sources/${key}`, { enabled }),
};

// ── Types ──────────────────────────────────────────────────────────────────

export interface DashboardStats {
  period: string;
  computed_at: string;

  // Current period
  mau: number;
  leads_total: number;
  leads_accepted: number;
  leads_declined: number;
  leads_expired: number;
  leads_completed: number;
  leads_no_show: number;
  leads_calls: number;
  leads_messages: number;
  leads_slot_bookings: number;
  searches: number;
  new_providers: number;
  new_consumers: number;
  ratings_submitted: number;

  // Previous period (for trend)
  mau_prev: number;
  leads_prev: number;
  searches_prev: number;
  new_providers_prev: number;
  new_consumers_prev: number;

  // Delta % vs previous period (null = no prior data)
  mau_delta_pct: number | null;
  leads_delta_pct: number | null;
  searches_delta_pct: number | null;
  new_providers_delta_pct: number | null;
  new_consumers_delta_pct: number | null;

  // Conversion rates
  acceptance_rate_pct: number;
  completion_rate_pct: number;
  no_show_rate_pct: number;
  search_to_lead_pct: number;

  // All-time snapshot
  total_providers: number;
  total_consumers: number;
  total_users: number;
  claimed_providers: number;
  claim_rate_pct: number;
  avg_trust_score: number;
  trust_tier_breakdown: Array<{ tier: string; count: number; avg_score: number }>;

  // Revenue (MRR-based)
  mrr_paise: number;
  arr_paise: number;
  arpu_paise: number;
  active_subscriptions: number;
  subs_by_tier: Record<string, { count: number; total_paise: number }>;

  // Operational health
  open_disputes: number;
  pending_credentials: number;
  pending_cred_over48h: number;
  certificates_issued: number;
  fcm_delivery_rate_24h: number | null;

  // Actionable insights
  insights: string[];

  // Trend lines (daily time series for sparklines)
  daily_trends: Array<{
    day: string;
    dau: number;
    leads: number;
    new_users: number;
    revenue_paise: number;
    active_subs: number;
  }>;

  // Trend lines (one per calendar day in the period)
  daily_trends: Array<{
    day: string;           // 'YYYY-MM-DD'
    dau: number;           // daily active users (distinct contacts)
    leads: number;         // total leads generated
    new_users: number;     // new user registrations
    revenue_paise: number; // subscription revenue started that day
    active_subs: number;   // subscriptions started that day
  }>;

  // Legacy
  total_contacts: number;
  claim_rate: number;
}

export interface ConfigRow { key: string; value: string; description: string; data_type: string; updated_at: string; updated_by: string; }
export interface TrustConfigRow { id: string; listing_type: string; signal_name: string; max_pts: number; raw_max_total: number; is_active: boolean; description: string; }
export interface Dispute { id: string; provider_id: string; flag_type: string; severity: string; status: string; evidence: unknown; created_at: string; sla_expires_at: string; provider?: { display_name: string } }
export interface Credential { id: string; provider_id: string; verification_type: string; status: string; created_at: string; provider?: { display_name: string; listing_type: string } }
export interface ProviderPage { providers: ProviderRow[]; total: number; page: number; }
export interface ProviderRow { id: string; display_name: string; listing_type: string; trust_score: number; trust_tier: string; is_claimed: boolean; is_active: boolean; city_id: string; }
export interface City { id: string; name: string; slug: string; is_active: boolean; is_launch_city: boolean; country_code: string; }
export interface NewCityPayload { name: string; state: string; slug: string; country_code: string; }
export interface TsaasKey { id: string; client_id: string; client_email: string; monthly_limit: number; calls_month: number; is_active: boolean; created_at: string; }
export interface NotifPage { logs: NotifRow[]; total: number; }
export interface NotifRow { id: string; user_id: string; channel: string; event_type: string; sent_at: string; delivered_at: string | null; wa_fallback_sent: boolean; }
export interface ScrapingStatus { jobs: ScrapingJob[]; summary: Array<{status: string; count: number}>; staging_unprocessed: number; }
export interface ScrapingJob { id: string; jobType: string; status: string; total_records: number; processed: number; failed: number; created_at: string; }
export interface ScrapingSource { key: string; label: string; group: string; enabled: boolean; last_run: string | null; total_records: number; job_count: number; }
