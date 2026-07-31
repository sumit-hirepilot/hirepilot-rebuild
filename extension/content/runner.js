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
      // The dial-code picker fills itself from the number. Reporting it as a
      // question parked applications on a field that needed nothing.
      if (HP.combobox.isDialCodePicker(el)) return false;
      return true;
    });

    for (const el of controls) {
      const label = HP.fields.labelTextFor(el);
      if (!label || label.length < 2) continue;
      if (IDENTITY_RE.test(label) || DOC_RE.test(label)) continue;

      /*
       * Radio AND checkbox groups produce one entry, not one per option.
       *
       * Checkboxes were keyed per element, so Gusto's "How did you hear about
       * this opportunity? (select all that apply)" - eleven boxes sharing one
       * name and one fieldset - was reported as eleven separate required
       * questions called "LinkedIn", "Glassdoor", "Indeed" and so on. It
       * inflated that application from six real questions to sixteen and would
       * have asked the user eleven times for one answer.
       */
      const grouped = el.type === 'radio' || (el.type === 'checkbox' && el.name);
      const key = grouped ? `${el.type}:${el.name || label}` : `${label}:${el.type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let type = el.tagName === 'TEXTAREA' ? 'textarea' : el.type || 'text';
      let options = null;
      // Set when a control turns out to belong to a group whose legend is the
      // real question - the element's own label is then just one option's name.
      let groupLabel = null;

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
        const group = el.closest('fieldset, [class*="field"], [class*="question"]');
        const peers = group && el.name
          ? Array.from(group.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(el.name)}"]`))
          : [];
        if (peers.length > 1) {
          // The group's own legend is the question; the boxes are its options.
          const legend = group.querySelector('legend, label, [class*="label"]');
          if (legend) groupLabel = HP.fields.clean(legend.textContent);
          options = peers.map((p) => {
            const l = p.labels && p.labels[0];
            return HP.fields.clean(l ? l.textContent : p.value);
          }).filter(Boolean);
          type = 'checkbox_multi';
        }
      }

      out.push({
        question: groupLabel || label,
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

  /*
   * Find the control a question is asking through.
   *
   * "First control whose label matches" is not good enough, because a label
   * often belongs to a whole field group rather than to one input. A question
   * and its "if yes, explain" follow-up share a group, so both answer to the
   * same label text and the loose match took whichever came first. That put a
   * dropdown's "No" into a free-text explanation box on a live application.
   *
   * So candidates are scored rather than taken in document order: an exact
   * label match beats a prefix, which beats a loose regex hit, and a question
   * that offers options prefers a control that can hold one. Ties keep document
   * order. An unlabelled control never matches at all.
   */
  function findByLabel(root, re, opts = {}) {
    const controls = Array.from(root.querySelectorAll('input, textarea, select'))
      .filter(HP.fields.visible)
      .filter((el) => !['hidden', 'submit', 'button', 'file'].includes(el.type))
      // react-select keeps a second input holding the committed value. It
      // carries the same label, and writing to it silently does nothing while
      // reporting success.
      .filter((el) => !HP.combobox.isHiddenValueInput(el));

    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const wanted = norm(opts.question);
    const expectChoice = Boolean(opts.expectChoice);

    let best = null;
    let bestScore = 0;
    for (const el of controls) {
      const label = HP.fields.labelTextFor(el);
      if (!label || !re.test(label)) continue;

      const l = norm(label);
      let score = 1;
      if (wanted && l === wanted) score = 4;
      else if (wanted && (l.startsWith(wanted) || wanted.startsWith(l))) score = 3;
      else score = 2;

      // A question with a fixed option list belongs in a control that has one.
      const isChoice = HP.combobox.is(el) || el.tagName === 'SELECT' || el.type === 'radio';
      if (expectChoice) score += isChoice ? 2 : -1;

      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
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
  /*
   * Describe the control a question is asking through, so an unanswered question
   * can be put back to the user as the same kind of input the employer used.
   *
   * A dropdown's options are the important part: asked as free text, the user
   * types "Yes" where the form wanted "Yes, I am authorized", and the answer we
   * save is one no future form will accept.
   */
  async function describeControl(el) {
    if (!el) return { type: 'text', options: null };
    if (HP.combobox.is(el)) {
      const options = await HP.combobox.readOptions(el).catch(() => null);
      return { type: 'select', options: options && options.length ? options : null };
    }
    if (el.tagName === 'SELECT') {
      return {
        type: 'select',
        options: Array.from(el.options).map((o) => o.text.trim())
          .filter((t) => t && !/^select\b|^-+$|^choose\b/i.test(t)),
      };
    }
    if (el.type === 'radio') {
      const group = el.closest('fieldset, [class*="field"], [class*="question"]') || document;
      const options = Array.from(group.querySelectorAll(`input[type=radio][name="${el.name}"]`))
        .map((r) => {
          const l = r.labels && r.labels[0];
          return HP.fields.clean(l ? l.textContent : r.value);
        }).filter(Boolean);
      return { type: 'radio', options: options.length ? options : null };
    }
    if (el.type === 'checkbox') return { type: 'checkbox', options: null };
    if (el.tagName === 'TEXTAREA') return { type: 'textarea', options: null };
    return { type: 'text', options: null };
  }

  async function fillQuestions(adapter, questions) {
    const root = adapter.formRoot() || document;
    const filled = [];
    const unfilled = [];

    // Every unfilled question carries the live control's shape and options, so
    // the drawer can ask for exactly what this form will accept.
    const cannotFill = async (q, el, reason) => {
      const shape = await describeControl(el);
      unfilled.push({
        question: q.question,
        reason,
        suggestion: q.suggestion || null,
        required: q.required !== false,
        optional: Boolean(q.optional),
        ...shape,
        // Fall back to whatever the server knew if the page yielded nothing.
        options: shape.options || q.options || null,
      });
    };

    for (const q of questions || []) {
      if (q.answer === null || q.answer === undefined || q.answer === '') {
        if (q.required && !q.optional) {
          const el = findByLabel(root, questionRe(q.question), { question: q.question, expectChoice: Boolean(q.options && q.options.length) });
          await cannotFill(q, el, q.reason || 'not in your profile yet');
        }
        continue;
      }

      const el = findByLabel(root, questionRe(q.question), { question: q.question, expectChoice: Boolean(q.options && q.options.length) });
      if (!el) {
        await cannotFill(q, null, 'field not found on page');
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
        await cannotFill(q, el, 'checkbox requires your action');
        continue;
      } else {
        ok = HP.fields.fillText(el, q.answer);
      }

      if (ok) filled.push(q.question);
      else await cannotFill(q, el, 'your saved answer is not one of this form’s options');
    }
    return { filled, unfilled };
  }

  /*
   * Question text as a matcher. Sliced BEFORE escaping - slicing the escaped
   * string can cut a backslash in half and produce a regex that matches nothing,
   * silently turning an answerable question into an unfilled one.
   */
  function questionRe(question) {
    return new RegExp(escapeRe(String(question).slice(0, 60)), 'i');
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

    /*
     * An expired posting is not a broken adapter, and saying "could not find the
     * application form" for one sends you hunting for a bug that is not there.
     * Greenhouse redirects a removed job to the board root with ?error=true;
     * Lever and Ashby land on a 404-ish board page. Detected before the generic
     * failure so the queue records why it actually stopped.
     */
    if (/[?&]error=true/.test(location.search) || /job (no longer|has been) (available|removed|filled)/i.test(document.body.innerText)) {
      return { ok: false, expired: true, reason: 'This posting is no longer available on the employer\u2019s site' };
    }

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

    if (HP.drawer) {
      HP.drawer.update({
        status: 'filling',
        message: 'Filling the form…',
        job: payload.job,
        fields: [...(payload.standardFields || []), ...(payload.screeningQuestions || [])],
      });
    }

    const questionResult = await fillQuestions(adapter, payload.screeningQuestions);

    // A required field we could not fill is a hard stop: submitting an
    // incomplete form either fails validation or sends a blank answer.
    if (questionResult.unfilled.length) {
      if (HP.drawer) {
        const n = questionResult.unfilled.length;
        HP.drawer.update({
          status: 'asking',
          // Handed to the drawer as questions to answer, not as an error. Each
          // one answered here is saved to the profile and never asked again.
          ask: questionResult.unfilled,
          message: `${n} question${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} not in your profile yet. Answer ${n === 1 ? 'it' : 'them'} once and HirePilot will reuse ${n === 1 ? 'it' : 'them'} everywhere.`,
        });
      }
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
      if (HP.drawer) {
        HP.drawer.update({
          status: 'done',
          message: 'Form filled. Review it and click Submit on this page when you are ready.',
        });
      }
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

      if (msg.type === 'HP_DRAWER_STATE') {
        // Background pushes queue context in once it has it.
        if (HP.drawer) HP.drawer.show(msg.payload || {});
        return respond({ ok: true });
      }

      if (msg.type === 'HP_DISCOVER') {
        const adapter = HP.discovery.activeAdapter(msg.atsPlatform);
        if (HP.drawer) {
          HP.drawer.show({ status: 'reading', message: 'Reading this form…' });
        }
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

/* ------------------------------------------------------------------ *
 * Announce
 *
 * Ask the background whether this page has a queued application, and if it
 * does, put the drawer up straight away. This is what makes the extension feel
 * present: you open a posting you have already queued and the panel is simply
 * there, rather than only appearing once a run happens to reach this tab.
 *
 * Deliberately quiet when the answer is no - an unqueued job page gets nothing.
 * ------------------------------------------------------------------ */
(function announce() {
  if (!HP.drawer) return;
  if (!HP.discovery.activeAdapter()) return; // not a form we can act on

  const ask = () => chrome.runtime.sendMessage({ type: 'HP_PAGE_CONTEXT' }, (res) => {
    if (chrome.runtime.lastError) return; // worker asleep or extension reloading
    if (res && res.ok && res.payload) HP.drawer.show(res.payload);
  });

  // Single-page ATS flows swap the form in without a navigation, so the adapter
  // can report nothing on first paint even though a form arrives moments later.
  if (document.readyState === 'complete') ask();
  else window.addEventListener('load', ask, { once: true });
}());
