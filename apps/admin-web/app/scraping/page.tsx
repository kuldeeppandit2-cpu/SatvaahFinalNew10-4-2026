'use client';
import { useEffect, useState } from 'react';
import { adminApi, ScrapingStatus, ScrapingJob } from '@/lib/adminClient';

const STATUS: Record<string, { bg: string; text: string; label: string }> = {
  completed: { bg: 'bg-verdigris/10', text: 'text-verdigris', label: 'Completed' },
  running:   { bg: 'bg-blue-100',     text: 'text-blue-700',  label: 'Running' },
  failed:    { bg: 'bg-red-100',      text: 'text-red-700',   label: 'Failed' },
  queued:    { bg: 'bg-gray-100',     text: 'text-gray-500',  label: 'Queued' },
  pending:   { bg: 'bg-gray-100',     text: 'text-gray-500',  label: 'Pending' },
};

export default function ScrapingPage() {
  const [data, setData] = useState<ScrapingStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { adminApi.getScrapingJobs().then(setData).catch(e => setError(e.message)); }, []);

  const jobs: ScrapingJob[] = (data as any)?.jobs ?? (Array.isArray(data) ? data : []);
  const summary = (data as any)?.summary ?? [];
  const staged = (data as any)?.staging_unprocessed ?? 0;

  const totalRecords = jobs.reduce((s, j) => s + (j.records_scraped ?? 0), 0);
  const failed = jobs.filter(j => j.status === 'failed').length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-deep-ink mb-1">Scraping Monitor</h1>
      <p className="text-gray-400 text-sm mb-6">Pre-launch goal: 50,000 Hyderabad providers on Day 1</p>
      {error && <div className="text-terracotta p-3 bg-red-50 rounded-xl text-sm mb-4">{error}</div>}
      {failed > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-terracotta">
          🔴 {failed} job{failed > 1 ? 's' : ''} failed. Check error logs below.
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Total Records Scraped</div>
          <div className="text-3xl font-bold text-deep-ink">{totalRecords.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Staged for Processing</div>
          <div className="text-3xl font-bold text-deep-ink">{staged.toLocaleString()}</div>
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

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-deep-ink">Recent Jobs</h2>
        </div>
        {jobs.length === 0 ? (
          <div className="px-5 py-10 text-center text-gray-400 text-sm">No scraping jobs yet. Jobs will appear here once scraping begins.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {jobs.map((job: ScrapingJob) => {
              const st = STATUS[job.status] ?? STATUS.queued;
              const progress = job.records_scraped ?? 0;
              return (
                <div key={job.id} className="px-5 py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-sm font-mono font-medium text-deep-ink">{job.job_name ?? job.jobType ?? '—'}</code>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.bg} ${st.text}`}>{st.label}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 max-w-48 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div className="h-full rounded-full bg-verdigris" style={{ width: `${Math.min(100, (progress / 50000) * 100)}%` }} />
                      </div>
                      <span className="text-xs text-gray-400">{progress.toLocaleString()} records</span>
                    </div>
                    {job.status === 'failed' && job.error_log && (
                      <div className="mt-1 text-xs text-terracotta font-mono truncate">{String(job.error_log).slice(0, 100)}</div>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 shrink-0 text-right">
                    {job.started_at ? new Date(job.started_at).toLocaleString('en-IN') : '—'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
