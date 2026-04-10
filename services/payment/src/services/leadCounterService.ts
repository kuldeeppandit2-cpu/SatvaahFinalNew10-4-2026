import { logger } from '@satvaaah/logger';
import { ConfigurationError } from '@satvaaah/errors';
/**
 * SatvAAh — Lead Counter Service
 *
 * deductLead(consumerId, providerId)
 *
 * Rules:
 *  - contact_lead_cost is ALWAYS read from system_config table.
 *    Currently 0 (free during launch phase) but must NEVER be hardcoded.
 *    Future: set to 1 via system_config UPDATE — zero code change needed.
 *
 *  - Atomicity:
 *      The contact_events INSERT and lead_credits_remaining UPDATE are
 *      executed inside a single SERIALIZABLE transaction.
 *      If the consumer has insufficient leads, the entire transaction rolls
 *      back and an InsufficientLeadsError is thrown.
 *
 *  - Idempotency:
 *      contact_events has a UNIQUE constraint on (consumer_id, provider_id,
 *      date_bucket) where date_bucket = DATE_TRUNC('day', NOW()).
 *      A duplicate contact attempt on the same day is a no-op (ON CONFLICT
 *      DO NOTHING) and returns { deducted: 0, already_contacted: true }.
 *
 *  - Zero cost:
 *      When contact_lead_cost = 0, no leads are deducted but the
 *      contact_events row is still inserted (audit trail).
 */

import { PoolClient } from 'pg';
import { db } from '../app';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DeductLeadResult {
  deducted: number;        // Amount deducted (0 if free or already contacted)
  leads_remaining: number; // Updated balance after deduction
  already_contacted: boolean;
  contactEventId: string;
}

// Local class kept for backward compat — use @satvaaah/errors InsufficientLeadsError
export class InsufficientLeadsError extends Error {
  code = 'INSUFFICIENT_LEADS';
  constructor(public available: number, public required: number) {
    super(`Insufficient leads: has ${available}, needs ${required}`);
  }
}

// ─── Cache: system_config is slow-changing, cache for 60 seconds ──────────────
let cachedLeadCost: number | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60_000;

async function getContactLeadCost(client: PoolClient): Promise<number> {
  const now = Date.now();
  if (cachedLeadCost !== null && now < cacheExpiresAt) {
    return cachedLeadCost;
  }

  const result = await client.query<{ value: string }>(
    `SELECT value FROM system_config WHERE key = 'contact_lead_cost' LIMIT 1`,
  );

  if (result.rows.length === 0) {
    // system_config row missing: treat as 0 (safe default, log warning)
    logger.warn(
      '[leadCounter] system_config.contact_lead_cost not found — defaulting to 0',
    );
    cachedLeadCost = 0;
  } else {
    cachedLeadCost = Number(result.rows[0].value);
    if (!Number.isInteger(cachedLeadCost) || cachedLeadCost < 0) {
      throw new ConfigurationError(`contact_lead_cost: expected non-negative integer, got '${result.rows[0].value}'`);
    }
  }

  cacheExpiresAt = now + CACHE_TTL_MS;
  return cachedLeadCost;
}

// ─── deductLead ───────────────────────────────────────────────────────────────
/**
 * Atomically:
 *  1. Read contact_lead_cost from system_config (cached 60 s)
 *  2. Check consumer has enough leads
 *  3. INSERT contact_events (idempotent on same-day duplicate)
 *  4. Deduct leads from consumer_lead_usage
 *
 * @throws InsufficientLeadsError if consumer doesn't have enough leads
 */
export async function deductLead(
  consumerId: string,
  providerId: string,
): Promise<DeductLeadResult> {
  const client: PoolClient = await db.connect();

  try {
    // SERIALIZABLE prevents phantom reads between the balance check and UPDATE
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    // ── 1. Read lead cost from system_config (never hardcoded) ───────────
    const leadCost = await getContactLeadCost(client);

    // ── 2. Check consumer's current lead balance ──────────────────────────
    const balanceRow = await client.query<{
      leads_remaining: number;
      subscription_status: string;
    }>(
      `SELECT clu.leads_allocated - clu.leads_used AS leads_remaining, 'active' AS subscription_status
       FROM consumer_lead_usage clu
       WHERE clu.consumer_id = $1
         AND clu.period_end >= NOW()
       ORDER BY clu.period_end DESC
       LIMIT 1
       FOR UPDATE`,                // Row-level lock
      [consumerId],
    );

    // No subscription row → treat as 0 leads
    const currentLeads =
      balanceRow.rows.length > 0
        ? Number(balanceRow.rows[0].leads_remaining)
        : 0;

    if (leadCost > 0 && currentLeads < leadCost) {
      throw new InsufficientLeadsError(currentLeads, leadCost);
    }

    // ── 3. Insert contact_events (idempotency: one event per day per pair) ──
    const insertResult = await client.query<{ id: string; inserted: boolean }>(
      `INSERT INTO contact_events
         (consumer_id, provider_id, lead_cost, date_bucket, created_at)
       VALUES
         ($1, $2, $3, DATE_TRUNC('day', NOW()), NOW())
       ON CONFLICT (consumer_id, provider_id, date_bucket)
         DO NOTHING
       RETURNING id`,
      [consumerId, providerId, leadCost],
    );

    const alreadyContacted = insertResult.rows.length === 0;

    if (alreadyContacted) {
      // Duplicate contact on same day — do not deduct again
      await client.query('COMMIT');

      // Fetch current balance for response
      const refreshed = await db.query<{ leadCreditsRemaining: number }>(
        `SELECT (leads_allocated - leads_used) AS leads_remaining FROM consumer_lead_usage WHERE consumer_id = $1 AND period_end >= NOW() ORDER BY period_end DESC LIMIT 1`,
        [consumerId],
      );

      return {
        deducted: 0,
        leads_remaining: refreshed.rows[0]?.leads_remaining ?? 0,
        already_contacted: true,
        contactEventId: '',
      };
    }

    const contactEventId = insertResult.rows[0].id;

    // ── 4. Deduct leads (only if cost > 0) ───────────────────────────────
    let leadsRemaining = currentLeads;

    if (leadCost > 0) {
      const updateResult = await client.query<{ leadCreditsRemaining: number }>(
        `UPDATE consumer_lead_usage
         SET leads_used = leads_used + $1,
             updated_at             = NOW()
         WHERE consumer_id = $2 AND period_end >= NOW()
         RETURNING (leads_allocated - leads_used) AS leads_remaining`,
        [leadCost, consumerId],
      );
      leadsRemaining = Number(updateResult.rows[0].leads_remaining);

      // Log the deduction for audit
      // Audit trail: deduction recorded in consumer_lead_usage.leads_used above
    }

    await client.query('COMMIT');

    logger.info(
      `[leadCounter] contact_event ${contactEventId} — consumer ${consumerId} → provider ${providerId}, cost=${leadCost}, remaining=${leadsRemaining}`,
    );

    return {
      deducted: leadCost,
      leadsRemaining: leadsRemaining,
      already_contacted: false,
      contactEventId: contactEventId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── getLeadBalance ───────────────────────────────────────────────────────────
/** Read-only helper — returns current lead balance for a consumer */
export async function getLeadBalance(consumerId: string): Promise<number> {
  const result = await db.query<{ leads_remaining: number }>(
    `SELECT (leads_allocated - leads_used) AS leads_remaining
     FROM consumer_lead_usage
     WHERE consumer_id = $1
       AND period_end >= NOW()
     ORDER BY period_end DESC
     LIMIT 1`,
    [consumerId],
  );
  return result.rows[0]?.leads_remaining ?? 0;
}
