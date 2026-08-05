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
