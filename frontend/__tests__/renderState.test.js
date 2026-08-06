/*
 * A2c — the shared rule: unknown never renders as zero.
 *
 * These test the primitive rather than each page, because the defect shipped
 * three times in three components and the third instance was found by luck at
 * 375px on production. A rule the pages share can be pinned once.
 */

import { stateOf, countText, isParsed, parsedOr, LOADING, FAILED, READY, UNKNOWN } from '../lib/renderState';

describe('A2c — the four states are distinguishable', () => {
  it('treats a missing value as unknown, not as zero', () => {
    // The whole bug in one assertion: useState(0) made these identical.
    expect(stateOf({ value: null })).toBe(UNKNOWN);
    expect(stateOf({ value: undefined })).toBe(UNKNOWN);
    expect(stateOf({ value: 0 })).toBe(READY);
  });

  it('reports a failure ahead of a load in flight', () => {
    // A retry after a failure must not present as a first load.
    expect(stateOf({ loading: true, error: new Error('x') })).toBe(FAILED);
    expect(stateOf({ loading: true })).toBe(LOADING);
  });

  it('reports loading ahead of any value, so a stale number is never current', () => {
    expect(stateOf({ value: 42, loading: true })).toBe(LOADING);
  });
});

describe('A2c — countText renders a number only when a response returned one', () => {
  it('does not print 0 for a count that has not loaded', () => {
    const { state, text } = countText({ value: null, unit: 'results' });
    expect(state).toBe(UNKNOWN);
    expect(text).not.toMatch(/\b0\b/);
    expect(text).toMatch(/unavailable/i);
  });

  it('does not print 0 while loading', () => {
    const { text } = countText({ value: null, loading: true, unit: 'results' });
    expect(text).not.toMatch(/\b0\b/);
    expect(text).toMatch(/loading/i);
  });

  it('does not print 0 after a failure', () => {
    const { state, text } = countText({ value: null, error: new Error('500'), unit: 'results' });
    expect(state).toBe(FAILED);
    expect(text).not.toMatch(/\b0\b/);
  });

  it('does print a real zero a completed response returned', () => {
    // A zero that was actually measured is a fact and must survive. Suppressing
    // it would be the mirror of the bug.
    const { state, text } = countText({ value: 0, unit: 'results' });
    expect(state).toBe(READY);
    expect(text).toBe('0 results');
  });

  it('prefers better words for a real zero when given them', () => {
    const { text } = countText({ value: 0, zeroText: 'No applications yet' });
    expect(text).toBe('No applications yet');
  });

  it('formats a real count and never a non-finite one', () => {
    expect(countText({ value: 23949, unit: 'results' }).text).toBe('23,949 results');
    expect(countText({ value: NaN, unit: 'results' }).state).toBe(FAILED);
  });
});

describe('A2c — a parsed field renders only if it parsed', () => {
  it('rejects a value that is its own column name', () => {
    // Shipped: a job ingested with company_name = "name" rendered on the Auto
    // Apply panel as `name · Philippines`.
    expect(isParsed('name')).toBe(false);
    expect(parsedOr('name', 'Company not stated')).toBe('Company not stated');
  });

  it('rejects blanks and parser placeholders', () => {
    for (const v of ['', '   ', null, undefined, 'null', 'undefined', 'N/A', '-', 'none']) {
      expect(isParsed(v)).toBe(false);
    }
  });

  it('keeps real values, including ones that merely look odd', () => {
    for (const v of ['Vercel', 'name.com', 'X', '37signals', 'Nameless Co']) {
      expect(isParsed(v)).toBe(true);
    }
    expect(parsedOr('  Twilio  ')).toBe('Twilio');
  });
});

describe('A7.14 — a fetch is not a publication', () => {
  const { timeAgo, fetchedAgo, relativeTime, NO_DATE, NEVER_FETCHED } = require('../lib/format');

  it('never describes a missing fetch time in publication vocabulary', () => {
    /*
     * The source panel called timeAgo(lastFetched), so a source that had never
     * been fetched rendered "Publication date unavailable" - a statement about
     * a job's publish date, made about a source. A7.3 fixed exactly this one
     * level down and the fix did not reach here.
     */
    expect(fetchedAgo(null)).not.toBe(NO_DATE);
    expect(fetchedAgo(null).toLowerCase()).not.toMatch(/publication/);
    expect(fetchedAgo(undefined)).toBe(NEVER_FETCHED);
    expect(fetchedAgo('not-a-date')).toBe(NEVER_FETCHED);
  });

  it('keeps the publication vocabulary for publication dates', () => {
    expect(timeAgo(null)).toBe(NO_DATE);
  });

  it('shares the arithmetic, so the two can never drift apart', () => {
    // The point of splitting was one calculation with two vocabularies, not
    // two calculations that agree today.
    const t = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(t)).toBe('3h ago');
    expect(timeAgo(t)).toBe(relativeTime(t));
    expect(fetchedAgo(t)).toBe(relativeTime(t));
  });
});

describe('A7.14 — the source dot reports the fetcher, not the leftovers', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'pages', 'jobs.js'), 'utf8');
  const panel = src.slice(src.indexOf('sourcesBanner'), src.indexOf('sourcesBanner') + 2200);

  it('does not infer liveness from the row count', () => {
    // `count > 0` is wrong in both directions - stale rows from a dead source
    // read as active, and a working source that matched nothing reads as dead.
    expect(panel).not.toMatch(/count\s*>\s*0\s*\?\s*\w*\.?sourceDotActive/);
    expect(panel).toMatch(/status === 'live'\s*\n?\s*\?\s*page\.sourceDotActive/);
  });

  it('reserves the error colour for things that actually failed', () => {
    // Red is a call to action. A board we deliberately do not fetch needs no
    // action, so it must not share a dot with one that broke overnight.
    expect(panel).toMatch(/status === 'failing'\s*\n?\s*\?\s*page\.sourceDotInactive/);
    expect(panel).toMatch(/page\.sourceDotOff/);
  });

  it('does not print a count for a source nothing ever counted', () => {
    // "0" next to a never-fetched source reads as a measurement. It isn't one.
    const notConnected = panel.slice(panel.indexOf("=== 'not_connected'"));
    expect(notConnected).toMatch(/'not connected'/);
    expect(notConnected.slice(0, 200)).not.toMatch(/\$\{s\.count\}/);
  });

  it('does not label the whole row live while one member is not', () => {
    expect(panel).not.toMatch(/⚡ Live sources/);
  });
});

describe('A7.2 — every surface that shows a company routes through parsedOr', () => {
  const fs = require('fs');
  const path = require('path');

  /*
   * Found during the A7.5 sweep: the resume editor rendered {j.company_name}
   * raw, so 181 legacy rows read "UI/UX Engineer — name" in the "Tailor to a
   * job" list. The A7.2 comment had predicted it - "the render guard protects
   * surfaces that route through it, and there is no guarantee every future
   * surface will."
   *
   * So guard the rule over the whole pages directory rather than that one
   * line: any page interpolating a company field must pass it through
   * parsedOr. The next page to show a company gets caught here.
   */
  const dir = path.join(__dirname, '..', 'pages');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

  it('never interpolates a raw company field into JSX', () => {
    const offenders = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      // `{x.company_name}` or `{x.company}` standing alone inside JSX.
      const raw = src.match(/\{\s*\w+\.company(_name)?\s*\}/g) || [];
      if (raw.length) offenders.push(`${f}: ${raw.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('A7.1/A7.20 — a score is rendered as a percentage everywhere', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'pages');

  it('never prints a bare match score without its unit', () => {
    /*
     * jobs.js decided this explicitly - "a bare 75 is not a score, it is a
     * number; the % carries the meaning" - and the dashboard rendered
     * {Math.round(m.overall_score * 100)} with no unit, contradicting it on
     * the first screen a user sees.
     *
     * Guarded as the rule across pages rather than the one line, so the next
     * surface to show a score cannot reintroduce it.
     */
    const offenders = [];
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const hits = src.match(/\{Math\.round\([^)]*overall_score[^)]*\)\}(?!\s*%)/g) || [];
      if (hits.length) offenders.push(`${f}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
