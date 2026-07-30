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
  apiBase: 'https://hirepilot-production.up.railway.app',
};

const state = {
  running: false,
  currentTabId: null,
  currentApplicationId: null,
  lastError: null,
  processed: 0,
  submitted: 0,
  failed: 0,
  pausedFor: null,
};

/* ------------------------------------------------------------------ *
 * HirePilot API
 * ------------------------------------------------------------------ */

async function config() {
  const s = await chrome.storage.local.get(['apiBase', 'token']);
  return { apiBase: s.apiBase || DEFAULTS.apiBase, token: s.token || null };
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

  const granted = await chrome.permissions.contains({ origins: [origin] }).catch(() => false);
  if (!granted) {
    // request() must be user-gesture-initiated, which a background poll is not.
    // Surface it rather than failing silently with "could not attach".
    const ok = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    if (!ok) {
      console.warn(`[HirePilot] no host permission for ${origin}`);
      return false;
    }
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

  try {
    // Bounded rather than while(true): a server bug that keeps handing back the
    // same item should stop, not spin forever opening tabs.
    for (let guard = 0; guard < 100; guard += 1) {
      if (!state.running) break;

      const { item } = await api('/api/apply/queue/next');
      if (!item) break;

      state.currentApplicationId = item.applicationId;
      state.pausedFor = null;
      await broadcast();

      const result = await processOne(item);
      state.processed += 1;
      if (result.submitted) state.submitted += 1;
      else if (result.failed) state.failed += 1;

      // A paused item stays at the front of the queue; stop the loop and let
      // the tab watcher resume it once the user has done their part. Carrying
      // on would bury the tab that needs their attention.
      if (result.paused) break;

      await sleep(1200);
    }
  } catch (err) {
    state.lastError = err.message;
    console.error('[HirePilot] queue error:', err);
  } finally {
    state.running = false;
    state.currentApplicationId = null;
    await broadcast();
  }
  return { done: true, ...counters() };
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
    await pause(
      item.applicationId,
      'unmapped_required_field',
      `Needs your answer: ${filledQs.summary.blockingQuestions.slice(0, 3).join(' | ')}`
    );
    return { paused: true };
  }

  const fresh = await api(`/api/apply/queue/${item.applicationId}`);
  const payload = fresh.item;

  if (payload.status !== 'approved') {
    // The user has not approved this one yet - leave it for the review screen.
    await chrome.tabs.remove(tab.id).catch(() => {});
    return { paused: true, awaitingApproval: true };
  }

  await api(`/api/apply/queue/${item.applicationId}/start`, { method: 'POST' });

  // --- Execute ----------------------------------------------------------
  const resumeFile = await fetchResumeBytes(item.applicationId);
  const settings = await chrome.storage.local.get(['autoSubmit']);

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
    await pause(item.applicationId, normalizePauseReason(exec.reason), exec.detail);
    watchTabForResume(tab.id, item.applicationId);
    return { paused: true };
  }

  if (!exec || !exec.ok) {
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
      if (/thank you for applying|application (has been )?(received|submitted|sent)|we('| ha)ve received your application|successfully (applied|submitted)/i.test(t)) {
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

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    try {
      switch (msg.type) {
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
