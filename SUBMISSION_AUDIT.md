# A5 — Submission audit

Written 2026-08-05. Findings only. **The legal question is not concluded here**
and must not be concluded by an engineering pass — see §4 Constraint 6 and the
Counsel section below.

## 1. What submits, by what mechanism, under whose session

**Platforms the server will execute.** `SUPPORTED_ATS` in
`backend/routes/apply.js` is `{greenhouse}` alone. Lever and Ashby are present
as commented-out entries (D7): adapters exist and were never run against a live
form, so they were disabled rather than deleted. Re-enabling either requires
editing that set, which `backend/__tests__/supportedAts.test.js` makes a
deliberate, reviewable act.

**Adapters that exist.** `extension/content/adapters/` holds exactly
`greenhouse.js`, `lever.js`, `ashby.js`. Two of the three cannot run.

**Where the extension is allowed to act.** `manifest.json` injects content
scripts on exactly `https://*.greenhouse.io/*`, `https://jobs.lever.co/*`,
`https://jobs.ashbyhq.com/*`, plus HirePilot's own origin. It does NOT run on
the open web.

FINDING: `host_permissions` is `<all_urls>`, far broader than the three hosts
the content scripts actually match. Nothing uses the extra scope today, but a
permission granted is a permission available. Narrowing it to the three hosts
would make the manifest match the behaviour. Logged as A5-a.

**Mechanism.** Browser automation in the user's own signed-in session. The
runner fills fields and then clicks the employer's real submit button
(`adapter.submitButton()`), in the user's tab. There is no server-side
submission path and no headless browser. HirePilot holds no employer
credentials — a repo-wide grep for password/credential/cookie storage in the
extension returns only *detection* code.

**Whose session.** The user's. The extension acts inside a browser the person
is already signed into as themselves; HirePilot never authenticates as them.

**What it refuses to do.** Login walls, MFA/one-time codes and CAPTCHAs are
detected and hard-stop the run rather than being answered
(`extension/content/fields.js`). Consent and certification checkboxes are never
auto-ticked — the user is personally asserting something. Demographic and EEO
questions are never auto-answered (Constraint 4).

**What marks an application applied.** Only `recordEvidence` in
`backend/routes/apply.js`, and only after the employer's own confirmation page
is captured. Since A4 a `submission_receipts` row is frozen at that same moment
and the database refuses to change it.

## 2. What the platforms' terms say

**Greenhouse — MATERIAL, and it concerns the ONE adapter that is enabled.**

The My Greenhouse User Agreement lists, among restricted activities, using
"automated means, including spiders, robots, crawlers, or similar means or
processes to access or use the Services". Fetched directly from
<https://my.greenhouse.io/users/agreement> on 2026-08-05, not from a summary.

That agreement is written for **job seekers / candidates** — the same party
HirePilot acts on behalf of. It is not an employer-only contract.

What is NOT established, and what an engineer cannot establish:
- Whether "My Greenhouse" (Greenhouse's candidate account product) governs a
  candidate filling an employer's embedded job-board form at
  `job-boards.greenhouse.io`, where the candidate may hold no My Greenhouse
  account at all. The agreement's scope over that surface is a legal reading.
- Whether user-initiated automation inside the user's own authenticated session
  is "automated means ... to access or use the Services" in the sense intended,
  or whether the clause targets unattended scraping of the platform.
- Whether the answer differs when the human initiates each run and the tool
  stops at every consent, login and CAPTCHA.

**Lever, Ashby — NOT YET RESEARCHED.** Both are disabled, so nothing ships
against them today. Their terms must be read before either is re-enabled;
recording that as unresearched rather than implying it was checked.

## 3. Reconciling the site's claims with the product

Swept every submission claim in `frontend/pages` and `frontend/components`.

FIXED: the landing FAQ read "Coverage today is Greenhouse, Lever and Ashby"
while `SUPPORTED_ATS` had been cut to greenhouse alone. A visitor deciding
whether to trust the product was reading a claim the product could not keep.
Corrected, and now BOUND: `frontend/__tests__/adapterStatus.test.js` fails if
the landing claim names a disabled adapter, and also fails if it omits an
enabled one. Proven red in both directions.

Verified accurate, no change needed:
- "applied means the employer's own confirmation page was captured" — true;
  `recordEvidence` is the only path and A4 froze the receipt.
- "fills and submits the form in your own signed-in browser rather than from a
  server" — true, and now the most legally load-bearing sentence on the site.
- "pauses and asks you ... a login, a CAPTCHA, a consent tick" — true.
- "Workday, Taleo and iCIMS are not automated and are opened for you" — true.
- The Auto Apply coverage panel was already bound to `SUPPORTED_ATS`.

## 4. Counsel — needed before anything scales

The one enabled adapter runs against a platform whose candidate-facing
agreement restricts automated access. §3's default decision table, read
literally, says browser automation against a third party's ATS is
`deferred: ToS` — which points at disabling Greenhouse too, i.e. at disabling
the product's core capability.

That is deliberately NOT decided here. Two reasons: the master prompt reserves
the legal reading for counsel, and the questions in §2 above are exactly the
ones that determine the answer. An engineering pass concluding either way —
"it's fine because the user initiates it" or "shut it off" — would be
substituting a guess for advice.

What is decided here: nothing new ships against any ATS, and Lever and Ashby
stay disabled, until this is answered.
