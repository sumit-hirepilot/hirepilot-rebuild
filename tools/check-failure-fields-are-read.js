#!/usr/bin/env node
/*
 * D52c — a failure the API reports and the UI never reads.
 *
 * `POST /api/apply/queue` returns `preparationFailed: [{jobId, title, reason}]`.
 * The Jobs page read none of it: a batch of fifteen where three failed to
 * prepare said "Prepared 12 applications" and stopped. Twelve appear under
 * Ready to send and nothing anywhere says which three are missing or why.
 *
 * This is the same shape as the receipt reporting `frozen: false` into a field
 * nobody asserted, one layer out: the server is honest, and the honesty stops
 * at the boundary. D52b covers the test side; this covers the client side.
 *
 * Scope is deliberately narrow. Every response carries fields a client may
 * legitimately ignore - ids, timestamps, pagination. Only fields whose NAME
 * says a failure happened are required to be read, because those are the ones
 * whose absence from the UI turns a partial failure into a reported success.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROUTES = path.join(ROOT, 'backend', 'routes');
const FRONTEND = path.join(ROOT, 'frontend');

/*
 * A key that announces something went wrong - camelCase suffix (preparationFailed)
 * or the bare word (skipped). The first pass only matched the suffix form and
 * checked exactly one key across the whole API, which is not a sweep.
 */
const FAILURE_WORDS = 'failed|failures|skipped|blocked|rejected|refused|unavailable|dropped|notsent|unsupported|withheld';
const FAILURE_KEY = new RegExp(`^(?:.*(?:${FAILURE_WORDS})|(?:${FAILURE_WORDS}))$`, 'i');

/* Keys that name a failure but are the WHOLE response, i.e. already the error
 * path - those are handled by `if (!res.ok)` and need no separate render. */
const IGNORE = new Set(['error', 'errors']);

/*
 * `__tests__` is EXCLUDED, and that exclusion is the difference between this
 * working and not.
 *
 * With tests in the corpus the check passed while the defect was reverted: the
 * test file asserting "the UI must read preparationFailed" itself contains the
 * word, so the field counted as read. A test naming a field is not the UI
 * rendering it - that is the same confusion between a claim and the behaviour
 * the claim describes that D45 exists for.
 */
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'coverage', '__tests__']);

function frontendSources(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) frontendSources(full, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

/*
 * Comments are stripped, and that is not tidiness either.
 *
 * With comments in the corpus the check still passed while the defect was
 * reverted: the comment ABOVE the code, explaining that preparationFailed used
 * to be ignored, contains the word. So the field counted as read because
 * something described it.
 *
 * Between this and the `__tests__` exclusion, the instrument took two rounds of
 * being proved against the real defect before it could see it - which is the
 * whole argument for proving it rather than trusting a green result.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const frontendText = frontendSources(FRONTEND)
  .map((f) => stripComments(fs.readFileSync(f, 'utf8')))
  .join('\n');

const missing = [];
let keysChecked = 0;

for (const name of fs.readdirSync(ROUTES)) {
  if (!name.endsWith('.js')) continue;
  /*
   * Comments stripped HERE too, not just from the frontend corpus.
   *
   * The first version read the raw route source, and the key pattern
   * `word:` matched inside prose - "never silently dropped: a skill the user
   * genuinely has" was reported as a response field named `dropped` that the
   * UI ignores. A guard that invents findings gets switched off, so the same
   * rule applies to both sides of the comparison.
   */
  const src = stripComments(fs.readFileSync(path.join(ROUTES, name), 'utf8'));

  // Keys inside res.json({ ... }) shorthand or explicit, one level deep.
  for (const m of src.matchAll(/res\s*\.\s*(?:status\(\s*2\d\d\s*\)\s*\.\s*)?json\s*\(\s*\{([\s\S]{0,900}?)\}\s*\)/g)) {
    const body = m[1];
    for (const km of body.matchAll(/(?:^|[,{\s])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)) {
      const key = km[1];
      if (IGNORE.has(key)) continue;
      if (!FAILURE_KEY.test(key)) continue;
      keysChecked += 1;

      const read = new RegExp(`\\b${key}\\b`).test(frontendText);
      if (!read) {
        const line = src.slice(0, m.index).split('\n').length;
        missing.push({ file: `backend/routes/${name}`, line, key });
      }
    }
  }
}

const unique = [...new Map(missing.map((x) => [`${x.file}:${x.key}`, x])).values()];

if (unique.length) {
  console.error(`D52c: ${unique.length} failure field(s) the API reports and the UI never reads:\n`);
  for (const f of unique) console.error(`  ${f.file}:${f.line}  ${f.key}`);
  console.error('\nA partial failure the client ignores is reported to the user as a success.');
  console.error('Render it, or stop returning it.\n');
  process.exit(1);
}

console.log(`every reported failure field is read by the UI (${keysChecked} checked)`);
