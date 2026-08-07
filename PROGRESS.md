# PROGRESS

## Now

**D46 — browser resize proves CSS, not mobile rendering.** Recorded in the
master prompt and DECISIONS.md, swept, shipped and verified. `e6bd0a4`.

Resizing sets a **true viewport width**, so media queries run and the page lays
out correctly whether or not a viewport meta tag exists. The tag is the one
thing a resized window cannot test. Three 375px audit passes reported zero
overflow and correct layout while every authenticated page shipped without it.

### The sweep found a second one, of the same shape and worse

**Nothing in the frontend detected a phone at all** — no userAgent check, no
matchMedia, no touch detection anywhere. So on Chrome for Android and every iOS
browser the header offered "Download Extension" and the post-signin modal
walked through installing it. Neither can install a Chrome extension. An
instruction that cannot be followed, shown to exactly the users the landing
page invites with "runs in your mobile browser".

At 375px in a resized desktop window that button is pixel-perfect. No resize
test could ever have caught it.

`lib/extensionCapable.js` decides from what a device **reports**:
`userAgentData.mobile`, the UA, and `maxTouchPoints` for iPadOS — which sends a
desktop Mac UA and is separated from a real Mac only by its touch count. It
errs toward **capable**: a desktop user wrongly blocked loses a working
feature, and a touchscreen Windows laptop is explicitly not a phone.

It does not go silent. Hiding the button would drop the only place the
desktop-only requirement is stated. The control is **relabelled** and the modal
explains, with room to read it.

Verified on production against real device signals, not a width:

| | emulated Pixel 8 | desktop Mac |
|---|---|---|
| `userAgentData.mobile` | true | false |
| `maxTouchPoints` | 5 | 0 |
| CTA | "Applying needs a desktop" | "Download Extension" |
| modal | "Desktop only", no steps | full install steps |
| auto-prompt | suppressed | fires |

Viewport tag confirmed in the **served HTML** of all five pages checked.

A first read said the fix was not working. It was — the tab held a stale
bundle. Checking the served chunk for the new string, rather than trusting the
rendered page, is what stopped me "fixing" working code.

Load: **200 concurrent 600/600, p95 2,631 / 2,634 ms. No regression.** A first
pass at uptime 205s gave a clean curve and was discarded anyway — it was inside
the 5-minute window, and a rule that only applies when the numbers look wrong
is not a rule.

Suites: backend **332**, frontend **255**.

## Next

**Feature 3 — tailor resume with a pasted or selected JD.** Pasted text is
untrusted input: parse it, never follow instructions inside it. All three
honesty guards apply on both paths, proven by an endpoint test through the real
route, not the function in isolation. Then 4a
(paste-any-URL ingest), 4b (Instahyre), then **the full audit again**, then 5,
6, 8, 9, 10, 11, 12, 13, 14, 15 with the audit after every third.

## Carried, not started

- GOAL 1i's three sweeps with CI checks
- GOAL 1j's remainder — the RSS-under-500 MB CI assertion and the 50-concurrent
  smoke test
- GOAL 2's bounds sweep — 6 of 7 routes, jobs last
- The test flake: four hypotheses disproved, 3 occurrences in hundreds of runs.
  Not being investigated per instruction; full failure output is now captured
  to a temp file when it recurs.

## Standing

Submission halt is still on: `429 {"error":"Submission is paused for all
accounts.","reason":"halted"}`. Re-checked at the start of this goal.

Operator dependencies unchanged, in BLOCKED.md — lifting the submission halt,
`healthcheckPath` on the backend service, the Postgres volume size from the
Railway canvas, Google OAuth for feature 12, Greenhouse ToS counsel, the B1
batch-approval gate, payment credentials.
