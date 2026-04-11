import { NotFoundError, ConflictError, ForbiddenError } from '@satvaaah/errors';
import { logger } from '@satvaaah/logger';
/**
 * SatvAAh — Referral Service
 *
 * Business rules:
 *  - Only valid on first signup (no prior row in referral_events for this user)
 *  - Cannot use your own referral code (self-referral guard)
 *  - Referrer receives +5 bonus leads immediately
 *  - Milestone rewards (checked AFTER crediting the new referral):
 *      5  referrals → Bronze  subscription (1 year)
 *      10 referrals → Silver  subscription (1 year)
 *      25 referrals → Gold    subscription (1 year)
 *  - All operations inside a single DB transaction for atomicity
 */

import { PoolClient } from 'pg';
import { db } from '../app';

const BONUS_LEADS_PER_REFERRAL = 5;

// ─── Milestone map ────────────────────────────────────────────────────────────
// Keys are the EXACT referral count that triggers the reward.
// SubscriptionTier enum: free | silver | gold ONLY (V036 — bronze never existed)
const MILESTONES: Record<number, { tier: string; tier_display: string }> = {
  5:  { tier: 'silver', tier_display: 'Silver' },
  10: { tier: 'gold',   tier_display: 'Gold'   },
  25: { tier: 'gold',   tier_display: 'Gold (renewed)' },
};

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ApplyReferralResult {
  success:             boolean;
  referrerId:          string;
  bonusLeadsCredited:  number;
  milestoneUnlocked:   string | null;
}

// ─── applyReferral ────────────────────────────────────────────────────────────
export async function applyReferral({
  newUserId,
  referralCode,
}: {
  newUserId: string;
  referralCode: string;
}): Promise<ApplyReferralResult> {
  const client: PoolClient = await db.connect();

  try {
    await client.query('BEGIN');

    // ── Guard: has this user already used a referral? ─────────────────────
    const newUserRow = await client.query<{
      referralCode: string;
    }>(
      `SELECT id, referral_code FROM users WHERE id = $1`,
      [newUserId],
    );

    if (newUserRow.rows.length === 0) {
      throw new NotFoundError('User');
    }

    // Check via referral_events table (users table has no such column)
    const alreadyUsed = await client.query(
      `SELECT id FROM referral_events WHERE referred_id = $1 LIMIT 1`,
      [newUserId],
    );
    if (alreadyUsed.rows.length > 0) {
      throw new ConflictError('REFERRAL_ALREADY_APPLIED', 'You have already used a referral code');
    }

    // ── Find referrer by referral code ────────────────────────────────────
    const referrerRow = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE referral_code = $1`,
      [referralCode],
    );

    if (referrerRow.rows.length === 0) {
      throw new NotFoundError(`Referral code '${referralCode}'`);
    }

    const referrerId = referrerRow.rows[0].id;

    // ── Guard: self-referral ──────────────────────────────────────────────
    if (referrerId === newUserId) {
      throw new ForbiddenError('SELF_REFERRAL_NOT_ALLOWED', 'You cannot use your own referral code');
    }

    // ── Credit +5 bonus leads to referrer ─────────────────────────────────
    await client.query(
      `UPDATE consumer_lead_usage
       SET leads_bonus  = leads_bonus + $1,
           updated_at   = NOW()
       WHERE consumer_id = $2
         AND period_end >= NOW()`,
      [BONUS_LEADS_PER_REFERRAL, referrerId],
    );

    // ── Mark new user as having used a referral ───────────────────────────
    // Note: users table has no referred_by_user_id column — referral_events tracks this relationship
    // No users UPDATE needed here

    // ── Insert referral record ────────────────────────────────────────────
    // audit-ref: DB22 referral_events — reward_granted=true because leads were credited above.
    // Was previously inserted as false and never updated — fixed here.
    await client.query(
      `INSERT INTO referral_events
         (id, referrer_id, referred_id, referral_code, converted_at, reward_type, reward_granted, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), 'bonus_leads', true, NOW())
       ON CONFLICT (referred_id) DO NOTHING`,
      [referrerId, newUserId, referralCode],
    );

    // ── Count total referrals by this referrer (for milestone check) ───────
    const countRow = await client.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM referral_events WHERE referrer_id = $1`,
      [referrerId],
    );
    const totalReferrals = Number(countRow.rows[0].total);

    // ── Milestone reward ──────────────────────────────────────────────────
    let milestoneUnlocked: string | null = null;
    const milestone = MILESTONES[totalReferrals];

    if (milestone) {
      // Fetch the milestone plan
      const planRow = await client.query<{
        id: string;
        leads_allocated: number;
        validity_days: number;
      }>(
        `SELECT id, leads_allocated, validity_days
         FROM subscription_plans
         WHERE tier = $1
           AND user_type = 'provider'
           AND validity_days >= 365
           AND is_active = true
         ORDER BY validity_days DESC
         LIMIT 1`,
        [milestone.tier],
      );

      if (planRow.rows.length > 0) {
        const plan = planRow.rows[0];

        // Grant the annual subscription as reward (no payment required)
        // Insert milestone subscription record
        await client.query(
          `INSERT INTO subscription_records
             (id, user_id, plan_id, status, started_at, expires_at, amount_paise, idempotency_key)
           VALUES
             (gen_random_uuid(), $1, $2, 'active', NOW(), NOW() + INTERVAL '1 day' * $3, 0,
              md5($1::text || $2::text || 'milestone'))
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [referrerId, plan.id, plan.validity_days],
        );

        // milestone_rewards table not in schema — logged via subscription_records insert

        milestoneUnlocked = milestone.tier;
        logger.info(
          `[referral] Milestone ${milestone.tier_display} unlocked for user ${referrerId} (${totalReferrals} referrals)`,
        );
      } else {
        logger.warn(
          `[referral] No active annual plan found for tier "${milestone.tier}" — skipping milestone reward`,
        );
      }
    }

    await client.query('COMMIT');

    return {
      success: true,
      referrerId: referrerId,
      bonusLeadsCredited:  BONUS_LEADS_PER_REFERRAL,
      milestoneUnlocked:   milestoneUnlocked,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
