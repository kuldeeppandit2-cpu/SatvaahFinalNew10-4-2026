'use client';
import { useEffect, useState } from 'react';
import { adminApi, ScrapingStatus, ScrapingJob, ScrapingSource } from '@/lib/adminClient';

const STATUS: Record<string, { bg: string; text: string; label: string }> = {
  completed: { bg: 'bg-verdigris/10', text: 'text-verdigris', label: 'Completed' },
  running:   { bg: 'bg-blue-100',     text: 'text-blue-700',  label: 'Running' },
  failed:    { bg: 'bg-red-100',      text: 'text-red-700',   label: 'Failed' },
  queued:    { bg: 'bg-gray-100',     text: 'text-gray-500',  label: 'Queued' },
  pending:   { bg: 'bg-gray-100',     text: 'text-gray-500',  label: 'Pending' },
};

const GROUP_ORDER = ['Private Platforms', 'Government Registries', 'Professional Associations'];

export default function ScrapingPage() {
  const [data, setData]       = useState<ScrapingStatus | null>(null);
  const [sources, setSources] = useState<ScrapingSource[]>([]);
  const [error, setError]     = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'jobs' | 'sources'>('jobs');

  useEffect(() => {
    adminApi.getScrapingJobs()
      .then(setData)
      .catch(e => setError(e.message));
    adminApi.getScrapingSources()
      .then(setSources)
      .catch(() => {}); // non-blocking
  }, []);

  const handleToggle = async (src: ScrapingSource) => {
    setToggling(src.key);
    try {
      const updated = await adminApi.toggleScrapingSource(src.key, !src.enabled);
      setSources(prev => prev.map(s => s.key === src.key ? { ...s, enabled: updated.enabled } : s));
    } catch (e: any) {
      setError(e.message ?? 'Toggle failed');
    } finally {
      setToggling(null);
    }
  };

  const jobs: ScrapingJob[] = (data as any)?.jobs ?? (Array.isArray(data) ? data : []);
  const summary = (data as any)?.summary ?? [];
  const staged  = (data as any)?.staging_unprocessed ?? 0;

  const totalRecords  = jobs.reduce((s, j) => s + (j.records_scraped ?? 0), 0);
  const failed        = jobs.filter(j => j.status === 'failed').length;
  const enabledCount  = sources.filter(s => s.enabled).length;
  const disabledCount = sources.length - enabledCount;

  const grouped = GROUP_ORDER.map(group => ({
    group,
    items: sources.filter(s => s.group === group),
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-deep-ink">Scraping Control</h1>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {(['jobs', 'sources'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-white text-deep-ink shadow-sm'
                  : 'text-gray-500 hover:text-deep-ink'
              }`}
            >
              {tab === 'jobs' ? 'Job Monitor' : `Sources (${disabledCount > 0 ? `${disabledCount} off` : 'all on'})`}
            </button>
          ))}
        </div>
      </div>
      <p className="text-gray-400 text-sm mb-6">Pre-launch goal: 50,000 Hyderabad providers on Day 1</p>

      {error && <div className="text-red-600 p-3 bg-red-50 rounded-xl text-sm mb-4">{error}</div>}

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Records Scraped</div>
          <div className="text-3xl font-bold text-deep-ink">{totalRecords.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Staged Unprocessed</div>
          <div className="text-3xl font-bold text-deep-ink">{staged.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Sources Active</div>
          <div className="text-3xl font-bold text-verdigris">{enabledCount}<span className="text-base text-gray-400 font-normal">/{sources.length}</span></div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Jobs by Status</div>
          <div className="flex flex-col gap-1 mt-1">
            {summary.map((s: any) => (
              <div key={s.status} className="flex items-center justify-between text-sm">
                <span className="text-gray-500 capitalize">{s.status}</span>
                <span className="font-semibold text-deep-ink">{s.count}</span>
              </div>
            ))}
            {summary.length === 0 && <span className="text-gray-400 text-sm">No jobs yet</span>}
          </div>
        </div>
      </div>

      {/* JOB MONITOR TAB */}
      {activeTab === 'jobs' && (
        <>
          {failed > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-600">
              🔴 {failed} job{failed > 1 ? 's' : ''} failed. Check error logs below.
            </div>
          )}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-deep-ink">Recent Jobs</h2>
            </div>
            {jobs.length === 0 ? (
              <div className="px-5 py-10 text-center text-gray-400 text-sm">
                No scraping jobs yet. Jobs will appear here once scraping begins.
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {jobs.map((job: ScrapingJob) => {
                  const st = STATUS[job.status] ?? STATUS.queued;
                  const progress = job.records_scraped ?? 0;
                  return (
                    <div key={job.id} className="px-5 py-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <code className="text-sm font-mono font-medium text-deep-ink">
                            {job.job_name ?? job.jobType ?? '—'}
                          </code>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.bg} ${st.text}`}>
                            {st.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 max-w-48 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-verdigris"
                              style={{ width: `${Math.min(100, (progress / 50000) * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400">{progress.toLocaleString()} records</span>
                        </div>
                        {job.status === 'failed' && (job as any).error_log && (
                          <div className="mt-1 text-xs text-red-500 font-mono truncate">
                            {String((job as any).error_log).slice(0, 100)}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 shrink-0 text-right">
                        {job.created_at ? new Date(job.created_at).toLocaleString('en-IN') : '—'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* SOURCES TAB */}
      {activeTab === 'sources' && (
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
            ⚠️ Disabling a source prevents it from running in the next scraper execution.
            Changes take effect the next time the scraper is launched — existing data is unaffected.
          </div>

          {grouped.map(({ group, items }) => (
            <div key={group} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-deep-ink">{group}</h2>
                <span className="text-xs text-gray-400">
                  {items.filter(s => s.enabled).length}/{items.length} enabled
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {items.map((src) => (
                  <div key={src.key} className="px-5 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium text-sm ${src.enabled ? 'text-deep-ink' : 'text-gray-400'}`}>
                          {src.label}
                        </span>
                        {!src.enabled && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-500 font-medium">
                            Disabled
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 flex gap-3">
                        <span>{src.total_records.toLocaleString()} records</span>
                        {src.last_run && (
                          <span>Last: {new Date(src.last_run).toLocaleDateString('en-IN')}</span>
                        )}
                        <code className="font-mono">{src.key}</code>
                      </div>
                    </div>
                    {/* Toggle switch */}
                    <button
                      onClick={() => handleToggle(src)}
                      disabled={toggling === src.key}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        toggling === src.key
                          ? 'opacity-50 cursor-not-allowed bg-gray-300'
                          : src.enabled
                            ? 'bg-verdigris'
                            : 'bg-gray-300'
                      }`}
                      title={src.enabled ? `Disable ${src.label}` : `Enable ${src.label}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          src.enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
