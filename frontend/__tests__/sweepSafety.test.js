/*
 * D26 — the sweep tool must be an allowlist, and must prove its own detector.
 *
 * A denylist fails open. The A7.5 sweep's pattern list had not yet excluded
 * "save" when it ran against the operator's live account, and the failure mode
 * of a miss there is an unrecoverable submission to a real employer.
 *
 * D24 — and its negatives are worthless until the detector has been shown to
 * report a positive. 83 of 84 "dead controls" were a blind detector.
 */

const fs = require('fs');
const path = require('path');

const { stripComments } = require('../test-utils/source');

/* Comments stripped: this file's own explanation of why a denylist is wrong
 * contains the word "denylist", which the structural assertion below bans. */
const src = stripComments(
  fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'ui-sweep.js'), 'utf8')
);
const { isSafe } = require('../../tools/ui-sweep');

describe('D26 — nothing is clicked unless it is known safe', () => {
  it.each([
    'Apply Now', 'Submit application', 'Save and continue this application',
    'Approve', 'Delete', 'Discard', 'Retry', 'Prepare 2 applications',
    'Run queue now', 'Choose Pilot', 'Update password', 'Save profile',
    'Sign out', 'Add', 'Generate cover letter', 'Tailor',
  ])('refuses to click %s', (label) => {
    expect(isSafe(label)).toBe(false);
  });

  it.each([
    'View Details', 'Next ›', 'Best match', 'Newest first', 'Clear',
    '2', 'Close menu', '▦', 'Export CSV',
  ])('allows %s', (label) => {
    expect(isSafe(label)).toBe(true);
  });

  it('decides by allowlist, never by a list of things to avoid', () => {
    // The structural property: unknown input must default to NOT safe.
    expect(isSafe('Some Button Nobody Anticipated')).toBe(false);
    expect(isSafe('')).toBe(false);
    expect(src).toMatch(/SAFE_CONTROLS\.some/);
    expect(src).not.toMatch(/DANGER|denylist|blocklist/);
  });
});

describe('D24 — the detector proves itself before any negative is believed', () => {
  it('refuses to run until preflight passes', () => {
    expect(src).toMatch(/const pre = await preflight\(\)/);
    expect(src).toMatch(/if \(!pre\.ok\) throw/);
  });

  it('calibrates against a control known to be alive', () => {
    expect(src).toMatch(/preflight[\s\S]{0,700}View Details/);
    expect(src).toMatch(/domChanged && seen\.requests > 0/);
  });

  it('watches the DOM and the network, not the text length', () => {
    // innerText length alone cannot see a drawer open, or twenty rows of
    // similar length change. That is what produced 83 false findings.
    expect(src).toMatch(/document\.body\.innerHTML\.length/);
    expect(src).toMatch(/window\.fetch = function/);
  });
});
