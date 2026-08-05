/*
 * A7.9 — every control that changes the result set must survive the URL.
 *
 * Found while verifying A7.11: loading /jobs?sort=recent produced the
 * score-ranked feed. The page WRITES its filters to the query string and reads
 * most of them back, but sort, minScore and ranked were written by neither -
 * so a reload, a shared link, or the back button silently returns a different
 * list than the one on screen, and the A7.1 score floor resets to 0.4 with no
 * indication.
 *
 * Written as one rule over the whole set rather than three assertions about
 * three parameters, because the defect is the asymmetry, not the parameters:
 * the next control added will have exactly this bug unless the rule is what is
 * guarded.
 */

import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '..', 'pages', 'jobs.js'), 'utf8');

/** The reader: `const x = q.foo ...` inside the query-restore function. */
const restore = src.slice(src.indexOf('const restoreFromQuery'), src.indexOf('const queryFromSearch'));
/** The writer: `if (x) q.foo = ...` inside the query-builder. */
const build = src.slice(src.indexOf('const buildQuery'), src.indexOf('const syncUrl'));

const RESULT_AFFECTING = ['sort', 'minScore', 'ranked', 'datePosted', 'experience', 'location', 'scope', 'page'];

describe('A7.9 — the URL is the state, in both directions', () => {
  it.each(RESULT_AFFECTING)('round-trips %s', (key) => {
    // Both halves. A parameter that is written but never read produces a URL
    // that looks shareable and is not; one that is read but never written
    // cannot be shared at all.
    expect(build).toMatch(new RegExp(`q\\.${key}\\s*=`));
    expect(restore).toMatch(new RegExp(`q\\.${key}\\b`));
  });

  it('reads every key it writes, with nothing left over', () => {
    /*
     * The general rule, so a new control cannot quietly opt out: every key the
     * builder assigns must appear in the restore path. Derived from the source
     * rather than listed, so adding a control to one side and forgetting the
     * other fails here.
     */
    const written = [...build.matchAll(/q\.([a-zA-Z]+)\s*=/g)].map((m) => m[1]);
    expect(written.length).toBeGreaterThan(8);
    const missing = written.filter((k) => !new RegExp(`q\\.${k}\\b`).test(restore));
    expect(missing).toEqual([]);
  });
});
