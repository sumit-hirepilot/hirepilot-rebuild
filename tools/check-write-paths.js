#!/usr/bin/env node
/*
 * Every write against the constraints the running database actually enforces.
 *
 * A7.18 found POST /api/applications/:id/approve writing status='applied' with
 * no evidence columns. applications_applied_requires_submission refuses exactly
 * that row, so the UPDATE could only ever raise and the button could only ever
 * 500 - while the copy beside it promised the one thing it could not do. Nobody
 * hit it because sweeps run on an allowlist of controls and that one was never
 * clicked.
 *
 * A write path that cannot satisfy a live constraint is not a latent bug. It is
 * a guaranteed 500 hiding behind an unclicked control, and no amount of testing
 * the response shape finds it, because the response is never reached.
 *
 * The two constraints, read back from production and pinned here:
 *
 *   applications_applied_at_requires_submitted
 *     CHECK (applied_at IS NULL OR status = 'submitted')
 *
 *   applications_applied_requires_submission
 *     CHECK (status <> 'applied' OR COALESCE(is_manual,FALSE) = TRUE
 *            OR submitted_at IS NOT NULL OR confirmation_captured_at IS NOT NULL
 *            OR employer_confirmation_id IS NOT NULL OR verified_at IS NOT NULL)
 *
 * They are pinned rather than fetched because this runs in CI with no database.
 * schemaClaims.js + db-health are what prove the pinned copy still matches the
 * real one; this proves the code can live with it.
 *
 *   node tools/check-write-paths.js
 */
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', 'backend');
const DIRS = ['routes', 'services'];

const EVIDENCE = [
  'submitted_at', 'confirmation_captured_at', 'employer_confirmation_id', 'verified_at', 'is_manual',
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(BACKEND, d)));
const problems = [];

for (const file of files) {
  const rel = path.relative(BACKEND, file);
  const src = fs.readFileSync(file, 'utf8')
    // Strip comments first: this file and several routes DISCUSS the defect,
    // and a checker that reads its own explanation as a violation is noise.
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  // Every backtick/quoted SQL statement that writes to applications.
  for (const m of src.matchAll(/`([^`]*?(?:UPDATE\s+applications|INSERT\s+INTO\s+applications)[\s\S]*?)`/gi)) {
    const sql = m[1].replace(/\s+/g, ' ').trim();
    const line = src.slice(0, m.index).split('\n').length;

    const isUpdate = /UPDATE\s+applications/i.test(sql);
    const setsAppliedStatus = /SET[\s\S]*?status\s*=\s*'applied'/i.test(sql)
      || (/INSERT\s+INTO\s+applications/i.test(sql) && /VALUES[\s\S]*'applied'/i.test(sql));
    const setsAppliedAt = /\bapplied_at\s*=/i.test(sql)
      || (/INSERT\s+INTO\s+applications\s*\([^)]*\bapplied_at\b/i.test(sql));
    const setsSubmittedStatus = /status\s*=\s*'submitted'/i.test(sql)
      || (/INSERT\s+INTO\s+applications/i.test(sql) && /VALUES[\s\S]*'submitted'/i.test(sql));
    const carriesEvidence = EVIDENCE.some((c) => new RegExp(`\\b${c}\\b`, 'i').test(sql));

    /*
     * An UPDATE that only NARROWS to already-applied rows (WHERE status =
     * 'applied') is not asserting the status, it is filtering on it.
     */
    const onlyFiltersOnApplied = isUpdate
      && /WHERE[\s\S]*status\s*=\s*'applied'/i.test(sql)
      && !/SET[\s\S]*?status\s*=\s*'applied'/i.test(sql);

    if (setsAppliedStatus && !carriesEvidence && !onlyFiltersOnApplied) {
      problems.push({
        rel, line, sql: sql.slice(0, 150),
        why: "writes status='applied' with no submission evidence - applications_applied_requires_submission refuses this row, so the statement always raises",
      });
    }

    if (setsAppliedAt && !setsSubmittedStatus && !/applied_at\s*=\s*NULL/i.test(sql)) {
      problems.push({
        rel, line, sql: sql.slice(0, 150),
        why: "sets applied_at without status='submitted' - applications_applied_at_requires_submitted refuses this row",
      });
    }
  }
}

if (problems.length) {
  console.error('WRITE PATH CANNOT SATISFY A LIVE CONSTRAINT:\n');
  for (const p of problems) {
    console.error(`  ${p.rel}:${p.line}`);
    console.error(`    ${p.why}`);
    console.error(`    ${p.sql}\n`);
  }
  console.error('This is not a latent bug. It is a guaranteed 500 behind whichever control calls it.');
  process.exit(1);
}

console.log('every write against applications can satisfy the live constraints');
