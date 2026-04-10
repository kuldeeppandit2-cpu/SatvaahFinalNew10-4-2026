'use client';
import { useEffect, useState } from 'react';
import { adminApi, TrustConfigRow } from '@/lib/adminClient';

const LISTING_META: Record<string, { label: string; icon: string; desc: string }> = {
  individual_service:  { label: 'Individual Service', icon: '🔧', desc: 'Plumbers, electricians, tutors etc.' },
  expertise:           { label: 'Expertise',          icon: '🎓', desc: 'Doctors, lawyers, CAs etc.' },
  establishment:       { label: 'Establishment',      icon: '🏢', desc: 'Clinics, salons, restaurants etc.' },
  individual_product:  { label: 'Individual Product', icon: '📦', desc: 'Single sellers, artisans etc.' },
  product_brand:       { label: 'Product Brand',      icon: '🏷', desc: 'Multi-product brands etc.' },
};

const LISTING_TYPES = Object.keys(LISTING_META);

export default function TrustConfigPage() {
  const [rows, setRows]       = useState<TrustConfigRow[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState<Record<string, boolean>>({});
  const [saved, setSaved]     = useState<Record<string, boolean>>({});
  const [error, setError]     = useState('');

  useEffect(() => { adminApi.getTrustConfig().then(setRows).catch(e => setError(e.message)); }, []);

  async function handleSave(row: TrustConfigRow) {
    const newPts = parseInt(editing[row.id] ?? String(row.max_pts), 10);
    if (isNaN(newPts) || newPts < 0) { setError('Points must be 0 or more'); return; }
    setSaving(s => ({ ...s, [row.id]: true }));
    setError('');
    try {
      await adminApi.updateTrustConfig(row.id, newPts);
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, max_pts: newPts } : r));
      setEditing(e => { const n = { ...e }; delete n[row.id]; return n; });
      setSaved(s => ({ ...s, [row.id]: true }));
      setTimeout(() => setSaved(s => ({ ...s, [row.id]: false })), 2000);
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setSaving(s => ({ ...s, [row.id]: false })); }
  }

  const byType = (type: string) => rows.filter(r => r.listing_type === type);

  return (
    <div>
      <h1 className="text-2xl font-bold text-deep-ink mb-1">Trust Signal Weights</h1>
      <p className="text-gray-400 text-sm mb-6">
        Every provider type has its own set of trust signals. The bar shows each signal's share of the total point budget.
        <span className="ml-2 text-saffron font-medium">Changes affect all future trust calculations.</span>
      </p>
      {error && <div className="text-terracotta p-3 bg-red-50 rounded-xl text-sm mb-4">{error}</div>}

      <div className="flex flex-col gap-6">
        {LISTING_TYPES.map(type => {
          const signals = byType(type);
          if (!signals.length) return null;
          const meta = LISTING_META[type] ?? { label: type, icon: '📋', desc: '' };
          const rawMax = signals[0]?.raw_max_total ?? signals.reduce((s, r) => s + r.max_pts, 0);
          const currentTotal = signals.reduce((s, r) => s + r.max_pts, 0);

          return (
            <div key={type} className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-verdigris shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-verdigris/5 border-b border-gray-100">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{meta.icon}</span>
                  <div>
                    <h2 className="font-semibold text-deep-ink">{meta.label}</h2>
                    <p className="text-xs text-gray-400">{meta.desc}</p>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-sm font-mono font-semibold text-deep-ink">{currentTotal} pts</div>
                    <div className="text-xs text-gray-400">total signal budget</div>
                  </div>
                </div>
                {/* Budget distribution bar */}
                <div className="flex h-3 rounded-full overflow-hidden gap-px">
                  {signals.map((row, i) => {
                    const pct = rawMax > 0 ? (row.max_pts / rawMax) * 100 : 0;
                    const opacity = 0.4 + (i / signals.length) * 0.6;
                    return (
                      <div key={row.id} style={{ width: `${pct}%`, backgroundColor: `rgba(46,125,114,${opacity})` }}
                        title={`${row.signal_name}: ${row.max_pts} pts (${pct.toFixed(1)}%)`}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="divide-y divide-gray-50">
                {signals.map(row => {
                  const isEditing = editing[row.id] !== undefined;
                  const pct = rawMax > 0 ? (row.max_pts / rawMax) * 100 : 0;
                  return (
                    <div key={row.id} className={`px-6 py-3 flex items-center gap-4 transition-colors ${isEditing ? 'bg-saffron/3' : 'hover:bg-gray-50/50'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <code className="text-sm font-mono font-medium text-deep-ink">{row.signal_name}</code>
                          {!row.is_active && <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">inactive</span>}
                        </div>
                        {row.description && <p className="text-xs text-gray-400 leading-relaxed">{row.description}</p>}
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="flex-1 max-w-32 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div className="h-full rounded-full bg-verdigris" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-400">{pct.toFixed(0)}% of budget</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="number" min={0} max={200}
                          value={editing[row.id] ?? row.max_pts}
                          onChange={e => setEditing(ed => ({ ...ed, [row.id]: e.target.value }))}
                          className="w-20 text-right px-2 py-1.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-verdigris"
                        />
                        <span className="text-xs text-gray-400">pts</span>
                        {isEditing && (
                          <button onClick={() => setEditing(e => { const n = { ...e }; delete n[row.id]; return n; })}
                            className="text-xs text-gray-400 hover:text-deep-ink px-2 py-1 border border-gray-200 rounded">
                            Cancel
                          </button>
                        )}
                        <button onClick={() => handleSave(row)} disabled={saving[row.id] || !isEditing}
                          className="text-xs px-3 py-1.5 bg-verdigris text-white rounded-lg disabled:opacity-40 hover:bg-green-800 transition-colors min-w-[52px] text-center">
                          {saving[row.id] ? '…' : saved[row.id] ? '✓' : 'Save'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
