'use client';
import { useEffect, useState } from 'react';
import { adminApi, Credential } from '@/lib/adminClient';
import { DataTable } from '@/components/DataTable';

const TYPE_META: Record<string, { icon: string; label: string }> = {
  aadhaar:        { icon: '🪪', label: 'Aadhaar' },
  pan:            { icon: '🆔', label: 'PAN Card' },
  degree:         { icon: '🎓', label: 'Degree Certificate' },
  medical_license:{ icon: '⚕️', label: 'Medical License' },
  bar_council:    { icon: '⚖️', label: 'Bar Council' },
  gst:            { icon: '🏛',  label: 'GST Registration' },
  business_reg:   { icon: '📋', label: 'Business Registration' },
  trade_license:  { icon: '🏪', label: 'Trade License' },
  ca_certificate: { icon: '📊', label: 'CA Certificate' },
  fssai:          { icon: '🍽',  label: 'FSSAI License' },
};

const DOC_TYPES = [
  { value: '', label: 'All Documents' },
  ...Object.entries(TYPE_META).map(([k, v]) => ({ value: k, label: `${v.icon} ${v.label}` })),
];

export default function CredentialsPage() {
  const [creds, setCreds]       = useState<Credential[]>([]);
  const [docType, setDocType]   = useState('');
  const [selected, setSelected] = useState<Credential | null>(null);
  const [reason, setReason]     = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => { adminApi.getCredentialQueue().then(setCreds).catch(e => setError(e.message)); }, []);

  async function review(status: 'approved' | 'rejected') {
    if (!selected) return;
    if (status === 'rejected' && !reason.trim()) { setError('Rejection reason is required.'); return; }
    setBusy(true); setError('');
    try {
      await adminApi.reviewCredential(selected.id, status, reason || undefined);
      setCreds(prev => prev.filter(c => c.id !== selected.id));
      setSelected(null); setReason('');
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  // Client-side filter by doc type
  const displayed = docType === '' ? creds : creds.filter(c => c.verification_type === docType);

  // Group by overdue
  const overdue = displayed.filter(c => {
    const hrs = (Date.now() - new Date(c.created_at).getTime()) / 3600000;
    return hrs > 48;
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-deep-ink mb-1">Credential Review</h1>
      <p className="text-gray-400 text-sm mb-4">
        Approve or reject documents submitted by providers. 24–48h SLA.
        <span className="ml-2 text-verdigris font-medium">Approving adds +15 trust points.</span>
      </p>

      {overdue.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-terracotta">
          🔴 {overdue.length} credential{overdue.length > 1 ? 's' : ''} overdue (>48h SLA). Action required.
        </div>
      )}
      {creds.length > 0 && overdue.length === 0 && (
        <div className="bg-saffron/5 border border-saffron/20 rounded-xl p-3 mb-4 text-sm text-saffron">
          📋 {creds.length} credential{creds.length > 1 ? 's' : ''} pending. Click a row to review.
        </div>
      )}
      {error && <div className="text-terracotta p-3 bg-red-50 rounded-xl text-sm mb-4">{error}</div>}

      {/* Document type filter */}
      <div className="flex items-center gap-3 mb-4">
        <select value={docType} onChange={e => setDocType(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-verdigris cursor-pointer">
          {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {docType && (
          <button onClick={() => setDocType('')} className="text-xs text-gray-400 hover:text-deep-ink underline">
            Clear filter
          </button>
        )}
        <span className="text-xs text-gray-400">{displayed.length} showing</span>
      </div>

      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          <DataTable<Record<string, unknown>>
            data={displayed as unknown as Record<string, unknown>[]}
            onRowClick={row => { setSelected(row as unknown as Credential); setReason(''); setError(''); }}
            columns={[
              { key: 'provider', header: 'Provider', render: row => (
                <div>
                  <div className="font-medium text-deep-ink text-sm">{(row.provider as any)?.display_name ?? '—'}</div>
                  <div className="text-xs text-gray-400 capitalize">
                    {String((row.provider as any)?.listing_type ?? '').replace(/_/g,' ')}
                  </div>
                </div>
              )},
              { key: 'verification_type', header: 'Document', render: row => {
                const vt = String(row.verification_type ?? '');
                const meta = TYPE_META[vt] ?? { icon: '📄', label: vt };
                return (
                  <span className="flex items-center gap-1.5 text-sm">
                    <span>{meta.icon}</span>
                    <span>{meta.label}</span>
                  </span>
                );
              }},
              { key: 'created_at', header: 'Submitted', sortable: true, render: row => {
                const hrs = (Date.now() - new Date(String(row.created_at)).getTime()) / 3600000;
                const overdue = hrs > 48;
                return (
                  <div>
                    <div className="text-sm">{new Date(String(row.created_at)).toLocaleDateString('en-IN')}</div>
                    <div className={`text-xs ${overdue ? 'text-terracotta font-medium' : 'text-gray-400'}`}>
                      {overdue ? `🔴 ${Math.round(hrs)}h ago` : `${Math.round(hrs)}h ago`}
                    </div>
                  </div>
                );
              }},
            ]}
            emptyMessage="✅ Queue is empty — all credentials reviewed"
          />
        </div>

        {selected && (
          <div className="w-80 shrink-0">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sticky top-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-deep-ink">Review Document</h2>
                <button onClick={() => setSelected(null)} className="text-gray-300 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
              <div className="text-sm font-medium text-deep-ink mb-1">
                {(selected as any).provider?.display_name ?? 'Unknown Provider'}
              </div>
              <div className="text-xs text-gray-400 mb-3 capitalize">
                {String((selected as any).provider?.listing_type ?? '').replace(/_/g,' ')}
              </div>
              <div className="flex items-center gap-2 mb-4 p-3 bg-gray-50 rounded-xl">
                <span className="text-2xl">{TYPE_META[selected.verification_type]?.icon ?? '📄'}</span>
                <div>
                  <div className="text-sm font-medium text-deep-ink">{TYPE_META[selected.verification_type]?.label ?? selected.verification_type}</div>
                  <div className="text-xs text-gray-400">Submitted {new Date(selected.created_at).toLocaleDateString('en-IN')}</div>
                </div>
              </div>
              {(selected as any).document_url && (
                <a href={(selected as any).document_url} target="_blank" rel="noopener noreferrer"
                  className="block w-full py-2 text-center text-sm text-verdigris border border-verdigris/30 rounded-xl hover:bg-verdigris/5 transition-colors mb-4">
                  📎 View Document
                </a>
              )}
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                placeholder="Reason (required for rejection)…"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-verdigris resize-none mb-3" />
              <div className="flex gap-2">
                <button onClick={() => review('approved')} disabled={busy}
                  className="flex-1 py-2 bg-verdigris text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-green-800 transition-colors">
                  {busy ? '…' : '✓ Approve'}
                </button>
                <button onClick={() => review('rejected')} disabled={busy || !reason.trim()}
                  className="flex-1 py-2 bg-red-50 text-terracotta border border-terracotta/20 rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-red-100 transition-colors">
                  {busy ? '…' : '✕ Reject'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
