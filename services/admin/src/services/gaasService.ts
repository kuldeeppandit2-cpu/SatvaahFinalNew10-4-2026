/**
 * gaasService.ts — Generate Analytics As a Service (GaaS)
 * services/admin/src/services/gaasService.ts
 *
 * Generates plain-language analytics narration for provider dashboards.
 * Powered by Claude Sonnet 4.6 (Anthropic API).
 *
 * Caching strategy:
 *   Key:  gaas:narration:{provider_id: providerId}:{period}:{YYYY-MM-DD}  (IST date)
 *   TTL:  seconds remaining until midnight IST
 *   Once per provider per period per calendar day.
 *
 * Non-blocking: route handler catches errors and returns null narration
 * on any failure — analytics data is always returned.
 *
 * Master Context: "AI: Claude Sonnet 4.6 (Anthropic API) + Gemini"
 */

import Redis from 'ioredis';
import { logger } from '@satvaaah/logger';
import { adminService, ProviderAnalyticsData } from './adminService';

// ---------------------------------------------------------------------------
// Redis — shared cache
// ---------------------------------------------------------------------------

const redis = new Redis({
  host:           process.env.REDIS_HOST ?? 'satvaaah-redis',   // Critical Rule #10
  port:           Number(process.env.REDIS_PORT ?? 6379),
  password:       process.env.REDIS_PASSWORD,
  db:             Number(process.env.REDIS_DB_GAAS ?? 0),
  lazyConnect:    true,
  enableReadyCheck: true,
  retryStrategy:  (times) => Math.min(times * 200, 5_000),
  maxRetriesPerRequest: 2,
});

redis.on('error', (err) => {
  logger.warn('GaaS Redis error — narration will regenerate without cache');
});

// ---------------------------------------------------------------------------
// Anthropic API config
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL  = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION  = '2023-06-01';
const CLAUDE_MODEL       = 'claude-sonnet-4-6';    // Canonical model string
const MAX_TOKENS         = 400;                    // Short, punchy narration
const TIMEOUT_MS         = 8_000;                  // 8s — never block the API response

// ---------------------------------------------------------------------------
// Cache key + TTL helpers
// ---------------------------------------------------------------------------

/**
 * Returns today's date in Asia/Kolkata (IST) as YYYY-MM-DD.
 * Critical Rule #6: All timestamps UTC, convert to IST in app only.
 */
function getTodayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * Seconds remaining until midnight IST — used as Redis TTL.
 */
function secondsUntilMidnightIST(): number {
  const now = new Date();
  const midnight = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  midnight.setHours(24, 0, 0, 0);
  const diff = midnight.getTime() - now.getTime();
  return Math.max(60, Math.floor(diff / 1000));   // minimum 60s
}

function cacheKey(providerId: string, period: string): string {
  return `gaas:narration:${providerId}:${period}:${getTodayIST()}`;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildPrompt(data: ProviderAnalyticsData): string {
  const {
    period_label, leads, ratings, trust, contacts,
  } = data;

  const acceptanceRateLine = leads.total > 0
    ? `You accepted ${leads.acceptance_rate_pct}% of leads (${leads.accepted} of ${leads.total}).`
    : 'No leads received in this period.';

  const ratingLine = ratings.total_received > 0 && ratings.average_stars
    ? `You received ${ratings.total_received} new rating${ratings.total_received > 1 ? 's' : ''} with an average of ${ratings.average_stars} stars.`
    : 'No new ratings in this period.';

  const trustLine = trust.change !== null
    ? trust.change > 0
      ? `Your trust score improved by ${trust.change} points to ${trust.current_score} (${trust.current_tier}).`
      : trust.change < 0
      ? `Your trust score decreased by ${Math.abs(trust.change)} points to ${trust.current_score} (${trust.current_tier}).`
      : `Your trust score is stable at ${trust.current_score} (${trust.current_tier}).`
    : `Your current trust score is ${trust.current_score} (${trust.current_tier}).`;

  const contactLine = contacts.total > 0
    ? `You had ${contacts.total} customer contact${contacts.total > 1 ? 's' : ''} in this period.`
    : 'No customer contacts in this period.';

  return `You are SatvAAh's analytics advisor for service providers in India's informal economy. Generate a short, warm, and encouraging analytics summary in 2–3 sentences for a provider based on their data from ${period_label}.

Data:
- Leads: ${acceptanceRateLine}
- ${ratingLine}
- ${trustLine}
- ${contactLine}

Guidelines:
- Be specific with numbers.
- If performance is down, be constructive and suggest one practical action.
- If performance is strong, celebrate it briefly and highlight one standout metric.
- Write as if speaking directly to the provider. Use "you" and "your".
- Keep it under 60 words. Plain language — no jargon.
- Do NOT use markdown, bullet points, or headings. Plain prose only.`;
}

// ---------------------------------------------------------------------------
// Anthropic API call
// ---------------------------------------------------------------------------

async function callClaude(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method:  'POST',
      signal:  controller.signal,
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       process.env.ANTHROPIC_API_KEY ?? '',  // set in admin docker env
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model:      CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const textBlock = data.content.find(b => b.type === 'text');
    if (!textBlock?.text) {
      throw new Error('No text block in Anthropic API response');
    }

    return textBlock.text.trim();

  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Main export: generateNarration
// ---------------------------------------------------------------------------

/**
 * Generates (or returns cached) a plain-language analytics narration.
 *
 * @param providerId - UUID of the provider
 * @param period     - '7d' | '30d' | 'year'
 * @returns          Plain-text narration string (never markdown)
 *
 * Cache: once per provider per period per calendar day (IST).
 * Throws on API failure — caller must catch and handle gracefully.
 */
async function generateNarration(providerId: string, period: string): Promise<string> {
  const key = cacheKey(providerId, period);

  // 1. Cache check
  try {
    const cached = await redis.get(key);
    if (cached) {
      logger.debug({ provider_id: providerId, period, key }, 'GaaS narration cache hit');
      return cached;
    }
  } catch (cacheErr) {
    logger.warn('GaaS Redis GET failed — proceeding without cache');
  }

  // 2. Fetch analytics data (re-uses adminService — single source of truth)
  const analyticsData = await adminService.getProviderAnalytics({ providerId, period });

  // 3. Build prompt
  const prompt = buildPrompt(analyticsData);

  // 4. Call Claude Sonnet 4.6
  logger.info('Calling Claude for GaaS narration');
  const narration = await callClaude(prompt);

  // 5. Cache the result until midnight IST
  try {
    const ttl = secondsUntilMidnightIST();
    await redis.setex(key, ttl, narration);
    logger.debug({ provider_id: providerId, period, ttl }, 'GaaS narration cached');
  } catch (cacheErr) {
    logger.warn('GaaS Redis SETEX failed — narration not cached');
  }

  return narration;
}

/**
 * Manually invalidates the cached narration for a provider.
 * Call this if provider data changes significantly mid-day (e.g. large trust delta).
 */
async function invalidateNarration(providerId: string, period?: string): Promise<void> {
  const periods = period ? [period] : ['7d', '30d', 'year'];
  const today   = getTodayIST();

  const keys = periods.map(p => `gaas:narration:${providerId}:${p}:${today}`);
  try {
    await redis.del(...keys);
    logger.info('GaaS narration cache invalidated');
  } catch (err) {
    logger.warn('GaaS cache invalidation failed — non-blocking');
  }
}

// ---------------------------------------------------------------------------
// Exported service
// ---------------------------------------------------------------------------

export const gaasService = {
  generateNarration,
  invalidateNarration,
};
