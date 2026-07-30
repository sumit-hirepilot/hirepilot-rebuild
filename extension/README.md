# HirePilot Apply — browser extension

Executes your **approved** HirePilot applications on employer ATS pages, inside
your own logged-in browser session.

The backend never touches employer sites. It prepares applications and holds
them in a queue; this extension is the only component that opens a form, fills
it, and submits it — and only for applications you have approved on the review
screen.

## Install (unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this `extension/` folder
4. Click the HirePilot icon in the toolbar

## Connect

1. In HirePilot: **Settings → Integrations → Copy access token**
2. In the extension popup: paste the token, confirm the HirePilot URL, **Connect**

The token is your login session (valid 7 days). It is stored in
`chrome.storage.local` and sent only to your HirePilot instance — never to an
employer page. Treat it like your password; **Disconnect** clears it.

## Using it

1. In HirePilot, pick jobs → **Prepare application** (or select several → **Prepare N applications**)
2. Go to **Apply Queue**, open each one, check what will be submitted, **Approve**
3. In the extension popup, click **Run queue**

For each approved application the extension will:

- open the employer's form in a tab
- read the real fields and send the questions back to HirePilot, so the review
  screen shows the actual form rather than a guess
- fill your details and screening answers, and attach your resume file
- advance multi-step forms
- **pause** and hand the tab to you for anything only you can do
- submit, then capture the confirmation page and reference number
- post that evidence back to HirePilot

**Nothing is marked "Applied" without that evidence.** If the confirmation page
can't be captured, the application is recorded as failed with the reason — never
as applied.

### When it pauses

| Reason | What to do |
|---|---|
| Sign-in required | Log in on the employer site |
| MFA / one-time code | Enter the code |
| CAPTCHA | Solve it |
| Consent / certification checkbox | Tick it yourself — these are your personal attestation, so the extension never ticks them |
| A question with no saved answer | Answer it in the Apply Queue |

After you've done your part the extension notices and continues on its own. It
watches the tab for up to ~20 minutes.

If you complete and submit a form manually while it's paused, it detects the
confirmation page and records that as the submission rather than resubmitting.

### Auto-submit toggle

On by default: approving in HirePilot is the authorisation, so the extension
completes the submission.

Turn it **off** to have it fill everything and stop, leaving the final Submit
click to you on the employer's page.

## Supported ATS platforms

| Platform | Status |
|---|---|
| Greenhouse | Adapter — both the current React board and the legacy board |
| Lever | Adapter |
| Ashby | Adapter |
| Workday, SmartRecruiters, Taleo, iCIMS, SuccessFactors | Detected, no adapter — the tab opens with your materials ready and you complete it |

These three are the platforms HirePilot ingests from via their official public
APIs, so the form structure is known rather than guessed.

## What it does not do

- It does not create accounts or enter passwords.
- It does not solve CAPTCHAs or bypass bot detection.
- It does not tick consent or certification boxes.
- It does not invent an answer. If your Application Profile has no value for a
  question, the field stays empty and you are asked — a guessed
  work-authorisation or salary answer is a misrepresentation on a real
  application.
- It does not submit anything you have not approved. The backend refuses to
  mark an application `approved` while a required answer is missing, and
  refuses to let the extension execute anything that is not `approved`.

## Files

```
manifest.json              MV3 manifest
background.js              queue driver: pulls approved items, sequences tabs,
                           posts evidence, auto-resumes after a pause
content/fields.js          form primitives + pause-condition detection
content/adapters/*.js      per-ATS selectors and form location
content/runner.js          discovery, fill, submit, evidence capture
popup/                     connect screen and queue status
```

### Why the fills go through a native setter

All three boards are React apps. Assigning `input.value = x` directly updates
the DOM but not React's internal state, so the value is wiped on the next
render or submitted empty. `fields.js` writes through the property's own setter
and then dispatches the events React listens for.

The resume is attached by building a `DataTransfer` and assigning its `files`
list — the only way to populate a file input without opening a file dialog.
