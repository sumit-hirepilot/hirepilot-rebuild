#!/usr/bin/env node
/*
 * Every value read from a request is bounded before it is used.
 *
 * GET /api/jobs?limit=100&page=250 is OFFSET 24,900 over a CTE that ranks the
 * whole index. Three of those took production down for eight minutes and it
 * needed a redeploy to come back. page and limit were read off the query
 * string and used directly.
 *
 * That was one instance of a class, not a paging bug: minScore, free-text
 * search, and limits on five other endpoints were all read the same way. This
 * fails CI on any query parameter that does not pass through
 * services/requestBounds, so the next one cannot be introduced quietly.
 *
 * KNOWN LIMITS, stated so this cannot pass for more than it is:
 *
 *   - Scope is the FILE, not the handler. A parameter bounded in one handler
 *     satisfies the check for another handler in the same file that reads the
 *     same name. Tightening this needs per-handler scoping.
 *   - Proved on a known positive only PARTIALLY: mutating routes/jobs.js to
 *     restore the historical unbounded paging made it report `limit`, but not
 *     `page`, and the mutation did not cleanly reproduce the original state.
 *     So it is demonstrated to catch an unbounded parameter, and NOT
 *     demonstrated to catch every one. Treat a green run as "no obvious hole",
 *     not as proof.
 *
 *   node tools/check-query-bounds.js
 */
const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', 'backend', 'routes');

/*
 * Parameters that are not values but SELECTORS: each is compared against a
 * fixed set inside the handler and can only ever take one of those values, so
 * the caller's string never reaches a query. Listed by name so adding a new
 * one is a deliberate act rather than an omission, and each is checked below
 * for actually being compared against something.
 */
const SELECTORS = new Set([
  'sort', 'datePosted', 'experience', 'includeRelated', 'ranked',
  'category', 'status', 'stage', 'view', 'range',
]);

/** Reaching req.params.id and using it as a number is already bounded by SQL. */
const BOUNDERS = /\bbound(Int|Float|Text|Enum|List|Paging)\s*\(/;

const files = fs.readdirSync(ROUTES).filter((f) => f.endsWith('.js')).map((f) => path.join(ROUTES, f));
const problems = [];

for (const file of files) {
  const rel = path.relative(path.join(__dirname, '..'), file);
  const src = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  const params = new Set();

  // const { a, b = 2, c: d } = req.query
  for (const m of src.matchAll(/\{([^}]*)\}\s*=\s*req\.query/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) params.add(name);
    }
  }
  // req.query.foo
  for (const m of src.matchAll(/req\.query\.([A-Za-z_$][\w$]*)/g)) params.add(m[1]);

  if (!params.size) continue;

  for (const name of params) {
    if (SELECTORS.has(name)) {
      // A selector must actually be compared against something, or it is just
      // an unbounded string with a reassuring name.
      const compared = new RegExp(`${name}\\s*(===?|!==?)|\\b(includes|hasOwnProperty)\\s*\\(\\s*${name}|\\[\\s*${name}\\s*\\]|${name}\\s*(?:&&|\\?)`).test(src);
      if (!compared) {
        problems.push({ rel, name, why: 'listed as a selector but never compared against a fixed set' });
      }
      continue;
    }

    /*
     * Everything else must reach a bounds helper. Matched on the parameter
     * appearing as an argument to one - `boundInt(req.query.limit, ...)` or
     * `boundPaging(rawPage, rawLimit)` via its raw alias.
     */
    /*
     * Matched inside the bounds call's ARGUMENTS, not merely on the same line.
     * "Somewhere on this line" let a parameter count as bounded because an
     * unrelated bounds call happened to sit beside it - a checker that can be
     * satisfied by coincidence reports green over exactly the gap it exists to
     * find, which is how the first two cuts of the guard-wiring census went.
     */
    const aliasRe = new RegExp(`(?:^|[^\\w$])(raw)?${name}(?:[^\\w$]|$)`, 'i');
    const boundedHere = [...src.matchAll(/\bbound(?:Int|Float|Text|Enum|List|Paging)\s*\(([^)]*)\)/g)]
      .some((call) => aliasRe.test(call[1]));
    if (!boundedHere) {
      problems.push({ rel, name, why: 'read from req.query and never passed through services/requestBounds' });
    }
  }
}

if (problems.length) {
  console.error('UNBOUNDED REQUEST PARAMETER:\n');
  for (const p of problems) console.error(`  ${p.rel}  ${p.name}\n    ${p.why}\n`);
  console.error('An unbounded parameter took production down for eight minutes. Bound it, clamp');
  console.error('rather than refuse, and state the clamp - services/requestBounds.');
  process.exit(1);
}

console.log('every query parameter is bounded before use');
