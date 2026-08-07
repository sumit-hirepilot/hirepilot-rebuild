#!/usr/bin/env node
/*
 * D52 — a WRITE that fails inside a try/catch, on a path that then answers 2xx.
 *
 * The receipt freeze hid a total failure for the product's entire life. The
 * query read `a.resume_id` and `a.ats` - columns of the table it was inserting
 * INTO - so Postgres threw on every submission ever made. The catch turned that
 * into `{frozen: false, reason: 'receipt could not be written'}`, the endpoint
 * answered 200, and the missing receipts were read as "nobody has submitted".
 *
 * The shape is not "a catch exists". Catches around writes are often correct -
 * a notification that fails must not un-submit an application. The shape is:
 *
 *   a catch swallows a WRITE failure, and NOTHING the caller receives
 *   distinguishes the failure from success.
 *
 * So a catch is reported only when all of these hold:
 *   - the try block contains an INSERT/UPDATE/DELETE
 *   - the catch does not rethrow, and does not send a 4xx/5xx
 *   - no variable the catch assigns is named in the response that follows
 *
 * That last one is what clears the receipt code AFTER the fix: it assigns
 * `receipt`, and `receipt` is in the JSON the caller gets, so a caller can see
 * `frozen: false`. It did not clear it BEFORE, because nothing checked the
 * value - which is the honest lesson: reporting a failure in a field nobody
 * reads is the same as swallowing it.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'backend');
const DIRS = ['routes', 'services'];

const WRITE = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;
const RETHROW = /\bthrow\b/;
const ERROR_STATUS = /res\s*\.\s*status\s*\(\s*[45]\d\d\s*\)/;

/** Find matching close brace for the block starting at `open`. */
function blockEnd(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return src.length;
}

const findings = [];
let scanned = 0;

for (const dir of DIRS) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;

  for (const name of fs.readdirSync(full)) {
    if (!name.endsWith('.js')) continue;
    const file = path.join(full, name);
    const src = fs.readFileSync(file, 'utf8');
    scanned += 1;

    // Every `try {` ... `} catch (e) {` ... `}`
    const tryRe = /\btry\s*\{/g;
    let m;
    while ((m = tryRe.exec(src))) {
      const tryOpen = m.index + m[0].length - 1;
      const tryClose = blockEnd(src, tryOpen);
      const tryBody = src.slice(tryOpen, tryClose);

      const after = src.slice(tryClose, tryClose + 200);
      const catchM = /^\s*\}\s*catch\s*\(([^)]*)\)\s*\{/.exec(after);
      if (!catchM) continue;

      const catchOpen = tryClose + catchM[0].length - 1;
      const catchClose = blockEnd(src, catchOpen);
      const catchBody = src.slice(catchOpen, catchClose);

      if (!WRITE.test(tryBody)) continue;              // not a write path
      if (RETHROW.test(catchBody)) continue;           // surfaces to the caller
      if (ERROR_STATUS.test(catchBody)) continue;      // answers with an error

      /*
       * Does the catch record the failure somewhere the caller can see? Look
       * for an assignment in the catch, then check the same name appears in a
       * res.json()/res.send() within the rest of the enclosing function.
       */
      const assigned = [...catchBody.matchAll(/(\w+)\s*=\s*[^=]/g)].map((a) => a[1]);
      const rest = src.slice(catchClose, catchClose + 3000);
      const responded = /res\s*\.\s*(json|send)\s*\(/.test(rest);
      const surfaced = assigned.some((v) => new RegExp(`\\b${v}\\b`).test(rest.slice(0, 3000)));

      if (responded && !surfaced) {
        const line = src.slice(0, tryClose).split('\n').length;
        findings.push({
          file: `backend/${dir}/${name}`,
          line,
          snippet: catchBody.replace(/\s+/g, ' ').slice(0, 110),
        });
      }
    }
  }
}

/*
 * SECOND PASS — the shape that actually hid D52, which the first pass cannot
 * see and would be dishonest to imply it can.
 *
 * The receipt catch DID surface its failure: it assigned `receipt` and
 * `receipt` was in the JSON. So by the rule above it was clean, and it hid a
 * total failure for the product's whole life anyway. What was missing was
 * anyone reading the field: no test asserted the failure branch, so nothing
 * distinguished "never written" from "written every time".
 *
 * Reporting a failure in a field nobody reads is the same as swallowing it.
 *
 * So: a soft-failure flag returned on a 2xx must be named in a test. That is
 * checkable, and it is the thing that was missing.
 */
const SOFT_FLAG = /\b(frozen|ok|success|verified|saved|stored|written|applied)\s*:\s*false\b/g;

const testDir = path.join(ROOT, '__tests__');
const testCorpus = fs.existsSync(testDir)
  ? fs.readdirSync(testDir).map((f) => fs.readFileSync(path.join(testDir, f), 'utf8')).join('\n')
  : '';

const unread = [];
for (const dir of DIRS) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  for (const name of fs.readdirSync(full)) {
    if (!name.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(full, name), 'utf8');
    let m;
    SOFT_FLAG.lastIndex = 0;
    while ((m = SOFT_FLAG.exec(src))) {
      const flag = m[1];
      // Is this flag asserted anywhere in the tests?
      const asserted = new RegExp(`${flag}\\s*[:)]|['"\`]${flag}['"\`]`).test(testCorpus);
      if (!asserted) {
        unread.push({
          file: `backend/${dir}/${name}`,
          line: src.slice(0, m.index).split('\n').length,
          flag,
        });
      }
    }
  }
}

let failed = false;

if (findings.length) {
  console.error(`D52a: ${findings.length} write failure(s) swallowed with nothing in the response:\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    ${f.snippet}\n`);
  }
  console.error('Either surface the failure in the response, or answer with an error status.\n');
  failed = true;
}

if (unread.length) {
  console.error(`D52b: ${unread.length} soft-failure flag(s) returned on success that no test reads:\n`);
  for (const f of unread) console.error(`  ${f.file}:${f.line}  ${f.flag}: false`);
  console.error('\nThis is the shape that hid the missing receipt. A flag nobody asserts');
  console.error('cannot tell "never once succeeded" from "always succeeds".\n');
  failed = true;
}

if (failed) process.exit(1);

console.log(`no write failure swallowed, and every soft-failure flag is asserted (${scanned} files)`);
