#!/usr/bin/env node
/*
 * A test may not assert that a CLAIM exists. It must assert the system does
 * what the claim says.
 *
 * landingTruth asserted the pricing page contains the words "never per
 * application". Green throughout - and defending a sentence
 * services/submissionGate.js contradicts, because it refuses to submit at
 * `remaining <= 0`. Fixing the lie would have read as breaking the suite.
 * Coverage pointing the wrong way is worse than no coverage: it converts a
 * correction into a regression.
 *
 * The same file asserted the pricing page says "cancel" and "one click". It
 * did say so - "Settings -> Plans -> Cancel" - and there was no Cancel control
 * and no cancel path in the backend. The test defended an instruction to press
 * a button nobody had built.
 *
 * WHAT THIS FINDS: an assertion whose subject is page copy and whose expected
 * value is a sentence rather than an identifier. That is the shape of a claim
 * test. It cannot tell a well-grounded one from a hollow one - only that the
 * assertion is ABOUT prose, which is when a human has to check that something
 * else in the same block pins the behaviour.
 *
 * KNOWN LIMITS, stated so this cannot pass for more than it is:
 *   - Heuristic, not semantic. A claim test that also happens to mention a
 *     backend path is treated as grounded; it may not be.
 *   - Only files that read page or component SOURCE are scanned. A test that
 *     renders a component and asserts on visible text is a different shape and
 *     is not covered here.
 *   - REVIEWED holds the blocks a human has already judged. It is a record of
 *     review, not an exemption from the rule - each entry says why.
 *
 *   node tools/check-claim-tests.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = [
  path.join(ROOT, 'frontend', '__tests__'),
  path.join(ROOT, 'backend', '__tests__'),
];

/*
 * Blocks a human has read and judged. The reason is the point: a bare
 * allowlist is how a rule quietly stops applying.
 */
const REVIEWED = new Map([
  ['landingTruth.test.js::states the application allowance it actually enforces, and never charges for a score',
    'asserts the denial is ABSENT and that matches.js has no tier branch; check-plan-names.js checks the same claim against the gate'],
  ['landingTruth.test.js::has the cancel control it tells people to click',
    'asserts the control, the handler and the endpoint; proved red by removing the control'],
  ['landingTruth.test.js::does not promise end-of-period cancellation while nothing can be charged',
    'billing is not connected; asserts the copy admits it rather than describing a period that does not exist'],
  ['landingTruth.test.js::prices in rupees first, because the user is in India',
    'currency toggle is structural - the symbols are the feature, not a claim about behaviour'],
  ['landingTruth.test.js::offers Free, Pilot and Copilot',
    'cross-checked against backend TIERS by check-plan-names.js'],
  ['landingTruth.test.js::does not imply a charge occurred at a checkout that cannot charge',
    'asserts the ABSENCE of a fabricated receipt - the safe direction; a false negative here cannot invent a charge'],
  ['landingHonesty.test.js::does not lead the homepage with what the product lacks',
    'absence-only assertion about page structure, no behavioural claim pinned'],
  ['landingHonesty.test.js::does not claim it cannot submit, which is no longer true',
    'absence-only; submission capability is proved by appliedRequiresSubmission and submissionReceipt'],

  /*
   * These three RENDER the component against a mocked failure and assert what
   * it shows. That is behaviour - the state is driven, not described - and the
   * prose is the observable output, which is the thing under test. A grep of
   * page source could not tell them apart from a copy assertion, so they are
   * recorded here rather than the heuristic being loosened to admit them.
   */
  ['applicationsScreen.test.js::states a server error and does not claim the account is empty',
    'renders against a mocked 500 and asserts the rendered output - state is driven, not described'],
  ['applicationsScreen.test.js::states an expired session distinctly from a server fault',
    'renders against a mocked 401 and asserts the rendered output'],
  ['applicationsScreen.test.js::states a network failure and offers a retry',
    'renders against a rejected fetch and asserts the rendered output'],

  ['landingTruth.test.js::declares a mobile viewport for every page, not only the one that claims it',
    'grounded on pages/_app.js carrying the viewport meta product-wide; the heuristic only looks for backend paths, and this behaviour lives in the frontend'],
]);

const NAME_RE = /\b(?:it|test)\s*\(\s*(['"`])([\s\S]*?)\1/g;

/** A regex/string literal that is a SENTENCE, not an identifier or a path. */
function isProse(expected) {
  const body = expected.replace(/^[/'"`]|[/'"`][gimsuy]*$/g, '');
  if (body.length < 12) return false;
  if (/^[\w$.[\]'"-]+$/.test(body)) return false;          // identifier-ish
  if (/\bapi\/|require\(|\.js\b|=>|function\b/.test(body)) return false;
  const words = body.split(/[\s|]+/).filter((w) => /^[A-Za-z][A-Za-z']{2,}$/.test(w));
  return words.length >= 3;
}

const findings = [];

for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.test.js'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    // Only files that read page/component source can be asserting on copy.
    if (!/read\(\s*['"`](?:pages|components)|pages[/\\]|components[/\\]/.test(src)) continue;

    // Split into it() blocks so a finding can name the test.
    const blocks = [];
    let m;
    NAME_RE.lastIndex = 0;
    while ((m = NAME_RE.exec(src))) blocks.push({ name: m[2], from: m.index });
    for (let i = 0; i < blocks.length; i += 1) {
      blocks[i].body = src.slice(blocks[i].from, blocks[i + 1] ? blocks[i + 1].from : src.length);
    }

    for (const b of blocks) {
      const body = b.body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
      // Positive assertions only: `not.toMatch` asserts an absence, which
      // cannot pin a false claim in place - it can only fail to catch one.
      const asserts = [...body.matchAll(/(?<!not\.)\btoMatch\s*\(\s*([^\n]*?)\s*\)\s*;/g)]
        .map((x) => x[1])
        .filter(isProse);
      if (!asserts.length) continue;

      /*
       * Grounded means the block reaches BEHAVIOUR - a backend file, a route,
       * a service.
       *
       * The first cut of this also counted `\w+\(\s*['"`]` as grounding, "the
       * block calls something with a string". That matched `read('pages', ...)`
       * - the very call that fetches the copy - so every claim test grounded
       * itself and the checker reported green on the two defects it was
       * written from. Proving it on a known positive is the only reason that
       * was caught, and it is the same way the guard-wiring census went wrong
       * twice.
       */
      /*
       * `api\/` as well as `api/`: inside a regex literal the slash is
       * escaped, so `toMatch(/api\/jobs\/facets/)` - a block reaching a real
       * endpoint - read as ungrounded until this allowed for it.
       */
      const grounded = /backend|routes[/\\]|services[/\\]|\bapi\\?\//.test(body);
      const key = `${file}::${b.name}`;
      if (REVIEWED.has(key)) continue;
      if (!grounded) findings.push({ key, sample: asserts[0].slice(0, 72) });
    }
  }
}

if (findings.length) {
  console.error('TEST ASSERTS A CLAIM, NOT THE BEHAVIOUR BEHIND IT:\n');
  for (const f of findings) console.error(`  ${f.key}\n    asserts prose: ${f.sample}\n`);
  console.error('Assert that the system does what the copy says. If the assertion is already');
  console.error('grounded elsewhere, add it to REVIEWED with the reason.');
  process.exit(1);
}

console.log(`no ungrounded claim tests (${REVIEWED.size} reviewed and recorded)`);
