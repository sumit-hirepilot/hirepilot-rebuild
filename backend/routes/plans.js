/*
 * Plans and credits (PRD 6).
 *
 * Two deliberate choices:
 *
 * 1. A credit is spent on a VERIFIED submission, not on an attempt. Charging
 *    for a form that stalled on a CAPTCHA, or for one the system filled wrong
 *    and had to retry, bills someone for work that did not happen. spend() is
 *    therefore called from the evidence path and nowhere else.
 *
 * 2. Allowances live on the user row, not derived from the tier name. Changing
 *    what "Pro" includes later must not silently rewrite what an existing
 *    subscriber was sold.
 *
 * Prices are omitted on purpose - the PRD lists them as needing business input,
 * and inventing numbers here would put them in front of users as though they
 * were decided.
 */

const express = require('express');
const { query } = require('../db');
const { verifyToken, attachUserIfPresent } = require('../middleware/auth');

const router = express.Router();

const TIERS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    applicationsPerMonth: 600,
    autoApply: false,
    features: ['Job matching and tailoring', 'Apply with the extension', 'Tracker and Inbox'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    popular: true,
    applicationsPerMonth: 1500,
    autoApply: false,
    features: ['Everything in Starter', 'Higher monthly allowance', 'Networking outreach'],
  },
  power: {
    id: 'power',
    name: 'Power',
    applicationsPerMonth: 4500,
    autoApply: true,
    features: ['Everything in Pro', 'Auto Apply - hands off, daily capped', 'Priority processing'],
  },
};

function tierOf(user) {
  return TIERS[user?.plan_tier] || TIERS.starter;
}

/*
 * Allowances are monthly. Rather than a scheduled job, the window is rolled
 * forward lazily on read - a cron that fails silently would leave people
 * permanently out of credits, whereas this cannot drift.
 */
async function rollWindow(userId) {
  const r = await query(
    `UPDATE users
        SET credits_used = 0,
            credits_reset_at = date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month'
      WHERE id = $1
        AND (credits_reset_at IS NULL OR credits_reset_at <= CURRENT_TIMESTAMP)
      RETURNING credits_used, credits_reset_at`,
    [userId]
  );
  return r.rows[0] || null;
}

async function readCredits(userId) {
  await rollWindow(userId);
  const r = await query(
    `SELECT plan_tier, credits_total, credits_used, credits_reset_at FROM users WHERE id = $1`,
    [userId]
  );
  const u = r.rows[0] || {};
  const tier = tierOf(u);
  // credits_total is authoritative when set; the tier is the fallback for rows
  // that predate the column.
  const total = u.credits_total ?? tier.applicationsPerMonth;
  const used = u.credits_used ?? 0;
  return {
    tier: tier.id,
    tierName: tier.name,
    autoApplyIncluded: tier.autoApply,
    total,
    used,
    remaining: Math.max(0, total - used),
    resetsAt: u.credits_reset_at || null,
    nearLimit: total > 0 && used / total >= 0.8,
  };
}

/**
 * Spend a credit for a verified submission.
 *
 * Returns false when the allowance is exhausted, but never throws and never
 * blocks the caller: the application has already reached the employer by the
 * time this runs, and refusing to record it would lose the one thing worth
 * keeping. Over-spend is surfaced, not enforced retroactively.
 */
async function spend(userId, n = 1) {
  try {
    await rollWindow(userId);
    const r = await query(
      `UPDATE users SET credits_used = COALESCE(credits_used, 0) + $2
        WHERE id = $1 RETURNING credits_used, credits_total`,
      [userId, n]
    );
    const row = r.rows[0];
    if (!row) return false;
    return (row.credits_used || 0) <= (row.credits_total || 0);
  } catch (err) {
    console.warn('[plans] could not spend a credit:', err.message);
    return true;
  }
}

/** Whether a tier-gated capability is available to this user. */
async function can(userId, capability) {
  const r = await query('SELECT plan_tier FROM users WHERE id = $1', [userId]);
  const tier = tierOf(r.rows[0]);
  if (capability === 'autoApply') return tier.autoApply;
  return true;
}

/*
 * Item 4 — the admin path to grant a plan and credits.
 *
 * Testers are meant to experience the full paid product, and the tier gate is
 * now genuinely enforced - so without a way to place an account on a tier that
 * includes auto-apply, enforcing it would simply switch the feature off for
 * everyone. Granting has to exist for enforcing to be safe.
 *
 * Same two doors as the kill switch: a shared secret, or the admin account.
 * Neither is a user role a tester could reach.
 */
router.post('/admin/grant', attachUserIfPresent, async (req, res) => {
  const secret = process.env.ADMIN_HALT_SECRET;
  const bySecret = Boolean(secret) && req.get('x-admin-secret') === secret;

  let byAdmin = false;
  if (!bySecret && req.user?.id) {
    try {
      const u = await query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
      byAdmin = u?.rows?.[0]?.is_admin === true;
    } catch (err) {
      byAdmin = false;
    }
  }
  if (!bySecret && !byAdmin) return res.status(403).json({ error: 'Forbidden' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  const tier = String(req.body?.tier || '').trim();
  if (!email) return res.status(400).json({ error: 'email is required' });
  if (!TIERS[tier]) {
    return res.status(400).json({ error: `Unknown tier. One of: ${Object.keys(TIERS).join(', ')}` });
  }

  // credits_total is authoritative when set; default to the tier's allowance
  // rather than inventing a number.
  const credits = Number.isFinite(Number(req.body?.credits))
    ? Number(req.body.credits)
    : TIERS[tier].applicationsPerMonth;

  const r = await query(
    `UPDATE users
        SET plan_tier = $2, credits_total = $3,
            credits_used = 0,
            credits_reset_at = date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month'
      WHERE LOWER(email) = $1
      RETURNING id, email, plan_tier, credits_total, credits_used`,
    [email, tier, credits]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'No account with that email' });

  console.warn(`[plans] granted ${tier} (${credits}) to ${email}`);
  res.json({ granted: r.rows[0], autoApplyIncluded: TIERS[tier].autoApply });
});

router.get('/', verifyToken, async (req, res) => {
  try {
    res.json({
      tiers: Object.values(TIERS),
      current: await readCredits(req.user.id),
      // Stated rather than left implicit: the counter is not a clock, and
      // someone deciding on a plan should know what actually decrements it.
      creditPolicy: 'One credit per application verified as received by the employer. '
        + 'Applications that fail, stall, or are skipped do not cost a credit.',
    });
  } catch (err) {
    console.error('GET /plans failed:', err.message);
    res.status(500).json({ error: 'Could not load plans' });
  }
});

router.get('/credits', verifyToken, async (req, res) => {
  try {
    res.json(await readCredits(req.user.id));
  } catch (err) {
    console.error('GET /plans/credits failed:', err.message);
    res.status(500).json({ error: 'Could not load credits' });
  }
});

/*
 * Tier change. No billing provider is wired in, so this only moves the account
 * between tiers - it takes no payment and pretends to take none. Wiring a
 * provider is a separate piece of work with its own review.
 */
router.post('/select', verifyToken, async (req, res) => {
  try {
    const tier = TIERS[String(req.body.tier || '').toLowerCase()];
    if (!tier) return res.status(400).json({ error: 'Unknown tier' });
    await query(
      `UPDATE users SET plan_tier = $1, credits_total = $2 WHERE id = $3`,
      [tier.id, tier.applicationsPerMonth, req.user.id]
    );
    res.json({
      ok: true,
      current: await readCredits(req.user.id),
      billing: 'not_connected',
      note: 'No payment was taken - billing is not connected yet.',
    });
  } catch (err) {
    console.error('POST /plans/select failed:', err.message);
    res.status(500).json({ error: 'Could not change plan' });
  }
});

module.exports = router;
module.exports.spend = spend;
module.exports.can = can;
module.exports.readCredits = readCredits;
module.exports.TIERS = TIERS;
