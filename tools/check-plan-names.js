#!/usr/bin/env node
/*
 * The plan a user is told they are on must be a plan the pricing page sells.
 *
 * It was not. routes/plans.js named the tiers Starter / Pro / Power; /pricing
 * sold Free / Pilot / Copilot. No overlap at all, so the credits pill told a
 * live account it was "on Power" while the page one click away offered three
 * other plans. New signups default to plan_tier 'starter' and were therefore
 * on a plan that has never appeared on the pricing page.
 *
 * Worse, the two disagreed about what is even metered:
 *
 *   /pricing            "Applications are not metered on any plan"
 *   routes/plans.js      applicationsPerMonth: 600 / 1500 / 4500
 *   submissionGate.js    refuses to submit at remaining <= 0
 *   the header pill      counts it down on every authenticated page
 *
 * The page denied a limit the product enforces. Nothing connected the two
 * files, so nothing caught it - both suites were green. It was found by
 * reading the header pill against the pricing page during a feature audit.
 *
 * This is the class fix. The instance was one stale vocabulary; the class is
 * two independent lists describing the same thing to the same user.
 *
 *   node tools/check-plan-names.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRICING = path.join(ROOT, 'frontend', 'pages', 'pricing.js');
const PLANS = path.join(ROOT, 'backend', 'routes', 'plans.js');
const GATE = path.join(ROOT, 'backend', 'services', 'submissionGate.js');

const read = (p) => fs.readFileSync(p, 'utf8');
const live = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

/** The `{...}` or `[...]` body of `const NAME = ...`, balanced. */
function block(src, name, open, close) {
  const start = src.indexOf(`const ${name} = ${open}`);
  if (start === -1) return null;
  const from = src.indexOf(open, start);
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === open) depth += 1;
    else if (src[i] === close) {
      depth -= 1;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return null;
}

const names = (body) => (body
  ? [...body.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1])
  : []);

const problems = [];

const backend = names(block(live(read(PLANS)), 'TIERS', '{', '}'));
const pricingSrc = read(PRICING);
const frontend = names(block(live(pricingSrc), 'PLANS', '[', ']'));

if (!backend.length) problems.push('no tier names found in backend/routes/plans.js');
if (!frontend.length) problems.push('no plan names found in frontend/pages/pricing.js');

for (const n of backend) {
  if (!frontend.includes(n)) {
    problems.push(`backend can put an account on '${n}', which /pricing does not sell`);
  }
}
for (const n of frontend) {
  if (!backend.includes(n)) {
    problems.push(`/pricing sells '${n}', which no backend tier is named`);
  }
}

/*
 * The metering claim. Checked against the GATE rather than against prose,
 * because the gate is what actually refuses a submission - if it enforces an
 * allowance, no user-facing sentence may say there isn't one.
 */
const gated = /remaining\s*<=\s*0/.test(live(read(GATE)));
/*
 * Comments stripped: a comment RECORDING the old false sentence is not a claim
 * to anyone. Scanning raw source flagged this file's own history note, which
 * would have pushed the next person to delete the explanation to get green.
 */
const pricingLive = live(pricingSrc);
const denies = [
  /not metered on any plan/i,
  /nothing (?:here )?is charged per application/i,
  /never per application/i,
  /unlimited applications/i,
];
if (gated) {
  for (const re of denies) {
    const m = pricingLive.match(re);
    if (m) {
      problems.push(`/pricing says "${m[0]}" but submissionGate refuses to submit at remaining <= 0`);
    }
  }
}

if (problems.length) {
  console.error('THE PLAN A USER IS ON DOES NOT MATCH THE PLAN THE PAGE SELLS:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nOne vocabulary, and it must describe the limit the gate actually enforces.');
  process.exit(1);
}

console.log(`plan names agree: ${backend.join(', ')} - and the metering claim matches the gate`);
