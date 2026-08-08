# Auto Apply — proven end to end, WEAKENED

Run on production (`backend-production-e6a8`), 2026-08-07, account
`autoapply-proof@hirepilot.local`, seeded from the operator's own resume PDF.

## WEAKENED — what was substituted, and what that costs

A5 defers to counsel whether HirePilot may drive automation against a real
employer's Greenhouse board. On the operator's instruction the pipeline was
proved against a **controlled target** instead.

**Exactly one component was replaced:** the employer's form and its
confirmation page. Everything else is the shipped product — the queue, the
tailored resume, the cover letter, the screening answers, the resume file
endpoint, the evidence endpoint, the receipt trigger and the tracker.

**What is genuinely exercised.** The target is built to
`extension/content/adapters/greenhouse.js`'s own selectors (`#application_form`,
`job_application[...]`), so the **shipped adapter, field resolver and selectors
are what ran**. Nothing about the form was assumed by the harness: every element
came back from the adapter's own `identityFields()`, `resumeInput()`,
`coverLetterField()` and `submitButton()`.

**The delta, stated plainly.**

| | covered | not covered |
|---|---|---|
| adapter claims the page | yes | — |
| adapter resolves every field | yes | — |
| resume bytes arrive intact | yes | — |
| confirmation parsed and verified | yes | — |
| receipt frozen and immutable | yes | — |
| **Greenhouse's LIVE markup still matches the selectors** | **no** | a page built to fit the selectors can never catch selector drift |
| MV3 service-worker orchestration, `chrome.*` APIs, tab watching | **no** | the harness loads the content scripts directly |
| a real employer's CAPTCHA, login wall or consent gate | **no** | — |

Only a run against a live board closes the first row, and that is the run A5
gates. `ATS_SANDBOX_ENABLED` is the switch; with it unset the target is not
driveable at all and `automationSupported` reads false for it, exactly like an
unverified ATS.

## The stages

| stage | evidence |
|---|---|
| candidate selection | job queued from the real feed, `atsScore 64` |
| resume upload + parse | real PDF, **10 skills, 6 roles** extracted |
| tailoring, three honesty guards | `addedSkills: []`; Marketing, HR, Payroll → `needsConfirmation` (D51) |
| prepare refuses to invent | `needs_user`, blocking on name/email/phone until the profile existed |
| optional fields left empty | LinkedIn and Portfolio stayed `null`, `source: profile_gap` |
| adapter claims the page | `matches() true`, `formRoot() <form id="application_form">` |
| every field resolved by the adapter | first/last/email/phone → `job_application[...]`, resume input, cover letter, `#submit_app` |
| file attached, byte-exact | **110,255 bytes, sha256 `dd8d0df0…5346`** — the target's hash of what it received matches the bytes fetched from the queue |
| demographic questions | **nothing sent** — `demographic answers received: []` |
| submission | target returned 201, `GH-SANDBOX-3C4E12C87615` |
| confirmation captured | evidence endpoint `verified: true`, basis `confirmation_id` |
| receipt readable | `{id: 1, frozen: true}`, `GET /receipt` 200 |
| receipt immutable | `UPDATE` and `DELETE` both **rejected by the trigger** |
| tracker advanced | `status submitted`, `tracker_stage applied`, `verified_at` set |

## The safety layer

| control | result |
|---|---|
| kill switch halts a live start | **429** `{"reason":"halted"}` |
| kill switch resumes | **200** `{"ok":true}` |
| halt lever rejects a wrong secret | **403** |
| halt lever rejects an absent secret | **403** |
| Lever stays disabled | `platform=lever automationSupported=false` |
| Ashby stays disabled | `platform=ashby automationSupported=false` |
| Greenhouse enabled | `platform=greenhouse automationSupported=true` |
| no evidence → never applied | **422**, row `failed`, `applied_at` null, `submitted_at` null, **0 receipts**, reason recorded |
| applied requires a submission record | DB constraint refuses the row (D50) |

## Two defects this run found

Both were invisible to a green suite, and both are the reason the run mattered.

1. **The receipt had never once been written.** The freeze query selected
   `a.resume_id` and `a.ats` — columns of `submission_receipts`, the table it
   inserts into, which have never existed on `applications`. Postgres threw on
   every submission ever made; the catch downgraded it to
   `{frozen: false, reason: 'receipt could not be written'}` and the endpoint
   answered 200. The old production's **0 submission_receipts had been read as
   "nobody has submitted yet"**. It was this.

2. **The controlled target 500'd on the real payload** — multer parses
   `job_application[first_name]` into a nested object, and the route called
   `String()` on it. My own new code, found by running it rather than by the
   tests I had written from the same wrong assumption.

Guards added for both classes: SQL column references are checked against the
schema, and the target's tests now drive the real bracket names.

---

## UPDATE 2026-08-08 — MV3 orchestration is now covered (real extension, sandbox)

The delta table above listed "MV3 service-worker orchestration, chrome.* APIs,
tab watching" as NOT covered because the harness loaded the content scripts
directly. That row is now closed: the REAL unpacked extension was loaded under
Google Chrome for Testing and driven end to end against the sandbox — the MV3
worker opened the tab, injected the scripts, filled, attached the résumé
byte-exact (sha256 2e66…04ee), submitted, and captured the confirmation
(GH-SANDBOX-58615736D16F); the application carries verified_at and an immutable
receipt. Demographic fields arrived blank. See PROJECT.md §27 and
extension/test-e2e/. Only two rows remain uncovered, both inherent to a
sandbox: live Greenhouse selector drift (E2 covers this read-only — no drift)
and a real employer's CAPTCHA/login/consent (A5).
