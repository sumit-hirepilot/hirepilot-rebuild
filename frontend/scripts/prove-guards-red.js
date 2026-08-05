#!/usr/bin/env node
/*
 * A3-b — prove every guard red on a violating input.
 *
 * "The tests pass" is not evidence a guard works; it is evidence the code is
 * currently clean OR that the guard cannot detect anything. Those look
 * identical from the outside, and this project has hit the second case three
 * separate ways: an assertion satisfied by an unrelated earlier match, a runner
 * exiting with zero executed tests, and an assertion reading the wrong argument.
 *
 * The source-scan guards are the ones most at risk, because they share the
 * exact regex mechanism that produced the H4 false positive. They also defend
 * the no-fabricated-numbers claim, so a false green there is the expensive kind.
 *
 * This mutates one file, runs one named test, and requires it to FAIL. Every
 * mutation is reverted in a finally block, including on crash or Ctrl-C.
 *
 *   node scripts/prove-guards-red.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');

/** file, a mutation applied to its text, and the test name that must catch it. */
const CASES = [
  // ---- landingHonesty (9) — the no-invented-figures claim ----
  { suite: 'landingHonesty', test: 'renders no "Illustrative example" label',
    file: 'pages/index.js', mutate: (s) => s + '\nconst __v = <p>Illustrative example</p>;\n' },
  { suite: 'landingHonesty', test: 'renders no hardcoded count with a + or k suffix',
    file: 'pages/index.js', mutate: (s) => s + "\nconst __v = '180+';\n" },
  { suite: 'landingHonesty', test: 'renders no hardcoded percentage as a display string',
    file: 'pages/index.js', mutate: (s) => s + "\nconst __v = '87%';\n" },
  { suite: 'landingHonesty', test: 'declares no example/mock/sample/fake data constant',
    file: 'pages/index.js', mutate: (s) => s + '\nconst MATCH_EXAMPLE = { score: 1 };\n' },
  { suite: 'landingHonesty', test: 'shows scoring weights that sum to 100 and match the engine',
    file: 'pages/index.js', mutate: (s) => s.replace(/weight:\s*40/, 'weight: 41') },
  { suite: 'landingHonesty', test: 'computes the copyright year rather than hardcoding it',
    file: 'components/Layout.js', mutate: (s) => s.replace(/\{new Date\(\)\.getFullYear\(\)\}/, '2026') },
  { suite: 'landingHonesty', test: 'has OG and Twitter card tags',
    file: 'pages/index.js', mutate: (s) => s.replace(/og:image/g, 'og:imagex') },
  { suite: 'landingHonesty', test: 'does not lead the homepage with what the product lacks',
    file: 'pages/index.js', mutate: (s) => s + '\nconst __v = <h2>NO FAKE AUTO-SUBMIT</h2>;\n' },
  { suite: 'landingHonesty', test: 'does not claim it cannot submit, which is no longer true',
    file: 'pages/index.js', mutate: (s) => s + '\nconst __v = <p>HirePilot does not currently submit applications.</p>;\n' },

  // ---- noFabricatedZero (3 detecting + 1 self-check) ----
  { suite: 'noFabricatedZero', test: 'initialises no count-like state to 0',
    file: 'pages/tracker.js', mutate: (s) => s + '\nconst __v = () => { const [fooCount, setFooCount] = useState(0); return fooCount; };\n' },
  { suite: 'noFabricatedZero', test: 'never coerces an absent count from a response into 0',
    file: 'pages/tracker.js', mutate: (s) => s + '\nconst __v = (data) => { setFooCount(data.total || 0); };\n' },
  { suite: 'noFabricatedZero', test: 'writes a literal 0 to a count only where the zero is measured',
    file: 'pages/tracker.js', mutate: (s) => s + '\nconst __v = () => { setFooCount(0); };\n' },

  // ---- the A3 guards ----
  { suite: 'cssClassResolution', test: 'resolves every styles.x reference in the sheet that file imports',
    file: 'pages/tracker.js', mutate: (s) => s + '\nconst __v = styles.__definitelyNotAClass;\n' },
  { suite: 'dynamicClassBinding', test: 'defines a class for every state the code can produce',
    file: 'pages/auto-apply.js', mutate: (s) => s.replace("state: 'partial'", "state: 'bogus'") },
  { suite: 'dynamicClassBinding', test: 'defines a class for every pipeline status',
    file: 'styles/ApplyQueue.module.css', mutate: (s) => s.replace('.s_submitting', '.s_submittingX') },
  { suite: 'adapterStatus', test: 'shows a full-status dot only for adapters the server will run',
    file: 'pages/auto-apply.js', mutate: (s) => s.replace("atsKey: 'lever', state: 'none'", "atsKey: 'lever', state: 'full'") },
  { suite: 'hydration', test: 'renders identical markup signed-out and signed-in',
    file: 'components/Layout.js', mutate: (s) => s.replace('const isAuthenticated = mounted && hasToken;',
      "const isAuthenticated = typeof window !== 'undefined' && !!localStorage.getItem('token');") },
  { suite: 'localVerification', test: 'attaches a React root that renders real content',
    file: 'pages/applications.js', mutate: (s) => s.replace('export default function Applications() {',
      'export default function Applications() {\n  if (true) return null;') },
];

/*
 * `jest -t` takes a REGEX, not a literal. A test named "...with a + or k
 * suffix" contains `+`, which became a quantifier, matched nothing, ran ZERO
 * tests and exited 0 - which this script first read as GREEN. The instrument
 * had the exact defect it exists to find. Escape the name.
 */
function escapeForJestT(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runTest(suite, test) {
  const args = ['jest', `__tests__/${suite}.test.js`, '-t', escapeForJestT(test)];
  let out;
  let failed = false;
  try {
    out = String(execFileSync('npx', args, { cwd: ROOT, stdio: 'pipe' }));
  } catch (err) {
    failed = true;
    out = String(err.stdout || '') + String(err.stderr || '');
  }

  // Checked on BOTH paths. A run that executed nothing is a null result, and
  // on the success path it would otherwise be counted as the guard passing.
  if (/Test suite failed to run/.test(out)) return 'DID_NOT_RUN';
  const executed = out.match(/Tests:.*?(\d+) total/);
  if (!executed || Number(executed[1]) === 0) return 'DID_NOT_RUN';
  if (/matched\s+0\s+test/i.test(out)) return 'DID_NOT_RUN';
  const ran = out.match(/Tests:[^\n]*/);
  if (ran && /(\d+) skipped/.test(ran[0]) && !/failed|passed/.test(ran[0])) return 'DID_NOT_RUN';

  return failed ? 'RED' : 'GREEN';
}

const results = [];
for (const c of CASES) {
  const abs = path.join(ROOT, c.file);
  const original = fs.readFileSync(abs, 'utf8');
  let verdict;
  try {
    const mutated = c.mutate(original);
    if (mutated === original) {
      verdict = 'MUTATION_NO_OP'; // the anchor moved; the case proves nothing
    } else {
      fs.writeFileSync(abs, mutated);
      verdict = runTest(c.suite, c.test);
    }
  } finally {
    fs.writeFileSync(abs, original);
  }
  results.push({ ...c, verdict });
  process.stdout.write(`${verdict === 'RED' ? '  ok  ' : 'FAIL  '}${c.suite} :: ${c.test}\n`);
  if (verdict !== 'RED') process.stdout.write(`        -> ${verdict}\n`);
}

const bad = results.filter((r) => r.verdict !== 'RED');
process.stdout.write(`\n${results.length - bad.length}/${results.length} guards proven red on a violating input\n`);
if (bad.length) {
  process.stdout.write('\nNOT PROVEN — these guards did not detect their own violation:\n');
  for (const b of bad) process.stdout.write(`  ${b.suite} :: ${b.test}  (${b.verdict})\n`);
  process.exit(1);
}
