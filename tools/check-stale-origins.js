#!/usr/bin/env node
/*
 * No live file names a retired deployment.
 *
 * When production moved to a new Railway account, the old hostnames were
 * sitting in twelve places across three trees: the extension's default API base
 * AND a substring test that derived the app URL from it, the extension's host
 * permissions, two outbound User-Agent strings, the load-test default target,
 * the marketing site's every "Open the app" button, its .env, and its live-stat
 * fallback. Each was correct until the day it silently was not, and none of
 * them renders an error when wrong - the extension just submits somewhere else,
 * the marketing site just quotes a different database's number.
 *
 * Records of past work are exempt: LOAD.md's measurements and AUDIT.md's runs
 * were taken against those hosts, and rewriting them would falsify the history.
 * They carry a banner saying production has moved instead.
 */

const fs = require('fs');
const path = require('path');

const RETIRED = [
  'hirepilot-production-e70d.up.railway.app',
  'hirepilot-rebuild-production.up.railway.app',
  'hirepilot-production.up.railway.app',      // never existed; 502 with x-railway-fallback
];

/* Files that record what was true at the time. History, not configuration. */
const HISTORICAL = new Set([
  'LOAD.md', 'AUDIT.md', 'DECISIONS.md', 'MIGRATION.md', 'BLOCKED.md',
  'HISTORY.md', 'PROGRESS.md', 'PROGRESS-backend.md', 'PROGRESS-frontend.md',
  'HANDOFF.md', 'RAILWAY_SETUP.md', 'SUBMISSION_AUDIT.md',
  path.join('tools', 'check-stale-origins.js'),
]);

const SKIP_DIR = new Set(['node_modules', '.next', '.git', 'coverage', 'dist', 'build']);

const ROOTS = [
  path.join(__dirname, '..'),
  path.join(process.env.HOME || '', 'Documents', 'Codex', 'hirepilot-site'),
];

function walk(dir, root, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, root, out);
    else out.push(full);
  }
  return out;
}

let offenders = [];
let scanned = 0;

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root, root)) {
    const rel = path.relative(root, file);
    if (HISTORICAL.has(rel)) continue;
    if (/\.(png|jpg|jpeg|gif|ico|pdf|zip|woff2?|ttf|mp4)$/i.test(file)) continue;

    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    scanned += 1;

    for (const host of RETIRED) {
      if (src.includes(host)) {
        const line = src.split('\n').findIndex((l) => l.includes(host)) + 1;
        offenders.push(`${path.basename(root)}/${rel}:${line} -> ${host}`);
      }
    }
  }
}

if (offenders.length) {
  console.error('Retired deployment hostnames are still referenced:\n');
  for (const o of offenders) console.error('  ' + o);
  console.error('\nProduction is backend-production-e6a8 (API) / frontend-production-0d14b (app).');
  console.error('If the file is a record of past work, add it to HISTORICAL in this tool.');
  process.exit(1);
}

console.log(`no retired hostnames in ${scanned} files across ${ROOTS.filter((r) => fs.existsSync(r)).length} trees`);
