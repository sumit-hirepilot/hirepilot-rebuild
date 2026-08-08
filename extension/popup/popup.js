/* Popup: connect, show queue state, start/stop the run. */

const $ = (id) => document.getElementById(id);

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, reason: 'no response' }));
  });
}

const PAUSE_TITLES = {
  login: 'Sign-in needed',
  mfa: 'Verification code needed',
  captcha: 'CAPTCHA needs you',
  consent: 'Consent checkbox needs you',
  final_submit: 'Ready for your Submit click',
  unmapped_required_field: 'A question needs your answer',
};

async function refresh() {
  const s = await send({ type: 'HP_GET_STATE' });

  if (!s.connected) {
    $('connectView').classList.remove('hidden');
    $('mainView').classList.add('hidden');
    $('conn').textContent = 'Not connected';
    $('conn').className = 'pill pill-off';
    if (s.apiBase) $('apiBase').value = s.apiBase;
    return;
  }

  $('connectView').classList.add('hidden');
  $('mainView').classList.remove('hidden');
  $('conn').textContent = 'Connected';
  $('conn').className = 'pill pill-on';

  $('sSubmitted').textContent = s.submitted || 0;
  $('sFailed').textContent = s.failed || 0;
  $('autoSubmit').checked = s.autoSubmit !== false;
  $('mainErr').textContent = s.lastError || '';

  $('runBtn').classList.toggle('hidden', Boolean(s.running));
  $('stopBtn').classList.toggle('hidden', !s.running);

  if (s.pausedFor) {
    $('pauseBox').classList.remove('hidden');
    $('pauseTitle').textContent = PAUSE_TITLES[s.pausedFor.reason] || 'Your input is needed';
    $('pauseDetail').textContent = s.pausedFor.detail || '';
  } else {
    $('pauseBox').classList.add('hidden');
  }

  const q = await send({ type: 'HP_QUEUE' });
  const list = $('queueList');
  if (!q.ok) {
    list.innerHTML = `<p class="empty">${escapeHtml(q.reason || 'Could not load queue')}</p>`;
    $('sQueued').textContent = '0';
    return;
  }
  const items = q.queue || [];
  $('sQueued').textContent = items.length;

  if (!items.length) {
    list.innerHTML = '<p class="empty">Nothing queued. Select jobs in HirePilot to build a queue.</p>';
    return;
  }

  list.innerHTML = items.map((it) => `
    <div class="qitem">
      <div class="qitem-main">
        <div class="qitem-title">${escapeHtml(it.title || 'Untitled role')}</div>
        <div class="qitem-co">${escapeHtml(it.company_name || '')}${
          it.automationSupported ? '' : ' &middot; manual'
        }</div>
      </div>
      <span class="qstatus s-${escapeHtml(it.status)}">${escapeHtml(label(it.status))}</span>
    </div>
  `).join('');
}

function label(status) {
  return {
    ready_for_review: 'review',
    approved: 'approved',
    submitting: 'running',
    needs_user: 'needs you',
    submitted: 'submitted',
    failed: 'failed',
  }[status] || status;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

$('connectBtn').addEventListener('click', async () => {
  const token = $('token').value.trim();
  const apiBase = $('apiBase').value.trim() || undefined;
  if (!token) { $('connectErr').textContent = 'Paste your access token first.'; return; }
  $('connectErr').textContent = '';
  await send({ type: 'HP_SET_TOKEN', token, apiBase });
  const q = await send({ type: 'HP_QUEUE' });
  if (!q.ok) {
    $('connectErr').textContent = q.reason || 'Could not reach HirePilot with that token.';
    await send({ type: 'HP_DISCONNECT' });
    return;
  }
  refresh();
});

/*
 * Feature 13 (E3) — one-click capture. Renders exactly what the server said:
 * the added job with its score (or "Not scored yet" - never 0%), or the
 * refusal in the server's own words with the app's paste box as the next
 * step. Text via textContent throughout; a job title is untrusted input.
 */
$('captureBtn').addEventListener('click', async () => {
  const out = $('captureResult');
  $('captureBtn').disabled = true;
  out.textContent = 'Reading this page…';
  try {
    const r = await send({ type: 'HP_CAPTURE_TAB' });
    out.textContent = '';
    if (r.ok) {
      const company = r.job.companyStated ? r.job.company_name : 'company not stated';
      const scoreText = r.score !== null && r.score !== undefined
        ? `scored ${Math.round(Number(r.score) * 100)}%` : 'not scored yet';
      out.textContent = r.alreadyHad
        ? `Already in your list: ${r.job.title} (${company}).`
        : `Added: ${r.job.title} (${company}) — ${scoreText}.`;
    } else {
      out.textContent = r.detail || 'Could not add this page.';
      if (r.reason === 'refused' && r.appBase) {
        const a = document.createElement('a');
        a.href = `${r.appBase}/jobs`;
        a.target = '_blank';
        a.textContent = ' Paste it in HirePilot instead.';
        out.appendChild(a);
      }
    }
  } finally {
    $('captureBtn').disabled = false;
  }
});

$('runBtn').addEventListener('click', async () => { await send({ type: 'HP_RUN' }); refresh(); });
$('stopBtn').addEventListener('click', async () => { await send({ type: 'HP_STOP' }); refresh(); });
$('disconnectBtn').addEventListener('click', async () => {
  await send({ type: 'HP_DISCONNECT' });
  refresh();
});
$('autoSubmit').addEventListener('change', (e) => {
  send({ type: 'HP_SET_AUTOSUBMIT', value: e.target.checked });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'HP_STATE') refresh();
});

refresh();
setInterval(refresh, 4000);
