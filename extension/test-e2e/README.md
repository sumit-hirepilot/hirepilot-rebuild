# Extension end-to-end harness (E1)

Drives the **real unpacked extension** through the **real production queue**
against the **ATS sandbox target** — the flow the jest suites cannot reach
because they stub `chrome.*`. It proves MV3 service-worker orchestration:
the worker opens the tab, injects the content scripts, fills the form,
attaches the résumé byte-exact, submits, and captures the confirmation.

This is NOT part of the gate. It needs a real Chromium build, network, and a
seeded sandbox application, none of which belong in `npm test`.

## Why the browser matters (2026-08-08)

Stable Google Chrome (v137+, confirmed on 151) has **removed `--load-extension`**
— no service worker registers and no content script runs. Use a Chromium that
still supports it: Playwright's bundled build, or Google **Chrome for Testing**.
The docs that said "the extension cannot be loaded in a browser here" were
wrong; it loads fine under Chrome for Testing.

## Run it

Prereqs: `npm i playwright-core`, and a Chrome-for-Testing / Playwright
Chromium binary (e.g. `~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/`).

1. Create an internal account, upload a résumé, set an application profile
   whose `authorized_countries` includes `United States` (the sandbox job is
   seeded in the US so work-authorisation resolves).
2. `POST /api/ats-sandbox/seed` (gated by `ATS_SANDBOX_ENABLED`) → a jobId.
3. `POST /api/apply/queue {jobIds:[id]}` → an `approved` application.
4. Save the account token to `$SCRATCH/ext-token.txt`, then:

```
EXT=<repo>/extension \
SCRATCH=<scratch dir> \
CHROME="<chrome-for-testing binary>" \
API=https://backend-production-e6a8.up.railway.app \
APP=https://frontend-production-0d14b.up.railway.app \
node extension/test-e2e/sandbox-submit.js
```

It pairs by writing the token to `chrome.storage.local` (what the popup's
HP_SET_TOKEN does), opens the real popup, clicks **Run queue**, and captures
artifacts (screenshots + console) under `$SCRATCH/pw/artifacts`.

## What a pass looks like

- popup shows **Connected** and the queued `approved` application
- the sandbox tab opens; the HirePilot drawer renders and fills
- the sandbox confirmation shows `GH-SANDBOX-…`
- `GET /api/ats-sandbox/capture/<conf>` shows the résumé sha256 matching what
  `GET /api/apply/queue/:id/resume-file` served, and the demographic answers
  **blank** (never auto-answered)
- the application carries `verified_at` and an immutable receipt

## Known limitation

Playwright does not reliably surface the MV3 service worker's `console.log`
as an artifact here (`sw-console.log` may be empty). The definitive proof is
server-side — the sandbox capture, the receipt, and `verified_at` — which the
worker cannot fake, since the sandbox records what it actually received.
