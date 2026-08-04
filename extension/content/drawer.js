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
    // Whether the runner will click Submit. Shown and controlled here, because
    // the one thing a person needs to know before pressing Fill is whether it
    // stops at a filled form or sends the application.
    autoSubmit: true,
    // Questions the profile could not answer, put back to the user. Cleared the
    // moment they are saved - a stale ask list would re-prompt for answers the
    // profile already has.
    ask: null,
  };

  const CSS = `
    /*
     * A shadow root blocks the page's selectors, but NOT inheritance. Inherited
     * properties flow in through the host element, and per spec an outer-tree
     * rule targeting the host beats :host from inside - so a page rule setting
     * letter-spacing on div reached this panel and spaced out every word. Caught
     * by rendering against a deliberately hostile stylesheet.
     *
     * :host is still reset, but the real defence is re-declaring every
     * inheritable property on .wrap, where nothing outside can outrank it.
     */
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .wrap {
      position: fixed; top: 16px; right: 16px; z-index: 2147483647;
      width: 372px; max-height: calc(100vh - 32px);
      display: flex; flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px; line-height: 1.5; color: #0f172a;
      /* Inheritable properties the host page can otherwise push in. */
      letter-spacing: normal; word-spacing: normal; text-transform: none;
      text-align: left; text-indent: 0; font-style: normal; font-weight: 400;
      font-variant: normal; white-space: normal; direction: ltr; visibility: visible;
      text-shadow: none; -webkit-font-smoothing: antialiased;
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
    .banner.ask { background: #f5f3ff; border-color: #ddd6fe; color: #5b21b6; }

    /* Questions being asked back to the user. Visually separated from the
       read-only list below so it is obvious which part wants input. */
    .askForm { margin: 4px 0 12px; }
    .row.ask { border-bottom: none; padding: 10px 0 4px; }
    .req { color: #dc2626; }
    .askIn {
      width: 100%; box-sizing: border-box; margin-top: 6px;
      font: inherit; font-size: 13px; color: #0f172a;
      padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 6px;
      background: #fff; appearance: auto;
    }
    .askIn:focus { outline: 2px solid #7c3aed; outline-offset: -1px; border-color: #7c3aed; }
    textarea.askIn { resize: vertical; min-height: 56px; }
    .saveBtn { width: 100%; margin-top: 10px; }

    /* The themed listbox that replaces a native <select>. Without these rules
       the button renders with the browser's default 2px outset border and grey
       fill, which in a screenshot is indistinguishable from a native control -
       exactly the confusion that hid this. */
    .askSel { position: relative; margin-top: 6px; }
    .askSelBtn {
      width: 100%; display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 6px;
      background: #fff; color: #0f172a; font: inherit; font-size: 13px;
      cursor: pointer; text-align: left;
    }
    .askSelBtn:hover { border-color: #7c3aed; }
    .askSelVal { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .askSelVal.ph { color: #94a3b8; }
    .askSelCaret { color: #64748b; font-size: 10px; flex-shrink: 0; }
    .askSelList {
      position: absolute; top: calc(100% + 3px); left: 0; right: 0; z-index: 5;
      max-height: 210px; overflow-y: auto; background: #fff;
      border: 1px solid #e2e8f0; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(15,23,42,.16);
    }
    .askSelOpt { padding: 8px 10px; font-size: 12.5px; line-height: 1.4; cursor: pointer; color: #0f172a; }
    .askSelOpt:hover { background: #f5f3ff; }
    .askSelOpt.on { background: #7c3aed; color: #fff; }

    .askOpts { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
    .askOpt { display: flex; align-items: flex-start; gap: 7px; font-size: 12.5px; cursor: pointer; }
    .askOpt input { margin-top: 2px; accent-color: #7c3aed; }

    .row { padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .row:last-child { border-bottom: none; }
    .q { font-size: 12px; font-weight: 600; }
    .a { font-size: 12px; color: #334155; margin-top: 2px; word-break: break-word; }
    .a.ask { color: #b45309; font-style: italic; }
    .meta { font-size: 10.5px; color: #94a3b8; margin-top: 2px; font-style: italic; letter-spacing: normal; }
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
    .submitRow {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 10px 14px 12px; cursor: pointer; border-top: 1px solid #f1f5f9;
    }
    .submitRow input { margin-top: 2px; accent-color: #7c3aed; }
    .submitRow strong { display: block; font-size: 11.5px; font-weight: 700; color: #0f172a; }
    .submitRow em { display: block; margin-top: 2px; font-size: 10.5px; line-height: 1.45; font-style: normal; color: #94a3b8; }
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

  /*
   * A question the profile cannot answer, rendered as the same kind of control
   * the employer used.
   *
   * Rendering a dropdown as a dropdown is not cosmetic. Asked as free text, the
   * user types "Yes" where this form's list says "Yes, I am authorized to work
   * in the US" - and that is the answer we would save and reuse forever. The
   * options come from the live page, so what gets saved is always a real value.
   */
  function askRow(a, i) {
    const name = `ask_${i}`;
    const opts = Array.isArray(a.options) ? a.options : null;
    const suggested = (v) => (a.suggestion && String(a.suggestion).trim().toLowerCase() === String(v).trim().toLowerCase());

    let control;
    if (opts && opts.length && a.type === 'checkbox_multi') {
      /*
       * "Select all that apply" is genuinely multi-select. Rendering it as a
       * single-choice dropdown would quietly discard every answer but one.
       */
      control = `<div class="askOpts">${opts.map((o, oi) => `
        <label class="askOpt">
          <input type="checkbox" name="${name}" value="${esc(o)}" data-multi="1" ${oi === 0 && suggested(o) ? 'checked' : ''} />
          <span>${esc(o)}</span>
        </label>`).join('')}</div>`;
    } else if (opts && opts.length && (a.type === 'select' || a.type === 'radio')) {
      /*
       * A listbox, not a native <select>.
       *
       * The OS draws a native select's popup and no CSS reaches it, so on macOS
       * it rendered as a grey system menu in the middle of the panel - nothing
       * like the rest of the drawer. Inside a shadow root a real listbox is
       * fully styleable and keeps the theme.
       */
      const picked = opts.find(suggested) || '';
      control = `<div class="askSel" data-sel="${name}">
        <button type="button" class="askSelBtn" aria-haspopup="listbox" aria-expanded="false">
          <span class="askSelVal ${picked ? '' : 'ph'}">${esc(picked || 'Choose…')}</span>
          <span class="askSelCaret" aria-hidden="true">▾</span>
        </button>
        <div class="askSelList" role="listbox" hidden>
          ${opts.map((o) => `<div class="askSelOpt ${suggested(o) ? 'on' : ''}" role="option" data-val="${esc(o)}">${esc(o)}</div>`).join('')}
        </div>
        <input type="hidden" name="${name}" value="${esc(picked)}" />
      </div>`;
    } else if (a.type === 'checkbox') {
      // Consent and attestations are never pre-ticked, and never saved as an
      // answer to reuse - the user ticks these on the page itself.
      control = '<div class="meta">Tick this yourself on the form — HirePilot does not agree to anything on your behalf.</div>';
    } else if (a.type === 'textarea') {
      control = `<textarea class="askIn" name="${name}" rows="3" ${a.required && !a.optional ? 'required' : ''}>${esc(a.suggestion || '')}</textarea>`;
    } else {
      control = `<input class="askIn" name="${name}" value="${esc(a.suggestion || '')}" ${a.required && !a.optional ? 'required' : ''} />`;
    }

    const why = a.suggestion && a.matchedQuestion
      ? `<div class="meta">Suggested from “${esc(String(a.matchedQuestion).slice(0, 60))}”${a.confidence ? ` · only ${Math.round(a.confidence * 100)}% sure, so confirm it` : ''}</div>`
      : `<div class="meta">${esc(String(a.reason || 'Not in your profile yet.').slice(0, 120))}</div>`;

    return `<div class="row ask">
      <div class="q">${esc(a.question)}${a.required && !a.optional ? '<span class="req"> *</span>' : ''}</div>
      ${why}
      ${control}
    </div>`;
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
        ? `<div class="banner ${state.status === 'done' ? 'ok' : state.status === 'needs_user' ? 'warn' : state.status === 'asking' ? 'ask' : ''}">${esc(state.message)}</div>`
        : '';
      const ask = state.ask || [];
      body = `
        <div class="job">${esc(state.job?.title || 'This application')}</div>
        <div class="co">${esc(state.job?.company || location.hostname)}</div>
        ${banner}
        ${ask.length ? `<form class="askForm">${ask.map(askRow).join('')}
          <button type="submit" class="btn saveBtn">Save ${ask.length === 1 ? 'answer' : `${ask.length} answers`} to my profile</button>
          <div class="note" style="padding:6px 0 2px">Saved to your HirePilot profile, not to this site. Asked once, reused on every future application.</div>
        </form>` : ''}
        ${!ask.length && needing.length ? `<div class="banner warn">${needing.length} question${needing.length === 1 ? '' : 's'} need${needing.length === 1 ? 's' : ''} your answer before this can be submitted.</div>` : ''}
        ${state.fields.length
    ? `${needing.map(fieldRow).join('')}${filled.map(fieldRow).join('')}`
    : (ask.length ? '' : '<div class="empty">No form data yet. Run the queue from HirePilot.</div>')}`;
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
        <label class="submitRow">
          <input type="checkbox" data-act="autosubmit" ${state.autoSubmit ? 'checked' : ''} />
          <span>
            <strong>${state.autoSubmit ? 'Submits automatically' : 'Fills only — you click Submit'}</strong>
            <em>${state.autoSubmit
    ? 'Fills the form and clicks Submit, then captures the employer’s confirmation. Nothing is marked Applied without it.'
    : 'Fills every field and stops. The form stays on screen for you to send.'}</em>
          </span>
        </label>
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
    const send = (type, onFail, extra) => {
      try {
        chrome.runtime.sendMessage({ type, ...(extra || {}) }, (res) => {
          if (chrome.runtime.lastError) {
            update({ status: 'needs_user', message: `HirePilot is not responding — reload the page. (${chrome.runtime.lastError.message})` });
            return;
          }
          if (res && res.ok === false) onFail(res.reason);
          else if (typeof onFail === 'function' && res && res.ok) onFail(null, res);
        });
      } catch (err) {
        update({ status: 'needs_user', message: `Could not reach HirePilot: ${err.message}` });
      }
    };

    /*
     * Answering the questions the profile could not.
     *
     * Saves to HirePilot first and only then refills, because the profile is
     * the source of truth: if the save fails the answer must not silently end
     * up on this one form and nowhere else, which is exactly how a user ends up
     * retyping the same answer on every application.
     */
    // Custom listboxes: open, choose, close. One open at a time, and a click
    // anywhere else closes them - a dropdown stuck open over the document is
    // worse than a native one.
    root.querySelectorAll('.askSel').forEach((sel) => {
      const btn = sel.querySelector('.askSelBtn');
      const list = sel.querySelector('.askSelList');
      const val = sel.querySelector('.askSelVal');
      const hidden = sel.querySelector('input[type="hidden"]');
      btn.onclick = (ev) => {
        ev.stopPropagation();
        const opening = list.hidden;
        root.querySelectorAll('.askSelList').forEach((l) => { l.hidden = true; });
        list.hidden = !opening;
        btn.setAttribute('aria-expanded', String(opening));
      };
      list.querySelectorAll('.askSelOpt').forEach((opt) => {
        opt.onclick = (ev) => {
          ev.stopPropagation();
          hidden.value = opt.dataset.val;
          val.textContent = opt.dataset.val;
          val.classList.remove('ph');
          list.querySelectorAll('.askSelOpt').forEach((o) => o.classList.remove('on'));
          opt.classList.add('on');
          list.hidden = true;
          btn.setAttribute('aria-expanded', 'false');
        };
      });
    });
    root.addEventListener('click', () => {
      root.querySelectorAll('.askSelList').forEach((l) => { l.hidden = true; });
    });

    const askForm = root.querySelector('.askForm');
    if (askForm) {
      askForm.onsubmit = (ev) => {
        ev.preventDefault();
        const answers = (state.ask || []).map((a, i) => {
          const nodes = askForm.querySelectorAll(`[name="ask_${i}"]`);
          if (!nodes.length) return null;
          // A checkbox group answers with every ticked option, comma separated -
          // one value would lose the rest.
          const value = nodes[0].dataset.multi
            ? Array.from(nodes).filter((n) => n.checked).map((n) => n.value).join(', ')
            : nodes[0].value;
          return { question: a.question, answer: value, options: a.options, type: a.type };
        }).filter((a) => a && String(a.answer).trim() !== '');

        if (!answers.length) {
          update({ status: 'asking', message: 'Nothing to save yet — answer at least one question.' });
          return;
        }

        const btn = askForm.querySelector('.saveBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        send('HP_SAVE_ANSWERS', (reason, res) => {
          if (reason) {
            if (btn) { btn.disabled = false; btn.textContent = 'Save answers to my profile'; }
            update({ status: 'needs_user', message: `Could not save to your profile: ${reason}` });
            return;
          }
          update({
            status: 'filling',
            ask: null,
            message: `Saved to your profile (${res.totalSavedAnswers} answers now). Filling the form…`,
          });
          // Straight back into the fill with the profile now able to answer.
          send('HP_DRAWER_FILL', (r) => r && update({ status: 'needs_user', message: `Could not fill: ${r}` }));
        }, { answers });
      };
    }

    const fill = root.querySelector('[data-act="fill"]');
    if (fill) {
      fill.onclick = () => {
        update({ status: 'filling', message: 'Filling this form…' });
        send('HP_DRAWER_FILL', (reason) => update({
          status: 'needs_user',
          message: reason === 'needs an answer'
            ? 'A question on this form is not in your profile yet — answer it above.'
            : reason === 'no matching application'
              ? 'No queued application matches this page. Prepare it in HirePilot first.'
              : `Could not fill: ${reason}`,
        }));
      };
    }
    const autoBox = root.querySelector('[data-act="autosubmit"]');
    if (autoBox) {
      autoBox.onchange = (ev) => {
        const value = ev.target.checked;
        update({ autoSubmit: value });
        try {
          chrome.runtime.sendMessage({ type: 'HP_SET_SUBMIT', value }, () => {
            if (chrome.runtime.lastError) update({ autoSubmit: !value });
          });
        } catch { update({ autoSubmit: !value }); }
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
