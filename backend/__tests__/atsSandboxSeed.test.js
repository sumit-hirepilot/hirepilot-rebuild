/*
 * E1 — the sandbox seed exists ONLY to let an automated harness drive the
 * real queue against the controlled target, and it is fenced by the exact
 * same flag that fences the whole sandbox: ATS_SANDBOX_ENABLED. With the flag
 * unset it 404s like any unknown route, so it cannot exist in a real
 * deployment. It creates an inactive, user-scoped job whose URL is the
 * sandbox page, so detectAts resolves it to the sandbox platform (never an
 * employer's ATS) and it never enters anyone else's feed.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
}));

const { query } = require('../db');
const sandbox = require('../routes/atsSandbox');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/ats-sandbox', sandbox);
  return a;
}

const OLD = process.env.ATS_SANDBOX_ENABLED;
afterAll(() => { if (OLD === undefined) delete process.env.ATS_SANDBOX_ENABLED; else process.env.ATS_SANDBOX_ENABLED = OLD; });

describe('POST /api/ats-sandbox/seed', () => {
  beforeEach(() => query.mockReset());

  it('404s when the sandbox flag is off, and writes nothing', async () => {
    delete process.env.ATS_SANDBOX_ENABLED;
    const res = await request(app()).post('/api/ats-sandbox/seed');
    expect(res.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it('creates an inactive, user-scoped sandbox job whose URL is the sandbox page', async () => {
    process.env.ATS_SANDBOX_ENABLED = 'true';
    query.mockResolvedValueOnce({ rows: [{ id: 900 }] });

    const res = await request(app()).post('/api/ats-sandbox/seed');
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe(900);
    expect(res.body.jobUrl).toMatch(/\/ats-sandbox\/greenhouse/);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO jobs/i);
    // inactive: never enters the shared feed
    expect(sql).toMatch(/is_active/i);
    expect(sql.replace(/\s+/g, ' ')).toMatch(/is_active[^)]*\bfalse\b|,\s*false\b/i);
    // scoped to the caller; source is the sandbox platform (a literal in the
    // SQL, not a bound param - assert where the value actually lives).
    expect(params).toContain(42);
    expect(sql).toMatch(/'ats_sandbox'/);
    expect(params.some((p) => typeof p === 'string' && /sandbox-seed-42/.test(p))).toBe(true);
    // the URL carries the caller id so two internal accounts can't collide on
    // the job_url UNIQUE constraint
    expect(res.body.jobUrl).toMatch(/[?&]u=42\b/);
  });
});
