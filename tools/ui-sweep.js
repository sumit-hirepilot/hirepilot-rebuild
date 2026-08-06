/*
 * D26 — the UI sweep, as an allowlist.
 *
 * The A7.5 sweep excluded dangerous controls by pattern. A pattern list is a
 * denylist and a denylist fails open: the first pass had not yet excluded
 * "save", so "Save and continue this application" was clicked on the
 * operator's live account. Nothing was submitted, because the product parks an
 * application with unanswered questions - but the failure mode of a miss is an
 * unrecoverable submission to a real employer, and that is not a risk to carry
 * on a pattern being complete.
 *
 * So a control is clicked only if it matches SAFE_CONTROLS. Everything else is
 * recorded as not-exercised, which is an honest gap rather than a silent risk.
 *
 * D24 — the detector also has to be able to SEE a change. The A7.5 sweep
 * compared innerText length and the URL, and called 84 controls dead; 83 were
 * alive and it could not tell. This one hashes the rendered DOM and counts
 * fetches, and preflight() proves on a known-live control that it can detect
 * one before any negative result is believed.
 *
 * Paste into the browser console on a signed-in page, then:
 *   await sweep.preflight()      // MUST pass before anything else
 *   await sweep.run(['/jobs'])
 */

const SAFE_CONTROLS = [
  // Navigation and view state. None of these mutate anything server-side.
  /^Next ›?$/, /^‹? ?Previous$/, /^\d{1,3}$/,
  /^Best match$/, /^Newest first$/, /^Browse all jobs$/,
  /^View Details$/, /^Close$/, /^Clear$/, /^Clear filters$/,
  /^Open menu$/, /^Close menu$/, /^☰$/, /^▦$/,
  /^Resume$/, /^Cover letter$/, /^All$/, /^Interview$/, /^Offer$/, /^Rejected$/,
  /^Show all \d+ related jobs$/, /^Saved jobs/, /^Find contacts$/,
  /have no publication date and sort last/,
  /^Refresh jobs$/, /^Export CSV$/,
];

const isSafe = (label) => SAFE_CONTROLS.some((re) => re.test(label));

const labelOf = (el) =>
  (el.textContent || '').trim().slice(0, 48) || el.getAttribute('aria-label') || '(no label)';

/* A signature that can actually see a drawer open or a list re-render. */
const signature = () =>
  `${document.body.innerHTML.length}|${document.body.innerText.slice(0, 6000)}|${location.pathname}${location.search}`;

let reqs = 0;
if (!window.__sweepFetchHooked) {
  const orig = window.fetch;
  window.fetch = function hooked(...args) { reqs += 1; return orig.apply(this, args); };
  window.__sweepFetchHooked = true;
}

async function clickAndObserve(el) {
  const before = signature();
  const r0 = reqs;
  el.click();
  await new Promise((r) => setTimeout(r, 1100));
  return { domChanged: signature() !== before, requests: reqs - r0 };
}

/*
 * D24 — refuse to run until the detector has reported a POSITIVE on a control
 * known to work. Without this the sweep's negatives mean nothing, which is
 * exactly how 83 false findings were produced.
 */
async function preflight() {
  await window.next.router.push('/jobs');
  await new Promise((r) => setTimeout(r, 1800));
  const known = [...document.querySelectorAll('button')].find((b) => /^View Details$/.test(labelOf(b)));
  if (!known) return { ok: false, why: 'no known-live control found to calibrate against' };
  const seen = await clickAndObserve(known);
  const ok = seen.domChanged && seen.requests > 0;
  return { ok, seen, why: ok ? 'detector sees DOM and network change' : 'detector is blind - negatives are worthless' };
}

async function run(routes) {
  const pre = await preflight();
  if (!pre.ok) throw new Error(`D24: ${pre.why}`);

  const report = {};
  for (const route of routes) {
    await window.next.router.push(route);
    await new Promise((r) => setTimeout(r, 1500));
    const rows = [];
    for (const el of [...document.querySelectorAll('button')]) {
      const label = labelOf(el);
      if (!isSafe(label)) { rows.push({ label, result: 'not-exercised (not on allowlist)' }); continue; }
      if (el.disabled) { rows.push({ label, result: 'disabled' }); continue; }
      const seen = await clickAndObserve(el);
      rows.push({
        label,
        result: seen.domChanged || seen.requests > 0 ? 'acted' : 'NO EFFECT',
        ...seen,
      });
    }
    report[route] = rows;
  }
  return report;
}

if (typeof module !== 'undefined') module.exports = { SAFE_CONTROLS, isSafe, labelOf };
