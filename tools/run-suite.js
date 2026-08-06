#!/usr/bin/env node
/*
 * A3-c — exit 0 is not evidence of work.
 *
 * `npx jest --ci` returning 0 means "nothing failed", which is also what it
 * returns when it ran NOTHING: a testMatch that stops matching, a
 * testPathIgnorePatterns edit, a moved directory. This project has already been
 * burned by exactly that - a runner exiting quietly with no executed tests, read
 * as a pass, twice.
 *
 * So assert the positive: a floor on how many tests must actually execute.
 * The floor is committed, so silently deleting tests fails CI too.
 *
 *   node tools/run-suite.js <dir> <minTests>
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [dir, minRaw] = process.argv.slice(2);
if (!dir || !minRaw) {
  console.error('usage: run-suite.js <dir> <minTests>');
  process.exit(2);
}
const min = Number(minRaw);
const cwd = path.resolve(__dirname, '..', dir);

/*
 * A real temp file, not --outputFile=/dev/stdout. That worked locally and
 * failed on the CI runner, where the JSON never arrived intact - the exact
 * shape of "green here, red there" this script exists to remove.
 */
const summaryFile = path.join(os.tmpdir(), `jest-summary-${process.pid}-${dir.replace(/\W/g, '')}.json`);
let failed = false;
try {
  execFileSync('npx', ['jest', '--ci', '--json', `--outputFile=${summaryFile}`], {
    cwd, stdio: 'inherit', maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  failed = true;
}

let raw = '';
try { raw = fs.readFileSync(summaryFile, 'utf8'); } catch (e) { raw = ''; }
try { fs.unlinkSync(summaryFile); } catch (e) { /* best effort */ }

const m = raw.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
if (!m) {
  console.error(`${dir}: could not read a JSON summary from jest - refusing to call this a pass`);
  process.exit(1);
}

let r;
try { r = JSON.parse(m[0]); } catch (e) {
  console.error(`${dir}: jest summary was not parseable JSON - refusing to call this a pass`);
  process.exit(1);
}

const { numTotalTests = 0, numPassedTests = 0, numFailedTests = 0 } = r;
console.log(`${dir}: ${numPassedTests} passed, ${numFailedTests} failed, ${numTotalTests} executed (floor ${min})`);

if (numFailedTests > 0 || failed) {
  /*
   * NAME the failures. "FAILURES" alone sent me chasing two red runs this
   * session that I could not reproduce afterwards, with no record of which
   * tests they were - and an unreproducible failure with no name is not a
   * lead, it is a rumour. The JSON summary already has this; it was simply
   * never read.
   */
  console.error(`${dir}: FAILURES`);
  for (const suite of r.testResults || []) {
    for (const t of suite.assertionResults || []) {
      if (t.status !== 'failed') continue;
      console.error(`  ${suite.name ? suite.name.split('/').pop() : '?'} :: ${t.fullName || t.title}`);
      const first = (t.failureMessages || [])[0];
      if (first) console.error(`    ${first.split('\n')[0].slice(0, 160)}`);
    }
  }
  process.exit(1);
}
if (numTotalTests < min) {
  console.error(
    `${dir}: only ${numTotalTests} tests executed, floor is ${min}. `
    + 'Either tests were deleted or the runner stopped finding them. '
    + 'Exit 0 with nothing run is the failure this floor exists to catch.'
  );
  process.exit(1);
}
