/*
 * An adapter may only submit on a user's behalf after a verified live run.
 *
 * Lever and Ashby sat in SUPPORTED_ATS while never having been run against a
 * live form - one queued job from submitting to a real employer through
 * untested code. An application cannot be unsent, so this list is a whitelist
 * of VERIFIED adapters, not of adapters that exist.
 *
 * This test exists to make re-enabling deliberate. Adding a platform here
 * requires editing this file too, which is the moment to ask for the evidence.
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'apply.js'), 'utf8');

// The declaration only, with comments stripped - a commented-out entry is
// disabled, and must not read as enabled.
const decl = src
  .slice(src.indexOf('const SUPPORTED_ATS'), src.indexOf('function detectAts'))
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

const enabled = [...decl.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

describe('SUPPORTED_ATS is a whitelist of verified adapters', () => {
  it('contains only adapters verified against a live form', () => {
    // Update this list ONLY alongside evidence of a verified live submission.
    const VERIFIED = ['greenhouse'];
    expect(enabled.sort()).toEqual(VERIFIED.sort());
  });

  it('does not enable lever or ashby, which have never been run live', () => {
    expect(enabled).not.toContain('lever');
    expect(enabled).not.toContain('ashby');
  });

  it('never enables a platform with no adapter file at all', () => {
    const adapters = fs
      .readdirSync(path.join(__dirname, '..', '..', 'extension', 'content', 'adapters'))
      .map((f) => f.replace(/\.js$/, ''));
    for (const p of enabled) expect(adapters).toContain(p);
  });
});
