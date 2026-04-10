'use client';
import { useEffect, useState, useCallback } from 'react';
import { adminApi, ConfigRow } from '@/lib/adminClient';

// ── Constraint Rules ──────────────────────────────────────────────────────────
type ConstraintRule = {
  message: string;
  validate: (val: string, all: Record<string, string>) => boolean;
};

const READONLY_KEYS = new Set([
  'search_lead_cost', 'certificate_id_prefix', 'opensearch_index_name',
]);

const DANGEROUS_KEYS = new Set([
  'trust_tier_basic_threshold', 'trust_tier_trusted_threshold',
  'trust_tier_highly_trusted_threshold', 'certificate_score_threshold',
]);

// These are CONCEPTUAL duplicates — two different key names doing the same thing.
// The duplicate key is shown greyed-out and read-only; the canonical key is editable.
const DUPLICATE_KEYS = new Set([
  'verified_rating_weight',      // canonical: rating_weight_verified_contact
  'open_rating_weight',          // canonical: rating_weight_open_community
  'no_show_lead_refund',         // canonical: lead_refund_on_no_show
  'certificate_validity_years',  // canonical: certificate_validity_days
  'min_ratings_for_trust_signal',// canonical: consumer_trust_min_ratings_for_signal
]);

const TIER_ORDER: Record<string, number> = { free: 0, bronze: 1, silver: 2, gold: 3 };

const CONSTRAINTS: Record<string, ConstraintRule[]> = {
  trust_tier_basic_threshold: [{
    message: 'basic < trusted < highly_trusted',
    validate: (v, all) => parseInt(v) < parseInt(all['trust_tier_trusted_threshold'] ?? '60'),
  }],
  trust_tier_trusted_threshold: [{
    message: 'basic < trusted < highly_trusted',
    validate: (v, all) => parseInt(v) > parseInt(all['trust_tier_basic_threshold'] ?? '20') && parseInt(v) < parseInt(all['trust_tier_highly_trusted_threshold'] ?? '80'),
  }],
  trust_tier_highly_trusted_threshold: [{
    message: 'basic < trusted < highly_trusted',
    validate: (v, all) => parseInt(v) > parseInt(all['trust_tier_trusted_threshold'] ?? '60'),
  }, {
    message: 'Should match certificate_score_threshold',
    validate: (v, all) => parseInt(v) === parseInt(all['certificate_score_threshold'] ?? '80'),
  }],
  certificate_score_threshold: [{
    message: 'Should equal trust_tier_highly_trusted_threshold',
    validate: (v, all) => parseInt(v) === parseInt(all['trust_tier_highly_trusted_threshold'] ?? '80'),
  }],
  customer_voice_max_weight: [{
    message: 'Must be 0.0–1.0',
    validate: (v) => parseFloat(v) >= 0 && parseFloat(v) <= 1,
  }],
  view_availability_min_tier: [{
    message: 'view_availability ≤ view_calendar ≤ slot_booking',
    validate: (v, all) => (TIER_ORDER[v] ?? 0) <= (TIER_ORDER[all['view_calendar_min_tier'] ?? 'gold'] ?? 3),
  }],
  view_calendar_min_tier: [{
    message: 'view_availability ≤ view_calendar ≤ slot_booking',
    validate: (v, all) => (TIER_ORDER[v] ?? 0) >= (TIER_ORDER[all['view_availability_min_tier'] ?? 'free'] ?? 0) && (TIER_ORDER[v] ?? 0) <= (TIER_ORDER[all['slot_booking_min_tier'] ?? 'gold'] ?? 3),
  }],
  slot_booking_min_tier: [{
    message: 'view_availability ≤ view_calendar ≤ slot_booking',
    validate: (v, all) => (TIER_ORDER[v] ?? 0) >= (TIER_ORDER[all['view_calendar_min_tier'] ?? 'gold'] ?? 3),
  }],
  free_tier_leads_per_month: [{
    message: 'free leads < gold leads',
    validate: (v, all) => parseInt(v) < parseInt(all['consumer_gold_leads_per_month'] ?? '50'),
  }],
  consumer_gold_leads_per_month: [{
    message: 'gold leads > free leads',
    validate: (v, all) => parseInt(v) > parseInt(all['free_tier_leads_per_month'] ?? '10'),
  }],
  subscription_grace_period_days: [{
    message: 'grace_period < expiry_warning',
    validate: (v, all) => parseInt(v) < parseInt(all['subscription_expiry_warning_days'] ?? '7'),
  }],
  fcm_fallback_timeout_minutes_lead: [{
    message: 'fallback timeout < lookback window',
    validate: (v, all) => parseInt(v) < parseInt(all['fcm_fallback_lookback_minutes'] ?? '30'),
  }],
  fcm_fallback_timeout_minutes_accepted: [{
    message: 'fallback timeout < lookback window',
    validate: (v, all) => parseInt(v) < parseInt(all['fcm_fallback_lookback_minutes'] ?? '30'),
  }],
  data_retention_years: [{
    message: 'data_retention < deletion_audit_retention',
    validate: (v, all) => parseInt(v) < parseInt(all['deletion_audit_retention_years'] ?? '7'),
  }],
  deletion_audit_retention_years: [{
    message: 'deletion_audit_retention > data_retention',
    validate: (v, all) => parseInt(v) > parseInt(all['data_retention_years'] ?? '5'),
  }],
  longevity_1yr_pts: [{
    message: '1yr < 5yr < 10yr < 20yr pts',
    validate: (v, all) => parseInt(v) < parseInt(all['longevity_5yr_pts'] ?? '12'),
  }],
  longevity_5yr_pts: [{
    message: '1yr < 5yr < 10yr < 20yr pts',
    validate: (v, all) => parseInt(v) > parseInt(all['longevity_1yr_pts'] ?? '5') && parseInt(v) < parseInt(all['longevity_10yr_pts'] ?? '18'),
  }],
  longevity_10yr_pts: [{
    message: '1yr < 5yr < 10yr < 20yr pts',
    validate: (v, all) => parseInt(v) > parseInt(all['longevity_5yr_pts'] ?? '12') && parseInt(v) < parseInt(all['longevity_20yr_pts'] ?? '25'),
  }],
  longevity_20yr_pts: [{
    message: '1yr < 5yr < 10yr < 20yr pts',
    validate: (v, all) => parseInt(v) > parseInt(all['longevity_10yr_pts'] ?? '18'),
  }],
  search_ring_1_km: [{
    message: 'ring1 < ring2 < ring3 < ring4 < ring5',
    validate: (v, all) => parseInt(v) < parseInt(all['search_ring_2_km'] ?? '7'),
  }],
  search_ring_2_km: [{
    message: 'ring1 < ring2 < ring3 < ring4 < ring5',
    validate: (v, all) => parseInt(v) > parseInt(all['search_ring_1_km'] ?? '3') && parseInt(v) < parseInt(all['search_ring_3_km'] ?? '15'),
  }],
  search_ring_3_km: [{
    message: 'ring1 < ring2 < ring3 < ring4 < ring5',
    validate: (v, all) => parseInt(v) > parseInt(all['search_ring_2_km'] ?? '7') && parseInt(v) < parseInt(all['search_ring_4_km'] ?? '50'),
  }],
  search_ring_4_km: [{
    message: 'ring1 < ring2 < ring3 < ring4 < ring5',
    validate: (v, all) => parseInt(v) > parseInt(all['search_ring_3_km'] ?? '15') && parseInt(v) < parseInt(all['search_ring_5_km'] ?? '150'),
  }],
  search_ring_5_km: [{
    message: 'ring1 < ring2 < ring3 < ring4 < ring5',
    validate: (v, all) => parseInt(v) > parseInt(all['search_ring_4_km'] ?? '50'),
  }],
  fcm_fallback_timeout_minutes_accepted: [{
    message: 'fallback timeout < lookback window',
    validate: (v, all) => parseInt(v) < parseInt(all['fcm_fallback_lookback_minutes'] ?? '30'),
  }],
  longevity_1yr_pts: [{
    message: '1yr < 5yr < 10yr < 20yr',
    validate: (v, all) => parseInt(v) < parseInt(all['longevity_5yr_pts'] ?? '12'),
  }],
  longevity_5yr_pts: [{
    message: '1yr < 5yr < 10yr < 20yr',
    validate: (v, all) => parseInt(v) > parseInt(all['longevity_1yr_pts'] ?? '5') && parseInt(v) < parseInt(all['longevity_10yr_pts'] ?? '18'),
  }],
  longevity_10yr_pts: [{
    message: '1yr < 5yr < 10yr < 20yr',
    validate: (v, all) => parseInt(v) > parseInt(all['longevity_5yr_pts'] ?? '12') && parseInt(v) < parseInt(all['longevity_20yr_pts'] ?? '25'),
  }],
  longevity_20yr_pts: [{
    message: '1yr < 5yr < 10yr < 20yr',
    validate: (v, all) => parseInt(v) > parseInt(all['longevity_10yr_pts'] ?? '18'),
  }],
};

// ── Domain Map ────────────────────────────────────────────────────────────────
type SubPanel = { id: string; title: string; keys: string[] };
type Domain = { id: string; label: string; icon: string; color: string; panels: SubPanel[] };

const DOMAINS: Domain[] = [
  {
    id: 'trust', label: 'Trust Engine', icon: '🛡', color: '#2E7D72',
    panels: [
      { id: 'tiers', title: 'Tier Thresholds', keys: ['trust_tier_basic_threshold', 'trust_tier_trusted_threshold', 'trust_tier_highly_trusted_threshold'] },
      { id: 'certs', title: 'Certificates', keys: ['certificate_score_threshold', 'certificate_below_grace_days', 'certificate_validity_days', 'certificate_seq_padding', 'certificate_id_prefix'] },
      { id: 'formula', title: 'Trust Formula Weights', keys: ['customer_voice_max_weight', 'customer_weight_curve', 'scraped_external_weight', 'scraped_external_stale_days', 'scraped_external_stale_weight'] },
      { id: 'timing', title: 'Recalculation Timing', keys: ['trust_score_stale_recalc_hours', 'trust_score_recalc_cooldown_mins', 'push_discovery_trust_threshold'] },
    ],
  },
  {
    id: 'ratings', label: 'Ratings', icon: '⭐', color: '#C8691A',
    panels: [
      { id: 'weights', title: 'Rating Weights', keys: ['rating_weight_verified_contact', 'rating_weight_open_community', 'scraped_rating_weight', 'rating_held_weight'] },
      { id: 'limits', title: 'Daily Limits', keys: ['rating_daily_limit_products', 'rating_daily_limit_services', 'rating_daily_limit_expertise', 'rating_daily_limit_establishments'] },
      { id: 'fraud', title: 'Fraud Prevention', keys: ['rating_burst_threshold', 'rating_burst_window_minutes', 'rating_same_provider_cooldown_days', 'rating_min_account_age_days'] },
      { id: 'rules', title: 'Rating Rules', keys: ['open_rating_requires_otp', 'rating_requires_contact_services', 'rating_requires_contact_expertise', 'rating_contact_window_days', 'rating_trigger_hours', 'rating_bonus_leads', 'rating_expiry_after_skips'] },
    ],
  },
  {
    id: 'leads', label: 'Leads & Contacts', icon: '📞', color: '#6BA89E',
    panels: [
      { id: 'economics', title: 'Lead Economics', keys: ['contact_lead_cost', 'no_show_trust_penalty_pts', 'no_show_penalty_enabled', 'lead_refund_on_no_show', 'no_show_lead_refund'] },
      { id: 'access', title: 'Tier Access Gates', keys: ['view_availability_min_tier', 'view_calendar_min_tier', 'slot_booking_min_tier', 'slot_duration_minutes'] },
      { id: 'timing', title: 'Lead Timing', keys: ['lead_expiry_hours', 'lead_limit_warning_pct', 'reveal_consumer_phone_on_accept'] },
      { id: 'allocation', title: 'Consumer Lead Allocation', keys: ['free_tier_leads_per_month', 'consumer_gold_leads_per_month', 'search_lead_cost'] },
    ],
  },
  {
    id: 'search', label: 'Search', icon: '🔍', color: '#4A90D9',
    panels: [
      { id: 'rings', title: 'Search Rings (km)', keys: ['search_ring_1_km', 'search_ring_2_km', 'search_ring_3_km', 'search_ring_4_km', 'search_ring_5_km'] },
      { id: 'behaviour', title: 'Search Behaviour', keys: ['fuzzy_match_threshold', 'suggest_min_chars', 'suggest_max_results', 'results_per_page'] },
      { id: 'features', title: 'Search Features', keys: ['push_discovery_enabled', 'push_discovery_max_per_user_per_day', 'search_narration_enabled', 'social_proof_hyperlocal_enabled'] },
      { id: 'infra', title: 'OpenSearch Infra', keys: ['opensearch_index_name', 'opensearch_bulk_batch_size', 'opensearch_sync_retry_max', 'opensearch_sync_retry_delay_secs'] },
    ],
  },
  {
    id: 'platform', label: 'Platform', icon: '📱', color: '#7B5EA7',
    panels: [
      { id: 'subscriptions', title: 'Subscriptions', keys: ['subscription_expiry_warning_days', 'subscription_grace_period_days', 'razorpay_webhook_tolerance_secs'] },
      { id: 'fcm', title: 'FCM Notifications', keys: ['fcm_fallback_timeout_minutes_lead', 'fcm_fallback_timeout_minutes_accepted', 'fcm_fallback_lookback_minutes', 'fcm_delivery_alert_threshold', 'fcm_aggressive_battery_manufacturers'] },
      { id: 'whatsapp', title: 'WhatsApp', keys: ['wa_channel_policy', 'wa_max_daily_messages_per_user'] },
      { id: 'features', title: 'Feature Flags', keys: ['live_activity_enabled', 'rising_brands_enabled', 'rising_brands_min_trust', 'rising_brands_max_age_days', 'commission_counter_enabled', 'commission_counter_competitor_rate', 'trusted_circle_min_contacts'] },
      { id: 'referrals', title: 'Referrals', keys: ['referral_reward_leads', 'referral_lead_bonus_per_join', 'referral_max_per_user', 'referral_code_expiry_days', 'referral_converted_window_days', 'referral_join_bonus_days_bronze', 'referral_reward_type', 'referral_milestone_5_reward', 'referral_milestone_10_reward', 'referral_milestone_25_reward'] },
    ],
  },
  {
    id: 'ai', label: 'AI & Data', icon: '🤖', color: '#E8A838',
    panels: [
      { id: 'narration', title: 'AI Narration', keys: ['ai_narration_enabled', 'ai_narration_model', 'gemini_narration_enabled', 'gaas_refresh_interval_hours'] },
      { id: 'scraping', title: 'Scraping', keys: ['scraping_dedupe_threshold', 'scraping_stale_days', 'scraping_nlp_min_confidence', 'scraping_max_daily_outreach', 'scraping_outreach_attempt_2_delay_hours', 'scraping_outreach_attempt_3_delay_days'] },
      { id: 'consumer_trust', title: 'Consumer Trust Signals', keys: ['consumer_trust_start', 'consumer_trust_signal_phone_verified', 'consumer_trust_signal_profile_complete', 'consumer_trust_signal_ratings_given', 'consumer_trust_signal_completed_interactions', 'consumer_trust_signal_no_abuse', 'consumer_trust_signal_subscription', 'consumer_trust_min_ratings_for_signal', 'consumer_trust_min_events_for_signal', 'consumer_trust_abuse_window_days'] },
      { id: 'longevity', title: 'Longevity Trust Points', keys: ['longevity_1yr_pts', 'longevity_5yr_pts', 'longevity_10yr_pts', 'longevity_20yr_pts'] },
    ],
  },
  {
    id: 'compliance', label: 'Compliance', icon: '⚖️', color: '#C0392B',
    panels: [
      { id: 'privacy', title: 'DPDP / Privacy', keys: ['anonymisation_deadline_hours', 'data_retention_years', 'deletion_audit_retention_years', 'data_export_max_records'] },
      { id: 'security', title: 'Security & Verification', keys: ['digilocker_enabled', 'geo_confirm_accuracy_metres'] },
      { id: 'tsaas', title: 'TSaaS — B2B API', keys: ['tsaas_enabled', 'tsaas_consent_required', 'tsaas_consent_trust_pts', 'tsaas_default_monthly_limit', 'tsaas_rate_limit_per_minute', 'tsaas_response_cache_ttl_secs'] },
    ],
  },
];

// ── Input Component ───────────────────────────────────────────────────────────
function ConfigInput({ row, value, onChange, isReadOnly }: {
  row: ConfigRow; value: string; onChange: (v: string) => void; isReadOnly: boolean;
}) {
  if (isReadOnly) {
    return <div className="px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-sm font-mono text-gray-500">{value}</div>;
  }
  if (row.data_type === 'boolean') {
    return (
      <div className="flex gap-2">
        {['true', 'false'].map(opt => (
          <button key={opt}
            onClick={() => onChange(opt)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${value === opt
              ? opt === 'true' ? 'bg-verdigris text-white shadow-sm' : 'bg-terracotta text-white shadow-sm'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
          >{opt}</button>
        ))}
      </div>
    );
  }
  if (row.key.includes('_min_tier')) {
    return (
      <div className="flex gap-2">
        {['free', 'bronze', 'silver', 'gold'].map(t => (
          <button key={t}
            onClick={() => onChange(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${value === t
              ? 'bg-deep-ink text-white shadow-sm'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
          >{t}</button>
        ))}
      </div>
    );
  }
  if (row.data_type === 'json') {
    return (
      <textarea value={value} rows={2}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-verdigris resize-none"
      />
    );
  }
  return (
    <input
      type={row.data_type === 'integer' ? 'number' : row.data_type === 'float' ? 'number' : 'text'}
      step={row.data_type === 'float' ? '0.01' : row.data_type === 'integer' ? '1' : undefined}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-verdigris"
    />
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ConfigPage() {
  const [rows, setRows]       = useState<ConfigRow[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState<Record<string, boolean>>({});
  const [saved, setSaved]     = useState<Record<string, boolean>>({});
  const [error, setError]     = useState('');
  const [activeDomain, setActiveDomain] = useState<string>('trust');
  const [openPanels, setOpenPanels]     = useState<Record<string, boolean>>({ 'trust.tiers': true });
  const [filter, setFilter]   = useState('');

  useEffect(() => {
    adminApi.getConfig().then(setRows).catch(e => setError(e.message));
  }, []);

  const allValues = useCallback((): Record<string, string> => {
    const base: Record<string, string> = {};
    rows.forEach(r => { base[r.key] = r.value; });
    Object.entries(editing).forEach(([k, v]) => { base[k] = v; });
    return base;
  }, [rows, editing]);

  const getConstraintErrors = (key: string, value: string): string[] => {
    const rules = CONSTRAINTS[key] ?? [];
    return rules.filter(r => !r.validate(value, allValues())).map(r => r.message);
  };

  const handleChange = (key: string, value: string) => {
    // If value matches the saved DB value, clear from editing state (not dirty)
    if (rowMap[key] && value === rowMap[key].value) {
      setEditing(e => { const n = { ...e }; delete n[key]; return n; });
    } else {
      setEditing(e => ({ ...e, [key]: value }));
    }
  };

  const handleSave = async (key: string) => {
    const value = editing[key];
    if (value === undefined) return;
    setSaving(s => ({ ...s, [key]: true }));
    setError('');
    try {
      await adminApi.updateConfig(key, value);
      setRows(prev => prev.map(r => r.key === key ? { ...r, value, updated_at: new Date().toISOString() } : r));
      setEditing(e => { const n = { ...e }; delete n[key]; return n; });
      setSaved(s => ({ ...s, [key]: true }));
      setTimeout(() => setSaved(s => ({ ...s, [key]: false })), 2000);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  };

  const rowMap = Object.fromEntries(rows.map(r => [r.key, r]));
  const activeDomainData = DOMAINS.find(d => d.id === activeDomain)!;

  // Filter mode — cross-domain search
  const filteredRows = filter
    ? rows.filter(r => r.key.includes(filter.toLowerCase()) || r.description?.toLowerCase().includes(filter.toLowerCase()))
    : [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-deep-ink">System Config</h1>
        <p className="text-gray-400 text-sm mt-1">{rows.length} keys across {DOMAINS.length} domains · changes take effect immediately</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-terracotta text-sm">{error}</div>
      )}

      {/* Global search */}
      <div className="mb-5">
        <input
          className="px-4 py-2 border border-gray-200 rounded-xl text-sm w-80 focus:outline-none focus:ring-2 focus:ring-verdigris"
          placeholder="🔍 Search all 134 keys…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {/* Filter results */}
      {filter && (
        <div className="flex flex-col gap-2 mb-4">
          {filteredRows.length === 0 && <div className="text-gray-400 text-sm">No matching keys</div>}
          {filteredRows.map(row => {
            const isReadOnly = READONLY_KEYS.has(row.key);
            const isDuplicate = DUPLICATE_KEYS.has(row.key);
            const isDangerous = DANGEROUS_KEYS.has(row.key);
            const currentVal = editing[row.key] ?? row.value;
            const errors = getConstraintErrors(row.key, currentVal);
            const isEditing = editing[row.key] !== undefined;
            return (
              <ConfigCard
                key={row.key} row={row} value={currentVal}
                isReadOnly={isReadOnly} isDuplicate={isDuplicate} isDangerous={isDangerous}
                errors={errors} isEditing={isEditing}
                saving={saving[row.key]} saved={saved[row.key]}
                onChange={v => handleChange(row.key, v)}
                onSave={() => handleSave(row.key)}
                onCancel={() => setEditing(e => { const n = { ...e }; delete n[row.key]; return n; })}
              />
            );
          })}
        </div>
      )}

      {!filter && (
        <div className="flex gap-6 flex-1 min-h-0">
          {/* Domain sidebar */}
          <div className="flex flex-col gap-1 w-44 shrink-0">
            {DOMAINS.map(d => (
              <button
                key={d.id}
                onClick={() => { setActiveDomain(d.id); setOpenPanels({}); }}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-all ${activeDomain === d.id ? 'text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
                style={activeDomain === d.id ? { backgroundColor: d.color } : {}}
              >
                <span className="text-base">{d.icon}</span>
                <span>{d.label}</span>
              </button>
            ))}
          </div>

          {/* Sub-panels */}
          <div className="flex-1 flex flex-col gap-3 overflow-y-auto pb-8">
            {activeDomainData.panels.map(panel => {
              const panelKey = `${activeDomain}.${panel.id}`;
              const isOpen = openPanels[panelKey] ?? false;
              const panelKeys = panel.keys.filter(k => rowMap[k]);
              const changedCount = panelKeys.filter(k => editing[k] !== undefined).length;

              return (
                <div key={panel.id}
                  className="bg-white rounded-2xl border shadow-sm overflow-hidden"
                  style={{ borderColor: activeDomainData.color + '33' }}
                >
                  {/* Panel header */}
                  <button
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                    onClick={() => setOpenPanels(p => ({ ...p, [panelKey]: !p[panelKey] }))}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-1 h-5 rounded-full" style={{ backgroundColor: activeDomainData.color }} />
                      <span className="font-semibold text-deep-ink">{panel.title}</span>
                      <span className="text-xs text-gray-400">{panelKeys.length} keys</span>
                      {changedCount > 0 && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">
                          {changedCount} unsaved
                        </span>
                      )}
                    </div>
                    <span className="text-gray-400 text-sm">{isOpen ? '▲' : '▼'}</span>
                  </button>

                  {/* Panel body */}
                  {isOpen && (
                    <div className="px-5 pt-4 pb-5 grid grid-cols-2 gap-4 border-t border-gray-50">
                      {panelKeys.map(key => {
                        const row = rowMap[key];
                        if (!row) return null;
                        const isReadOnly = READONLY_KEYS.has(key);
                        const isDuplicate = DUPLICATE_KEYS.has(key);
                        const isDangerous = DANGEROUS_KEYS.has(key);
                        const currentVal = editing[key] ?? row.value;
                        const errors = getConstraintErrors(key, currentVal);
                        const isEditing = editing[key] !== undefined;
                        return (
                          <ConfigCard
                            key={key} row={row} value={currentVal}
                            isReadOnly={isReadOnly} isDuplicate={isDuplicate} isDangerous={isDangerous}
                            errors={errors} isEditing={isEditing}
                            saving={saving[key]} saved={saved[key]}
                            onChange={v => handleChange(key, v)}
                            onSave={() => handleSave(key)}
                            onCancel={() => setEditing(e => { const n = { ...e }; delete n[key]; return n; })}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Config Card ───────────────────────────────────────────────────────────────
function ConfigCard({ row, value, isReadOnly, isDuplicate, isDangerous, errors, isEditing, saving, saved, onChange, onSave, onCancel }: {
  row: ConfigRow; value: string;
  isReadOnly: boolean; isDuplicate: boolean; isDangerous: boolean;
  errors: string[]; isEditing: boolean;
  saving?: boolean; saved?: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={`rounded-xl border p-4 transition-all ${
      isDuplicate ? 'border-gray-200 bg-gray-50 opacity-60' :
      isDangerous ? 'border-amber-200 bg-amber-50' :
      isEditing ? 'border-verdigris bg-green-50' :
      'border-gray-100 bg-white'
    }`}>
      {/* Key name + badges */}
      <div className="flex items-start gap-2 mb-2 flex-wrap">
        <span className="font-mono text-xs font-bold text-deep-ink">{row.key}</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">{row.data_type}</span>
        {isReadOnly && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-500">🔒 read-only</span>}
        {isDuplicate && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-600">⚠ duplicate</span>}
        {isDangerous && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-200 text-amber-700">⚡ affects all providers</span>}
      </div>

      {/* Description */}
      {row.description && (
        <p className="text-xs text-gray-400 mb-3 leading-relaxed">{row.description}</p>
      )}

      {/* Input */}
      <ConfigInput row={row} value={value} onChange={onChange} isReadOnly={isReadOnly} />

      {/* Constraint errors */}
      {errors.map((e, i) => (
        <div key={i} className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700">
          <span>⚠</span><span>{e}</span>
        </div>
      ))}

      {/* Actions */}
      {!isReadOnly && !isDuplicate && (
        <div className="flex gap-2 mt-3 justify-end">
          {isEditing && (
            <button onClick={onCancel}
              className="px-3 py-1 text-xs text-gray-500 hover:text-deep-ink border border-gray-200 rounded-lg transition-colors"
            >Cancel</button>
          )}
          <button onClick={onSave}
            disabled={saving || !isEditing || errors.length > 0}
            className="px-3 py-1 text-xs font-medium bg-verdigris text-white rounded-lg disabled:opacity-40 hover:bg-green-800 transition-colors"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      )}

      {/* Last updated */}
      <div className="text-gray-300 text-xs mt-2">
        {new Date(row.updated_at).toLocaleString('en-IN')}
      </div>
    </div>
  );
}
