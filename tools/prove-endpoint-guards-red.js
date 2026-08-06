#!/usr/bin/env node
/*
 * Prove the endpoint guard tests go RED when the guard is unwired.
 *
 * guardsFireOnTheEndpoint.test.js exists because three guards shipped that
 * nothing called. A test that stays green when the call is deleted would be the
 * same defect one level up - it would prove only that the endpoint responds,
 * not that the guard runs. So each case below removes the CALL (not the guard)
 * and requires the suite to fail.
 *
 * Restore is a finally block and the originals are copied before anything is
 * touched, because the last audit that mutated files without that was killed
 * mid-run and left mutations across five files.
 *
 *   node tools/prove-endpoint-guards-red.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND = path.join(__dirname, '..', 'backend');
const SUITE = '__tests__/guardsFireOnTheEndpoint.test.js';

const CASES = [
  {
    guard: 'can() on PUT /profile/preferences',
    file: 'routes/profile.js',
    from: 'if (!(await can(req.user.id, \'autoApply\'))) {',
    to: 'if (false) {',
  },
  {
    guard: 'checkSubmissionAllowed() on POST /queue/:id/start',
    file: 'routes/apply.js',
    from: 'const gate = await checkSubmissionAllowed(req.user.id);',
    to: 'const gate = { allowed: true };',
  },
  {
    guard: 'verifyAdditions() on POST /resume/tailor',
    file: 'routes/resume.js',
    from: 'const allowedSkills = checked.filter((c) => c.ok).map((c) => c.text);',
    to: 'const allowedSkills = checked.map((c) => c.text);',
  },
  {
    guard: 'verifyAdditions() on PUT /resume/:id/document',
    file: 'routes/resume.js',
    from: '      const [checked] = verifyAdditions([{ text: t, kind: n.kind }], corpus);',
    to: '      const [checked] = [{ ok: true, violations: [] }];',
  },
  {
    guard: 'verifyAdditions() on the doc header (meta)',
    file: 'routes/resume.js',
    from: "      const [checked] = verifyAdditions([{ text: value, kind: 'meta' }], corpus);",
    to: '      const [checked] = [{ ok: true, violations: [] }];',
  },
];

const originals = new Map();
for (const c of CASES) {
  const p = path.join(BACKEND, c.file);
  if (!originals.has(p)) originals.set(p, fs.readFileSync(p, 'utf8'));
}
const restore = () => { for (const [p, text] of originals) fs.writeFileSync(p, text); };

function suiteFails() {
  try {
    execFileSync('npx', ['jest', SUITE, '--no-cache', '--forceExit', '--silent'], {
      cwd: BACKEND, stdio: 'pipe',
    });
    return false; // exit 0 - suite passed
  } catch (e) {
    return true;
  }
}

let bad = 0;
try {
  // Green first. A red baseline would make every case below meaningless.
  if (suiteFails()) {
    console.error('BASELINE IS RED - fix the suite before proving anything with it.');
    process.exit(1);
  }
  console.log('baseline green\n');

  for (const c of CASES) {
    const p = path.join(BACKEND, c.file);
    const src = originals.get(p);
    if (!src.includes(c.from)) {
      console.error(`  ?? ${c.guard}: anchor not found in ${c.file} - this case proves nothing`);
      bad++;
      continue;
    }
    fs.writeFileSync(p, src.replace(c.from, c.to));
    const red = suiteFails();
    fs.writeFileSync(p, src);
    console.log(`  ${red ? 'ok  ' : 'FAIL'} ${c.guard} — suite ${red ? 'goes red' : 'STAYS GREEN'} when the call is removed`);
    if (!red) bad++;
  }
} finally {
  restore();
}

// The tree must come back. A prover that leaves mutations behind is the thing
// it is proving against.
for (const [p, text] of originals) {
  if (fs.readFileSync(p, 'utf8') !== text) {
    console.error(`\n${path.relative(BACKEND, p)} did not come back to its original content`);
    process.exit(2);
  }
}
console.log('\ntree clean at exit');

if (bad) {
  console.error(`\n${bad} guard(s) have a test that cannot tell whether they run.`);
  process.exit(1);
}
console.log('every endpoint guard test fails when its guard is unwired');
