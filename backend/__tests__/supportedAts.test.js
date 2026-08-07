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
 *
 * ---
 *
 * ONE EXCEPTION NOW EXISTS, and it is written out rather than waved through.
 *
 * `ats_sandbox` is HirePilot's own controlled target, standing in for an
 * employer's form while A5 defers the real run to counsel. It is NOT a
 * verified adapter and must never be counted as one. It is admissible only
 * because all three of these hold, and each is asserted below:
 *
 *   1. it is added behind an explicit env flag, so it is OFF in production
 *      unless someone turns it on
 *   2. it is a SEPARATE platform name from greenhouse, so no row, screen or
 *      receipt can report a HirePilot URL as an employer's ATS
 *   3. it has no adapter of its own - the page is built to the greenhouse
 *      adapter's selectors, so the shipped adapter is what drives it
 *
 * Point 3 is also its limit: a page shaped to fit the selectors can never
 * catch selector drift on the live boards. That delta is in SUBMISSION_AUDIT.md.
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'apply.js'), 'utf8');

const block = src
  .slice(src.indexOf('const SUPPORTED_ATS'), src.indexOf('function detectAts'))
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

// The unconditional membership: the literal array in the `new Set([...])`.
const declaration = block.slice(0, block.indexOf(']') + 1);
const unconditional = [...declaration.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

// Anything added afterwards, and the condition it is added under.
const conditionalAdds = [...block.matchAll(/SUPPORTED_ATS\.add\('([a-z_]+)'\)/g)].map((m) => m[1]);

describe('SUPPORTED_ATS is a whitelist of verified adapters', () => {
  it('contains only adapters verified against a live form', () => {
    // Update this list ONLY alongside evidence of a verified live submission.
    const VERIFIED = ['greenhouse'];
    expect(unconditional.sort()).toEqual(VERIFIED.sort());
  });

  it('does not enable lever or ashby, which have never been run live', () => {
    expect(unconditional).not.toContain('lever');
    expect(unconditional).not.toContain('ashby');
    expect(conditionalAdds).not.toContain('lever');
    expect(conditionalAdds).not.toContain('ashby');
  });

  it('never enables a platform with no adapter file at all', () => {
    const adapters = fs
      .readdirSync(path.join(__dirname, '..', '..', 'extension', 'content', 'adapters'))
      .map((f) => f.replace(/\.js$/, ''));
    for (const p of unconditional) expect(adapters).toContain(p);
  });
});

describe('the controlled target is the only exception, and it is fenced', () => {
  it('is the ONLY thing ever added outside the verified list', () => {
    expect(conditionalAdds).toEqual(['ats_sandbox']);
  });

  it('is added only behind an explicit env flag, so production is off by default', () => {
    expect(block).toMatch(/process\.env\.ATS_SANDBOX_ENABLED === 'true'\)\s*SUPPORTED_ATS\.add\('ats_sandbox'\)/);
    // Nothing else may turn it on.
    expect(block).not.toMatch(/NODE_ENV[^\n]*add\('ats_sandbox'\)/);
  });

  it('is a different platform from greenhouse, so the two cannot be confused', () => {
    expect(conditionalAdds).not.toContain('greenhouse');
    expect(unconditional).not.toContain('ats_sandbox');
  });

  it('has no adapter of its own - it is driven by the greenhouse adapter', () => {
    /*
     * Asserted rather than assumed. If someone later adds an ats_sandbox
     * adapter, the target stops exercising the shipped Greenhouse code and the
     * proof it produces quietly stops meaning what it says.
     */
    const adapters = fs
      .readdirSync(path.join(__dirname, '..', '..', 'extension', 'content', 'adapters'))
      .map((f) => f.replace(/\.js$/, ''));
    expect(adapters).not.toContain('ats_sandbox');
    expect(adapters).toContain('greenhouse');
  });
});
