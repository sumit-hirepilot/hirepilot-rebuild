/*
 * GOAL 1c — the index is read in bounded chunks, not all at once.
 *
 * calculateMatchesForUser ran a single `SELECT id, title, description,
 * requirements, ... FROM jobs WHERE is_active = true` with no LIMIT.
 * node-postgres buffers a result set completely before returning it, so every
 * call materialised all ~25,400 active rows in one array - including the two
 * largest text columns - and built a second array from them.
 *
 * It fits every symptom of the outages: a crash record of 551 MB RSS at ten
 * seconds of uptime; no crash log, because an OOM kill leaves none; no
 * watchdog recovery, because the watchdog exits a wedged process and cannot
 * survive being killed by the platform; recovery only on redeploy. And it is
 * reachable from an ordinary feed read - scoreIfNeverScored calls this on a
 * user's first /api/matches.
 *
 * Asserted on the SQL and the arguments actually sent, because a response
 * looks identical either way. That is the whole difficulty of this defect.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
const { query } = require('../db');

const CHUNK = 2000;
const TOTAL = 25418;

/** A fake index big enough that "load it all" and "load a chunk" differ. */
function serveIndex({ total = TOTAL } = {}) {
  query.mockImplementation((sql, params) => {
    if (/FROM jobs WHERE is_active = true/.test(sql)) {
      const after = Number(params[0]);
      const limit = Number(params[1]);
      const rows = [];
      for (let id = after + 1; id <= Math.min(after + limit, total); id += 1) {
        rows.push({ id, title: 'Designer', description: 'x', requirements: 'y', location: 'Remote' });
      }
      return Promise.resolve({ rows });
    }
    if (/FROM user_skills|FROM user_experience|FROM users|FROM application_profiles|FROM resumes/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => query.mockReset());

describe('the scan never asks for the whole index at once', () => {
  it('sends a LIMIT on every read of the jobs table', async () => {
    serveIndex();
    const { calculateMatchesForUser } = require('../services/matchingEngine');
    await calculateMatchesForUser(42);

    const scans = query.mock.calls.filter((c) => /FROM jobs WHERE is_active = true/.test(c[0]));
    expect(scans.length).toBeGreaterThan(1);          // it chunked at all
    for (const [sql, params] of scans) {
      expect(sql).toMatch(/LIMIT \$2/);
      expect(Number(params[1])).toBeLessThanOrEqual(CHUNK);
    }
  });

  it('walks by id rather than OFFSET, so a live table cannot skip or repeat a row', async () => {
    serveIndex();
    const { calculateMatchesForUser } = require('../services/matchingEngine');
    await calculateMatchesForUser(42);

    const scans = query.mock.calls.filter((c) => /FROM jobs WHERE is_active = true/.test(c[0]));
    expect(scans[0][0]).toMatch(/id > \$1/);
    expect(scans[0][0]).not.toMatch(/OFFSET/);

    // Strictly increasing cursor: the second chunk starts where the first ended.
    expect(Number(scans[0][1][0])).toBe(0);
    expect(Number(scans[1][1][0])).toBe(CHUNK);
  });

  it('covers the whole index despite reading it in pieces', async () => {
    serveIndex();
    const { calculateMatchesForUser } = require('../services/matchingEngine');
    await calculateMatchesForUser(42);

    const scans = query.mock.calls.filter((c) => /FROM jobs WHERE is_active = true/.test(c[0]));
    const lastCursor = Number(scans[scans.length - 1][1][0]);
    expect(lastCursor).toBeGreaterThanOrEqual(TOTAL - CHUNK);
  });

  it('stops instead of looping forever on an empty index', async () => {
    serveIndex({ total: 0 });
    const { calculateMatchesForUser } = require('../services/matchingEngine');
    await calculateMatchesForUser(42);

    const scans = query.mock.calls.filter((c) => /FROM jobs WHERE is_active = true/.test(c[0]));
    expect(scans).toHaveLength(1);
  });
});
