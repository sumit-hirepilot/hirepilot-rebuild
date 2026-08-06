/*
 * Item 0 — the blast radius around autonomous submission.
 *
 * Auto-Pilot stays on and fully autonomous for the tester cohort. Real
 * applications reach real employers under testers' names, so the two things
 * holding that in are the only things holding it in.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
  attachUserIfPresent: (req, _res, next) => { req.user = { id: 42 }; next(); },
}));

const { query } = require('../db');
const gate = require('../services/submissionGate');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/apply', require('../routes/apply'));
  return a;
}

const OLD_ENV = { ...process.env };
beforeEach(() => { query.mockReset(); process.env = { ...OLD_ENV }; delete process.env.SUBMISSIONS_HALTED; });

/** halted?, then today's count. */
function mockGate({ halted = false, used = 0 } = {}) {
  query.mockImplementation((sql) => {
    if (/FROM system_flags/.test(sql)) return Promise.resolve({ rows: [{ value: String(halted) }] });
    if (/COUNT\(\*\)::int AS n FROM applications/.test(sql)) return Promise.resolve({ rows: [{ n: used }] });
    if (/UPDATE applications SET status = 'submitting'/.test(sql)) return Promise.resolve({ rows: [{ id: 7 }] });
    return Promise.resolve({ rows: [] });
  });
}

describe('Item 0 — the kill switch stops every submission', () => {
  it('refuses to start when the flag is set', async () => {
    mockGate({ halted: true });
    const res = await request(app()).post('/api/apply/queue/7/start');
    expect(res.status).toBe(429);
    expect(res.body.reason).toBe('halted');
    // and nothing was moved toward sending
    const wrote = query.mock.calls.some((c) => /SET status = 'submitting'/.test(c[0]));
    expect(wrote).toBe(false);
  });

  it('an env override halts without reaching the database', async () => {
    // The second lever: usable when the DB is the thing that is wrong.
    process.env.SUBMISSIONS_HALTED = '1';
    query.mockImplementation(() => Promise.reject(new Error('db down')));
    await expect(gate.submissionsHalted()).resolves.toBe(true);
  });

  it('fails CLOSED when the flag cannot be read', async () => {
    // A gate that opens when its own storage is unavailable is not a gate.
    query.mockImplementation(() => Promise.reject(new Error('db down')));
    await expect(gate.submissionsHalted()).resolves.toBe(true);
  });

  it('allows a start when nothing is halted and the cap is not reached', async () => {
    mockGate({ halted: false, used: 0 });
    const res = await request(app()).post('/api/apply/queue/7/start');
    expect(res.status).toBe(200);
  });
});

describe('Item 0 — the daily cap is a server ceiling, not a preference', () => {
  it('is 5', () => {
    expect(gate.MAX_DAILY_SUBMISSIONS).toBe(5);
  });

  it('refuses the sixth of the day', async () => {
    mockGate({ used: 5 });
    const res = await request(app()).post('/api/apply/queue/7/start');
    expect(res.status).toBe(429);
    expect(res.body.reason).toBe('daily_cap');
    expect(res.body.cap).toBe(5);
  });

  it('counts anything already moving, not only what completed', async () => {
    // 'submitting' is in flight to an employer. Counting only 'submitted'
    // would let a burst of parallel starts all pass the check at once.
    const sql = gate.submittedToday.toString();
    expect(sql).toMatch(/'submitting'/);
    expect(sql).toMatch(/'submitted'/);
  });

  it('a user preference cannot raise it', () => {
    const fs = require('fs');
    const path = require('path');
    const profile = fs.readFileSync(path.join(__dirname, '..', 'routes', 'profile.js'), 'utf8');
    const engine = fs.readFileSync(path.join(__dirname, '..', 'services', 'autoApplyEngine.js'), 'utf8');
    // Both the write path and the runner clamp to the ceiling.
    expect(profile).toMatch(/Math\.min\([\s\S]{0,120}MAX_DAILY_SUBMISSIONS/);
    expect(engine).toMatch(/Math\.min\([^)]*MAX_DAILY_SUBMISSIONS\)/);
  });
});

describe('Item 0 — Greenhouse only', () => {
  it('runs no adapter that has never been run against a live form', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'apply.js'), 'utf8');
    const block = src.slice(src.indexOf('const SUPPORTED_ATS'), src.indexOf('const SUPPORTED_ATS') + 300);
    expect(block).toMatch(/'greenhouse'/);
    expect(block).not.toMatch(/^\s*'lever'/m);
    expect(block).not.toMatch(/^\s*'ashby'/m);
  });
});

describe('Item 0 — the switch can actually be flipped', () => {
  it('refuses a caller who is neither the secret holder nor an admin', async () => {
    delete process.env.ADMIN_HALT_SECRET;
    query.mockResolvedValue({ rows: [{ is_admin: false }] });
    const res = await request(app()).post('/api/apply/admin/halt').send({ halted: true });
    expect(res.status).toBe(403);
  });

  it('lets the admin account pull it with no environment access at all', async () => {
    /*
     * The secret needs an env var, and the app's Railway project is not
     * reachable from the machine that built this. A kill switch nobody can
     * pull is not a kill switch, so the owner's account is a second lever.
     */
    delete process.env.ADMIN_HALT_SECRET;
    query.mockImplementation((sql) => {
      if (/SELECT is_admin FROM users/.test(sql)) return Promise.resolve({ rows: [{ is_admin: true }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app()).post('/api/apply/admin/halt').send({ halted: true });
    expect(res.status).toBe(200);
    expect(res.body.halted).toBe(true);
  });

  it('refuses a wrong secret', async () => {
    process.env.ADMIN_HALT_SECRET = 'right';
    query.mockResolvedValue({ rows: [{ is_admin: false }] });
    const res = await request(app())
      .post('/api/apply/admin/halt').set('x-admin-secret', 'wrong').send({ halted: true });
    expect(res.status).toBe(403);
  });

  it('sets the flag with the right secret', async () => {
    process.env.ADMIN_HALT_SECRET = 'right';
    query.mockResolvedValue({ rows: [] });
    const res = await request(app())
      .post('/api/apply/admin/halt').set('x-admin-secret', 'right').send({ halted: true });
    expect(res.status).toBe(200);
    expect(res.body.halted).toBe(true);
    const wrote = query.mock.calls.find((c) => /INSERT INTO system_flags/.test(c[0]));
    expect(wrote[1]).toEqual(['submissions_halted', 'true']);
  });

  it('halts only on an explicit true, never on a stray body', async () => {
    // `halted: "false"` or a missing field must not read as "halt everything",
    // and equally must not silently resume it.
    process.env.ADMIN_HALT_SECRET = 'right';
    query.mockResolvedValue({ rows: [] });
    const res = await request(app())
      .post('/api/apply/admin/halt').set('x-admin-secret', 'right').send({ halted: 'true' });
    expect(res.body.halted).toBe(false);
  });
});


describe('Item 0 — an authorisation check that errors is a denial', () => {
  it('does not 500, and does not let anyone through, when the admin lookup fails', async () => {
    delete process.env.ADMIN_HALT_SECRET;
    query.mockImplementation(() => Promise.reject(new Error('db down')));
    const res = await request(app()).post('/api/apply/admin/halt').send({ halted: true });
    expect(res.status).toBe(403);
  });
});

describe('Item 4 — credits are a limit, not just a counter', () => {
  const gateMod = require('../services/submissionGate');

  it('refuses a submission when the allowance is exhausted', async () => {
    query.mockImplementation((sql) => {
      if (/FROM system_flags/.test(sql)) return Promise.resolve({ rows: [{ value: 'false' }] });
      if (/credits_total, credits_used/.test(sql) || /plan_tier/.test(sql)) {
        return Promise.resolve({ rows: [{ plan_tier: 'starter', credits_total: 600, credits_used: 600 }] });
      }
      if (/COUNT\(\*\)::int AS n FROM applications/.test(sql)) return Promise.resolve({ rows: [{ n: 0 }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await gateMod.checkSubmissionAllowed(42);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('no_credits');
  });

  it('refuses rather than granting unlimited use when the check itself fails', async () => {
    // A limit that opens when it cannot be read is not a limit.
    query.mockImplementation((sql) => {
      if (/FROM system_flags/.test(sql)) return Promise.resolve({ rows: [{ value: 'false' }] });
      return Promise.reject(new Error('db down'));
    });
    const res = await gateMod.checkSubmissionAllowed(42);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('credit_check_failed');
  });

  it('allows a submission while credits remain', async () => {
    query.mockImplementation((sql) => {
      if (/FROM system_flags/.test(sql)) return Promise.resolve({ rows: [{ value: 'false' }] });
      if (/credits_total, credits_used/.test(sql) || /plan_tier/.test(sql)) {
        return Promise.resolve({ rows: [{ plan_tier: 'starter', credits_total: 600, credits_used: 3 }] });
      }
      if (/COUNT\(\*\)::int AS n FROM applications/.test(sql)) return Promise.resolve({ rows: [{ n: 0 }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await gateMod.checkSubmissionAllowed(42);
    expect(res.allowed).toBe(true);
  });

  it('spends a credit only on a verified receipt, never on an attempt', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'apply.js'), 'utf8');
    // The single spend call sits behind the evidence check, so a failed or
    // stalled application costs nothing.
    const calls = src.match(/spendCredit\([^)]*\)/g) || [];
    expect(calls).toHaveLength(1);
    const idx = src.indexOf('spendCredit(');
    const before = src.slice(Math.max(0, idx - 900), idx);
    expect(before).toMatch(/status = 'submitted'|r\.rows\.length/);
  });
});

describe('Item 4 — the tier gate is actually checked', () => {
  it('auto-apply asks whether the plan includes it', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'autoApplyEngine.js'), 'utf8');
    // `can` existed and nothing called it: the preference alone decided.
    expect(src).toMatch(/can\(user\.id, 'autoApply'\)/);
    expect(src).toMatch(/blocked: 'tier'/);
  });
});
