#!/usr/bin/env node
/*
 * The landing page quotes real identifiers out of the backend. They have to
 * still be there.
 *
 * The page's whole device is "no black box": it prints the actual rule name
 * and status key beside plain English, so a reader can check the claim against
 * the code. That only works while the quote is true. It stopped being true -
 * the page listed a `no_deletion` guard rule under a heading that read "these
 * three checks", when resumeGuard had two rules and no `no_deletion`. It had
 * been removed as unreachable and the page went on advertising it.
 *
 * Nothing caught that. Both suites were green; the page renders a hardcoded
 * array, so no code path connects it to the file it claims to quote. It was
 * found by reading the live page during a feature audit.
 *
 * This is the class fix. The instance was one stale rule; the class is a
 * marketing surface that copies backend constants and drifts from them
 * silently. Now the copy is checked.
 *
 *   node tools/check-landing-claims.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LANDING = path.join(ROOT, 'frontend', 'pages', 'index.js');
const GUARD = path.join(ROOT, 'backend', 'services', 'resumeGuard.js');
const APPLY = path.join(ROOT, 'backend', 'routes', 'apply.js');

const read = (p) => fs.readFileSync(p, 'utf8');

/** Strip comments: a rule named only in a comment is not a rule that runs. */
const live = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

/** The `[...]` body of `const NAME = [ ... ];`, so sibling arrays don't bleed in. */
function arrayBody(src, name) {
  const start = src.indexOf(`const ${name} = [`);
  if (start === -1) return null;
  const from = src.indexOf('[', start);
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === '[') depth += 1;
    else if (src[i] === ']') {
      depth -= 1;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return null;
}

const quoted = (body, key) => (body
  ? [...body.matchAll(new RegExp(`${key}:\\s*'([^']+)'`, 'g'))].map((m) => m[1])
  : []);

const landing = read(LANDING);
const problems = [];

/* ---- guard rules: the page's list must equal resumeGuard's, both ways ---- */
const claimed = quoted(arrayBody(landing, 'GUARD_RULES'), 'rule');
const actual = quoted(live(read(GUARD)), 'rule');

if (!claimed.length) problems.push('GUARD_RULES not found on the landing page - has it been renamed?');
if (!actual.length) problems.push('no `rule:` identifiers found in services/resumeGuard.js');

for (const r of claimed) {
  if (!actual.includes(r)) {
    problems.push(`landing page advertises guard rule '${r}', which resumeGuard.js does not have`);
  }
}
/*
 * The reverse direction too. A rule the page omits is a real check going
 * unclaimed - less harmful than a false claim, but the same drift, and the
 * heading counts this list.
 */
for (const r of actual) {
  if (!claimed.includes(r)) {
    problems.push(`resumeGuard.js enforces '${r}', which the landing page does not list`);
  }
}

/* ---- the count in the heading must be derived, not typed ---- */
if (/passes these (one|two|three|four|five|six|\d+) checks/.test(landing)) {
  problems.push('the guard-rule count is hardcoded in the heading - derive it from GUARD_RULES.length');
}

/* ---- status keys must be states the apply route actually writes ---- */
const applySrc = live(read(APPLY));
for (const s of quoted(arrayBody(landing, 'TRACK_STATES'), 'state')) {
  if (!new RegExp(`'${s}'`).test(applySrc)) {
    problems.push(`landing page shows status '${s}', which routes/apply.js never writes`);
  }
}

if (problems.length) {
  console.error('LANDING PAGE CLAIMS SOMETHING THE CODE DOES NOT DO:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nThe page prints real identifiers so readers can check them. Keep them true.');
  process.exit(1);
}

console.log(`landing page claims verified: ${claimed.length} guard rules, all live`);
