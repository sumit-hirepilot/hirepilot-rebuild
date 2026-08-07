/*
 * nofluffjobs is paged, and its cap is reported.
 *
 * `GET /api/posting` answers with the WHOLE catalogue - measured at 160.8MB in
 * one response. On a real boot that single source took RSS from 106MB to 688MB
 * and heap from 28MB to 455MB, against a 500MB budget and a 1GB ceiling:
 * ~157MB of raw body as an external Buffer, plus the parsed JSON, plus the
 * dedup Map, plus the mapped output, all live at once.
 *
 * D53 had measured this step at 246MB and written it down as the next
 * candidate if the ceiling tightened. Their catalogue grew; it did.
 */

jest.mock('axios');
const axios = require('axios');
const { fetchJobs, MAX_RAW } = require('../services/apis/nofluffjobs');

const posting = (id) => ({
  id, title: `Job ${id}`, name: `Company ${id % 7}`, posted: 1700000000000,
  url: `job-${id}`, location: { places: [{ city: 'Remote' }] },
  salary: { from: 1000, to: 2000, currency: 'PLN' }, category: 'backend', seniority: ['Mid'],
});

/** Pages of `per` postings until `total` is exhausted. */
function servePages(total, per = 100) {
  axios.post.mockImplementation(async (url) => {
    const offset = Number(/offset=(\d+)/.exec(url)[1]);
    const remaining = Math.max(0, total - offset);
    const n = Math.min(per, remaining);
    return {
      data: {
        totalCount: total,
        postings: Array.from({ length: n }, (_, i) => posting(offset + i)),
      },
    };
  });
}

beforeEach(() => { axios.post.mockReset(); });

describe('it pages instead of pulling the catalogue', () => {
  it('never asks for everything at once', async () => {
    servePages(500);
    await fetchJobs();
    // Several requests, each with its own offset - not one unbounded call.
    expect(axios.post.mock.calls.length).toBeGreaterThan(1);
    const offsets = axios.post.mock.calls.map(([url]) => Number(/offset=(\d+)/.exec(url)[1]));
    expect(offsets[0]).toBe(0);
    expect(new Set(offsets).size).toBe(offsets.length);   // never repeats a page
  });

  it('uses the search endpoint, not the whole-catalogue one', async () => {
    servePages(100);
    await fetchJobs();
    for (const [url] of axios.post.mock.calls) {
      expect(url).toMatch(/\/api\/search\/posting/);
      expect(url).not.toMatch(/\/api\/posting(\?|$)/);
    }
  });

  it('stops when a page comes back empty', async () => {
    servePages(150);
    const rows = await fetchJobs();
    expect(rows.length).toBeGreaterThan(0);
    // 150 items at 100 a page: two full pages then an empty one.
    expect(axios.post.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

describe('the streaming form holds one page at a time', () => {
  it('hands over batches and never accumulates the whole source', async () => {
    servePages(500);
    const batches = [];
    const res = await fetchJobs(async (rows) => { batches.push(rows.length); });

    expect(batches.length).toBeGreaterThan(1);
    expect(res.fetched).toBe(500);
    // No single handover is the whole catalogue.
    expect(Math.max(...batches)).toBeLessThan(500);
  });

  it('awaits each batch before fetching the next', async () => {
    /*
     * Without the await two pages are resident at once and the bound is only
     * half applied - which would read as fixed while still peaking.
     */
    servePages(400);
    let inFlight = 0;
    let maxInFlight = 0;
    await fetchJobs(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    });
    expect(maxInFlight).toBe(1);
  });

  it('still returns an array when no consumer is given', async () => {
    servePages(100);
    const rows = await fetchJobs();
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe('the cap is stated, never silent', () => {
  it('stops at MAX_RAW and says how many it did not read', async () => {
    /*
     * Their index is ~22,000. A truncation nobody is told about reads as
     * "that is all there was", which is the same class as any other silent
     * cap in this codebase.
     */
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      servePages(MAX_RAW + 5000, 1000);
      const res = await fetchJobs(async () => {});
      expect(res.fetched).toBeGreaterThanOrEqual(MAX_RAW);

      const said = log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(said).toMatch(/nofluffjobs: stopped at/);
      expect(said).toMatch(/not read/);
      expect(said).toMatch(String(MAX_RAW + 5000));      // names the true total
    } finally {
      log.mockRestore();
    }
  });

  it('says nothing when it read everything', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      servePages(200);
      await fetchJobs();
      const said = log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(said).not.toMatch(/stopped at/);
    } finally {
      log.mockRestore();
    }
  });
});

describe('dedup survives paging', () => {
  it('the same posting on two pages is emitted once', async () => {
    // The API repeats a posting per province it is visible in.
    axios.post.mockImplementation(async (url) => {
      const offset = Number(/offset=(\d+)/.exec(url)[1]);
      if (offset >= 200) return { data: { totalCount: 200, postings: [] } };
      return { data: { totalCount: 200, postings: [posting(1), posting(2)] } };
    });
    const rows = await fetchJobs();
    const ids = rows.map((r) => r.external_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
