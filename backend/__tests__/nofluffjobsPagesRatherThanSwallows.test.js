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
const { fetchJobs, MAX_UNIQUE, PAGE_UNIQUE } = require('../services/apis/nofluffjobs');

const posting = (id) => ({
  id, title: `Job ${id}`, name: `Company ${id % 7}`, posted: 1700000000000,
  url: `job-${id}`, location: { places: [{ city: 'Remote' }] },
  salary: { from: 1000, to: 2000, currency: 'PLN' }, category: 'backend', seniority: ['Mid'],
});

/*
 * Pages keyed on `page`, each carrying `per` DISTINCT jobs, until `total` is
 * exhausted. Modelled on the real API: it repeats a posting once per province,
 * so a page holds several rows per distinct job.
 */
function servePages(total, per = 100, { variantsPerJob = 1 } = {}) {
  axios.post.mockImplementation(async (url) => {
    const page = Number(/[?&]page=(\d+)/.exec(url)[1]);
    const start = (page - 1) * per;
    const remaining = Math.max(0, total - start);
    const n = Math.min(per, remaining);
    const postings = [];
    for (let i = 0; i < n; i += 1) {
      for (let v = 0; v < variantsPerJob; v += 1) postings.push(posting(start + i + 1));
    }
    return { data: { totalCount: total, postings } };
  });
}

beforeEach(() => { axios.post.mockReset(); });

describe('it pages instead of pulling the catalogue', () => {
  it('never asks for everything at once, and advances the page', async () => {
    servePages(500);
    await fetchJobs();
    expect(axios.post.mock.calls.length).toBeGreaterThan(1);
    const pages = axios.post.mock.calls.map(([url]) => Number(/[?&]page=(\d+)/.exec(url)[1]));
    expect(pages[0]).toBe(1);
    expect(new Set(pages).size).toBe(pages.length);   // never asks twice for one page
  });

  it('pages on page=, not offset=, because offset is ignored by the API', () => {
    /*
     * The defect this exists to prevent: the first version paged on offset,
     * which the API ignores, so it read the same page forty times and the
     * source fell from ~3,000 jobs to 20.
     */
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'services', 'apis', 'nofluffjobs.js'), 'utf8'
    );
    const call = src.slice(src.indexOf('SEARCH_URL}?'), src.indexOf('SEARCH_URL}?') + 120);
    expect(call).toMatch(/page=\$\{page\}/);
    expect(call).not.toMatch(/offset=\$/);
  });

  it('asks for unique jobs per page via limit=', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'services', 'apis', 'nofluffjobs.js'), 'utf8'
    );
    expect(src).toMatch(/limit=\$\{PAGE_UNIQUE\}/);
    expect(PAGE_UNIQUE).toBeGreaterThan(0);
  });

  it('stops when a page adds nothing new, so a wrong parameter cannot loop', async () => {
    // Every page identical - what offset= actually did.
    axios.post.mockImplementation(async () => ({
      data: { totalCount: 21986, postings: [posting(1), posting(2)] },
    }));
    const rows = await fetchJobs();
    expect(rows).toHaveLength(2);
    expect(axios.post.mock.calls.length).toBe(2);
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
      servePages(MAX_UNIQUE + 5000, 1000);
      const res = await fetchJobs(async () => {});
      expect(res.fetched).toBeGreaterThanOrEqual(MAX_UNIQUE);

      const said = log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(said).toMatch(/nofluffjobs: stopped at/);
      expect(said).toMatch(String(MAX_UNIQUE + 5000));      // names the true total
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
  it('province variants of one job are emitted once', async () => {
    // The real shape: ~8 rows per distinct job, one per province.
    servePages(300, 100, { variantsPerJob: 8 });
    const rows = await fetchJobs();
    const ids = rows.map((r) => r.external_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rows).toHaveLength(300);
  });
});
