#!/usr/bin/env node
/*
 * CI gate — no mutation marker or audit artifact may reach a commit.
 *
 * The guard audit mutates real source files. Three mutations have escaped it:
 * `if (false)` disabling a tier check (twice), and a fabricated
 * `MATCH_EXAMPLE = { score: 1 }` constant that reached a commit in the file
 * whose own guard bans invented figures.
 *
 * Journalling, self-heal and the dirty-tree check all run on the developer's
 * machine and all of them can be skipped by a hard kill at the wrong moment.
 * This runs in CI, where nothing can skip it.
 *
 *   node tools/check-no-mutation-artifacts.js
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SEARCH = ['backend/routes', 'backend/services', 'frontend/pages', 'frontend/components', 'frontend/lib'];

/*
 * Shapes the audit's mutate() functions produce. Each is either meaningless in
 * real code or a known mutation, so a hit is a mutation and not a style
 * preference.
 */
const MARKERS = [
  { re: /\bif \(false\) \{/, why: 'a disabled branch - the audit uses this to switch a guard off' },
  { re: /\bMATCH_EXAMPLE\b/, why: 'a fabricated example constant planted by the landing-page mutation' },
  { re: /\bif \(true\) return null;/, why: 'a short-circuited render' },
  { re: /const trimToken = \(t\) => String\(t \|\| ''\);\s*$/m, why: 'trimToken reduced to a no-op' },
  /*
   * A ternary whose condition is the literal true/false, pinning one branch.
   * This is how the dashboard lost its plan check: `!autoApplyIncluded ?`
   * became `false ?`, so the honest copy could never render. Anchored on the
   * opening `{` or `(` so the real `=== false ?` comparisons do not match.
   */
  { re: /[{(]\s*(?:true|false)\s*\n?\s*\?/, why: 'a ternary pinned to one branch by a literal condition' },
];

const ARTIFACTS = ['.guard-mutation-journal.json'];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

const problems = [];

for (const a of ARTIFACTS) {
  if (fs.existsSync(path.join(REPO, a))) {
    problems.push(`${a} — an audit artifact was committed; the run that wrote it did not finish cleanly`);
  }
}

for (const root of SEARCH) {
  for (const file of walk(path.join(REPO, root))) {
    const src = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')   // a comment may legitimately describe a marker
      .replace(/^\s*\/\/.*$/gm, ' ');
    for (const m of MARKERS) {
      if (m.re.test(src)) problems.push(`${path.relative(REPO, file)} — ${m.why}`);
    }
  }
}

if (problems.length) {
  process.stdout.write('MUTATION ARTIFACT REACHED A COMMIT:\n');
  for (const p of problems) process.stdout.write(`  ${p}\n`);
  process.stdout.write('\nA guard script that can corrupt what it guards is worse than no guard.\n');
  process.exit(1);
}

process.stdout.write('no mutation markers or audit artifacts present\n');
