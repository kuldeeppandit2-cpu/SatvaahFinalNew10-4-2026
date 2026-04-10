'use client';
import { useEffect, useState, useCallback } from 'react';
import { adminApi, DashboardStats } from '@/lib/adminClient';

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtN   = (n: number) => n.toLocaleString('en-IN');
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtRupees = (paise: number) => {
  const r = paise / 100;
  if (r >= 10_00_000) return `₹${(r/10_00_000).toFixed(2)}Cr`;
  if (r >= 1_00_000)  return `₹${(r/1_00_000).toFixed(2)}L`;
  if (r >= 1_000)     return `₹${(r/1_000).toFixed(1)}K`;
  return r === 0 ? '₹0' : `₹${r.toFixed(0)}`;
};

// ── Health dot ────────────────────────────────────────────────────────────────
function Dot({ s }: { s: 'green'|'amber'|'red'|'grey' }) {
  const c = { green:'bg-emerald-500', amber:'bg-amber-400', red:'bg-red-500', grey:'bg-gray-300' };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${c[s]}`} />;
}

// ── Delta ─────────────────────────────────────────────────────────────────────
function Delta({ pct, good='high' }: { pct: number|null; good?: 'high'|'low' }) {
  if (pct === null || pct === 0) return <span className="text-xs text-gray-300">—</span>;
  const up = pct > 0;
  const isGood = good === 'high' ? up : !up;
  return (
    <span className={`text-xs font-semibold ${isGood?'text-emerald-600':'text-red-500'}`}>
      {up?'▲':'▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color = '#2E7D72', height = 40 }: {
  data: number[]; color?: string; height?: number;
}) {
  if (!data || data.length < 2) return <div style={{ height }} className="bg-gray-50 rounded" />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 200;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={`0,${height} ${pts.join(' ')} ${w},${height}`}
        fill={color}
        fillOpacity="0.1"
        stroke="none"
      />
    </svg>
  );
}

// ── Trend Card ────────────────────────────────────────────────────────────────
function TrendCard({ label, value, delta, data, color, formatter, health }: {
  label: string;
  value: string;
  delta?: number | null;
  data: number[];
  color: string;
  formatter?: (n: number) => string;
  health?: 'green'|'amber'|'red'|'grey';
}) {
  const last = data[data.length - 1] ?? 0;
  const prev = data[data.length - 2] ?? 0;
  const dayDelta = prev > 0 ? ((last - prev) / prev) * 100 : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 uppercase tracking-widest font-medium">{label}</span>
        {health && <Dot s={health} />}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-deep-ink">{value}</span>
        {delta !== undefined && <Delta pct={delta} />}
      </div>
      <Sparkline data={data} color={color} height={40} />
      <div className="flex justify-between text-xs text-gray-400">
        <span>Today: {formatter ? formatter(last) : fmtN(last)}</span>
        <Delta pct={dayDelta} />
      </div>
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, delta, sub, accent, health }: {
  label: string; value: string; delta?: number|null; sub?: string;
  accent?: string; health?: 'green'|'amber'|'red'|'grey';
}) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <span className="text-gray-400 text-xs font-medium uppercase tracking-widest">{label}</span>
        {health && <Dot s={health} />}
      </div>
      <div className="text-3xl font-bold mt-1" style={{ color: accent ?? '#1C1C2E' }}>{value}</div>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {delta !== undefined && <Delta pct={delta} />}
        {sub && <span className="text-xs text-gray-400">{sub}</span>}
      </div>
    </div>
  );
}

const TIER = {
  highly_trusted: { label:'Highly Trusted', color:'#2E7D72' },
  trusted:        { label:'Trusted',         color:'#6BA89E' },
  basic:          { label:'Basic',           color:'#C8691A' },
  unverified:     { label:'Unverified',      color:'#9CA3AF' },
};

function SectionLabel({ text }: { text: string }) {
  return <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{text}</div>;
}

// ── Period config ─────────────────────────────────────────────────────────────
const PERIODS = [
  { id:'wtd',  label:'WTD',  tooltip:'Week to date (since Monday)' },
  { id:'mtd',  label:'MTD',  tooltip:'Month to date (since 1st)' },
  { id:'ytd',  label:'YTD',  tooltip:'Year to date (since Apr 1, India FY)' },
  { id:'ltd',  label:'LTD',  tooltip:'Launch to date (since Jan 1, 2025)' },
  { id:'7d',   label:'7D',   tooltip:'Rolling last 7 days' },
  { id:'30d',  label:'30D',  tooltip:'Rolling last 30 days' },
  { id:'90d',  label:'90D',  tooltip:'Rolling last 90 days' },
];

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats, setStats]   = useState<DashboardStats | null>(null);
  const [error, setError]   = useState('');
  const [period, setPeriod] = useState('mtd');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    adminApi.getDashboardStats()
      .then(s => { setStats(s); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [period]);

  if (error) return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>
  );
  if (loading || !stats) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-verdigris border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-gray-400">Loading platform intelligence…</span>
      </div>
    </div>
  );

  const tierTotal      = stats.trust_tier_breakdown.reduce((a,b) => a+b.count, 0);
  const fcmPct         = stats.fcm_delivery_rate_24h != null ? stats.fcm_delivery_rate_24h * 100 : null;
  const fcmHealth: 'green'|'amber'|'red'|'grey' = fcmPct==null?'grey':fcmPct>=80?'green':fcmPct>=70?'amber':'red';
  const credHealth: 'green'|'amber'|'red' = stats.pending_cred_over48h>0?'red':stats.pending_credentials>5?'amber':'green';
  const dispHealth: 'green'|'amber'|'red' = stats.open_disputes>10?'red':stats.open_disputes>0?'amber':'green';
  const payingConsumers = Object.values(stats.subs_by_tier).reduce((a,b)=>a+b.count,0);

  // Extract daily trend arrays
  const T = stats.daily_trends ?? [];
  const tDau     = T.map(d => d.dau);
  const tLeads   = T.map(d => d.leads);
  const tNewUsers = T.map(d => d.new_users);
  const tRevenue = T.map(d => d.revenue_paise);
  const tSubs    = T.map(d => d.active_subs);
  const tArpu    = T.map((d, i) => d.active_subs > 0 ? Math.round(d.revenue_paise / d.active_subs) : 0);

  return (
    <div className="flex flex-col gap-6 pb-10">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-deep-ink">Platform Intelligence</h1>
          <p className="text-gray-400 text-xs mt-0.5">
            {new Date(stats.computed_at).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})}
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
          {PERIODS.map(p => (
            <button key={p.id} title={p.tooltip} onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                ${period===p.id?'bg-white text-deep-ink shadow-sm':'text-gray-400 hover:text-gray-600'}`}
            >{p.label}</button>
          ))}
        </div>
      </div>

      {/* ── Alert strip ────────────────────────────────────────────────── */}
      {stats.insights.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="text-xs font-bold text-amber-800 uppercase tracking-widest mb-2">⚠ Signals Requiring Attention</div>
          {stats.insights.map((s,i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-amber-800 mb-1">
              <span className="shrink-0">•</span><span>{s}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Vital Signs ─────────────────────────────────────────────────── */}
      <div>
        <SectionLabel text="Vital Signs" />
        <div className="grid grid-cols-5 gap-3">
          <KpiCard label="Total Users"      value={fmtN(stats.total_users)}
            sub={`${fmtN(stats.total_providers)} prov · ${fmtN(stats.total_consumers)} cons`} />
          <KpiCard label="Active This Period" value={fmtN(stats.mau)}
            delta={stats.mau_delta_pct} sub="contacted or searched" />
          <KpiCard label="Leads Generated"  value={fmtN(stats.leads_total)}
            delta={stats.leads_delta_pct} accent="#2E7D72"
            health={stats.acceptance_rate_pct>=60?'green':stats.acceptance_rate_pct>=40?'amber':'red'} />
          <KpiCard label="MRR"              value={fmtRupees(stats.mrr_paise)}
            sub={`ARR ${fmtRupees(stats.arr_paise)}`} accent="#C8691A"
            health={stats.mrr_paise>0?'green':'grey'} />
          <KpiCard label="Avg Trust Score"  value={stats.avg_trust_score>0?stats.avg_trust_score.toFixed(1):'—'}
            sub={`${fmtN(stats.certificates_issued)} certs`} accent="#2E7D72"
            health={stats.avg_trust_score>=60?'green':stats.avg_trust_score>=40?'amber':stats.avg_trust_score>0?'red':'grey'} />
        </div>
      </div>

      {/* ── Trend Lines ─────────────────────────────────────────────────── */}
      {T.length > 1 && (
        <div>
          <SectionLabel text={`Trend Lines — ${stats.period ?? period} · ${T.length} day${T.length!==1?'s':''}`} />
          <div className="grid grid-cols-3 gap-3">
            <TrendCard label="Daily Active Users" value={fmtN(stats.mau)}
              delta={stats.mau_delta_pct} data={tDau} color="#2E7D72" />
            <TrendCard label="Daily Leads"        value={fmtN(stats.leads_total)}
              delta={stats.leads_delta_pct} data={tLeads} color="#6BA89E" />
            <TrendCard label="New Users / Day"    value={fmtN(stats.new_providers + stats.new_consumers)}
              data={tNewUsers} color="#4A90D9" />
            <TrendCard label="Daily Revenue"      value={fmtRupees(stats.mrr_paise)}
              data={tRevenue} color="#C8691A" formatter={fmtRupees}
              health={stats.mrr_paise>0?'green':'grey'} />
            <TrendCard label="Active Subscribers" value={fmtN(stats.active_subscriptions)}
              data={tSubs} color="#7B5EA7" />
            <TrendCard label="ARPU / Day"         value={fmtRupees(stats.arpu_paise)}
              data={tArpu} color="#E8A838" formatter={fmtRupees} />
          </div>
          {T.length === 0 && (
            <div className="text-center py-8 text-gray-300 text-sm bg-white rounded-2xl border border-gray-100">
              Trend data will appear once platform activity begins
            </div>
          )}
        </div>
      )}

      {/* ── Supply & Demand ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Providers */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionLabel text="Supply — Providers" />
          <div className="grid grid-cols-3 gap-3 mb-5 pb-5 border-b border-gray-50">
            <div>
              <div className="text-2xl font-bold text-deep-ink">{fmtN(stats.total_providers)}</div>
              <div className="text-xs text-gray-400 mt-0.5">Total</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-verdigris">{fmtN(stats.claimed_providers)}</div>
              <div className="text-xs text-gray-400 mt-0.5">Claimed ({fmtPct(stats.claim_rate_pct)})</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-saffron">+{fmtN(stats.new_providers)}</div>
              <div className="text-xs text-gray-400 mt-0.5">New <Delta pct={stats.new_providers_delta_pct} /></div>
            </div>
          </div>
          <div className="text-xs font-semibold text-gray-500 mb-3">Trust Distribution</div>
          {(['highly_trusted','trusted','basic','unverified'] as const).map(tier => {
            const meta = TIER[tier];
            const row = stats.trust_tier_breakdown.find(t=>t.tier===tier);
            const count = row?.count ?? 0;
            const avgS  = row?.avg_score ?? 0;
            const pctV  = tierTotal>0?(count/tierTotal)*100:0;
            return (
              <div key={tier} className="mb-2.5">
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-gray-600">{meta.label}</span>
                  <span className="text-xs text-gray-400">{fmtN(count)} · avg {avgS.toFixed(0)}</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{width:`${pctV}%`,backgroundColor:meta.color}} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Consumers */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionLabel text="Demand — Consumers" />
          <div className="grid grid-cols-3 gap-3 mb-5 pb-5 border-b border-gray-50">
            <div>
              <div className="text-2xl font-bold text-deep-ink">{fmtN(stats.total_consumers)}</div>
              <div className="text-xs text-gray-400 mt-0.5">Total</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-verdigris">{fmtN(payingConsumers)}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                Paying ({stats.total_consumers>0?fmtPct((payingConsumers/stats.total_consumers)*100):'0%'})
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-saffron">+{fmtN(stats.new_consumers)}</div>
              <div className="text-xs text-gray-400 mt-0.5">New <Delta pct={stats.new_consumers_delta_pct} /></div>
            </div>
          </div>
          <div className="text-xs font-semibold text-gray-500 mb-3">Subscriptions</div>
          {(['gold','silver','free'] as const).map(tier => {
            const data = stats.subs_by_tier[tier as string];
            const count = data?.count ?? 0;
            const rev   = data?.total_paise ?? 0;
            const color = tier==='gold'?'#C8691A':tier==='silver'?'#6BA89E':'#9CA3AF';
            const maxC  = Math.max(...(['gold','silver','free'].map(t=>stats.subs_by_tier[t]?.count??0)),1);
            return (
              <div key={tier} className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{backgroundColor:color}} />
                    <span className="text-sm font-medium capitalize text-deep-ink">{tier}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-deep-ink">{fmtN(count)}</span>
                    {rev>0 && <span className="text-xs text-gray-400">{fmtRupees(rev)}/mo</span>}
                  </div>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{width:`${(count/maxC)*100}%`,backgroundColor:color}} />
                </div>
              </div>
            );
          })}
          <div className="mt-3 pt-3 border-t border-gray-50 flex justify-between text-xs text-gray-400">
            <span>ARPU</span>
            <span className="font-semibold text-deep-ink">{fmtRupees(stats.arpu_paise)}/mo</span>
          </div>
        </div>
      </div>

      {/* ── Lead Funnel ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-5">
          <SectionLabel text="Lead Funnel" />
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Dot s={stats.acceptance_rate_pct>=60?'green':stats.acceptance_rate_pct>=40?'amber':'red'} />
            <span>{fmtPct(stats.acceptance_rate_pct)} acceptance</span>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-2 mb-5">
          {[
            { label:'Searches',  value:stats.searches,          color:'#4A90D9', conv:null },
            { label:'Leads',     value:stats.leads_total,       color:'#2E7D72', conv:stats.searches>0?stats.leads_total/stats.searches:null },
            { label:'Accepted',  value:stats.leads_accepted,    color:'#6BA89E', conv:stats.leads_total>0?stats.leads_accepted/stats.leads_total:null },
            { label:'Completed', value:stats.leads_completed,   color:'#C8691A', conv:stats.leads_accepted>0?stats.leads_completed/stats.leads_accepted:null },
            { label:'Rated',     value:stats.ratings_submitted, color:'#8B8680', conv:stats.leads_completed>0?stats.ratings_submitted/stats.leads_completed:null },
          ].map((s,i) => (
            <div key={i} className="rounded-xl p-4 text-center relative"
              style={{backgroundColor:s.color+'18',border:`1px solid ${s.color}33`}}>
              {s.conv!==null && (
                <div className="absolute -left-3 top-1/2 -translate-y-1/2 text-xs text-gray-300 z-10">
                  {(s.conv*100).toFixed(0)}%→
                </div>
              )}
              <div className="text-2xl font-bold text-deep-ink">{fmtN(s.value)}</div>
              <div className="text-xs text-gray-500 mt-1">{s.label}</div>
              {s.conv!==null && (
                <div className="text-xs font-semibold mt-1" style={{color:s.color}}>
                  {(s.conv*100).toFixed(0)}% conv.
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-50">
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-3">Conversion Rates</div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label:'Search→Lead', val:stats.search_to_lead_pct, thresh:30 },
                { label:'Acceptance',  val:stats.acceptance_rate_pct, thresh:60 },
                { label:'Completion',  val:stats.completion_rate_pct, thresh:70 },
                { label:'No-show ↓',   val:stats.no_show_rate_pct,    thresh:null, badThresh:15 },
              ].map(r => {
                const h = r.badThresh!=null
                  ? r.val>r.badThresh?'text-red-500':r.val>r.badThresh*.66?'text-amber-500':'text-emerald-600'
                  : r.thresh!=null
                    ? r.val>=r.thresh?'text-emerald-600':r.val>=r.thresh*.6?'text-amber-500':'text-red-500'
                    : 'text-gray-600';
                return (
                  <div key={r.label} className="bg-gray-50 rounded-xl p-3">
                    <div className={`text-xl font-bold ${h}`}>{fmtPct(r.val)}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{r.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-3">By Contact Type</div>
            {[
              { label:'📞 Phone Call',   value:stats.leads_calls,        color:'#2E7D72' },
              { label:'💬 Message',      value:stats.leads_messages,     color:'#6BA89E' },
              { label:'📅 Slot Booking', value:stats.leads_slot_bookings,color:'#C8691A' },
            ].map(t => {
              const pctV = stats.leads_total>0?(t.value/stats.leads_total*100):0;
              return (
                <div key={t.label} className="flex items-center gap-3 mb-2">
                  <span className="text-xs text-gray-600 w-28">{t.label}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${pctV}%`,backgroundColor:t.color}} />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right">{fmtN(t.value)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Revenue + Operational ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionLabel text="Revenue" />
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-saffron rounded-xl p-3 text-white">
              <div className="text-xs opacity-70 mb-1">MRR</div>
              <div className="text-xl font-bold">{fmtRupees(stats.mrr_paise)}</div>
            </div>
            <div className="bg-verdigris rounded-xl p-3 text-white">
              <div className="text-xs opacity-70 mb-1">ARR</div>
              <div className="text-xl font-bold">{fmtRupees(stats.arr_paise)}</div>
            </div>
            <div className="bg-deep-ink rounded-xl p-3 text-white">
              <div className="text-xs opacity-70 mb-1">ARPU</div>
              <div className="text-xl font-bold">{fmtRupees(stats.arpu_paise)}</div>
            </div>
          </div>
          {stats.mrr_paise === 0 ? (
            <div className="text-center py-4 text-gray-300 text-sm">Revenue appears when consumers subscribe</div>
          ) : (
            <>
              <div className="text-xs font-semibold text-gray-500 mb-3">By Plan</div>
              {(['gold','silver'] as const).map(tier => {
                const data = stats.subs_by_tier[tier as string];
                if (!data?.count) return null;
                const color = tier==='gold'?'#C8691A':'#6BA89E';
                return (
                  <div key={tier} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{backgroundColor:color}} />
                      <span className="text-sm capitalize text-deep-ink">{tier}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-gray-400">{fmtN(data.count)} subs</span>
                      <span className="font-bold text-deep-ink">{fmtRupees(data.total_paise)}</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionLabel text="Operational Health" />
          {[
            { label:'Credentials Pending', value:stats.pending_credentials,
              sub: stats.pending_cred_over48h>0?`${stats.pending_cred_over48h} overdue >48h SLA`:'24–48h SLA',
              health: credHealth },
            { label:'Open Disputes', value:stats.open_disputes,
              sub:'48h resolution target', health: dispHealth },
            { label:'FCM Delivery 24h', value: fcmPct!=null?`${fcmPct.toFixed(0)}%`:'No data',
              sub:'Alert threshold <70%', health: fcmHealth },
            { label:'Certs Active', value:stats.certificates_issued,
              sub:'Highly Trusted verified', health:'green' as const },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 mb-2">
              <div className="flex items-center gap-3">
                <Dot s={item.health} />
                <div>
                  <div className="text-sm font-medium text-deep-ink">{item.label}</div>
                  <div className="text-xs text-gray-400">{item.sub}</div>
                </div>
              </div>
              <div className="text-xl font-bold text-deep-ink">
                {typeof item.value==='number'?fmtN(item.value):item.value}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
