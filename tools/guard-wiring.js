#!/usr/bin/env node
/*
 * Unwired-guard census.
 *
 * Three guards shipped that no live path could reach: plans.can() with no
 * caller, untraceable_claim bypassed because POST /api/resume/tailor never
 * called verifyAdditions, and resumeGuard.verify imported but never invoked.
 * All three had passing tests - the tests called the function, the endpoint
 * did not.
 *
 * A guard that exists and is not invoked is indistinguishable from no guard.
 * So enumerate every exported thing that can REFUSE, and report who actually
 * calls it. No caller is a finding, not a footnote.
 *
 * Parsed, not grepped. Two regex cuts of this script both reported the very
 * defect it exists to find as WIRED: the first counted `jwt.verify` in
 * middleware/auth.js as a call to resumeGuard.verify, the second counted the
 * import statement that names a symbol as a use of it. A census that cannot be
 * trusted to report a known positive is worse than none, because it launders a
 * gap into a clean bill of health.
 *
 *   node tools/guard-wiring.js           # census
 *   node tools/guard-wiring.js --strict  # exit 1 if any guard has no live caller
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Deliberately not a try/catch fallback to regex: a degraded census that still
// prints a table is the failure mode this tool exists to prevent.
let acorn;
for (const where of [
  path.join(ROOT, 'backend', 'node_modules', 'acorn'),
  path.join(ROOT, 'frontend', 'node_modules', 'acorn'),
]) {
  try { acorn = require(where); break; } catch (e) { /* try the next one */ }
}
if (!acorn) {
  console.error('guard-wiring needs acorn. Run `npm ci` in backend/ (it is a devDependency there).');
  console.error('Refusing to fall back to a weaker scan: a degraded census that still prints');
  console.error('a table is the exact failure mode this tool exists to prevent.');
  process.exit(1);
}

const SCAN = [
  ['backend', ['services', 'middleware', 'routes']],
  ['frontend', ['lib']],
  ['extension', ['.']],
];

/* ---------------- collect files ---------------- */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}
const files = SCAN.flatMap(([base, subs]) => subs.flatMap((s) => walk(path.join(ROOT, base, s))));
const rel = (f) => path.relative(ROOT, f);

const ast = new Map();
const text = new Map();
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  try {
    ast.set(f, acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true }));
    text.set(f, code);
  } catch (err) {
    try {
      ast.set(f, acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module' }));
      text.set(f, code);
    } catch (e2) {
      console.error(`could not parse ${rel(f)}: ${e2.message}`);
      process.exit(1);
    }
  }
}

/* ---------------- tiny AST walker ---------------- */
function each(node, fn, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent);
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => each(c, fn, node));
    else if (v && typeof v.type === 'string') each(v, fn, node);
  }
}

/* ---------------- 1. exported functions ---------------- */
const GUARD_NAME = [
  /^can$/,
  /^(verify|check|validate|assert|ensure|enforce|require|sanitis|sanitiz|guard|reject|refuse|deny)/i,
  /^is[A-Z].*(Allowed|Valid|Safe|Permitted|Halted)$/,
  /(Gate|Guard|Halted|Allowed|Supported)$/,
];

/*
 * A function is a GUARD if its return value is a verdict. That means an
 * {ok|allowed|valid|violations|...} shape - the refusal contract this codebase
 * uses everywhere a guard says no.
 *
 * Deliberately narrow. A first cut also accepted a `reason` field, a throw, or
 * any 4xx, and swept in all ten job-source adapters and every route handler.
 * A census padded with 10 non-guards is one nobody reads, and the one real
 * finding drowns. Refusal-by-response is only counted in middleware/, which is
 * the one place it is the whole job.
 */
const VERDICT_KEYS = ['ok', 'allowed', 'valid', 'violations', 'refused', 'blocked', 'needsConfirmation', 'halted'];

function refuses(fnNode, file) {
  let yes = false;
  each(fnNode, (n) => {
    if (yes) return;
    if (n.type === 'ObjectExpression') {
      for (const p of n.properties) {
        const key = p.key && (p.key.name || p.key.value);
        if (VERDICT_KEYS.includes(key)) { yes = true; return; }
      }
    }
    if (/middleware/.test(file) && n.type === 'CallExpression'
        && n.callee.type === 'MemberExpression'
        && n.callee.property && n.callee.property.name === 'status'
        && n.arguments[0] && typeof n.arguments[0].value === 'number'
        && n.arguments[0].value >= 400) { yes = true; }
  });
  return yes;
}

const decls = new Map(); // file -> Map(name -> node)
for (const [f, tree] of ast) {
  const m = new Map();
  each(tree, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) m.set(n.id.name, n);
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init
        && ['FunctionExpression', 'ArrowFunctionExpression'].includes(n.init.type)) {
      m.set(n.id.name, n.init);
    }
  });
  decls.set(f, m);
}

const guards = [];
for (const [f, tree] of ast) {
  const exported = new Set();
  each(tree, (n) => {
    // module.exports = { ... }
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression'
        && n.left.object.name === 'module' && n.left.property.name === 'exports') {
      if (n.right.type === 'ObjectExpression') {
        for (const p of n.right.properties) {
          const key = p.key && (p.key.name || p.key.value);
          if (key) exported.add(key);
        }
      }
    }
    // exports.foo = / module.exports.foo =
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression') {
      const o = n.left.object;
      if ((o.name === 'exports')
          || (o.type === 'MemberExpression' && o.object.name === 'module' && o.property.name === 'exports')) {
        if (n.left.property.name) exported.add(n.left.property.name);
      }
    }
  });

  for (const name of exported) {
    const node = decls.get(f).get(name);
    if (!node) continue;                       // constant, not a function
    const byName = GUARD_NAME.some((re) => re.test(name));
    const byBehaviour = refuses(node, f);
    if (!byName && !byBehaviour) continue;
    guards.push({ name, file: f, module: rel(f), why: byName ? (byBehaviour ? 'name+behaviour' : 'name') : 'behaviour' });
  }
}

/* ---------------- 2. import graph ---------------- */
function resolveReq(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [base, `${base}.js`, path.join(base, 'index.js')]) if (ast.has(c)) return c;
  return null;
}

const importsOf = new Map(); // file -> Map(target -> {symbols:Set, ns:Set})
for (const [f, tree] of ast) {
  const map = new Map();
  const add = (t) => { if (!map.has(t)) map.set(t, { symbols: new Set(), ns: new Set() }); return map.get(t); };
  each(tree, (n, parent) => {
    if (n.type !== 'CallExpression' || n.callee.name !== 'require') return;
    const spec = n.arguments[0] && n.arguments[0].value;
    if (typeof spec !== 'string') return;
    const target = resolveReq(f, spec);
    if (!target) return;
    const e = add(target);
    if (parent && parent.type === 'VariableDeclarator') {
      if (parent.id.type === 'Identifier') e.ns.add(parent.id.name);
      if (parent.id.type === 'ObjectPattern') {
        for (const p of parent.id.properties) {
          if (p.key && p.key.name) e.symbols.add(p.key.name);
          if (p.value && p.value.name) e.symbols.add(p.value.name);
        }
      }
    }
    // require('./x').fn(...)
    if (parent && parent.type === 'MemberExpression' && parent.property && parent.property.name) {
      e.symbols.add(parent.property.name);
    }
  });
  importsOf.set(f, map);
}

/* ---------------- 3. uses ---------------- */
function usesOf(g) {
  const called = [];
  const passed = [];
  for (const [f, tree] of ast) {
    if (f === g.file) continue;                 // internal use is not wiring
    const imp = importsOf.get(f).get(g.file);
    if (!imp) continue;
    let isCalled = false;
    let isPassed = false;
    each(tree, (n, parent) => {
      // called directly: name(...)
      if (n.type === 'CallExpression') {
        if (n.callee.type === 'Identifier' && n.callee.name === g.name && imp.symbols.has(g.name)) isCalled = true;
        if (n.callee.type === 'MemberExpression' && n.callee.property.name === g.name
            && n.callee.object.type === 'Identifier' && imp.ns.has(n.callee.object.name)) isCalled = true;
        // require('./x').name(...)
        if (n.callee.type === 'MemberExpression' && n.callee.property.name === g.name
            && n.callee.object.type === 'CallExpression' && n.callee.object.callee.name === 'require') isCalled = true;
      }
      // passed as a value: router.use(verifyToken)
      if (n.type === 'Identifier' && n.name === g.name && imp.symbols.has(g.name)) {
        const isCallee = parent && parent.type === 'CallExpression' && parent.callee === n;
        const isImportBinding = parent && (parent.type === 'Property' || parent.type === 'ObjectPattern' || parent.type === 'VariableDeclarator');
        if (!isCallee && !isImportBinding) isPassed = true;
      }
      /*
       * Handed over as ns.name without being called - how jobAggregator builds
       * its SOURCES table (`{ key: 'remoteok', fetchJobs: client.fetchJobs }`).
       * Missing this reported all ten adapters as having no caller.
       */
      if (n.type === 'MemberExpression' && n.property && n.property.name === g.name
          && n.object.type === 'Identifier' && imp.ns.has(n.object.name)) {
        const isCallee = parent && parent.type === 'CallExpression' && parent.callee === n;
        if (!isCallee) isPassed = true;
      }
    });
    if (isCalled) called.push(rel(f));
    else if (isPassed) passed.push(rel(f));
  }
  return { called, passed };
}

const rows = guards.map((g) => {
  const { called, passed } = usesOf(g);
  const all = [...called, ...passed];
  return { ...g, called, passed, live: all.length > 0, all };
});

/* ---------------- 4. report ---------------- */
const isRoute = (p) => p.includes(`${path.sep}routes${path.sep}`) || p.includes('/routes/');
const unwired = rows.filter((r) => !r.live);
const pad = (s, n) => String(s).padEnd(n);

console.log(`GUARD WIRING CENSUS — ${rows.length} guards across ${files.length} files\n`);
console.log(pad('GUARD', 26), pad('DEFINED IN', 34), pad('WHY', 15), 'REACHED FROM');
console.log('-'.repeat(120));
for (const r of rows.sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name))) {
  const entry = r.all.filter(isRoute);
  let where;
  if (!r.live) where = '*** NO CALLER — wire it or delete it ***';
  else if (entry.length) where = entry.join(', ') + (r.called.length ? '' : ' (as middleware)');
  else where = `(indirect) ${r.all.join(', ')}`;
  console.log(pad(r.name, 26), pad(r.module, 34), pad(r.why, 15), where);
}
console.log(`\nguards: ${rows.length}   unwired: ${unwired.length}`);

if (process.argv.includes('--strict') && unwired.length) {
  console.error('\nA guard that exists and is not invoked is indistinguishable from no guard.');
  console.error('Wire it or delete it. Never leave it.');
  process.exit(1);
}
