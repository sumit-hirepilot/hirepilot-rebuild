/*
 * Content-script orchestrator.
 *
 * Runs in the employer's page, in the user's own authenticated session. Three
 * commands from the background worker:
 *
 *   HP_DISCOVER  read the real form and report its questions back, so the
 *                review screen shows the actual fields before approval
 *   HP_EXECUTE   fill everything, then submit - only ever called for an
 *                application the user approved on the review screen
 *   HP_CAPTURE   read the post-submit page for confirmation evidence
 *
 * The split matters: nothing is filled or clicked during discovery, and
 * HP_EXECUTE is unreachable without a server-side `approved` status, which the
 * backend refuses to set while required answers are missing.
 */

window.HP = window.HP || {};

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

HP.discovery = (() => {
  const IDENTITY_RE = /first name|last name|full name|^name$|e-?mail|phone|mobile|telephone/i;
  const DOC_RE = /resume|cv|cover letter|attach|upload|portfolio file/i;

  // Every visible, meaningful control that is not identity or a document
  // upload - i.e. what the employer added themselves.
  //
  // Async because react-select options only exist once the menu is opened, and
  // reporting a dropdown as free-text would disable the option-match guard on
  // exactly the questions where guessing is most damaging.
  async function genericQuestions(adapter) {
    const root = adapter.formRoot() || document;
    const out = [];
    const seen = new Set();

    const controls = Array.from(
      root.querySelectorAll('input, textarea, select')
    ).filter((el) => {
      if (!HP.fields.visible(el)) return false;
      if (['hidden', 'submit', 'button', 'file'].includes(el.type)) return false;
      // react-select renders a second, value-holding input alongside the
      // combobox, sharing its label. Without this the same question is
      // discovered twice - once correctly as a select with options, once as
      // free text - which duplicates it on the review screen and sends the
      // fill down the wrong path. Verified on a live Greenhouse form.
      if (HP.combobox.isHiddenValueInput(el)) return false;
      return true;
    });

    for (const el of controls) {
      const label = HP.fields.labelTextFor(el);
      if (!label || label.length < 2) continue;
      if (IDENTITY_RE.test(label) || DOC_RE.test(label)) continue;

      // Radio groups produce one entry, not one per option.
      const key = el.type === 'radio' ? `radio:${el.name || label}` : `${label}:${el.type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let type = el.tagName === 'TEXTAREA' ? 'textarea' : el.type || 'text';
      let options = null;

      if (HP.combobox.is(el)) {
        type = 'select';
        options = await HP.combobox.readOptions(el);
      } else if (el.tagName === 'SELECT') {
        type = 'select';
        options = Array.from(el.options)
          .map((o) => HP.fields.clean(o.textContent))
          .filter((t) => t && !/^(select|choose|--)/i.test(t));
      } else if (el.type === 'radio') {
        type = 'radio';
        const group = Array.from(
          root.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name || '')}"]`)
        );
        options = group.map((r) => HP.fields.labelTextFor(r)).filter(Boolean);
      } else if (el.type === 'checkbox') {
        type = 'checkbox';
      }

      out.push({
        question: label,
        type,
        options,
        required: HP.fields.isRequired(el),
      });
    }
    return out;
  }

  /*
   * The queue item already carries the platform the backend detected from the
   * job's source, so prefer that over sniffing the page. Sniffing stays as the
   * fallback for embedded boards on company domains, but an explicit hint is
   * deterministic - it cannot pick the wrong adapter when a page happens to
   * carry markers from two vendors.
   */
  function activeAdapter(hint) {
    const all = HP.adapters || {};
    if (hint && all[hint]) return all[hint];
    return Object.values(all).find((a) => a.matches()) || null;
  }

  return { genericQuestions, activeAdapter };
})();

/* ------------------------------------------------------------------ *
 * Execution
 * ------------------------------------------------------------------ */

HP.runner = (() => {
  const log = (...a) => console.log('[HirePilot]', ...a);

  function findByLabel(root, re) {
    const controls = Array.from(root.querySelectorAll('input, textarea, select'))
      .filter(HP.fields.visible)
      .filter((el) => !['hidden', 'submit', 'button', 'file'].includes(el.type));
    return controls.find((el) => re.test(HP.fields.labelTextFor(el))) || null;
  }

  // Identity/contact. Known selectors first, label matching second.
  function fillIdentity(adapter, standardFields) {
    const root = adapter.formRoot() || document;
    const map = {};
    for (const f of standardFields || []) {
      if (f.answer === null || f.answer === '') continue;
      map[String(f.question).toLowerCase()] = f.answer;
    }
    const get = (...keys) => {
      for (const k of keys) {
        const hit = Object.entries(map).find(([q]) => q.includes(k));
        if (hit) return hit[1];
      }
      return null;
    };

    const fullName = get('full name', 'name');
    const email = get('email');
    const phone = get('phone');
    const location = get('current location', 'location');
    const linkedin = get('linkedin');
    const portfolio = get('portfolio', 'website');

    const filled = [];
    const pendingCombos = [];
    const sel = adapter.identityFields ? adapter.identityFields() : {};

    const tryFill = (selector, labelRe, value, tag) => {
      if (value === null || value === undefined || value === '') return;
      let el = selector ? root.querySelector(selector) : null;
      if (!el || !HP.fields.visible(el)) el = findByLabel(root, labelRe);
      if (!el) return;
      // A combobox here (Country, for instance) needs the react-select path;
      // fillText would type into its search box without committing a choice.
      if (HP.combobox.is(el)) { pendingCombos.push({ el, value, tag }); return; }
      if (HP.fields.fillText(el, value)) filled.push(tag);
    };

    // Greenhouse splits the name; everything else takes it whole.
    if (fullName && (sel.first_name || sel.last_name)) {
      const parts = String(fullName).trim().split(/\s+/);
      const first = parts.shift();
      const last = parts.join(' ');
      tryFill(sel.first_name, /first name/i, first, 'first_name');
      // A single-token name has no surname to give; leaving it blank so the
      // form's own validation asks is better than duplicating the first name.
      if (last) tryFill(sel.last_name, /last name/i, last, 'last_name');
    } else {
      tryFill(sel.full_name, /full name|^name$/i, fullName, 'full_name');
    }

    tryFill(sel.email, /e-?mail/i, email, 'email');
    tryFill(sel.phone, /phone|mobile|telephone/i, phone, 'phone');
    tryFill(sel.current_company, /current (company|employer)/i, get('current company'), 'current_company');
    tryFill(sel.linkedin_url, /linkedin/i, linkedin, 'linkedin');
    tryFill(sel.portfolio_url, /portfolio|website/i, portfolio, 'portfolio');
    tryFill(sel.github_url, /github/i, get('github'), 'github');
    tryFill(null, /location|city|based/i, location, 'location');

    return { filled, pendingCombos };
  }

  // Screening questions, from answers the server resolved against the profile.
  // An answer the server left null is never invented here.
  async function fillQuestions(adapter, questions) {
    const root = adapter.formRoot() || document;
    const filled = [];
    const unfilled = [];

    for (const q of questions || []) {
      if (q.answer === null || q.answer === undefined || q.answer === '') {
        if (q.required && !q.optional) unfilled.push({ question: q.question, reason: q.reason || 'no answer available' });
        continue;
      }

      const el = findByLabel(root, new RegExp(escapeRe(q.question).slice(0, 60), 'i'));
      if (!el) {
        unfilled.push({ question: q.question, reason: 'field not found on page' });
        continue;
      }

      let ok = false;
      if (HP.combobox.is(el)) ok = await HP.combobox.choose(el, q.answer);
      else if (el.tagName === 'SELECT') ok = HP.fields.fillSelect(el, q.answer);
      else if (el.type === 'radio') {
        const group = el.closest('fieldset, [class*="field"], [class*="question"]') || root;
        ok = HP.fields.fillRadio(group, q.answer);
      } else if (el.type === 'checkbox') {
        // Not auto-ticked - a required checkbox is treated as consent and
        // handed to the user by the gate check.
        ok = false;
        unfilled.push({ question: q.question, reason: 'checkbox requires your action' });
        continue;
      } else {
        ok = HP.fields.fillText(el, q.answer);
      }

      if (ok) filled.push(q.question);
      else unfilled.push({ question: q.question, reason: 'value did not match the field options' });
    }
    return { filled, unfilled };
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Multi-step forms: advance while a Next/Continue control exists and no gate
  // is blocking. Bounded so a form that re-renders the same step cannot loop.
  async function advanceSteps(adapter, maxSteps = 6) {
    const visited = [];
    for (let i = 0; i < maxSteps; i += 1) {
      const gate = HP.gates.check();
      if (gate.paused) return { ...gate, steps: visited };

      const root = adapter.formRoot() || document;
      const next = Array.from(root.querySelectorAll('button, a')).find((b) => {
        const t = HP.fields.clean(b.textContent);
        return /^(next|continue|save and continue|next step)$/i.test(t) && HP.fields.visible(b);
      });
      if (!next) return { paused: false, steps: visited };

      const before = document.body.innerText.slice(0, 500);
      next.click();
      await wait(1200);
      const after = document.body.innerText.slice(0, 500);
      visited.push(i + 1);
      if (before === after) return { paused: false, steps: visited, note: 'step did not advance' };
    }
    return { paused: false, steps: visited, note: 'hit step limit' };
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function execute(payload) {
    const adapter = HP.discovery.activeAdapter(payload.atsPlatform);
    if (!adapter) return { ok: false, reason: 'No adapter for this site' };

    const opened = await adapter.openForm();
    if (opened === 'navigating') return { ok: false, navigating: true, reason: 'Navigating to the apply form' };
    if (!adapter.formRoot()) return { ok: false, reason: 'Could not find the application form on this page' };

    // Gate check before touching anything - no point filling a form behind a
    // login wall.
    const preGate = HP.gates.check();
    if (preGate.paused) return { ok: false, paused: true, ...preGate };

    const { filled: identity, pendingCombos } = fillIdentity(adapter, payload.standardFields);
    for (const { el, value, tag } of pendingCombos) {
      if (await HP.combobox.choose(el, value)) identity.push(tag);
    }

    let resumeAttached = false;
    const fileInput = adapter.resumeInput();
    if (fileInput && payload.resumeFile && payload.resumeFile.bytes) {
      resumeAttached = HP.fields.attachFile(fileInput, payload.resumeFile);
      await wait(1500); // these boards parse the upload and re-render
    }

    let coverLetterFilled = false;
    const clField = adapter.coverLetterField();
    if (clField && payload.coverLetter) {
      coverLetterFilled = HP.fields.fillText(clField, payload.coverLetter);
    }

    const questionResult = await fillQuestions(adapter, payload.screeningQuestions);

    // A required field we could not fill is a hard stop: submitting an
    // incomplete form either fails validation or sends a blank answer.
    if (questionResult.unfilled.length) {
      return {
        ok: false,
        paused: true,
        reason: 'unmapped_required_field',
        detail: questionResult.unfilled
          .map((u) => `${u.question} (${u.reason})`).slice(0, 4).join(' | '),
        filled: { identity, resumeAttached, coverLetterFilled, questions: questionResult.filled },
      };
    }

    const stepResult = await advanceSteps(adapter);
    if (stepResult.paused) {
      return { ok: false, paused: true, reason: stepResult.reason, detail: stepResult.detail };
    }

    const postGate = HP.gates.check();
    if (postGate.paused) return { ok: false, paused: true, ...postGate };

    if (!payload.autoSubmit) {
      return {
        ok: true,
        submitted: false,
        awaitingUserSubmit: true,
        filled: { identity, resumeAttached, coverLetterFilled, questions: questionResult.filled },
      };
    }

    const submit = adapter.submitButton();
    if (!submit) {
      return { ok: false, reason: 'Form filled but no submit button found', paused: true };
    }

    const urlBefore = location.href;
    const textBefore = document.body.innerText.slice(0, 2000);
    submit.click();

    // Wait for the page to actually change - either a navigation or the
    // in-place confirmation these React boards render.
    for (let i = 0; i < 20; i += 1) {
      await wait(750);
      if (location.href !== urlBefore) break;
      if (document.body.innerText.slice(0, 2000) !== textBefore) break;
    }
    await wait(1500);

    return {
      ok: true,
      submitted: true,
      filled: { identity, resumeAttached, coverLetterFilled, questions: questionResult.filled },
      evidence: capture(),
    };
  }

  /* ---------------------------------------------------------------- *
   * Evidence capture
   * ---------------------------------------------------------------- */

  // Reference-number patterns these platforms actually print. Ordered
  // most-specific-first so "Application ID: 12345" is not matched by the bare
  // number pattern.
  const ID_PATTERNS = [
    /(?:confirmation|reference|application)\s*(?:number|id|code)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-_]{3,40})/i,
    /(?:req(?:uisition)?)\s*(?:id|number)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-_]{3,40})/i,
    /\bapplication\s+#\s*([A-Za-z0-9\-_]{3,40})/i,
  ];

  function capture() {
    const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim();

    let confirmationId = null;
    for (const re of ID_PATTERNS) {
      const m = text.match(re);
      if (m && m[1]) { confirmationId = m[1]; break; }
    }

    // Narrow the stored text to the confirmation region where possible, so the
    // proof shown in the dashboard is the employer's message rather than the
    // whole page chrome.
    let excerpt = text.slice(0, 4000);
    const anchor = text.search(/thank you for applying|application (has been )?(received|submitted|sent)|we('| ha)ve received your application|successfully (applied|submitted)/i);
    if (anchor >= 0) excerpt = text.slice(Math.max(0, anchor - 200), anchor + 2000);

    return {
      confirmationId,
      confirmationText: excerpt,
      finalUrl: location.href,
      capturedAt: new Date().toISOString(),
      pageTitle: document.title,
    };
  }

  return { execute, capture, fillIdentity, fillQuestions };
})();

/* ------------------------------------------------------------------ *
 * Message bridge
 * ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    try {
      if (msg.type === 'HP_PING') {
        const adapter = HP.discovery.activeAdapter(msg.atsPlatform);
        return respond({ ok: true, adapter: adapter ? adapter.name : null, url: location.href });
      }

      if (msg.type === 'HP_DISCOVER') {
        const adapter = HP.discovery.activeAdapter(msg.atsPlatform);
        if (!adapter) return respond({ ok: false, reason: 'No adapter for this site' });
        const opened = await adapter.openForm();
        if (opened === 'navigating') return respond({ ok: false, navigating: true });
        const gate = HP.gates.check();
        return respond({
          ok: true,
          adapter: adapter.name,
          formFound: Boolean(adapter.formRoot()),
          gate,
          questions: await adapter.customQuestions(),
          hasResumeInput: Boolean(adapter.resumeInput()),
          hasCoverLetterField: Boolean(adapter.coverLetterField()),
        });
      }

      if (msg.type === 'HP_EXECUTE') {
        return respond(await HP.runner.execute(msg.payload || {}));
      }

      if (msg.type === 'HP_CAPTURE') {
        return respond({ ok: true, evidence: HP.runner.capture() });
      }

      return respond({ ok: false, reason: `Unknown message ${msg.type}` });
    } catch (err) {
      console.error('[HirePilot] runner error:', err);
      return respond({ ok: false, reason: err.message });
    }
  })();
  return true; // async respond
});

console.log('[HirePilot] runner ready on', location.hostname);
