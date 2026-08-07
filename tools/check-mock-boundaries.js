#!/usr/bin/env node
/*
 * A mock of the thing under test is not a test of it.
 *
 * Feature 4a's SSRF suite did this:
 *
 *   jest.mock('../services/jobUrlFetch', () => {
 *     const actual = jest.requireActual('../services/jobUrlFetch');
 *     return { ...actual, fetchJobUrl: jest.fn() };      // <- no default
 *   });
 *
 * Every "refuses cloud metadata / loopback / private range" case then asserted
 * a refusal produced by a mock returning `undefined`. The refusals they exist
 * to prove live INSIDE fetchJobUrl. They were green, and they would have
 * stayed green with the SSRF guard deleted.
 *
 * WHAT THIS FINDS, and it is deliberately one narrow shape:
 *
 *   a factory that spreads `requireActual` - which says "I need the real
 *   module, with one seam" - and then replaces a function with a bare
 *   `jest.fn()` that is never defaulted back to the real implementation.
 *
 * That combination is always the defect. Spreading the actual module means the
 * author wanted real behaviour; leaving the seam undefaulted means no test in
 * the file gets any.
 *
 * KNOWN LIMITS, stated so this cannot pass for more than it is:
 *   - It does NOT judge whether mocking a given module is appropriate. Mocking
 *     `../db` is correct: the database is what the code TALKS TO. Mocking
 *     `../services/matchingEngine` to assert a route called it is correct too.
 *     Only a human can tell a collaborator from the subject, and the sweep for
 *     this rule was done by reading all 25 suites that mock a module they also
 *     use.
 *   - A whole-module mock with no requireActual is not flagged, because that
 *     is the ordinary and usually correct collaborator pattern.
 *
 *   node tools/check-mock-boundaries.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = [
  path.join(ROOT, 'backend', '__tests__'),
  path.join(ROOT, 'frontend', '__tests__'),
];

const problems = [];

/** The `jest.mock('mod', () => { ... })` calls, with balanced factory bodies. */
function mockFactories(src) {
  const out = [];
  const re = /jest\.mock\(\s*['"]([^'"]+)['"]\s*,/g;
  let m;
  while ((m = re.exec(src))) {
    const from = re.lastIndex;
    let depth = 0;
    let i = from;
    let started = false;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (c === '(') { depth += 1; started = true; }
      else if (c === ')') {
        depth -= 1;
        if (started && depth < 0) break;
      }
    }
    out.push({ module: m[1], body: src.slice(from, i) });
  }
  return out;
}

for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.test.js'))) {
    const full = path.join(dir, file);
    const src = fs.readFileSync(full, 'utf8');
    const live = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

    for (const { module: mod, body } of mockFactories(live)) {
      // Only the seam pattern: the factory asked for the REAL module.
      if (!/requireActual/.test(body)) continue;

      // Which names were replaced with a bare jest.fn().
      const stubbed = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*jest\.fn\(\s*\)/g)].map((x) => x[1]);
      for (const name of stubbed) {
        /*
         * Defaulted back to real behaviour anywhere in the file? Either
         * `name.mockImplementation(actual.name)` or an assignment from a
         * requireActual alias. Per-test overrides are fine and expected - what
         * matters is that the DEFAULT is the real thing.
         */
        const defaulted = new RegExp(
          `${name}\\.mockImplementation\\s*\\(\\s*\\w+\\.${name}\\b`
          + `|${name}\\.mockImplementation\\s*\\(\\s*jest\\.requireActual`
        ).test(live);

        if (!defaulted) {
          problems.push({
            file: `${path.basename(dir)}/${file}`,
            mod,
            name,
            why: `the factory spreads requireActual (so real behaviour was wanted) but ${name} `
              + 'is a bare jest.fn() that is never defaulted back — every test in this file gets undefined',
          });
        }
      }
    }
  }
}

if (problems.length) {
  console.error('A TEST MOCKS THE THING IT IS MEANT TO EXERCISE:\n');
  for (const p of problems) console.error(`  ${p.file}\n    ${p.mod} -> ${p.name}\n    ${p.why}\n`);
  console.error('Default the mock to jest.requireActual in beforeEach and opt into a canned');
  console.error('result per test. Mock what the code TALKS TO, never the code under test.');
  process.exit(1);
}

console.log('no suite mocks the boundary it exists to exercise');
