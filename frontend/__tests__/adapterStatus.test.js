/*
 * A3 / H6 — the adapter status a user reads must match what the server will
 * execute.
 *
 * Lever and Ashby rendered a GREEN dot next to text saying they had never been
 * verified. Colour is read before prose, so the row asserted "available" and
 * "unavailable" simultaneously and the colour won. Both are disabled in
 * SUPPORTED_ATS (D7, after they were found able to submit untested).
 *
 * This binds the two lists so they cannot drift: re-enabling an adapter on the
 * server without updating the page, or the reverse, fails here.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APPLY_ROUTE = path.join(ROOT, '..', 'backend', 'routes', 'apply.js');
const AUTO_APPLY = path.join(ROOT, 'pages', 'auto-apply.js');

/** The adapter keys the server will actually run, read from the whitelist. */
function serverSupported() {
  const src = fs.readFileSync(APPLY_ROUTE, 'utf8');
  const block = src.slice(src.indexOf('const SUPPORTED_ATS'));
  const body = block.slice(0, block.indexOf(']'));
  // Only uncommented entries count. The disabled ones are left in the source as
  // commented lines on purpose, so re-enabling is a deliberate edit.
  return new Set(
    body.split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .flatMap((l) => [...l.matchAll(/'([a-z]+)'/g)].map((m) => m[1]))
  );
}

/** The coverage rows the page renders, with the state that drives the dot. */
function pageCoverage() {
  const src = fs.readFileSync(AUTO_APPLY, 'utf8');
  const block = src.slice(src.indexOf('const COVERAGE = ['));
  const body = block.slice(0, block.indexOf('];'));
  return [...body.matchAll(/\{[^}]*?atsKey:\s*'([a-z]+)'[^}]*?state:\s*'(\w+)'[^}]*?\}/g)]
    .map((m) => ({ atsKey: m[1], state: m[2] }));
}

describe('A3 / H6 — adapter status is bound to SUPPORTED_ATS', () => {
  const supported = serverSupported();
  const coverage = pageCoverage();

  it('reads both lists successfully', () => {
    // Either parser returning nothing would make every assertion below vacuous.
    expect(supported.size).toBeGreaterThan(0);
    expect(coverage.length).toBeGreaterThan(0);
  });

  it('shows a full-status dot only for adapters the server will run', () => {
    const wronglyGreen = coverage
      .filter((c) => c.state === 'full' && !supported.has(c.atsKey))
      .map((c) => c.atsKey);
    expect(wronglyGreen).toEqual([]);
  });

  it('does not understate an adapter the server has enabled', () => {
    // The reverse drift: enabling on the server while the page still says no.
    const wronglyDisabled = coverage
      .filter((c) => c.state !== 'full' && supported.has(c.atsKey))
      .map((c) => c.atsKey);
    expect(wronglyDisabled).toEqual([]);
  });

  it('keeps greenhouse enabled and lever/ashby disabled, as D7 decided', () => {
    // Pins the current decision so re-enabling is deliberate and visible in a
    // diff, rather than something that quietly happens.
    expect(supported.has('greenhouse')).toBe(true);
    expect(supported.has('lever')).toBe(false);
    expect(supported.has('ashby')).toBe(false);
  });
});

/*
 * A5 — the marketing copy is bound to the whitelist too.
 *
 * The Auto Apply panel was bound; the landing page was not, and it drifted:
 * the FAQ read "Coverage today is Greenhouse, Lever and Ashby" while
 * SUPPORTED_ATS had been cut to greenhouse alone (D7, after Lever and Ashby
 * were found able to submit untested). A visitor deciding whether to trust the
 * product read a claim the product could not keep.
 *
 * §7 says copy follows the product, and it reads the same in both directions.
 * This makes drift a test failure rather than something noticed months later.
 */
describe('A5 — the landing page cannot overstate automated coverage', () => {
  const landing = fs.readFileSync(path.join(ROOT, 'pages', 'index.js'), 'utf8');
  const supported = serverSupported();

  // Every ATS the product has an adapter for, named on the landing page.
  const NAMED = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby' };

  it('reads the whitelist and the page', () => {
    expect(supported.size).toBeGreaterThan(0);
    expect(landing.length).toBeGreaterThan(1000);
  });

  it('does not present a disabled adapter as automated coverage', () => {
    /*
     * Anchored on the sentence that makes the coverage claim, not on the whole
     * file - Lever and Ashby legitimately appear elsewhere (job sources, and
     * the honest statement that their adapters are built but off).
     */
    const m = landing.match(/Automated coverage today is[^.]*\./);
    expect(m).toBeTruthy();
    const claim = m[0];

    const overstated = Object.entries(NAMED)
      .filter(([key, name]) => !supported.has(key) && new RegExp(`\\b${name}\\b`).test(claim))
      .map(([, name]) => name);
    expect(overstated).toEqual([]);
  });

  it('names every adapter the server WILL run', () => {
    const claim = (landing.match(/Automated coverage today is[^.]*\./) || [''])[0];
    const missing = [...supported]
      .filter((key) => NAMED[key] && !new RegExp(`\\b${NAMED[key]}\\b`).test(claim))
      .map((key) => NAMED[key]);
    expect(missing).toEqual([]);
  });
});
