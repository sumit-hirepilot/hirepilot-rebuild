/*
 * No source's private vocabulary reaches the Employment type chip.
 *
 * The facet CASE ended in `ELSE lower(job_type)`, so any spelling a board
 * invented was published as a category. A real user opening the chip was
 * offered "Clt(14)" - Brazil's CLT labour regime, from a Brazilian board,
 * capitalised and presented to an Indian job seeker as a kind of employment -
 * alongside "Hybrid(13)" and "Remote(2)", which are workplace arrangements
 * and not employment types at all. The Workplace facet beside it offered no
 * Hybrid option, so those 13 roles were filed under the wrong question.
 *
 * Both suites were green throughout. Nothing could have caught it: the values
 * come from data, not from code, so only opening the chip and reading it
 * against `SELECT DISTINCT job_type` shows the leak. This test closes the
 * hole the values came through, which IS in code.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'jobs.js'), 'utf8');
const CASE = SRC.slice(SRC.indexOf('const JOB_TYPE_SQL'), SRC.indexOf('const JOB_TYPE_SQL') + 1400);

/* Every value the facet is allowed to publish. Adding one is a deliberate act. */
const ALLOWED = new Set([
  'full-time', 'part-time', 'contract', 'internship',
  'temporary', 'volunteer', 'unspecified', 'other',
]);

describe('the employment-type facet publishes a closed vocabulary', () => {
  it('never falls through to the raw column value', () => {
    /*
     * The specific defect. `ELSE lower(job_type)` is a passthrough: it makes
     * the UI's category list equal to whatever every source happens to write.
     */
    expect(CASE).not.toMatch(/ELSE\s+lower\s*\(\s*job_type/i);
    expect(CASE).toMatch(/ELSE\s+'other'/i);
  });

  it('emits only names that were deliberately chosen', () => {
    const emitted = [...CASE.matchAll(/THEN\s+'([a-z-]+)'/g)].map((m) => m[1]);
    const elseArm = (CASE.match(/ELSE\s+'([a-z-]+)'/) || [])[1];

    expect(emitted.length).toBeGreaterThan(4);
    for (const v of [...emitted, elseArm]) {
      expect(ALLOWED.has(v)).toBe(true);
    }
  });

  it('files workplace arrangements as unknown employment, not as a type', () => {
    /*
     * Hybrid/remote/on-site say WHERE the work happens. Guessing that a hybrid
     * role is full-time would be inventing the answer to a different question;
     * 'unspecified' is the honest bucket, and workArrangement already carries
     * the real information.
     */
    const arm = CASE.match(/IN \('hybrid'[^)]*\)\s*THEN\s+'([a-z-]+)'/);
    expect(arm).not.toBeNull();
    expect(arm[1]).toBe('unspecified');
  });

  it('folds the spellings that mean contract work into contract', () => {
    const arm = CASE.match(/THEN 'contract'/) && CASE.match(/IN \(([^)]*)\)\s*THEN 'contract'/);
    expect(arm).not.toBeNull();
    for (const spelling of ['freelance', 'fixedterm', 'contractor']) {
      expect(arm[1]).toContain(spelling);
    }
  });
});
