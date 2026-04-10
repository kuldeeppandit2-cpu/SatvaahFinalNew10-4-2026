'use client';
import { useEffect, useState } from 'react';
import { adminApi, NotifRow } from '@/lib/adminClient';
import { DataTable } from '@/components/DataTable';

const CHANNELS = [
  { value: '',          label: 'All Channels' },
  { value: 'fcm',       label: '📱 FCM' },
  { value: 'whatsapp',  label: '💬 WhatsApp' },
];

const EVENT_TYPES = [
  { value: '',                    label: 'All Events' },
  { value: 'new_lead',            label: 'New Lead' },
  { value: 'lead_accepted',       label: 'Lead Accepted' },
  { value: 'lead_declined',       label: 'Lead Declined' },
  { value: 'lead_expired',        label: 'Lead Expired' },
  { value: 'no_show_reported',    label: 'No-show Reported' },
  { value: 'trust_score_updated', label: 'Trust Score Updated' },
  { value: 'subscription_active', label: 'Subscription Active' },
  { value: 'credential_approved', label: 'Credential Approved' },
  { value: 'credential_rejected', label: 'Credential Rejected' },
  { value: 'certificate_issued',  label: 'Certificate Issued' },
];

const DELIVERY = [
  { value: 'all',       label: 'All' },
  { value: 'delivered', label: '✓ Delivered' },
  { value: 'pending',   label: '⏳ Pending' },
];

const selectCls = 'px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-verdigris cursor-pointer';

export default function NotificationsPage() {
  const [notifs, setNotifs]       = useState<NotifRow[]>([]);
  const [channel, setChannel]     = useState('');
  const [eventType, setEventType] = useState('');
  const [delivery, setDelivery]   = useState('all');
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [error, setError]         = useState('');

  useEffect(() => {
    setLoading(true);
    adminApi.getNotifications(channel || undefined, eventType || undefined, page)
      .then(d => {
        setNotifs(Array.isArray(d) ? d : (d as any).logs ?? []);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [channel, eventType, page]);

  // Client-side delivery filter
  const displayed = delivery === 'all' ? notifs
    : delivery === 'delivered' ? notifs.filter(n => n.delivered_at)
    : notifs.filter(n => !n.delivered_at);

  const delivered = notifs.filter(n => n.delivered_at).length;
  const pending   = notifs.filter(n => !n.delivered_at).length;
  const rate      = notifs.length > 0 ? Math.round((delivered / notifs.length) * 100) : 0;

  async function resend(id: string) {
    setResending(id);
    try {
      await adminApi.resendNotif(id);
      setNotifs(prev => prev.map(n => n.id === id ? { ...n, sent_at: new Date().toISOString() } : n));
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setResending(null); }
  }

  function reset() { setChannel(''); setEventType(''); setDelivery('all'); setPage(1); }

  return (
    <div>
      <h1 className="text-2xl font-bold text-deep-ink mb-1">Notification Log</h1>
      <p className="text-gray-400 text-sm mb-5">FCM + WhatsApp events. Filter by channel, event type, or delivery status.</p>

      {/* KPI strip */}
      {notifs.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Showing</div>
            <div className="text-3xl font-bold text-deep-ink">{notifs.length.toLocaleString()}</div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Delivery Rate</div>
            <div className={`text-3xl font-bold ${rate < 70 ? 'text-terracotta' : rate < 90 ? 'text-saffron' : 'text-verdigris'}`}>{rate}%</div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Pending Delivery</div>
            <div className={`text-3xl font-bold ${pending > 10 ? 'text-saffron' : 'text-deep-ink'}`}>{pending}</div>
          </div>
        </div>
      )}

      {error && <div className="text-terracotta p-3 bg-red-50 rounded-xl text-sm mb-4">{error}</div>}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select value={channel} onChange={e => { setChannel(e.target.value); setPage(1); }} className={selectCls}>
          {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        <select value={eventType} onChange={e => { setEventType(e.target.value); setPage(1); }} className={selectCls}>
          {EVENT_TYPES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>

        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {DELIVERY.map(d => (
            <button key={d.value} onClick={() => setDelivery(d.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${delivery === d.value ? 'bg-white text-deep-ink shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
              {d.label}
            </button>
          ))}
        </div>

        {(channel || eventType || delivery !== 'all') && (
          <button onClick={reset} className="text-xs text-gray-400 hover:text-deep-ink underline">Clear filters</button>
        )}
        {loading && <span className="text-xs text-gray-400">Loading…</span>}
      </div>

      <DataTable<Record<string, unknown>>
        data={displayed as unknown as Record<string, unknown>[]}
        columns={[
          { key: 'channel', header: 'Channel', render: row => (
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
              String(row.channel) === 'fcm' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
            }`}>
              {String(row.channel) === 'fcm' ? '📱' : '💬'} {String(row.channel).toUpperCase()}
            </span>
          )},
          { key: 'event_type', header: 'Event', sortable: true, render: row => (
            <code className="text-xs font-mono text-gray-600">{String(row.event_type ?? '—')}</code>
          )},
          { key: 'sent_at', header: 'Sent', sortable: true, render: row =>
            new Date(String(row.sent_at)).toLocaleString('en-IN')
          },
          { key: 'delivered_at', header: 'Delivered', render: row => row.delivered_at
            ? <span className="text-verdigris text-sm">✓ {new Date(String(row.delivered_at)).toLocaleTimeString('en-IN')}</span>
            : <span className="text-gray-400 text-xs">Pending</span>
          },
          { key: 'wa_fallback_sent', header: 'WA Fallback', render: row => (
            <span className={row.wa_fallback_sent ? 'text-green-600 text-sm' : 'text-gray-300 text-sm'}>
              {row.wa_fallback_sent ? '✓' : '—'}
            </span>
          )},
          { key: 'id', header: '', render: row => (
            <button onClick={() => resend(String(row.id))} disabled={resending === String(row.id)}
              className="text-xs text-verdigris hover:underline disabled:opacity-40">
              {resending === String(row.id) ? 'Sending…' : 'Resend'}
            </button>
          )},
        ]}
        emptyMessage={loading ? 'Loading…' : 'No notifications match the selected filters'}
      />

      {/* Pagination */}
      {notifs.length >= 50 && (
        <div className="flex items-center gap-3 mt-4">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">
            ← Prev
          </button>
          <span className="text-sm text-gray-400">Page {page}</span>
          <button onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
