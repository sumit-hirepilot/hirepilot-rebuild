/*
 * In-page drawer, injected on the employer's application form.
 *
 * The queue lives in HirePilot, but the moment that matters happens on the
 * employer's page - and until now that moment was invisible: the extension
 * filled fields silently and the only feedback was a background badge. This
 * puts the state where the work is, so you can see what was filled, what it was
 * inferred from, and what still needs you, without leaving the form.
 *
 * Rendered into a shadow root. Employer pages carry aggressive global CSS
 * (`* { box-sizing }`, `div { margin }`, resets that would wreck an injected
 * panel), and equally we must not leak styles into their form. A shadow root is
 * the only reliable isolation in both directions.
 */

window.HP = window.HP || {};

HP.drawer = (() => {
  const ID = 'hirepilot-drawer-root';
  let host = null;
  let root = null;
  let state = {
    open: true,
    tab: 'autofill',
    job: null,
    fields: [],
    ats: null,
    profile: null,
    status: 'idle',
    message: null,
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .wrap {
      position: fixed; top: 16px; right: 16px; z-index: 2147483647;
      width: 372px; max-height: calc(100vh - 32px);
      display: flex; flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px; line-height: 1.5; color: #0f172a;
      background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
      box-shadow: 0 12px 40px rgba(15,23,42,.22);
      overflow: hidden;
    }
    .wrap.collapsed { width: auto; }
    .hdr {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px; border-bottom: 1px solid #e2e8f0; background: #fff;
    }
    .logo {
      width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0;
      background: #7c3aed; color: #fff; font-weight: 700; font-size: 12px;
      display: grid; place-items: center;
    }
    .title { font-weight: 700; font-size: 13px; }
    .spacer { flex: 1; }
    .iconBtn {
      width: 26px; height: 26px; border: none; border-radius: 7px;
      background: transparent; color: #64748b; cursor: pointer; font-size: 15px;
      display: grid; place-items: center;
    }
    .iconBtn:hover { background: #f1f5f9; color: #0f172a; }

    .tabs { display: flex; gap: 2px; padding: 8px 10px 0; border-bottom: 1px solid #e2e8f0; }
    .tab {
      flex: 1; padding: 7px 6px; border: none; background: transparent;
      font: inherit; font-size: 12px; font-weight: 600; color: #64748b;
      cursor: pointer; border-bottom: 2px solid transparent;
    }
    .tab:hover { color: #0f172a; }
    .tab.on { color: #7c3aed; border-bottom-color: #7c3aed; }

    .body { padding: 14px; overflow-y: auto; flex: 1; }
    .job { font-weight: 700; font-size: 13px; }
    .co { color: #64748b; font-size: 12px; margin-top: 1px; }

    .banner {
      margin: 10px 0; padding: 9px 11px; border-radius: 9px; font-size: 12px;
      background: #f5f3ff; border: 1px solid #ddd6fe; color: #6d28d9;
    }
    .banner.warn { background: #fffbeb; border-color: #fde68a; color: #b45309; }
    .banner.ok { background: #ecfdf5; border-color: #a7f3d0; color: #047857; }

    .row { padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .row:last-child { border-bottom: none; }
    .q { font-size: 12px; font-weight: 600; }
    .a { font-size: 12px; color: #334155; margin-top: 2px; word-break: break-word; }
    .a.ask { color: #b45309; font-style: italic; }
    .meta { font-size: 10.5px; color: #94a3b8; margin-top: 2px; font-style: italic; }
    .badge {
      display: inline-block; font-size: 10px; font-weight: 700;
      padding: 1px 6px; border-radius: 999px; margin-left: 5px;
    }
    .badge.hi { background: #ecfdf5; color: #047857; }
    .badge.lo { background: #fffbeb; color: #b45309; }

    .score { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    .ring {
      width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0;
      display: grid; place-items: center; font-weight: 800; font-size: 15px;
      border: 3px solid #e2e8f0;
    }
    .ring.good { border-color: #047857; color: #047857; }
    .ring.mid { border-color: #b45309; color: #b45309; }
    .ring.bad { border-color: #b91c1c; color: #b91c1c; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .chip {
      font-size: 10.5px; padding: 2px 7px; border-radius: 999px;
      background: #f1f5f9; color: #475569;
    }
    .chip.miss { background: #fef2f2; color: #b91c1c; }

    .foot { padding: 11px 14px; border-top: 1px solid #e2e8f0; display: flex; gap: 8px; }
    .btn {
      flex: 1; padding: 9px 12px; border-radius: 9px; border: 1px solid #7c3aed;
      background: #7c3aed; color: #fff; font: inherit; font-size: 12.5px;
      font-weight: 600; cursor: pointer;
    }
    .btn:hover { background: #6d28d9; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    .btn.ghost { background: #fff; color: #475569; border-color: #e2e8f0; }
    .btn.ghost:hover { background: #f8fafc; }
    .note { font-size: 10.5px; color: #94a3b8; padding: 0 14px 11px; }
    .empty { color: #94a3b8; font-size: 12px; padding: 10px 0; }

    .fab {
      width: 46px; height: 46px; border-radius: 50%; border: none;
      background: #7c3aed; color: #fff; font-weight: 700; font-size: 15px;
      cursor: pointer; box-shadow: 0 6px 20px rgba(124,58,237,.4);
    }
  `;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.getElementById(ID);
    if (!host) {
      host = document.createElement('div');
      host.id = ID;
      document.documentElement.appendChild(host);
    }
    root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  }

  function fieldRow(f) {
    const answered = f.answer !== null && f.answer !== undefined && f.answer !== '';
    const conf = typeof f.confidence === 'number'
      ? `<span class="badge ${f.confidence >= 0.7 ? 'hi' : 'lo'}">${Math.round(f.confidence * 100)}%</span>` : '';
    const from = f.matchedQuestion
      ? `<div class="meta">reused from: “${esc(String(f.matchedQuestion).slice(0, 70))}”${f.conceptLabel ? ` · ${esc(f.conceptLabel)}` : ''}</div>`
      : '';
    const reason = !answered && f.reason ? `<div class="meta">${esc(String(f.reason).slice(0, 110))}</div>` : '';
    return `
      <div class="row">
        <div class="q">${esc(String(f.question).slice(0, 90))}${conf}</div>
        <div class="a ${answered ? '' : 'ask'}">${answered ? esc(String(f.answer).slice(0, 110)) : 'Needs your answer'}</div>
        ${from}${reason}
      </div>`;
  }

  function render() {
    ensureHost();
    if (!state.open) {
      root.innerHTML = `<style>${CSS}</style>
        <div class="wrap collapsed"><button class="fab" title="HirePilot">H</button></div>`;
      root.querySelector('.fab').onclick = () => { state.open = true; render(); };
      return;
    }

    const needing = state.fields.filter((f) => !f.answer && f.required && !f.optional);
    const filled = state.fields.filter((f) => f.answer);

    let body = '';
    if (state.tab === 'autofill') {
      const banner = state.message
        ? `<div class="banner ${state.status === 'done' ? 'ok' : state.status === 'needs_user' ? 'warn' : ''}">${esc(state.message)}</div>`
        : '';
      body = `
        <div class="job">${esc(state.job?.title || 'This application')}</div>
        <div class="co">${esc(state.job?.company || location.hostname)}</div>
        ${banner}
        ${needing.length ? `<div class="banner warn">${needing.length} question${needing.length === 1 ? '' : 's'} need${needing.length === 1 ? 's' : ''} your answer before this can be submitted.</div>` : ''}
        ${state.fields.length
    ? `${needing.map(fieldRow).join('')}${filled.map(fieldRow).join('')}`
    : '<div class="empty">No form data yet. Run the queue from HirePilot.</div>'}`;
    } else if (state.tab === 'ats') {
      if (!state.ats) {
        body = '<div class="empty">No ATS score for this posting yet.</div>';
      } else {
        const s = state.ats.score ?? 0;
        const cls = s >= 70 ? 'good' : s >= 45 ? 'mid' : 'bad';
        body = `
          <div class="score">
            <div class="ring ${cls}">${s}%</div>
            <div>
              <div class="q">Keyword coverage</div>
              <div class="meta" style="font-style:normal">${state.ats.matchedCount ?? 0} of ${state.ats.totalKeywords ?? 0} terms in this posting appear in your resume.</div>
            </div>
          </div>
          <div class="q">Missing terms</div>
          <div class="chips">${(state.ats.missing || []).slice(0, 18).map((m) => `<span class="chip miss">${esc(m)}</span>`).join('') || '<span class="empty">None</span>'}</div>
          <div class="meta" style="margin-top:8px">Only add terms that are genuinely true of your experience. This measures wording overlap, not whether you are a fit.</div>`;
      }
    } else {
      const p = state.profile || {};
      const rows = [
        ['Name', p.full_name], ['Email', p.email], ['Phone', p.phone],
        ['Location', p.current_location], ['LinkedIn', p.linkedin_url],
        ['Portfolio', p.portfolio_url], ['Notice', p.notice_period],
        ['Authorised in', (p.authorized_countries || []).join(', ')],
      ].filter(([, v]) => v);
      body = `
        ${rows.map(([k, v]) => `<div class="row"><div class="q">${esc(k)}</div><div class="a">${esc(v)}</div></div>`).join('')}
        <div class="banner">${p.savedAnswers ?? 0} saved answers · reused automatically when another employer asks the same thing differently.</div>`;
    }

    root.innerHTML = `<style>${CSS}</style>
      <div class="wrap">
        <div class="hdr">
          <span class="logo">H</span>
          <span class="title">HirePilot</span>
          <span class="spacer"></span>
          <button class="iconBtn" data-act="min" title="Minimise">–</button>
        </div>
        <div class="tabs">
          <button class="tab ${state.tab === 'autofill' ? 'on' : ''}" data-tab="autofill">Autofill</button>
          <button class="tab ${state.tab === 'ats' ? 'on' : ''}" data-tab="ats">ATS Score</button>
          <button class="tab ${state.tab === 'profile' ? 'on' : ''}" data-tab="profile">Profile</button>
        </div>
        <div class="body">${body}</div>
        <div class="foot">
          <button class="btn" data-act="fill" ${state.status === 'filling' ? 'disabled' : ''}>
            ${state.status === 'filling' ? 'Filling…' : 'Fill this form'}
          </button>
          <button class="btn ghost" data-act="open">Open in HirePilot</button>
        </div>
        <div class="note">HirePilot never clicks Submit for you — review the form and submit it yourself.</div>
      </div>`;

    root.querySelectorAll('.tab').forEach((b) => {
      b.onclick = () => { state.tab = b.dataset.tab; render(); };
    });
    root.querySelector('[data-act="min"]').onclick = () => { state.open = false; render(); };
    /*
     * Both buttons report back. A sendMessage that fails - dead service worker,
     * no matching application - previously did nothing at all, so a broken CTA
     * was indistinguishable from a dead button. Anything that can fail silently
     * on a click has to say so.
     */
    const send = (type, onFail) => {
      try {
        chrome.runtime.sendMessage({ type }, (res) => {
          if (chrome.runtime.lastError) {
            update({ status: 'needs_user', message: `HirePilot is not responding — reload the page. (${chrome.runtime.lastError.message})` });
            return;
          }
          if (res && res.ok === false) onFail(res.reason);
        });
      } catch (err) {
        update({ status: 'needs_user', message: `Could not reach HirePilot: ${err.message}` });
      }
    };

    const fill = root.querySelector('[data-act="fill"]');
    if (fill) {
      fill.onclick = () => {
        update({ status: 'filling', message: 'Filling this form…' });
        send('HP_DRAWER_FILL', (reason) => update({
          status: 'needs_user',
          message: reason === 'not approved'
            ? 'Approve this application in HirePilot first.'
            : reason === 'no matching application'
              ? 'No queued application matches this page. Prepare it in HirePilot first.'
              : `Could not fill: ${reason}`,
        }));
      };
    }
    root.querySelector('[data-act="open"]').onclick = () => send('HP_DRAWER_OPEN_APP', (r) => update({
      status: 'needs_user', message: `Could not open HirePilot: ${r}`,
    }));
  }

  function update(patch) {
    state = { ...state, ...patch };
    render();
  }

  function show(patch) {
    state.open = true;
    update(patch || {});
  }

  function destroy() {
    if (host) host.remove();
    host = null; root = null;
  }

  return { show, update, render, destroy, get state() { return state; } };
})();
