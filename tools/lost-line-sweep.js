#!/usr/bin/env node
/*
 * Lines that disappeared without an intentional commit.
 *
 * dashboard.js lost its committed setLoadError line to an audit mutation and
 * nothing noticed - the mutation deleted it, the tree was committed, and the
 * error banner silently stopped existing. A separate mutation reached
 * frontend/pages/index.js in c75ba6f and was removed a commit later as "a
 * mutation the killed audit left behind". So this has happened at least twice,
 * and both times the loss was invisible.
 *
 * This sweeps the whole history for removals of PROTECTIVE lines - the ones
 * whose absence is silent by nature: error banners, guard calls, refusals,
 * fail-closed returns - and reports the ones that are still missing from HEAD.
 * A line removed and later restored is not interesting. A line removed and
 * never seen again, in a commit that says nothing about removing it, is.
 *
 *   node tools/lost-line-sweep.js
 */
const { execFileSync } = require('child_process');
const path = require('path');

const REPO = path.join(__dirname, '..');
const git = (args) => execFileSync('git', args, { cwd: REPO, maxBuffer: 1024 * 1024 * 256 }).toString();

/*
 * Things whose disappearance produces no error, no failing test and no visible
 * change until someone hits the exact path. That is the whole risk profile.
 */
const PROTECTIVE = [
  /\bset\w*Error\(/,
  /role="alert"/,
  /verifyAdditions\(/,
  /\bcheckSubmissionAllowed\(/,
  /\bsubmissionsHalted\(/,
  /\bcan\(\s*(req\.user\.id|user\.id)/,
  /res\.status\(4\d\d\)/,
  /return\s*\{\s*allowed:\s*false/,
  /\bcatch\s*\(/,
];

const IGNORE_PATH = /^(tools\/|.*__tests__\/|.*\.test\.js$|.*\.md$|frontend\/scripts\/)/;

const commits = git(['log', '--format=%H\t%s', '--reverse']).trim().split('\n')
  .map((l) => { const [hash, ...rest] = l.split('\t'); return { hash, subject: rest.join('\t') }; });

const head = new Map();
for (const f of git(['ls-files']).trim().split('\n')) {
  if (IGNORE_PATH.test(f)) continue;
  try { head.set(f, git(['show', `HEAD:${f}`])); } catch (e) { /* binary or gone */ }
}

const findings = [];

for (const c of commits) {
  let diff;
  try {
    diff = git(['show', c.hash, '--unified=0', '--format=', '--no-color']);
  } catch (e) { continue; }

  let file = null;
  for (const line of diff.split('\n')) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m) { file = m[1]; continue; }
    if (!file || IGNORE_PATH.test(file) || !head.has(file)) continue;
    if (!line.startsWith('-') || line.startsWith('---')) continue;

    const removed = line.slice(1).trim();
    if (removed.length < 12) continue;
    if (!PROTECTIVE.some((re) => re.test(removed))) continue;

    // Still in the file today? Then it came back, or never really left.
    if (head.get(file).includes(removed)) continue;

    findings.push({ commit: c.hash.slice(0, 7), subject: c.subject, file, removed });
  }
}

/*
 * A removal the commit message OWNS is a decision, not a loss. Matched loosely
 * on purpose - the question is whether a reader of the log would have known.
 */
const OWNED = /remov|delet|drop|retir|replac|rewrit|rebuild|refactor|consolidat|unif|revert|clean|simplif|merge|rename|move/i;

const unexplained = findings.filter((f) => !OWNED.test(f.subject));

console.log(`protective lines removed and still absent from HEAD: ${findings.length}`);
console.log(`  of those, in commits whose message does not mention a removal: ${unexplained.length}\n`);

const byCommit = new Map();
for (const f of unexplained) {
  if (!byCommit.has(f.commit)) byCommit.set(f.commit, { subject: f.subject, lines: [] });
  byCommit.get(f.commit).lines.push(f);
}

for (const [commit, { subject, lines }] of byCommit) {
  console.log(`${commit}  ${subject}`);
  for (const l of lines) console.log(`    ${l.file}\n      - ${l.removed.slice(0, 120)}`);
  console.log();
}

if (!unexplained.length) console.log('nothing unexplained');
