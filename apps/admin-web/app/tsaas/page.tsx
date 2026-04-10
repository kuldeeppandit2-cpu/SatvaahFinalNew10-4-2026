'use client';
import { useEffect, useState } from 'react';
import { adminApi, TsaasKey } from '@/lib/adminClient';

const STATUS_FILTERS = [
  { value: 'all',     label: 'All' },
  { value: 'active',  label: '● Active' },
  { value: 'revoked', label: '○ Revoked' },
];

export default function TsaasPage() {
  const [keys, setKeys]       = useState<TsaasKey[]>([]);
  const [filter, setFilter]   = useState('all');
  const [busy, setBusy]       = useState<string | null>(null);
  const [error, setError]     = useState('');

  useEffect(() => { adminApi.getTsaasKeys().then(setKeys).catch(e => setError(e.message)); }, []);

  async function toggleKey(key: TsaasKey) {
    setBusy(key.id); setError('');
    try {
      if (key.is_active) await adminApi.revokeTsaas(key.id);
      else               await adminApi.approveTsaas(key.id);
      setKeys(prev => prev.map(k => k.id === key.id ? { ...k, is_active: !k.is_active } : k));
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  const displayed = filter === 'all' ? keys
    : filter === 'active' ? keys.filter(k => k.is_active)
    : keys.filter(k => !k.is_active);

  const active  = keys.filter(k => k.is_active).length;
  const nearLimit = keys.filter(k => k.is_active && k.monthly_limit > 0 && (k.calls_month / k.monthly_limit) >= 0.8).length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-deep-ink mb-1">TSaaS — B2B Trust API</h1>
      <p className="text-gray-400 text-sm mb-5">
        {keys.length} client{keys.length !== 1 ? 's' : ''} · <span className="text-verdigris font-medium">{active} active</span>
        {nearLimit > 0 && <span className="text-saffron font-medium ml-2">· {nearLimit} near monthly limit</span>}
      </p>
      {error && <div className="text-terracotta p-3 bg-red-50 rounded-xl text-sm mb-4">{error}</div>}

      {/* Filter */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit mb-4">
        {STATUS_FILTERS.map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              filter === f.value ? 'bg-white text-deep-ink shadow-sm' : 'text-gray-400 hover:text-gray-600'
            }`}>{f.label}</button>
        ))}
      </div>

      {displayed.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center text-gray-400 text-sm">
          No TSaaS API keys {filter !== 'all' ? `with status "${filter}"` : 'issued yet'}.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {displayed.map(key => {
            const usagePct = key.monthly_limit > 0 ? Math.round((key.calls_month / key.monthly_limit) * 100) : 0;
            const nearLimitKey = usagePct >= 80;
            return (
              <div key={key.id} className={`bg-white rounded-2xl border shadow-sm p-5 ${
                key.is_active ? 'border-verdigris/20' : 'border-gray-100 opacity-60'
              }`}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <code className="text-sm font-mono font-semibold text-deep-ink">{key.client_id}</code>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        key.is_active ? 'bg-verdigris/10 text-verdigris' : 'bg-gray-100 text-gray-400'
                      }`}>
                        {key.is_active ? '● Active' : '○ Revoked'}
                      </span>
                      {nearLimitKey && key.is_active && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                          ⚠ Near Limit
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mb-3">{key.client_email}</div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 max-w-48">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-400">Monthly usage</span>
                          <span className={`text-xs font-medium ${nearLimitKey ? 'text-saffron' : 'text-gray-400'}`}>
                            {key.calls_month.toLocaleString()} / {key.monthly_limit.toLocaleString()}
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${nearLimitKey ? 'bg-saffron' : 'bg-verdigris'}`}
                            style={{ width: `${Math.min(100, usagePct)}%` }} />
                        </div>
                      </div>
                      <span className={`text-sm font-semibold ${nearLimitKey ? 'text-saffron' : 'text-gray-500'}`}>
                        {usagePct}%
                      </span>
                    </div>
                    {key.last_used_at && (
                      <div className="text-xs text-gray-300 mt-2">
                        Last used {new Date(key.last_used_at).toLocaleDateString('en-IN')}
                      </div>
                    )}
                  </div>
                  <button onClick={() => toggleKey(key)} disabled={busy === key.id}
                    className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40 transition-colors ${
                      key.is_active
                        ? 'bg-red-50 text-terracotta hover:bg-red-100 border border-terracotta/20'
                        : 'bg-verdigris/10 text-verdigris hover:bg-verdigris/20'
                    }`}>
                    {busy === key.id ? '…' : key.is_active ? 'Revoke' : 'Activate'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
