'use client';
import { useEffect, useState } from 'react';
import { adminApi, Dispute } from '@/lib/adminClient';
import { DataTable } from '@/components/DataTable';

const SEV: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-red-100',    text: 'text-red-700' },
  high:     { bg: 'bg-orange-100', text: 'text-orange-700' },
  medium:   { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  low:      { bg: 'bg-gray-100',   text: 'text-gray-600' },
};

const OUTCOMES = [
  { key: 'resolved',         label: 'Resolve — Flag Valid',        color: 'bg-terracotta text-white hover:bg-red-800' },
  { key: 'dismissed',        label: 'Dismiss — False Positive',    color: 'bg-gray-200 text-gray-700 hover:bg-gray-300' },
  { key: 'under_review',     label: 'Mark Under Review',           color: 'bg-blue-100 text-blue-700 hover:bg-blue-200' },
];

const STATUS_TABS = [
  { value: 'open',         label: 'Open',         dot: 'bg-red-500' },
  { value: 'under_review', label: 'Under Review',  dot: 'bg-amber-400' },
  { value: 'resolved',     label: 'Resolved',      dot: 'bg-verdigris' },
  { value: 'dismissed',    label: 'Dismissed',     dot: 'bg-gray-400' },
];

const SEV_FILTERS = ['all', 'critical', 'high', 'medium', 'low'];

export default function DisputesPage() {
  const [disputes, setDisputes]   = useState<Dispute[]>([]);
  const [status, setStatus]       = useState('open');
  const [sevFilter, setSevFilter] = useState('all');
  const [selected, setSelected]   = useState<Dispute | null>(null);
  const [note, setNote]           = useState('');
  const [resolving, setResolving] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [page, setPage]           = useState(1);
  const [total, setTotal]         = useState(0);
  const [error, setError]         = useState('');

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    adminApi.getDisputes(status, page)
      .then(d => {
        const data = (d as any);
        setDisputes(Array.isArray(d) ? d : data.disputes ?? []);
        setTotal(data.total ?? 0);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [status, page]);

  async function resolve(outcome: string) {
    if (!selected) return;
    setResolving(true);
    try {
      await adminApi.resolveDispute(selected.id, outcome, note);
      setDisputes(prev => prev.filter(d => d.id !== selected.id));
      setSelected(null); setNote('');
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setResolving(false); }
  }

  // Client-side severity filter
  const displayed = sevFilter === 'all' ? disputes
    : disputes.filter(d => d.severity === sevFilter);

  const critical = disputes.filter(d => d.severity === 'critical' || d.severity === 'high').length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-deep-ink mb-1">Disputes</h1>
      <p className="text-gray-400 text-sm mb-4">48h SLA from flag creation. Click a row to resolve.</p>

      {critical > 0 && status === 'open' && (
        <div className="bg-terracotta/5 border border-terracotta/20 rounded-xl p-3 mb-4 text-sm text-terracotta">
          🔴 {critical} critical/high severity dispute{critical > 1 ? 's' : ''} need immediate attention.
        </div>
      )}
      {error && <div className="text-terracotta p-3 bg-red-50 rounded-xl text-sm mb-4">{error}</div>}

      {/* Status tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4 w-fit">
        {STATUS_TABS.map(t => (
          <button key={t.value} onClick={() => { setStatus(t.value); setPage(1); setSevFilter('all'); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              status === t.value ? 'bg-white text-deep-ink shadow-sm' : 'text-gray-400 hover:text-gray-600'
            }`}>
            <span className={`w-2 h-2 rounded-full ${t.dot}`} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Severity filter */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-400 font-medium">Severity:</span>
        {SEV_FILTERS.map(s => (
          <button key={s} onClick={() => setSevFilter(s)}
            className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-all ${
              sevFilter === s ? 'bg-deep-ink text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}>
            {s === 'all' ? 'All' : s}
          </button>
        ))}
        {loading && <span className="text-xs text-gray-400 ml-2">Loading…</span>}
      </div>

      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          <DataTable<Record<string, unknown>>
            data={displayed as unknown as Record<string, unknown>[]}
            onRowClick={row => { setSelected(row as unknown as Dispute); setNote(''); }}
            columns={[
              { key: 'provider', header: 'Provider', render: row => (
                <div>
                  <div className="font-medium text-deep-ink text-sm">{(row.provider as any)?.display_name ?? '—'}</div>
                  <div className="text-xs text-gray-400">{String(row.flag_type ?? '').replace(/_/g, ' ')}</div>
                </div>
              )},
              { key: 'severity', header: 'Severity', render: row => {
                const s = SEV[String(row.severity)] ?? SEV.low;
                return (
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${s.bg} ${s.text}`}>
                    {String(row.severity ?? '—')}
                  </span>
                );
              }},
              { key: 'status', header: 'Status', render: row => (
                <span className="text-xs text-gray-500 capitalize">{String(row.status ?? '').replace(/_/g,' ')}</span>
              )},
              { key: 'created_at', header: 'Flagged', sortable: true, render: row =>
                new Date(String(row.created_at)).toLocaleDateString('en-IN')
              },
            ]}
            emptyMessage={loading ? 'Loading…' : `No ${status.replace('_',' ')} disputes`}
          />
          <div className="flex items-center gap-3 mt-4">
            <span className="text-xs text-gray-400">{total} total</span>
            {page > 1 && (
              <button onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">← Prev</button>
            )}
            {displayed.length >= 50 && (
              <button onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Next →</button>
            )}
          </div>
        </div>

        {selected && (
          <div className="w-80 shrink-0">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sticky top-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-deep-ink">Resolve Dispute</h2>
                <button onClick={() => setSelected(null)} className="text-gray-300 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
              <div className="text-sm text-gray-600 mb-1 font-medium">{(selected as any).provider?.display_name ?? 'Unknown Provider'}</div>
              <div className="text-xs text-gray-400 mb-1 capitalize">{String(selected.flag_type ?? '').replace(/_/g,' ')}</div>
              <div className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mb-4 capitalize ${(SEV[selected.severity??'low']??SEV.low).bg} ${(SEV[selected.severity??'low']??SEV.low).text}`}>
                {selected.severity ?? 'low'}
              </div>
              {selected.evidence && (
                <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 mb-4 max-h-24 overflow-y-auto font-mono">
                  {JSON.stringify(selected.evidence, null, 2)}
                </div>
              )}
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                placeholder="Admin note (required for resolution)…"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-verdigris resize-none mb-4" />
              <div className="flex flex-col gap-2">
                {OUTCOMES.map(o => (
                  <button key={o.key} disabled={resolving || !note.trim()}
                    onClick={() => resolve(o.key)}
                    className={`w-full py-2 px-3 rounded-xl text-sm font-medium disabled:opacity-40 transition-colors ${o.color}`}>
                    {resolving ? 'Saving…' : o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
