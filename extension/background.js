/*
 * Background service worker: the queue driver.
 *
 * Owns the loop between HirePilot and the employer page:
 *   pull an approved item -> open its form -> discover the real fields ->
 *   report them back for review -> once approved, fill and submit ->
 *   capture evidence -> POST it -> next item.
 *
 * Two properties are deliberate:
 *
 * 1. It never submits an item the server has not marked `approved`. The server
 *    refuses to approve while required answers are missing, so an incomplete
 *    application cannot reach a submit click.
 *
 * 2. When it pauses for the user (login/MFA/CAPTCHA/consent), it leaves the tab
 *    open and focused, then watches that tab. When the blocking condition
 *    clears it resumes on its own rather than making the user come back here.
 */

const DEFAULTS = {
  // The API and the frontend are separate Railway services on separate domains,
  // so BOTH are recorded here. This must be the API one: a shortened,
  // guessed-at variant of the app's hostname was used once and no service owns
  // it, so it answers 502 with x-railway-fallback rather than failing in a way
  // that names the mistake.
  apiBase: 'https://backend-production-e6a8.up.railway.app',
  // The app origin, stored rather than derived. It used to be worked out by
  // asking whether apiBase contained a particular deployment's hostname, which
  // meant the extension opened the right page on exactly one deployment and
  // silently fell through to a wrong guess everywhere else. Two addresses that
  // move together belong side by side.
  appBase: 'https://frontend-production-0d14b.up.railway.app',
};

/*
 * What the employer's own page has to say before anything is marked Applied.
 * Shared by the post-submit recovery path and the tab watcher so the two cannot
 * disagree about what counts as proof.
 */
const CONFIRMED_RE = /thank you for applying|application (has been )?(received|submitted|sent)|we('| ha)ve received your application|successfully (applied|submitted)/i;

const state = {
  running: false,
  currentTabId: null,
  currentApplicationId: null,
  lastError: null,
  processed: 0,
  submitted: 0,
  failed: 0,
  // Applications parked on a question the profile could not answer. Counted
  // separately from failures: nothing went wrong, the drawer is asking.
  awaitingAnswers: 0,
  pausedFor: null,
  // The server-side run these counters belong to. The UI reads the run, not
  // these - they do not survive the worker being evicted.
  runId: null,
};

/* ------------------------------------------------------------------ *
 * HirePilot API
 * ------------------------------------------------------------------ */

async function config() {
  const s = await chrome.storage.local.get(['apiBase', 'appBase', 'token']);
  return {
    apiBase: s.apiBase || DEFAULTS.apiBase,
    appBase: s.appBase || DEFAULTS.appBase,
    token: s.token || null,
  };
}

async function api(path, opts = {}) {
  const { apiBase, token } = await config();
  if (!token) throw new Error('Not connected to HirePilot - open the extension and sign in.');
  const res = await fetch(`${apiBase}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    await chrome.storage.local.remove('token');
    throw new Error('HirePilot session expired - sign in again from the extension.');
  }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    throw new Error(body?.error || `${path} failed (${res.status})`);
  }
  return body;
}

// Resume bytes for the file input. Fetched here (not in the content script) so
// the auth token never enters the employer's page context.
async function fetchResumeBytes(applicationId) {
  const { apiBase, token } = await config();
  const res = await fetch(`${apiBase}/api/apply/queue/${applicationId}/resume-file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const disp = res.headers.get('content-disposition') || '';
  const nameMatch = disp.match(/filename="?([^"]+)"?/);
  return {
    bytes: Array.from(new Uint8Array(buf)),
    filename: nameMatch ? nameMatch[1] : 'resume.pdf',
    mimetype: res.headers.get('content-type') || 'application/pdf',
  };
}

/* ------------------------------------------------------------------ *
 * Tab plumbing
 * ------------------------------------------------------------------ */

function sendToTab(tabId, message, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve({ ok: false, reason: 'Content script did not respond' }); }
    }, timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          return resolve({ ok: false, reason: chrome.runtime.lastError.message });
        }
        resolve(response || { ok: false, reason: 'Empty response' });
      });
    } catch (err) {
      if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, reason: err.message }); }
    }
  });
}

function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - started > timeoutMs) { clearInterval(poll); return resolve(false); }
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') { clearInterval(poll); return resolve(true); }
      } catch {
        clearInterval(poll);
        return resolve(false);
      }
    }, 400);
  });
}

// The files the declarative content_scripts entry lists, in the same order -
// fields.js defines HP.fields/HP.gates/HP.combobox that the adapters use, and
// runner.js registers the message bridge, so order matters.
const CONTENT_FILES = [
  'content/fields.js',
  'content/adapters/greenhouse.js',
  'content/adapters/lever.js',
  'content/adapters/ashby.js',
  'content/drawer.js',
  'content/runner.js',
];

/*
 * Injects the content script into a tab the extension itself opened.
 *
 * Needed because the declarative content_scripts entry only covers the three
 * ATS origins, and roughly a third of Greenhouse boards redirect to the
 * company's own careers domain - verified live: job-boards.greenhouse.io/okta/...
 * lands on www.okta.com/company/careers/, where the form is embedded and the
 * declarative script never runs. Programmatic injection follows the tab
 * wherever it ends up.
 *
 * Idempotent: HP_PING short-circuits when the declarative script already ran, so
 * this does not double-register the message bridge on ATS origins.
 */
async function ensureInjected(tabId) {
  const ping = await sendToTab(tabId, { type: 'HP_PING' }, 2500);
  if (ping && ping.ok) return true;

  let url;
  try { url = (await chrome.tabs.get(tabId)).url; } catch { return false; }
  let origin;
  try { origin = `${new URL(url).origin}/*`; } catch { return false; }

  // host_permissions declares <all_urls> at install, so there is nothing to
  // request here. The optional-permission route did not work: request() needs a
  // user gesture the background worker never has, and its dialog needs a real
  // click - injection just failed with "could not attach to the employer page".
  const granted = await chrome.permissions.contains({ origins: [origin] }).catch(() => true);
  if (!granted) {
    console.warn(`[HirePilot] no host permission for ${origin}`);
    return false;
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  } catch (err) {
    console.warn('[HirePilot] injection failed:', err.message);
    return false;
  }
  const after = await sendToTab(tabId, { type: 'HP_PING' }, 3000);
  return Boolean(after && after.ok);
}

// The content script needs a moment after document_idle before it answers, and
// on a non-ATS origin it has to be injected first.
async function waitForRunner(tabId, attempts = 12) {
  for (let i = 0; i < attempts; i += 1) {
    if (await ensureInjected(tabId)) return true;
    await sleep(700);
  }
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

async function runQueue() {
  if (state.running) return { alreadyRunning: true };
  state.running = true;
  state.lastError = null;
  await broadcast();

  const attempted = [];

  /*
   * Open a run so its applications can be grouped afterwards.
   *
   * The counters in `state` below are for this loop and the popup only. The
   * Auto Apply screen reads the run from the server, because these are evicted
   * with the service worker and would blank the display mid-batch.
   */
  let runId = null;
  try {
    const r = await api('/api/apply/runs', { method: 'POST', body: JSON.stringify({ source: 'extension' }) });
    runId = r?.run?.id || null;
    state.runId = runId;
  } catch (err) {
    // A run is for grouping, not for working - never block the batch on it.
    console.warn('[HirePilot] could not open a run:', err.message);
  }

  try {
    // Bounded rather than while(true): a server bug that keeps handing back the
    // same item should stop, not spin forever opening tabs.
    for (let guard = 0; guard < 100; guard += 1) {
      if (!state.running) break;

      // Ids already attempted this run. Without it, an item the server still
      // reports as runnable but which parks again immediately would be handed
      // back on every iteration until the guard trips.
      const qs = [];
      if (attempted.length) qs.push(`exclude=${attempted.join(',')}`);
      if (runId) qs.push(`runId=${runId}`);
      const { item } = await api(`/api/apply/queue/next${qs.length ? `?${qs.join('&')}` : ''}`);
      if (!item) break;
      attempted.push(item.applicationId);

      state.currentApplicationId = item.applicationId;
      state.pausedFor = null;
      await broadcast();

      /*
       * Per-item error containment.
       *
       * processOne was awaited inside the loop's own try, so an unexpected
       * throw - a network blip on a resume fetch, a tab closed mid-run, any
       * unhandled case - aborted the ENTIRE batch from that item onwards. One
       * application's bad luck silently cancelled every application behind it,
       * and the run looked like it had simply finished.
       *
       * A throw is now that application's failure and nobody else's.
       */
      let result;
      try {
        result = await processOne(item);
      } catch (err) {
        console.error(`[HirePilot] application ${item.applicationId} threw:`, err);
        await reportFailure(item.applicationId, `Unexpected error: ${err.message}`, true).catch(() => {});
        state.processed += 1;
        state.failed += 1;
        await sleep(1200);
        continue;
      }
      state.processed += 1;
      if (result.submitted) state.submitted += 1;
      else if (result.failed) state.failed += 1;

      /*
       * A pause does not necessarily stop the run.
       *
       * Something only a human can do - login, MFA, CAPTCHA, a permission
       * prompt, a consent tick - owns the screen, so carrying on would bury the
       * tab that needs attention. That still stops the loop, and the tab watcher
       * resumes it and the rest of the queue once the user is done.
       *
       * An unanswered question does not own the screen. The drawer is asking on
       * that tab and will keep asking; stopping the whole run for it means one
       * unknown question on job three blocks the seven behind it, which for a
       * ten-job batch is the difference between one click and ten.
       */
      if (result.paused && !result.awaitingAnswer) break;
      if (result.awaitingAnswer) {
        state.awaitingAnswers += 1;
        console.log(`[HirePilot] application ${item.applicationId} is waiting on an answer - continuing with the rest of the queue`);
      }

      await sleep(1200);
    }
  } catch (err) {
    state.lastError = err.message;
    console.error('[HirePilot] queue error:', err);
  } finally {
    state.running = false;
    state.currentApplicationId = null;
    if (runId) {
      await api(`/api/apply/runs/${runId}/end`, { method: 'POST' }).catch(() => {});
    }
    await broadcast();
  }
  return { done: true, runId, ...counters() };
}

async function processOne(item) {
  const url = item.targetFormUrl;
  if (!url) {
    await reportFailure(item.applicationId, 'No application URL on this posting', false);
    return { failed: true };
  }

  if (!item.automationSupported) {
    // Open it for the user rather than pretending to handle it. Nothing is
    // marked applied - the tracker keeps it as needs_user.
    await chrome.tabs.create({ url, active: true });
    await pause(item.applicationId, 'login', `${item.atsPlatform || 'This ATS'} has no automation adapter - complete it in the tab that just opened.`);
    return { paused: true };
  }

  const tab = await chrome.tabs.create({ url, active: true });
  state.currentTabId = tab.id;
  await waitForTabLoad(tab.id);

  if (!(await waitForRunner(tab.id))) {
    await reportFailure(item.applicationId, 'HirePilot could not attach to the employer page', true);
    return { failed: true };
  }

  // --- Discovery: read the real form -----------------------------------
  let discovery = await sendToTab(tab.id, { type: 'HP_DISCOVER', atsPlatform: item.atsPlatform });

  // Lever navigates from posting -> /apply; re-attach after that load.
  if (discovery && discovery.navigating) {
    await sleep(2500);
    await waitForTabLoad(tab.id);
    // A navigation tears down the injected script, so re-inject before retrying.
    await waitForRunner(tab.id);
    discovery = await sendToTab(tab.id, { type: 'HP_DISCOVER', atsPlatform: item.atsPlatform });
  }

  if (!discovery || !discovery.ok) {
    await reportFailure(item.applicationId, `Could not read the application form: ${discovery?.reason || 'unknown'}`, true);
    return { failed: true };
  }

  if (discovery.gate && discovery.gate.paused) {
    await pause(item.applicationId, discovery.gate.reason, discovery.gate.detail);
    watchTabForResume(tab.id, item.applicationId);
    return { paused: true };
  }

  // Report the real questions so the review screen shows the actual form, then
  // re-read the item to pick up the server's pre-filled answers.
  const filledQs = await api(`/api/apply/queue/${item.applicationId}/questions`, {
    method: 'PATCH',
    body: JSON.stringify({ questions: discovery.questions || [] }),
  });

  // --- Approval gate ----------------------------------------------------
  // Discovery may have surfaced questions the profile cannot answer. In that
  // case the item goes back for review instead of being executed.
  if (filledQs.summary && !filledQs.summary.readyWithoutInput) {
    // Ask in the drawer, on the page the user is already looking at, rather than
    // only parking it on the review screen. Answering here writes to the profile,
    // so the same question never blocks another application again.
    const blocking = new Set(filledQs.summary.blockingQuestions);
    sendToTab(tab.id, {
      type: 'HP_DRAWER_STATE',
      payload: {
        job: item.job || null,
        status: 'asking',
        ask: (filledQs.questions || [])
          .filter((q) => blocking.has(q.question))
          .map((q) => ({
            question: q.question,
            type: q.type || 'text',
            options: q.options || null,
            required: q.required !== false,
            optional: Boolean(q.optional),
            suggestion: q.suggestion || null,
            confidence: q.confidence || null,
            matchedQuestion: q.matchedQuestion || null,
            reason: q.reason || 'Not in your profile yet.',
          })),
        message: `${blocking.size} question${blocking.size === 1 ? '' : 's'} on this form ${blocking.size === 1 ? 'is' : 'are'} not in your profile yet. Answer ${blocking.size === 1 ? 'it' : 'them'} once and HirePilot will reuse ${blocking.size === 1 ? 'it' : 'them'} everywhere.`,
      },
    }, 5000);

    await pause(
      item.applicationId,
      'unmapped_required_field',
      `Needs your answer: ${filledQs.summary.blockingQuestions.slice(0, 3).join(' | ')}`
    );
    watchTabForResume(tab.id, item.applicationId);
    // Same rule as the mid-fill pause: the drawer is asking on this tab, so the
    // rest of the batch carries on rather than queueing behind one question.
    return { paused: true, awaitingAnswer: true };
  }

  const fresh = await api(`/api/apply/queue/${item.applicationId}`);
  const payload = fresh.item;

  /*
   * Nothing waits on a human here. Discovery has just re-resolved this form
   * against the profile, and the server promoted it to `approved` if everything
   * required is answered - so anything still short of that is short of an
   * ANSWER, not of a signature.
   *
   * The tab stays open when that happens, because the drawer is on it asking
   * the question; closing it was correct when the answer belonged on a review
   * screen and is exactly wrong now.
   */
  if (payload.status !== 'approved') {
    return { paused: true, awaitingAnswer: true };
  }

  await api(`/api/apply/queue/${item.applicationId}/start`, { method: 'POST' });

  // --- Execute ----------------------------------------------------------
  const resumeFile = await fetchResumeBytes(item.applicationId);
  const settings = await chrome.storage.local.get(['autoSubmit']);

  // Give the drawer everything it needs for its three tabs before filling
  // starts, so the user can see the context rather than a blank panel.
  const profile = await api('/api/apply/profile').catch(() => null);
  sendToTab(tab.id, {
    type: 'HP_DRAWER_STATE',
    payload: {
      job: payload.job,
      fields: [...(payload.standardFields || []), ...(payload.screeningQuestions || [])],
      ats: payload.resume ? {
        score: payload.resume.atsScore,
        matchedCount: payload.resume.matchedCount,
        totalKeywords: payload.resume.totalKeywords,
        missing: payload.resume.missing,
      } : null,
      profile: profile && profile.profile
        ? { ...profile.profile, savedAnswers: Object.keys(profile.profile.custom_answers || {}).length }
        : null,
      status: 'filling',
    },
  }, 5000);

  const exec = await sendToTab(tab.id, {
    type: 'HP_EXECUTE',
    payload: {
      atsPlatform: payload.atsPlatform,
      standardFields: payload.standardFields || [],
      screeningQuestions: payload.screeningQuestions || [],
      coverLetter: payload.coverLetter,
      resumeFile,
      // Approval on the review screen is the authorisation to submit, so this
      // defaults on. Users who want to eyeball the filled form on the employer
      // site before the click can turn it off in the popup.
      autoSubmit: settings.autoSubmit !== false,
    },
  }, 120000);

  if (exec && exec.paused) {
    const reason = normalizePauseReason(exec.reason);
    await pause(item.applicationId, reason, exec.detail);
    watchTabForResume(tab.id, item.applicationId);
    /*
     * An unanswered question stops THIS application, not the batch.
     *
     * The distinction was already made for the pre-execute path but not here,
     * and this is the path that actually fires: a saved answer that is not on a
     * particular form's option list parks the item mid-fill. One Checkr form
     * whose Country list did not contain the saved value halted the seven jobs
     * behind it.
     */
    return { paused: true, awaitingAnswer: reason === 'unmapped_required_field' };
  }

  /*
   * A silent responder is not a failure - it is usually a success.
   *
   * Clicking Submit navigates the page, which tears down the content script
   * before it can answer, so sendToTab resolves with "Content script did not
   * respond". Treating that as a failure recorded a REAL Scale AI submission -
   * confirmation page and all - as `failed` with no reason. Ask the page what
   * happened before concluding anything: if it is showing a confirmation, the
   * application went out and the evidence is right there.
   */
  if (!exec || !exec.ok) {
    await waitForTabLoad(tab.id, 15000);
    const recovered = await waitForRunner(tab.id, 6)
      ? await sendToTab(tab.id, { type: 'HP_CAPTURE' }, 8000)
      : null;

    if (recovered && recovered.ok && recovered.evidence
        && CONFIRMED_RE.test(recovered.evidence.confirmationText || '')) {
      console.log(`[HirePilot] application ${item.applicationId} submitted - recovered evidence after the page navigated away`);
      return finalize(item.applicationId, recovered.evidence, tab.id);
    }

    await reportFailure(item.applicationId, exec?.reason || 'Execution failed', true);
    return { failed: true };
  }

  if (exec.awaitingUserSubmit) {
    await pause(item.applicationId, 'final_submit', 'Form is filled - review it and click Submit on the employer page.');
    watchTabForResume(tab.id, item.applicationId);
    return { paused: true };
  }

  // --- Evidence ---------------------------------------------------------
  return finalize(item.applicationId, exec.evidence, tab.id);
}

async function finalize(applicationId, evidence, tabId) {
  if (!evidence) {
    await reportFailure(applicationId, 'Submitted but no confirmation page was captured', true);
    return { failed: true };
  }
  try {
    const res = await api(`/api/apply/queue/${applicationId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        confirmationId: evidence.confirmationId,
        confirmationText: evidence.confirmationText,
        finalUrl: evidence.finalUrl,
        submittedAt: evidence.capturedAt,
      }),
    });
    if (res.verified) {
      await chrome.tabs.remove(tabId).catch(() => {});
      notify('Application submitted', `Verified${res.application?.employer_confirmation_id ? ` - ref ${res.application.employer_confirmation_id}` : ''}`);
      return { submitted: true };
    }
    return { failed: true };
  } catch (err) {
    // A 422 from the evidence endpoint means the server refused to call it
    // submitted. The tab stays open so the user can see what actually happened.
    state.lastError = err.message;
    return { failed: true };
  }
}

function normalizePauseReason(reason) {
  const known = ['login', 'mfa', 'captcha', 'consent', 'final_submit', 'unmapped_required_field'];
  return known.includes(reason) ? reason : 'unmapped_required_field';
}

async function pause(applicationId, reason, detail) {
  state.pausedFor = { applicationId, reason, detail };
  await api(`/api/apply/queue/${applicationId}/pause`, {
    method: 'POST',
    body: JSON.stringify({ reason, detail }),
  }).catch((e) => console.warn('pause report failed:', e.message));
  notify(pauseTitle(reason), detail || 'HirePilot needs you on the employer page.');
  await broadcast();
}

function pauseTitle(reason) {
  return {
    login: 'Sign-in needed',
    mfa: 'Verification code needed',
    captcha: 'CAPTCHA needs you',
    consent: 'Consent checkbox needs you',
    final_submit: 'Ready to submit',
    unmapped_required_field: 'A question needs your answer',
  }[reason] || 'Your input is needed';
}

async function reportFailure(applicationId, reason, retryable) {
  state.lastError = reason;
  await api(`/api/apply/queue/${applicationId}/failure`, {
    method: 'POST',
    body: JSON.stringify({ reason, retryable }),
  }).catch((e) => console.warn('failure report failed:', e.message));
  await broadcast();
}

/* ------------------------------------------------------------------ *
 * Auto-resume after the user does their part
 * ------------------------------------------------------------------ */

// Polls the paused tab. Once the blocking gate is gone, picks the application
// back up automatically - the user completing a CAPTCHA should not require
// them to come back and press anything here.
function watchTabForResume(tabId, applicationId) {
  let ticks = 0;
  const timer = setInterval(async () => {
    ticks += 1;
    if (ticks > 240) { clearInterval(timer); return; } // ~20 min

    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { clearInterval(timer); return; }
    if (!tab || tab.status !== 'complete') return;

    const ping = await sendToTab(tabId, { type: 'HP_PING' }, 2500);
    if (!ping || !ping.ok) return;

    // If the page already shows a confirmation, the user submitted it manually
    // - capture that as the evidence rather than trying to submit again.
    const cap = await sendToTab(tabId, { type: 'HP_CAPTURE' }, 5000);
    if (cap && cap.ok && cap.evidence) {
      const t = cap.evidence.confirmationText || '';
      if (CONFIRMED_RE.test(t)) {
        clearInterval(timer);
        await finalize(applicationId, cap.evidence, tabId);
        if (state.running === false) runQueue();
        return;
      }
    }

    const disc = await sendToTab(tabId, { type: 'HP_DISCOVER' }, 8000);
    if (disc && disc.ok && (!disc.gate || !disc.gate.paused)) {
      clearInterval(timer);
      // Gate cleared. Re-approve is still required for a fresh submit, so hand
      // it back to the loop, which re-reads status from the server.
      state.pausedFor = null;
      await broadcast();
      if (!state.running) runQueue();
    }
  }, 5000);
}

/* ------------------------------------------------------------------ *
 * Popup messaging
 * ------------------------------------------------------------------ */

function counters() {
  return {
    processed: state.processed,
    submitted: state.submitted,
    failed: state.failed,
    awaitingAnswers: state.awaitingAnswers,
    running: state.running,
    pausedFor: state.pausedFor,
    lastError: state.lastError,
    currentApplicationId: state.currentApplicationId,
  };
}

async function broadcast() {
  chrome.runtime.sendMessage({ type: 'HP_STATE', state: counters() }).catch(() => {});
}

function notify(title, message) {
  // Notifications permission is optional; fall back to the badge so the user
  // still gets a signal.
  chrome.action.setBadgeText({ text: '!' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#7C3AED' }).catch(() => {});
  console.log(`[HirePilot] ${title}: ${message}`);
}

/**
 * Which queued application, if any, belongs to the page in this tab.
 *
 * Matched on pathname rather than the whole URL: boards routinely append
 * tracking and source parameters, and Greenhouse serves the same posting from
 * both job-boards.greenhouse.io and the company's own careers host.
 */
async function applicationForTab(tabId, url) {
  if (state.currentApplicationId && state.currentTabId === tabId) {
    return state.currentApplicationId;
  }
  const q = await api('/api/apply/queue').catch(() => null);
  const hit = (q?.queue || []).find((it) => {
    try { return new URL(it.target_form_url).pathname === new URL(url || '').pathname; }
    catch { return false; }
  });
  return hit?.id || null;
}

// What the drawer shows for an application it has not started filling yet.
function idleDrawerState(status) {
  if (status === 'approved') {
    return { status: 'ready', message: 'Approved and ready. Click "Fill this form" to fill it here.' };
  }
  if (status === 'ready_for_review') {
    return { status: 'needs_user', message: 'Review what will be sent in HirePilot, then come back and fill.' };
  }
  if (status === 'submitted') {
    return { status: 'done', message: 'Already submitted. Nothing left to do on this page.' };
  }
  if (status === 'needs_user') {
    return { status: 'needs_user', message: 'Paused - this one needs something from you in HirePilot.' };
  }
  return { status: 'needs_user', message: `This application is ${status}.` };
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    try {
      switch (msg.type) {
        /*
         * Sent by every content script the moment it loads on a supported job
         * page. Without it the drawer only ever appeared part-way through a run,
         * so landing on a posting directly - which is how people actually browse
         * jobs - showed nothing at all, and there was no way to reach "Fill this
         * form" except by starting the whole queue.
         *
         * Stays silent when no queued application matches, rather than putting a
         * panel on every job page the user opens.
         */
        case 'HP_PAGE_CONTEXT': {
          const tabId = _sender?.tab?.id;
          const { token } = await config();
          if (!tabId || !token) return respond({ ok: false, reason: 'not connected' });

          const appId = await applicationForTab(tabId, _sender.tab.url);
          if (!appId) return respond({ ok: false, reason: 'no matching application' });

          /*
           * Read the LIVE form before answering.
           *
           * This served whatever screening_answers happened to hold, which is
           * whatever the last run stored - so a form whose questions have since
           * been re-grouped, or that was never discovered properly, showed
           * stale questions with no options and rendered them as free-text
           * boxes. Opening the page is how someone checks a fix, and that path
           * never re-read the form.
           *
           * Discovery + PATCH refreshes the stored questions to match what is
           * actually on screen, then the payload is built from that. Best
           * effort: if discovery fails the stored copy is still shown, which is
           * worse than fresh but better than nothing.
           */
          let discovery = await sendToTab(tabId, { type: 'HP_DISCOVER' }, 30000).catch(() => null);
          if (discovery && discovery.navigating) {
            await sleep(2000);
            await waitForTabLoad(tabId);
            await waitForRunner(tabId);
            discovery = await sendToTab(tabId, { type: 'HP_DISCOVER' }, 30000).catch(() => null);
          }
          if (discovery && discovery.ok && (discovery.questions || []).length) {
            await api(`/api/apply/queue/${appId}/questions`, {
              method: 'PATCH',
              body: JSON.stringify({ questions: discovery.questions }),
            }).catch(() => null);
          }

          const fresh = await api(`/api/apply/queue/${appId}`).catch(() => null);
          const item = fresh?.item;
          if (!item) return respond({ ok: false, reason: 'could not load application' });

          const profile = await api('/api/apply/profile').catch(() => null);
          const submitPref = await chrome.storage.local.get(['autoSubmit']);

          /*
           * Unanswered required questions become an ASK list, not just rows in
           * a read-only summary.
           *
           * The drawer only rendered inputs when a live run pushed
           * status:'asking'. Land on a parked application afterwards - which is
           * exactly when someone sits down to clear blockers - and it showed
           * "16 questions need your answer" with no way to answer any of them.
           * Their options are carried through so a fixed-choice question is a
           * dropdown rather than a free-text box inviting a value the form will
           * reject.
           */
          const unanswered = (item.screeningQuestions || []).filter((q) => (
            q.required && !q.optional
            && (q.answer === null || q.answer === undefined || q.answer === '')
          ));

          return respond({
            ok: true,
            payload: {
              job: item.job,
              ask: unanswered.length ? unanswered.map((q) => ({
                question: q.question,
                type: q.type || 'text',
                options: q.options || null,
                required: true,
                optional: false,
                suggestion: q.suggestion || null,
                confidence: q.confidence || null,
                matchedQuestion: q.matchedQuestion || null,
                reason: q.reason || 'Not in your profile yet.',
              })) : null,
              fields: [...(item.standardFields || []), ...(item.screeningQuestions || [])],
              ats: item.resume ? {
                score: item.resume.atsScore,
                matchedCount: item.resume.matchedCount,
                totalKeywords: item.resume.totalKeywords,
                missing: item.resume.missing,
              } : null,
              profile: profile && profile.profile
                ? { ...profile.profile, savedAnswers: Object.keys(profile.profile.custom_answers || {}).length }
                : null,
              ...idleDrawerState(item.status),
              // The drawer must state what will happen, not a fixed sentence.
              // Its footer claimed HirePilot never clicks Submit while the code
              // defaulted to clicking it - the UI said the opposite of the
              // behaviour, so there was no way to know which was true.
              autoSubmit: submitPref.autoSubmit !== false,
              // An ask list outranks the idle message: there is something to do.
              ...(unanswered.length ? { status: 'asking' } : {}),
            },
          });
        }
        /*
         * From the in-page drawer. "Fill this form" must fill the form the user
         * is looking at - it previously called runQueue(), which restarts the
         * whole queue and may well open a different job in a new tab, doing
         * nothing to the page the button lives on.
         *
         * Resolves the application bound to THIS tab and executes it here.
         */
        case 'HP_DRAWER_FILL': {
          const tabId = _sender?.tab?.id;
          if (!tabId) return respond({ ok: false, reason: 'no tab' });

          // The tab may have been opened outside a run (or the worker restarted
          // and lost its state), so fall back to matching the queue by URL.
          const appId = await applicationForTab(tabId, _sender.tab.url);
          if (!appId) {
            sendToTab(tabId, { type: 'HP_DRAWER_STATE', payload: {
              status: 'needs_user',
              message: 'No queued application matches this page. Prepare it in HirePilot first.',
            } }, 4000);
            return respond({ ok: false, reason: 'no matching application' });
          }

          /*
           * Read the form BEFORE filling it.
           *
           * This used to execute straight from the prepared payload, which is
           * built from the posting rather than the page - so it filled the text
           * inputs, missed every dropdown, and reported seven questions as
           * unanswerable that the profile could in fact answer, purely because
           * the live wording differed from the prepared one. Discovery sends the
           * real questions, with their real options, to be re-resolved.
           */
          let discovery = await sendToTab(tabId, { type: 'HP_DISCOVER' }, 30000).catch(() => null);
          if (discovery && discovery.navigating) {
            await sleep(2500);
            await waitForTabLoad(tabId);
            await waitForRunner(tabId);
            discovery = await sendToTab(tabId, { type: 'HP_DISCOVER' }, 30000).catch(() => null);
          }
          if (discovery && discovery.ok) {
            // The server re-resolves against the profile and, if nothing is
            // missing, promotes this to `approved` on its own. No one approves.
            await api(`/api/apply/queue/${appId}/questions`, {
              method: 'PATCH',
              body: JSON.stringify({ questions: discovery.questions || [] }),
            }).catch(() => null);
          }

          const fresh = await api(`/api/apply/queue/${appId}`).catch(() => null);
          const payload = fresh?.item;
          if (!payload) return respond({ ok: false, reason: 'could not load application' });

          // Not ready means an unanswered question, never a missing signature.
          // Hand those to the drawer to ask here rather than sending the user off.
          /*
           * The whitelist applies here too.
           *
           * The queue-run path checks item.automationSupported before executing
           * (processOne, above). This one did not - it only checked that the
           * server had marked the application ready. So a user sitting on a
           * posting whose adapter has never been verified could press "Fill this
           * form" and submit through it, even while the queue refused to touch
           * the same application. Server-side blocking with a second, ungated
           * entry point is not blocking.
           *
           * activeAdapter() resolves from the page, not from the server, so the
           * adapter existing is exactly what makes this reachable.
           */
          if (!payload.automationSupported) {
            sendToTab(tabId, { type: 'HP_DRAWER_STATE', payload: {
              job: payload.job,
              status: 'needs_user',
              message: `HirePilot does not fill ${payload.atsPlatform || 'this'} forms yet — its adapter has not been verified against a live form. Fill this one yourself.`,
            } }, 4000);
            return respond({ ok: false, reason: 'adapter not verified' });
          }

          if (payload.status !== 'approved') {
            const blocking = (payload.screeningQuestions || [])
              .filter((q) => q.required && !q.optional && (q.answer === null || q.answer === undefined || q.answer === ''));
            sendToTab(tabId, { type: 'HP_DRAWER_STATE', payload: {
              job: payload.job,
              status: 'asking',
              ask: blocking.map((q) => ({
                question: q.question,
                type: q.type || 'text',
                options: q.options || null,
                required: true,
                optional: false,
                suggestion: q.suggestion || null,
                confidence: q.confidence || null,
                matchedQuestion: q.matchedQuestion || null,
                reason: q.reason || 'Not in your profile yet.',
              })),
              message: blocking.length
                ? `${blocking.length} question${blocking.length === 1 ? '' : 's'} on this form ${blocking.length === 1 ? 'is' : 'are'} not in your profile yet. Answer ${blocking.length === 1 ? 'it' : 'them'} once and HirePilot will reuse ${blocking.length === 1 ? 'it' : 'them'} everywhere.`
                : 'This application is not ready to run yet.',
            } }, 4000);
            return respond({ ok: false, reason: 'needs an answer' });
          }

          const resumeFile = await fetchResumeBytes(appId);
          const settings = await chrome.storage.local.get(['autoSubmit']);
          sendToTab(tabId, {
            type: 'HP_EXECUTE',
            payload: {
              atsPlatform: payload.atsPlatform,
              standardFields: payload.standardFields || [],
              screeningQuestions: payload.screeningQuestions || [],
              coverLetter: payload.coverLetter,
              resumeFile,
              autoSubmit: settings.autoSubmit !== false,
            },
          }, 120000).then((r) => {
            if (r && r.paused) {
              pause(appId, normalizePauseReason(r.reason), r.detail);
            } else if (r && r.submitted && r.evidence) {
              finalize(appId, r.evidence, tabId);
            }
          });
          return respond({ ok: true, started: true, applicationId: appId });
        }
        /*
         * The user answered questions in the drawer that their profile could not.
         *
         * Writes straight to the Application Profile - the extension keeps no
         * answers of its own. That is what makes the next form, on any ATS and
         * on any device, resolve the same question without asking: it is the
         * profile that learned, not this browser.
         */
        case 'HP_SET_SUBMIT': {
          await chrome.storage.local.set({ autoSubmit: Boolean(msg.value) });
          return respond({ ok: true, autoSubmit: Boolean(msg.value) });
        }
        case 'HP_SAVE_ANSWERS': {
          const answers = Array.isArray(msg.answers) ? msg.answers : [];
          if (!answers.length) return respond({ ok: false, reason: 'no answers supplied' });
          const r = await api('/api/apply/profile/answers', {
            method: 'POST',
            body: JSON.stringify({ answers }),
          });
          return respond({ ok: true, saved: r.saved, totalSavedAnswers: r.totalSavedAnswers });
        }
        case 'HP_DRAWER_OPEN_APP': {
          const { appBase } = await config();
          // The app origin is configured, not sniffed out of the API's
          // hostname. The previous version asked whether apiBase contained one
          // particular deployment's name, so it opened the right page on that
          // deployment and guessed - wrongly - on every other one.
          await chrome.tabs.create({ url: `${appBase}/apply-queue` });
          return respond({ ok: true });
        }
        case 'HP_GET_STATE': {
          const { apiBase, token } = await config();
          const s = await chrome.storage.local.get(['autoSubmit']);
          return respond({
            ...counters(),
            connected: Boolean(token),
            apiBase,
            autoSubmit: s.autoSubmit !== false,
          });
        }
        case 'HP_SET_TOKEN':
          await chrome.storage.local.set({
            token: msg.token,
            ...(msg.apiBase ? { apiBase: msg.apiBase } : {}),
          });
          return respond({ ok: true });
        case 'HP_SET_AUTOSUBMIT':
          await chrome.storage.local.set({ autoSubmit: Boolean(msg.value) });
          return respond({ ok: true });
        case 'HP_DISCONNECT':
          await chrome.storage.local.remove('token');
          return respond({ ok: true });
        case 'HP_RUN':
          runQueue();
          return respond({ ok: true, started: true });
        case 'HP_STOP':
          state.running = false;
          return respond({ ok: true });
        case 'HP_QUEUE': {
          const q = await api('/api/apply/queue');
          return respond({ ok: true, ...q });
        }
        default:
          return respond({ ok: false, reason: `Unknown ${msg.type}` });
      }
    } catch (err) {
      return respond({ ok: false, reason: err.message });
    }
  })();
  return true;
});

console.log('[HirePilot] background worker ready');
