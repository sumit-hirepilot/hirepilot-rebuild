/*
 * D54 and D55, the two guards written after the nofluffjobs episode.
 *
 * D54 — a resource target is satisfiable by doing nothing. The memory fix cut
 * the boot peak to 158MB, the best figure ever recorded, while cutting that
 * source from 3,054 jobs to 20. Every budget metric improved; only the ingest
 * count disagreed, on one log line.
 *
 * D55 — external dependencies change without your code changing. That same
 * endpoint was 246MB of process peak when D53 measured it and inside budget;
 * their index grew, the response reached 160.8MB, and the identical code took
 * the process to 694MB. It surfaced at a load test, which is hours late and
 * points nowhere near the cause.
 */

const { checkSourceYield, median, MIN_BASELINE } = require('../services/ingestYield');
const { SourceResponseTooLarge, DEFAULT_MAX_BYTES } = require('../services/apis/httpSource');

/** A query that answers the history lookup with the given past yields. */
const history = (...counts) => jest.fn().mockResolvedValue({
  rows: counts.map((n) => ({ jobs_fetched: n })),
});

describe('D54 — the work is counted, not assumed', () => {
  it('flags the real event: 3,054 down to 20', async () => {
    const q = history(3054, 3040, 3061, 3055, 3048);
    const r = await checkSourceYield(q, 'nofluffjobs', 20);

    expect(r.checked).toBe(true);
    expect(r.collapsed).toBe(true);
    // median of [3040, 3048, 3054, 3055, 3061]
    expect(r.baseline).toBe(3054);
    expect(r.dropPct).toBeGreaterThan(98);
  });

  it('stays quiet when a source merely has a slow week', async () => {
    // Half the usual is plausible; a board goes quiet. It must not cry wolf.
    const q = history(1000, 1000, 1000, 1000, 1000);
    const r = await checkSourceYield(q, 'remoteok', 600);
    expect(r.collapsed).toBe(false);
  });

  it('uses the median, so one bad previous run cannot mask the next collapse', async () => {
    /*
     * With a mean, a single 20 in the history drags the baseline down far
     * enough that the following 20 looks normal - the defect would go quiet on
     * its second cycle, which is precisely when someone would look.
     */
    const q = history(3054, 20, 3061, 3055, 3048);
    const r = await checkSourceYield(q, 'nofluffjobs', 20);
    // median of [20, 3048, 3054, 3055, 3061] - the 20 does not move it.
    // The mean would be 2447, and 20 < 2447*0.4 still flags, but a SECOND
    // collapsed run would drag the mean to ~1240 and a third to ~630.
    expect(r.baseline).toBe(3054);
    expect(r.collapsed).toBe(true);
  });

  it('reports "unchecked" rather than "passed" with no history', async () => {
    const r = await checkSourceYield(history(), 'brandnew', 5);
    expect(r.checked).toBe(false);
    expect(r.collapsed).toBe(false);
  });

  it('ignores baselines too small to mean anything', async () => {
    // 2 from 5 is not a signal, and treating it as one makes the guard noise.
    const r = await checkSourceYield(history(5, 4, 6), 'tiny', 2);
    expect(r.checked).toBe(false);
    expect(MIN_BASELINE).toBeGreaterThan(10);
  });

  it('a failing history lookup does not fail the cycle', async () => {
    const q = jest.fn().mockRejectedValue(new Error('db down'));
    const r = await checkSourceYield(q, 'remoteok', 10);
    expect(r.checked).toBe(false);
    expect(r.collapsed).toBe(false);
  });

  it('only counts successful past runs with a real yield', async () => {
    const q = history(1000);
    await checkSourceYield(q, 'remoteok', 900);
    const [sql] = q.mock.calls[0];
    expect(sql).toMatch(/success = true/);
    expect(sql).toMatch(/jobs_fetched > 0/);
  });

  it('median is a median', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);   // rounded midpoint
    expect(median([])).toBeNull();
  });
});

describe('D55 — an oversized source response is refused at ingest', () => {
  it('the ceiling is well above the largest real response and far below the incident', () => {
    const mb = DEFAULT_MAX_BYTES / 1024 / 1024;
    expect(mb).toBeGreaterThan(16);    // nofluffjobs' paged response
    expect(mb).toBeLessThan(160);      // the response that caused the 694MB peak
  });

  it('names the source and points at paging, not a bigger buffer', () => {
    const err = new SourceResponseTooLarge('nofluffjobs', DEFAULT_MAX_BYTES);
    expect(err.source).toBe('nofluffjobs');
    expect(err.message).toMatch(/nofluffjobs/);
    expect(err.message).toMatch(/paging, not a bigger buffer/i);
  });

  it('every source client goes through the bounded fetcher', () => {
    /*
     * The bound is worthless on eleven of twelve clients. Checked as a census
     * rather than trusting that a conversion covered them all.
     */
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'services', 'apis');
    const offenders = [];

    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.js') || name === 'httpSource.js' || name === 'textSanitizer.js') continue;
      const src = fs.readFileSync(path.join(dir, name), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (/\baxios\s*\.\s*(get|post|request)\s*\(/.test(src)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
