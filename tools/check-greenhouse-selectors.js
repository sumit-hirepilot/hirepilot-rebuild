#!/usr/bin/env node
/*
 * Greenhouse selector-drift check (E2).
 *
 * The ATS sandbox is built to the adapter's OWN selectors, so it can never
 * catch the one failure that actually breaks a live submit: Greenhouse
 * changing its markup. This runs the SHIPPED adapter (content/fields.js +
 * content/adapters/greenhouse.js, loaded unmodified) against REAL Greenhouse
 * application DOM and reports, per selector method, whether it resolves,
 * misses, or is ambiguous.
 *
 * Read-only by construction: it loads captured HTML into jsdom and calls only
 * the adapter's resolver methods. It never fills, clicks, or submits, and it
 * makes no network request unless run with --live.
 *
 *   node tools/check-greenhouse-selectors.js            # against committed fixtures
 *   node tools/check-greenhouse-selectors.js --live     # re-fetch a small live set first
 *
 * Fixtures live in extension/test/fixtures/greenhouse/*.html and are real
 * pages captured from production boards. Refresh them with --live when a
 * check regresses, after reading the diff.
 *
 * jsdom sees SERVER-rendered DOM. Greenhouse's modern board renders the whole
 * application form server-side (verified: #application-form, #first_name and
 * the file input are all in the raw HTML), so this is faithful to what the
 * content script queries. A field that only appears after client hydration
 * would read here as MISSING - a conservative, never a falsely-passing,
 * signal. run-with-browser mode (E1 harness) cross-checks the hydrated DOM.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// jsdom is a devDependency of the frontend workspace.
const { JSDOM } = require(path.join(__dirname, '..', 'frontend', 'node_modules', 'jsdom'));

const FIX_DIR = path.join(__dirname, '..', 'extension', 'test', 'fixtures', 'greenhouse');
const FIELDS = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content', 'fields.js'), 'utf8');
const ADAPTER = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content', 'adapters', 'greenhouse.js'), 'utf8');

function loadAdapter(html, url) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  // The adapter and fields attach to window.HP; run them in the page's realm.
  const ctx = dom.getInternalVMContext ? dom.getInternalVMContext() : vm.createContext(window);
  vm.runInContext(FIELDS, ctx);
  vm.runInContext(ADAPTER, ctx);
  return window;
}

// getBoundingClientRect/offsetParent are 0 in jsdom, so HP.fields visibility
// checks would drop everything. The adapter's resolver methods used here do
// not gate on visibility; genericQuestions() does, so it is reported
// separately and treated as "needs a real browser".
function checkOne(name, html, url) {
  const w = loadAdapter(html, url);
  const A = w.HP.adapters.greenhouse;
  const out = { name, url };

  out.matches = A.matches();

  // A careers-domain embed (e.g. jobs.elastic.co) ships an empty shell and
  // mounts the Greenhouse form with client JS. jsdom does not run the page's
  // scripts, so it sees zero controls - which is a blind spot of THIS
  // instrument, not adapter drift. Classify it honestly and hand it to the
  // real-browser harness rather than reporting a false miss (D24: prove the
  // negative is real before trusting it).
  const ssrControls = w.document.querySelectorAll('input, textarea, select').length;
  if (out.matches && ssrControls === 0) {
    out.clientRendered = true;
    out.formRoot = 'client-rendered (needs browser render)';
    out.identity = {}; out.resume = 'n/a'; out.cover = 'n/a'; out.submit = 'n/a';
    return out;
  }

  const root = A.formRoot();
  out.formRoot = root ? `${root.tagName}${root.id ? '#' + root.id : ''}${root.getAttribute && root.getAttribute('data-testid') ? '[testid=' + root.getAttribute('data-testid') + ']' : ''}` : 'MISS';

  const ids = A.identityFields();
  out.identity = {};
  for (const [k, sel] of Object.entries(ids)) {
    const matched = (root || w.document).querySelectorAll(sel);
    out.identity[k] = matched.length === 0 ? 'MISS' : matched.length === 1 ? 'ok' : `AMBIGUOUS(${matched.length})`;
  }

  const resume = A.resumeInput();
  out.resume = resume ? `ok(${resume.id || resume.name || 'file'})` : 'MISS';
  const cover = A.coverLetterField();
  out.cover = cover ? `ok(${cover.id || cover.name || 'textarea'})` : 'none';
  const submit = A.submitButton();
  out.submit = submit ? `ok(${submit.id || submit.type || submit.tagName})` : 'MISS';

  return out;
}

function verdict(r) {
  if (r.clientRendered) return [];
  const crit = [];
  if (!r.matches) crit.push('matches=false');
  if (r.formRoot === 'MISS') crit.push('formRoot MISS');
  // Identity: email + name are the load-bearing ones.
  for (const k of ['first_name', 'last_name', 'email']) {
    if (r.identity[k] === 'MISS') crit.push(`${k} MISS`);
    if (String(r.identity[k]).startsWith('AMBIGUOUS')) crit.push(`${k} ${r.identity[k]}`);
  }
  if (r.resume === 'MISS') crit.push('resume MISS');
  if (r.submit === 'MISS') crit.push('submit MISS');
  return crit;
}

async function refreshLive() {
  const https = require('https');
  const set = [
    ['modern-anthropic', 'https://job-boards.greenhouse.io/anthropic/jobs/5382033008'],
    ['modern-gitlab', 'https://job-boards.greenhouse.io/gitlab/jobs/8646573002'],
    ['modern-cloudflare', 'https://job-boards.greenhouse.io/cloudflare/jobs/8115936'],
  ];
  fs.mkdirSync(FIX_DIR, { recursive: true });
  for (const [name, url] of set) {
    const html = await new Promise((res, rej) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          return https.get(r.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } }, (r2) => {
            let b = ''; r2.on('data', (c) => b += c); r2.on('end', () => res(b));
          }).on('error', rej);
        }
        let b = ''; r.on('data', (c) => b += c); r.on('end', () => res(b));
      }).on('error', rej);
    });
    fs.writeFileSync(path.join(FIX_DIR, `${name}.html`), html);
    console.log(`refreshed ${name} (${html.length} bytes)`);
  }
}

(async () => {
  if (process.argv.includes('--live')) await refreshLive();
  if (!fs.existsSync(FIX_DIR)) {
    console.error(`no fixtures at ${FIX_DIR}. Run with --live once to capture them.`);
    process.exit(2);
  }
  const files = fs.readdirSync(FIX_DIR).filter((f) => f.endsWith('.html'));
  if (!files.length) { console.error('no .html fixtures'); process.exit(2); }

  let anyCritical = false;
  const clientRendered = [];
  for (const f of files) {
    const name = f.replace(/\.html$/, '');
    const html = fs.readFileSync(path.join(FIX_DIR, f), 'utf8');
    const url = `https://job-boards.greenhouse.io/${name}`;
    let r;
    try { r = checkOne(name, html, url); }
    catch (e) { console.log(`\n### ${name}\n  ERROR: ${e.message}`); anyCritical = true; continue; }
    const crit = verdict(r);
    console.log(`\n### ${name}`);
    console.log(`  matches:  ${r.matches}`);
    console.log(`  formRoot: ${r.formRoot}`);
    if (!r.clientRendered) {
      console.log(`  identity: ${JSON.stringify(r.identity)}`);
      console.log(`  resume:   ${r.resume}`);
      console.log(`  cover:    ${r.cover}`);
      console.log(`  submit:   ${r.submit}`);
    }
    console.log(`  VERDICT:  ${r.clientRendered ? 'client-rendered — assess with the browser harness (E1), not this checker' : (crit.length ? 'DRIFT — ' + crit.join('; ') : 'ok')}`);
    if (crit.length) anyCritical = true;
    if (r.clientRendered) clientRendered.push(name);
  }
  if (clientRendered.length) console.log(`\nclient-rendered (browser-only): ${clientRendered.join(', ')}`);
  console.log(`\n${anyCritical ? 'SELECTOR DRIFT DETECTED' : 'all server-rendered fixtures resolve the load-bearing selectors'}`);
  process.exit(anyCritical ? 1 : 0);
})();
