'use client';
import { useEffect, useState, useCallback } from 'react';
import { adminApi, ProviderRow } from '@/lib/adminClient';
import { DataTable } from '@/components/DataTable';

const LISTING_TYPES = [
  { value: '',                   label: 'All Types' },
  { value: 'individual_service', label: '🔧 Individual Service' },
  { value: 'expertise',          label: '🎓 Expertise' },
  { value: 'establishment',      label: '🏢 Establishment' },
  { value: 'individual_product', label: '📦 Individual Product' },
  { value: 'product_brand',      label: '🏷 Product Brand' },
];

const TIER: Record<string, { label: string; bg: string; text: string; bar: string }> = {
  highly_trusted: { label: 'Highly Trusted', bg: 'bg-verdigris/10', text: 'text-verdigris',  bar: 'bg-verdigris' },
  trusted:        { label: 'Trusted',        bg: 'bg-teal-50',      text: 'text-teal-600',   bar: 'bg-teal-400' },
  basic:          { label: 'Basic',          bg: 'bg-saffron/10',   text: 'text-saffron',    bar: 'bg-saffron' },
  unverified:     { label: 'Unverified',     bg: 'bg-gray-100',     text: 'text-gray-500',   bar: 'bg-gray-300' },
};

const TRUST_TIERS = [
  { value: '',              label: 'All Tiers' },
  { value: 'highly_trusted',label: '🛡 Highly Trusted' },
  { value: 'trusted',       label: '✓ Trusted' },
  { value: 'basic',         label: '· Basic' },
  { value: 'unverified',    label: '○ Unverified' },
];

const CLAIMED = [
  { value: '',      label: 'All' },
  { value: 'true',  label: '✓ Claimed' },
  { value: 'false', label: '○ Unclaimed' },
];

const selectCls = 'px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-verdigris cursor-pointer';

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [q, setQ]                 = useState('');
  const [listingType, setListing] = useState('');
  const [claimed, setClaimed]     = useState('');
  const [tierFilter, setTier]     = useState('');
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [resyncing, setResyncing] = useState<string | null>(null);
  const [error, setError]         = useState('');

  const search = useCallback(async (query: string, pg: number, lt: string, cl: string) => {
    setLoading(true);
    try {
      const isClaimed = cl === '' ? undefined : cl === 'true';
      const data = await adminApi.searchProviders(query, pg, lt || undefined, isClaimed);
      setProviders(data.providers ?? []);
      setTotal(data.total ?? 0);
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { search(q, page, listingType, claimed); }, [q, page, listingType, claimed, search]);

  // Client-side trust tier filter (tier comes from trust_score_record join)
  const displayed = tierFilter === '' ? providers
    : providers.filter(p => (p as any).trust_tier === tierFilter);

  async function resync(id: string) {
    setResyncing(id);
    try { await adminApi.resyncProvider(id); }
    catch (e: unknown) { setError((e as Error).message); }
    finally { setResyncing(null); }
  }

  function reset() { setQ(''); setListing(''); setClaimed(''); setTier(''); setPage(1); }

  const hasFilters = q || listingType || claimed || tierFilter;

  return (
    <div>
      <h1 className="text-2xl font-bold text-deep-ink mb-1">Providers</h1>
      <p className="text-gray-400 text-sm mb-4">{total.toLocaleString()} total · filter by type, tier, or claim status</p>
      {error && <div className="text-terracotta p-3 bg-red-50 rounded-xl text-sm mb-4">{error}</div>}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-verdigris"
          placeholder="🔍 Search name, phone…" value={q}
          onChange={e => { setQ(e.target.value); setPage(1); }} />

        <select value={listingType} onChange={e => { setListing(e.target.value); setPage(1); }} className={selectCls}>
          {LISTING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        <select value={tierFilter} onChange={e => setTier(e.target.value)} className={selectCls}>
          {TRUST_TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {CLAIMED.map(c => (
            <button key={c.value} onClick={() => { setClaimed(c.value); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                claimed === c.value ? 'bg-white text-deep-ink shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}>{c.label}</button>
          ))}
        </div>

        {hasFilters && (
          <button onClick={reset} className="text-xs text-gray-400 hover:text-deep-ink underline">Clear</button>
        )}
        {loading && <span className="text-xs text-gray-400">Loading…</span>}
      </div>

      <DataTable<Record<string, unknown>>
        data={displayed as unknown as Record<string, unknown>[]}
        columns={[
          { key: 'display_name', header: 'Provider', sortable: true, render: row => (
            <div>
              <div className="font-medium text-deep-ink text-sm">{String(row.display_name ?? '—')}</div>
              <div className="text-xs text-gray-400 capitalize mt-0.5">
                {String(row.listing_type ?? '').replace(/_/g,' ')}
              </div>
            </div>
          )},
          { key: 'trust_score', header: 'Trust Score', sortable: true, render: row => {
            const score = Number(row.trust_score ?? 0);
            const tierKey = String((row as any).trust_tier ?? 'unverified');
            const t = TIER[tierKey] ?? TIER.unverified;
            return (
              <div className="flex items-center gap-2">
                <div className="w-16 bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${score}%` }} />
                </div>
                <span className="text-sm font-mono font-semibold text-deep-ink">{score}</span>
              </div>
            );
          }},
          { key: 'trust_tier', header: 'Tier', render: row => {
            const tierKey = String((row as any).trust_tier ?? 'unverified');
            const t = TIER[tierKey] ?? TIER.unverified;
            return (
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${t.bg} ${t.text}`}>
                {t.label}
              </span>
            );
          }},
          { key: 'is_claimed', header: 'Claimed', render: row => (
            <span className={`text-sm ${row.is_claimed ? 'text-verdigris' : 'text-gray-400'}`}>
              {row.is_claimed ? '✓ Claimed' : '○ Unclaimed'}
            </span>
          )},
          { key: 'id', header: '', render: row => (
            <button onClick={() => resync(String(row.id))} disabled={resyncing === String(row.id)}
              className="text-xs text-gray-400 hover:text-verdigris disabled:opacity-40 transition-colors">
              {resyncing === String(row.id) ? 'Syncing…' : 'Resync'}
            </button>
          )},
        ]}
        emptyMessage={loading ? 'Searching…' : 'No providers match the selected filters'}
      />

      <div className="flex items-center gap-3 mt-4">
        <span className="text-xs text-gray-400">{total} total providers</span>
        {page > 1 && (
          <button onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">← Prev</button>
        )}
        {displayed.length >= 20 && (
          <button onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Next →</button>
        )}
      </div>
    </div>
  );
}
