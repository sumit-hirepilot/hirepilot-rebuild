/*
 * Q4 — the cross-source dedupe was eating same-board postings.
 *
 * Reproduced against live boards before any fix (the numbers ARE the bug):
 * Brex published 303 postings, the database held 140. Simulating the matcher
 * over the live board explained it - 183 postings share a normalised title
 * with a sibling published within ±3 days (multi-location roles: the same
 * title in NYC, SF, London), and the matcher, which checks title + company +
 * date window but NOT source and NOT location, merged every sibling into the
 * first row. Braze 129/257 eaten, ClickHouse 79/166, Databricks 120/819.
 * Sum across boards ≈ the ~930 gap between live boards (10,210) and the
 * database (9,277). The "greenhouse-discord >40MB" refusal the queue named
 * was real but transient and trivial - that board has 47 jobs and its
 * response measures 409KB today.
 *
 * The rule: a CROSS-source duplicate must be from a DIFFERENT source and the
 * SAME place. A false merge deletes a real posting a user could have applied
 * to; a false non-merge shows a duplicate card. The safe direction is known.
 */

jest.mock('../db', () => ({ query: jest.fn() }));

const { query } = require('../db');
const { storeJob } = require('../services/jobAggregator');

const CANDIDATE = {
  source: 'greenhouse',
  external_id: 'gh-brex-1',
  title: 'Software Engineer',
  company_name: 'Brex',
  company_url: null,
  job_url: 'https://boards.greenhouse.io/brex/jobs/1',
  description: 'd', requirements: null,
  salary_min: null, salary_max: null, currency: null,
  job_type: 'full-time', work_arrangement: 'on-site',
  location: 'New York, NY', country: '',
  posted_at: new Date('2026-08-01'), apply_url: null,
};

function primeMisses() {
  query.mockReset();
  query
    .mockResolvedValueOnce({ rows: [] })            // (source, external_id) lookup
    .mockResolvedValueOnce({ rows: [] })            // job_url lookup
    .mockResolvedValueOnce({ rows: [] })            // cross-source dedupe: miss
    .mockResolvedValueOnce({ rows: [{ id: 77 }] }); // INSERT
}

const dedupeCall = () => query.mock.calls.find((c) => /is_active = true[\s\S]*title/.test(c[0]) && /BETWEEN/.test(c[0]));

describe('findCrossSourceDuplicate, driven through storeJob', () => {
  it('excludes the candidate\'s own source - same-board siblings are different jobs', async () => {
    primeMisses();
    await storeJob(CANDIDATE);
    const call = dedupeCall();
    expect(call).toBeTruthy();
    expect(call[0]).toMatch(/source\s*<>\s*\$/);
    expect(call[1]).toContain('greenhouse');
  });

  it('requires the same normalised location - NYC and SF are different jobs', async () => {
    primeMisses();
    await storeJob(CANDIDATE);
    const call = dedupeCall();
    expect(call[0]).toMatch(/location/);
    // The normalised location travels as a parameter.
    expect(call[1]).toContain('new york ny');
  });

  it('a genuine cross-source duplicate still merges', async () => {
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 55 }] }) // dedupe hit (other source, same place)
      .mockResolvedValueOnce({ rows: [] });          // fetched_at bump
    const out = await storeJob(CANDIDATE);
    expect(out.isDuplicateMerge).toBe(true);
    expect(out.id).toBe(55);
  });

  it('a dedupe miss inserts the posting as its own row', async () => {
    primeMisses();
    const out = await storeJob(CANDIDATE);
    expect(out.isNew).toBe(true);
    expect(query.mock.calls.some((c) => /INSERT INTO jobs/.test(c[0]))).toBe(true);
  });
});

describe('per-slug fetch failures are visible, not console-only', () => {
  it('fetchAllForPlatform reports which slugs failed alongside the fetch count', async () => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    const { fetchAllForPlatform } = require('../services/apis/ats');
    const fetchOne = jest.fn(async (slug) => {
      if (slug === 'discord') throw new Error('response exceeded 40MB and was refused');
      return [{ id: `${slug}-1` }];
    });
    const batches = [];
    const out = await fetchAllForPlatform(['brex', 'discord', 'stripe'], fetchOne, 'Greenhouse', async (b) => batches.push(...b));
    expect(out.fetched).toBe(2);
    expect(out.failedSlugs).toEqual([{ slug: 'discord', error: expect.stringMatching(/40MB/) }]);
  });
});
