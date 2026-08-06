/*
 * Item 0 — the blast radius around autonomous submission.
 *
 * Auto-Pilot stays on and fully autonomous for the tester cohort, so real
 * applications go to real employers under testers' names. Two constraints hold
 * that in, both server-side, because a client-side limit is a suggestion.
 *
 *   HALT      one flag stops every submission across every account, with no
 *             deploy. DB-backed so it takes effect on the next request, with
 *             an env override as a second, independent lever.
 *   DAILY CAP a hard ceiling of 5 per user per day that a user cannot raise.
 *             auto_apply_limit_per_day is user-settable and the operator
 *             account was sitting at 50; the ceiling now clamps it.
 *
 * Both are checked at the one point that flips an application to 'submitting',
 * which is the moment the extension is told to go.
 */

const { query } = require('../db');

/** The flag name. Documented in PROGRESS.md so an operator can find it fast. */
const HALT_FLAG = 'submissions_halted';

/** No user may exceed this, whatever their profile says. */
const MAX_DAILY_SUBMISSIONS = Number(process.env.MAX_DAILY_SUBMISSIONS || 5);

/**
 * True when submission is halted globally.
 *
 * Env wins, so an operator who cannot reach the database can still stop
 * everything by setting SUBMISSIONS_HALTED=1 and restarting. Otherwise the DB
 * flag decides, and it needs no restart at all.
 *
 * Fails CLOSED: if the flag cannot be read, submission is halted. A gate that
 * opens when its own storage is unavailable is not a gate.
 */
async function submissionsHalted() {
  if (String(process.env.SUBMISSIONS_HALTED || '').toLowerCase() === '1') return true;
  try {
    const r = await query('SELECT value FROM system_flags WHERE key = $1', [HALT_FLAG]);
    if (!r.rows.length) return false;
    return String(r.rows[0].value).toLowerCase() === 'true';
  } catch (err) {
    console.error('submissionGate: could not read halt flag, failing closed:', err.message);
    return true;
  }
}

/** How many this user has already had submitted today, UTC. */
async function submittedToday(userId) {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM applications
      WHERE user_id = $1
        AND status IN ('submitting', 'submitted', 'applied')
        AND COALESCE(submitted_at, updated_at) >= date_trunc('day', CURRENT_TIMESTAMP)`,
    [userId]
  );
  return r.rows[0]?.n ?? 0;
}

/**
 * May this user start one more submission right now?
 *
 * Returns a reason rather than a boolean so the caller can say which limit
 * stopped it - a refusal a user cannot explain is its own defect.
 */
async function checkSubmissionAllowed(userId) {
  if (await submissionsHalted()) {
    return { allowed: false, reason: 'halted', message: 'Submission is paused for all accounts.' };
  }
  const used = await submittedToday(userId);
  if (used >= MAX_DAILY_SUBMISSIONS) {
    return {
      allowed: false,
      reason: 'daily_cap',
      used,
      cap: MAX_DAILY_SUBMISSIONS,
      message: `Daily limit reached — ${used} of ${MAX_DAILY_SUBMISSIONS} applications sent today.`,
    };
  }
  return { allowed: true, used, cap: MAX_DAILY_SUBMISSIONS };
}

module.exports = {
  HALT_FLAG, MAX_DAILY_SUBMISSIONS,
  submissionsHalted, submittedToday, checkSubmissionAllowed,
};
