/*
 * Q2 — the verification account holds a real person's data in production.
 *
 * The account (autonomy-verify-2026-08-08@hirepilot.local) was seeded from
 * the operator's real profile: real name on the users row, real phone and
 * employers in the resume text, real employment history, the real name
 * signed under a generated cover letter. The scrub replaces the CONTENT with
 * clearly synthetic equivalents while keeping every row and id intact - the
 * evidence trail in PROJECT.md names those ids.
 *
 * Mechanism: corrective migration statements, the only write path this
 * machine has to the production database (the A1/A7.2 precedent), with the
 * audit row FIRST per the standing rule - a correction that does not record
 * what it changed cannot be told from one that never ran.
 *
 * And the account gains is_internal, which the auto-apply sweep excludes:
 * an internal verification account must never be swept into sending anything.
 */

const { STATEMENTS } = require('../services/migrations');
const { CLAIMS } = require('../services/schemaClaims');

const INTERNAL_EMAIL = 'autonomy-verify-2026-08-08@hirepilot.local';

const idx = (re) => STATEMENTS.findIndex((s) => re.test(s));
const all = (re) => STATEMENTS.filter((s) => re.test(s));

describe('the scrub migration', () => {
  it('adds users.is_internal additively and idempotently', () => {
    const i = idx(/ALTER TABLE users ADD COLUMN IF NOT EXISTS is_internal/);
    expect(i).toBeGreaterThan(-1);
  });

  it('writes the audit row BEFORE any scrub mutation', () => {
    const audit = idx(/q2-internal-account-scrub/);
    expect(audit).toBeGreaterThan(-1);
    const firstMutation = STATEMENTS.findIndex(
      (s) => /UPDATE (users|resumes|user_experience|cover_letters|screening_answers|tailored_resumes)\s/.test(s)
        && s.includes(INTERNAL_EMAIL)
    );
    expect(firstMutation).toBeGreaterThan(audit);
  });

  it('the column exists before the statement that sets it', () => {
    expect(idx(/ALTER TABLE users ADD COLUMN IF NOT EXISTS is_internal/))
      .toBeLessThan(idx(/UPDATE users\s+SET[\s\S]*is_internal = TRUE/));
  });

  it('every scrub statement keys on the internal email, never a bare id', () => {
    const scrubs = all(new RegExp(`UPDATE [a-z_]+\\s+SET[\\s\\S]*${INTERNAL_EMAIL.replace(/[.@]/g, '\\$&')}`));
    // users, resumes, user_experience, cover_letters, screening_answers, tailored_resumes
    expect(scrubs.length).toBeGreaterThanOrEqual(6);
    for (const s of scrubs) {
      expect(s).toContain(INTERNAL_EMAIL);
      // Environment-portable: the id is 3 on production and anything else on
      // a fresh database, so a literal id would scrub the wrong account.
      expect(s).not.toMatch(/user_id\s*=\s*3\b/);
    }
  });

  it('re-running the scrub is a no-op (every content mutation carries its own guard)', () => {
    const contentScrubs = all(/UPDATE (resumes|user_experience|cover_letters|screening_answers|tailored_resumes)\s+SET[\s\S]*hirepilot\.local/);
    // The filter itself is proven non-vacuous: all five content tables.
    expect(contentScrubs.length).toBe(5);
    for (const s of contentScrubs) {
      // Each one refuses rows already carrying the synthetic marker.
      expect(s).toMatch(/NOT LIKE '%(Verification|SYNTHETIC|Synthetic)[^']*%'|NOT LIKE '(Verification|SYNTHETIC|Synthetic)[^']*%'/);
    }
  });

  it('the scrub never drops or alters an existing column', () => {
    const q2Start = idx(/q2-internal-account-scrub/) - 2;
    const q2Block = STATEMENTS.slice(Math.max(q2Start, 0));
    for (const s of q2Block.filter((x) => x.includes(INTERNAL_EMAIL) || /is_internal/.test(x))) {
      expect(s).not.toMatch(/DROP COLUMN|ALTER COLUMN [a-z_]+ TYPE|ALTER COLUMN [a-z_]+ SET NOT NULL/i);
    }
  });

  it('is read back from the running database as a schema claim', () => {
    expect(CLAIMS.some((c) => c.kind === 'column_nullable' && c.name === 'users.is_internal')).toBe(true);
  });
});

describe('internal accounts are excluded from the auto-apply sweep', () => {
  it('the all-users sweep filters is_internal, fail-safe on NULL', () => {
    jest.resetModules();
    jest.doMock('../db', () => ({ query: jest.fn(() => Promise.resolve({ rows: [] })) }));
    // eslint-disable-next-line global-require
    const { query } = require('../db');
    // eslint-disable-next-line global-require
    const { runAutoApplyForAllUsers } = require('../services/autoApplyEngine');
    return runAutoApplyForAllUsers().then(() => {
      const sweep = query.mock.calls.map((c) => c[0]).find((s) => /auto_apply_enabled = true/.test(s));
      expect(sweep).toBeTruthy();
      expect(sweep).toMatch(/COALESCE\(u\.is_internal, FALSE\) = FALSE/);
    });
  });
});
