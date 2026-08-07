/*
 * Feature 4a — pasting any job link, through the real route.
 *
 * Two things are being proved here, and they are different:
 *
 *   1. SAFETY. A URL from a request tells this server to open a socket to an
 *      address the user chose. Unchecked that is SSRF, and on Railway
 *      `http://169.254.169.254/` is the metadata endpoint that hands out the
 *      platform's own credentials. Refused by ADDRESS after DNS, and again on
 *      every redirect, because a public host can 302 into a private one.
 *
 *   2. SPECIFIC REFUSALS. The brief is explicit that a failure never returns a
 *      generic reason, so every path below asserts on the actual sentence a
 *      person would read. "Could not fetch" is the thing this must never say.
 *
 * And the standing line, unchanged since D19: a board refusing an automated
 * request is an ANSWER. Nothing here retries to evade, rotates an agent, or
 * solves a challenge - it names the board and offers the paste box, which
 * produces the identical result.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
  attachUserIfPresent: (req, _res, next) => { req.user = req.user || { id: 42 }; next(); },
}));
jest.mock('../services/jobUrlFetch', () => {
  const actual = jest.requireActual('../services/jobUrlFetch');
  return { ...actual, fetchJobUrl: jest.fn() };
});
jest.mock('../services/matchingEngine', () => ({
  scoreJobsForUser: jest.fn(async () => new Map()),
  calculateMatchesForUser: jest.fn(),
  calculateJobMatch: jest.fn(),
  ON_DEMAND_STORE_LIMIT: 100,
}));

const { query } = require('../db');
const { fetchJobUrl } = require('../services/jobUrlFetch');
const { classifyJobUrl, assertPublicHost, isBlockedAddress } = require('../services/jobUrlParse');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/jobs', require('../routes/jobs'));
  return a;
}

const post = (body) => request(app()).post('/api/jobs/from-url').send(body);

const actualFetch = jest.requireActual('../services/jobUrlFetch');

beforeEach(() => {
  query.mockReset();
  fetchJobUrl.mockReset();
  /*
   * Defaults to the REAL implementation. The first cut mocked it outright and
   * the SSRF tests then proved nothing at all - the refusal they assert lives
   * inside the thing that had been replaced. A canned result is opted into per
   * test, never inherited.
   */
  fetchJobUrl.mockImplementation(actualFetch.fetchJobUrl);
  query.mockImplementation((sql) => {
    if (/COUNT\(\*\)::int AS n FROM jobs/.test(sql)) return Promise.resolve({ rows: [{ n: 0 }] });
    if (/INSERT INTO jobs/.test(sql)) {
      return Promise.resolve({
        rows: [{
          id: 9001, title: 'Senior Product Designer', company_name: 'Acme',
          location: 'Bengaluru', posted_at: null, job_url: 'https://x/y',
          added_by_user_id: 42, is_active: false,
        }],
      });
    }
    return Promise.resolve({ rows: [] });
  });
});

/* ------------------------------------------------------------------ *
 * SSRF — refused by address, not by how the string looks
 * ------------------------------------------------------------------ */
describe('a user-supplied URL cannot make this server open a private socket', () => {
  it.each([
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['loopback', 'http://127.0.0.1:5432/'],
    ['localhost by name', 'http://localhost:3000/job'],
    ['private range', 'http://10.0.0.5/job'],
    ['other private range', 'http://192.168.1.10/job'],
  ])('refuses %s before any fetch happens', async (_label, url) => {
    const res = await post({ url });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('private_address');

    /*
     * And no network was possible: classification refuses SYNCHRONOUSLY,
     * before any socket is opened. Asserted on the classifier rather than on a
     * spy, because the spy would only tell us the wrapper was entered.
     */
    expect(classifyJobUrl(url)).toMatchObject({ ok: false, reason: 'private_address' });
  });

  it('refuses a non-http scheme by name', async () => {
    const res = await post({ url: 'file:///etc/passwd' });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('bad_scheme');
    expect(res.body.error).toMatch(/only http and https/i);
    expect(classifyJobUrl('file:///etc/passwd')).toMatchObject({ ok: false, reason: 'bad_scheme' });
  });

  it('blocks localhost however it is spelled', () => {
    // The unit that decides. Decimal and IPv4-mapped forms are localhost too,
    // and neither looks like it.
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.0.1']) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '52.10.11.12']) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });

  it('re-checks the address on a REDIRECT, not only on the first request', async () => {
    /*
     * The hole a first-hop-only check leaves wide open: a perfectly public URL
     * that 302s to 127.0.0.1. axios's own redirect follower would take it.
     */
    const http = {
      get: jest.fn(async (url) => (url.includes('evil.test')
        ? { status: 302, headers: { location: 'http://127.0.0.1:5432/' }, data: '' }
        : { status: 200, headers: {}, data: 'never reached' })),
    };
    const resolver = { lookup: async (host) => [{ address: host === 'evil.test' ? '93.184.216.34' : '127.0.0.1' }] };

    /*
     * Driven through fetchJobUrl - the entry routes/jobs.js actually calls -
     * rather than the inner helper, so this proves the guard fires on the real
     * path rather than proving the helper works in isolation.
     */
    const out = await actualFetch.fetchJobUrl('https://evil.test/job', { http, resolver });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('private_address');
  });

  it('refuses a hostname that resolves to a private address', async () => {
    const resolver = { lookup: async () => [{ address: '10.0.0.9' }] };
    const out = await assertPublicHost('sneaky.test', resolver);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('private_address');
  });

  it('refuses when ANY resolved address is private, not just the first', async () => {
    const resolver = { lookup: async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }] };
    const out = await assertPublicHost('mixed.test', resolver);
    expect(out.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Board routing — the three with public APIs never read HTML
 * ------------------------------------------------------------------ */
describe('boards with an official API are read through it, not scraped', () => {
  it.each([
    ['greenhouse', 'https://job-boards.greenhouse.io/acme/jobs/4512345', 'boards-api.greenhouse.io'],
    ['lever', 'https://jobs.lever.co/acme/6f3a1b2c-1111-2222-3333-444455556666', 'api.lever.co'],
    ['ashby', 'https://jobs.ashbyhq.com/acme/6f3a1b2c-1111-2222-3333-444455556666', 'api.ashbyhq.com'],
  ])('%s resolves to its public posting API', (board, url, apiHost) => {
    const c = classifyJobUrl(url);
    expect(c.ok).toBe(true);
    expect(c.board).toBe(board);
    expect(c.via).toBe('public_api');
    expect(c.apiUrl).toContain(apiHost);
  });

  it('names the board when the link is not to a single posting', () => {
    const c = classifyJobUrl('https://boards.greenhouse.io/acme/');
    expect(c.ok).toBe(false);
    expect(c.reason).toBe('unrecognised_posting_url');
    expect(c.detail).toMatch(/greenhouse/i);
  });

  it.each([
    ['naukri', 'https://www.naukri.com/job-listings-designer-acme-010125900001'],
    ['linkedin', 'https://www.linkedin.com/jobs/view/3912345678/'],
    ['instahyre', 'https://www.instahyre.com/job/123456/designer'],
  ])('%s is routed as HTML, because it publishes no posting API', (board, url) => {
    const c = classifyJobUrl(url);
    expect(c.board).toBe(board);
    expect(c.via).toBe('html');
  });

  it('anything else is generic, not refused', () => {
    expect(classifyJobUrl('https://careers.someco.com/openings/42')).toMatchObject({ ok: true, board: 'generic' });
  });
});

/* ------------------------------------------------------------------ *
 * Every failure says something specific
 * ------------------------------------------------------------------ */
describe('a failure names the reason, never a generic one', () => {
  const GENERIC = /^(could not fetch|failed|error|something went wrong)\.?$/i;

  it.each([
    ['blocked_by_site', { ok: false, reason: 'blocked_by_site', detail: 'Naukri does not allow this page to be opened by software, so we cannot read it for you. Open the job, copy the description, and paste it instead — that works on every board and gives exactly the same result.', board: 'naukri', canPaste: true }],
    ['not_found', { ok: false, reason: 'not_found', detail: 'That job posting no longer exists at that address — it may have been filled or taken down.' }],
    ['timeout', { ok: false, reason: 'timeout', detail: 'That site did not answer within 12 seconds. It may be slow or down right now.' }],
    ['site_error', { ok: false, reason: 'site_error', detail: 'That site returned an error (503). It is a problem on their side, not with the link.' }],
    ['rate_limited', { ok: false, reason: 'rate_limited', detail: 'That site is asking us to slow down. Wait a minute and try again, or paste the description instead.' }],
  ])('%s reaches the user as its own sentence', async (reason, fetchResult) => {
    fetchJobUrl.mockResolvedValue(fetchResult);
    const res = await post({ url: 'https://www.naukri.com/job-listings-x-1' });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe(reason);
    expect(res.body.error).not.toMatch(GENERIC);
    expect(res.body.error.length).toBeGreaterThan(30);
  });

  it('tells the user the paste box gives the same result when a board refuses', async () => {
    fetchJobUrl.mockResolvedValue({
      ok: false, reason: 'blocked_by_site', board: 'linkedin', canPaste: true,
      detail: 'LinkedIn does not allow this page to be opened by software, so we cannot read it for you. Open the job, copy the description, and paste it instead — that works on every board and gives exactly the same result.',
    });
    const res = await post({ url: 'https://www.linkedin.com/jobs/view/1/' });

    expect(res.status).toBe(422);
    expect(res.body.canPaste).toBe(true);
    expect(res.body.board).toBe('linkedin');
    expect(res.body.error).toMatch(/paste/i);
  });

  it('a blocked board is 422, not 500 — nothing here is broken', async () => {
    fetchJobUrl.mockResolvedValue({ ok: false, reason: 'blocked_by_site', detail: 'x'.repeat(50), board: 'naukri' });
    const res = await post({ url: 'https://www.naukri.com/x' });
    expect(res.status).toBe(422);
  });

  it('refuses an empty link with an instruction, not a code', async () => {
    const res = await post({ url: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/paste the link/i);
  });
});

/* ------------------------------------------------------------------ *
 * The success path, and what it must not invent
 * ------------------------------------------------------------------ */
describe('a fetched job is stored as the user\'s own, never in the shared index', () => {
  const goodFetch = {
    ok: true, status: 200, board: 'greenhouse', via: 'public_api',
    finalUrl: 'https://job-boards.greenhouse.io/acme/jobs/1',
    classified: { via: 'public_api', board: 'greenhouse', url: 'https://job-boards.greenhouse.io/acme/jobs/1' },
    body: JSON.stringify({
      title: 'Senior Product Designer',
      content: '<p>Figma, prototyping and user research for our Bengaluru team.</p>',
      location: { name: 'Bengaluru, India' },
      absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1',
      updated_at: '2026-08-01T00:00:00Z',
    }),
  };

  it('writes it inactive and owned, so it stays out of everyone else\'s feed', async () => {
    fetchJobUrl.mockResolvedValue(goodFetch);
    const res = await post({ url: 'https://job-boards.greenhouse.io/acme/jobs/1' });

    expect(res.status).toBe(201);
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO jobs/.test(sql));
    expect(insert).toBeTruthy();
    /*
     * Asserted on the VALUES clause specifically. The first cut matched
     * `/false, \$9|is_active/`, and the `is_active` alternative is satisfied
     * by the COLUMN LIST - so it passed with the row written active, which is
     * the one outcome it exists to prevent. A checker satisfiable by
     * coincidence reports green over exactly the gap it was written for.
     */
    const valuesClause = insert[0].slice(insert[0].indexOf('VALUES'));
    expect(valuesClause).toMatch(/\bfalse\b/);
    expect(valuesClause).not.toMatch(/\btrue\b/);
    expect(insert[1]).toContain('user_link');
    expect(insert[1]).toContain(42);
  });

  it('never fills posted_at from a field that is not a publication date', async () => {
    /*
     * Greenhouse's updated_at moves whenever the posting is edited. Using it
     * would fabricate freshness - the exact defect that nearly put invented
     * dates on 4,685 himalayas rows.
     */
    fetchJobUrl.mockResolvedValue(goodFetch);
    await post({ url: 'https://job-boards.greenhouse.io/acme/jobs/1' });

    const insert = query.mock.calls.find(([sql]) => /INSERT INTO jobs/.test(sql));
    /*
     * Position-independent, and it has to be: the first cut asserted
     * `not.toContain('2026-08-01T00:00:00Z')`, which passed when the value was
     * present as '2026-08-01T00:00:00.000Z'. An exact-string absence check is
     * not an absence check.
     */
    const carriesUpdatedAt = insert[1].some(
      (v) => typeof v === 'string' && v.startsWith('2026-08-01')
    );
    expect(carriesUpdatedAt).toBe(false);
  });

  it('enforces a per-hour limit, so a person pasting links cannot become a crawler', async () => {
    query.mockImplementation((sql) => {
      if (/COUNT\(\*\)::int AS n FROM jobs/.test(sql)) return Promise.resolve({ rows: [{ n: 20 }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post({ url: 'https://job-boards.greenhouse.io/acme/jobs/1' });

    expect(res.status).toBe(429);
    expect(res.body.reason).toBe('rate_limited_local');
    expect(fetchJobUrl).not.toHaveBeenCalled();
  });

  it('keeps the job when scoring fails, rather than losing what the user added', async () => {
    fetchJobUrl.mockResolvedValue(goodFetch);
    const { scoreJobsForUser } = require('../services/matchingEngine');
    scoreJobsForUser.mockRejectedValueOnce(new Error('scoring down'));

    const res = await post({ url: 'https://job-boards.greenhouse.io/acme/jobs/1' });
    expect(res.status).toBe(201);
    expect(res.body.job.id).toBe(9001);
    expect(res.body.score).toBeNull();
  });

  it('says whether the company and the date are actually known', async () => {
    fetchJobUrl.mockResolvedValue(goodFetch);
    const res = await post({ url: 'https://job-boards.greenhouse.io/acme/jobs/1' });
    expect(res.body.job.postedAtKnown).toBe(false);
    expect(res.body.job).toHaveProperty('companyStated');
  });
});
