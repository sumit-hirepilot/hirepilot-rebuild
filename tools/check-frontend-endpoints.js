#!/usr/bin/env node
/*
 * Every /api/... the frontend calls must exist in the backend.
 *
 * "Download PDF" pointed at GET /api/resume/tailored/:id/pdf. That route was
 * deleted in 5dddb82 when server-side rendering was replaced by printing from
 * the editor - a deliberate removal - but the two buttons calling it were not
 * touched, so they returned 404 from that commit onward. Nothing caught it:
 * the backend suite does not know the frontend exists, the frontend suite
 * mocks fetch, and a 404 on a button nobody clicked in testing is silent.
 *
 * This is the dead-branch shape pointed the other way. Instead of a rule no
 * input can reach, it is a caller whose target is gone.
 *
 *   node tools/check-frontend-endpoints.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/* ---------- what the backend serves ---------- */
const mounts = new Map(); // routerFile -> mount path
const indexSrc = fs.readFileSync(path.join(ROOT, 'backend', 'index.js'), 'utf8');

/*
 * Mounts name a variable, not a require: `app.use('/api/jobs', jobsRoutes)`.
 * A first cut matched only the inline-require form, found zero routes, and
 * duly reported all 90 frontend calls as broken - a checker that flags
 * everything is as useless as one that flags nothing, and rather more
 * convincing. Resolve the binding first.
 */
const binding = new Map(); // varName -> routes/<file>
for (const m of indexSrc.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g)) {
  binding.set(m[1], m[2].replace(/\.js$/, ''));
}
for (const m of indexSrc.matchAll(/app\.use\(\s*['"](\/api\/[^'"]*)['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
  const file = binding.get(m[2]);
  if (file) mounts.set(file, m[1]);
}
for (const m of indexSrc.matchAll(/app\.use\(\s*['"](\/api\/[^'"]*)['"]\s*,\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g)) {
  mounts.set(m[2].replace(/\.js$/, ''), m[1]);
}

if (!mounts.size) {
  console.error('resolved zero backend mounts from index.js - refusing to report every call as broken');
  process.exit(2);
}

// A path with its parameters flattened, so /queue/:id/start and /queue/7/start
// compare equal. Names differ between caller and route and never matter.
const shape = (p) => p
  .replace(/\/:[^/]+/g, '/*')
  .replace(/\/\$\{[^}]*\}/g, '/*')
  .replace(/\/[0-9]+(?=\/|$)/g, '/*')
  .replace(/\/+$/, '') || '/';

const served = new Set();
for (const [file, mount] of mounts) {
  const p = path.join(ROOT, 'backend', 'routes', `${file}.js`);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]*)['"`]/g)) {
    const full = `${mount}${m[2] === '/' ? '' : m[2]}`;
    served.add(`${m[1].toUpperCase()} ${shape(full)}`);
  }
}

/* ---------- what the frontend calls ---------- */
const called = [];
for (const file of walk(path.join(ROOT, 'frontend', 'pages')).concat(
  walk(path.join(ROOT, 'frontend', 'components')),
  walk(path.join(ROOT, 'frontend', 'lib'))
)) {
  const src = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  for (const m of src.matchAll(/[`'"]\$\{base\}(\/api\/[^`'"?]*)/g)) {
    const url = m[1];
    // Method: look at the nearest method: '...' after this call, else GET.
    const after = src.slice(m.index, m.index + 400);
    const meth = /method:\s*['"](get|post|put|patch|delete)['"]/i.exec(after);
    called.push({ file: path.relative(ROOT, file), url, method: (meth ? meth[1] : 'get').toUpperCase() });
  }
}

const missing = [];
for (const c of called) {
  const key = `${c.method} ${shape(c.url)}`;
  if (served.has(key)) continue;
  // A GET picked up by the default may really be a POST elsewhere in the file;
  // only report when NO method serves that shape at all.
  const anyMethod = [...served].some((s) => s.endsWith(` ${shape(c.url)}`));
  if (anyMethod) continue;
  missing.push(c);
}

const seen = new Set();
const unique = missing.filter((m) => {
  const k = `${m.file}|${m.url}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

console.log(`backend routes: ${served.size}   frontend call sites: ${called.length}`);

if (unique.length) {
  console.error(`\nFRONTEND CALLS AN ENDPOINT THE BACKEND DOES NOT SERVE:\n`);
  for (const m of unique) console.error(`  ${m.file}\n    ${m.method} ${m.url}`);
  console.error('\nA button pointing at a deleted route fails silently until someone clicks it.');
  process.exit(1);
}

console.log('every frontend /api call has a route behind it');
