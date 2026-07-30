/*
 * Shared form primitives for every ATS adapter.
 *
 * Two things here are less obvious than they look and are the reason this file
 * exists rather than each adapter calling .value = x:
 *
 * 1. Setting .value on a React-controlled input does not update React's
 *    internal state - the value visibly appears and is then wiped on the next
 *    render, or submits empty. All three of these ATS platforms are React apps.
 *    setNativeValue() goes through the property's own setter and then fires the
 *    events React listens for.
 *
 * 2. File inputs cannot be assigned directly, but a DataTransfer's file list
 *    can be, which is the only way to attach a resume without the user picking
 *    it from a file dialog.
 */

window.HP = window.HP || {};

HP.fields = (() => {
  // Fire the events frameworks actually listen to, in the order a real user
  // interaction would produce them.
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillText(el, value) {
    if (!el || value === null || value === undefined || value === '') return false;
    el.focus();
    setNativeValue(el, String(value));
    el.blur();
    return true;
  }

  function fillSelect(el, value) {
    if (!el || !value) return false;
    const want = String(value).trim().toLowerCase();
    const opt = Array.from(el.options).find(
      (o) => o.value.trim().toLowerCase() === want || o.textContent.trim().toLowerCase() === want
    );
    // No fuzzy fallback on purpose: picking the "closest" option on a work
    // authorisation or salary dropdown is exactly the kind of guess that turns
    // into a misrepresentation. Unmatched means the runner pauses for the user.
    if (!opt) return false;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (setter) setter.call(el, opt.value);
    else el.value = opt.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return true;
  }

  function fillRadio(container, value) {
    if (!container || !value) return false;
    const want = String(value).trim().toLowerCase();
    const radios = Array.from(container.querySelectorAll('input[type="radio"]'));
    for (const r of radios) {
      const label = labelTextFor(r);
      if (
        r.value.trim().toLowerCase() === want
        || (label && label.trim().toLowerCase() === want)
      ) {
        r.click();
        return r.checked;
      }
    }
    return false;
  }

  // Attaches real bytes to a file input. `bytes` is a plain array of octets
  // because structured clone across the extension message boundary does not
  // preserve ArrayBuffer views reliably in MV3 service workers.
  function attachFile(input, { bytes, filename, mimetype }) {
    if (!input || !bytes || !bytes.length) return false;
    try {
      const blob = new Blob([new Uint8Array(bytes)], {
        type: mimetype || 'application/pdf',
      });
      const file = new File([blob], filename || 'resume.pdf', {
        type: mimetype || 'application/pdf',
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.files.length === 1;
    } catch (err) {
      console.warn('[HirePilot] file attach failed:', err);
      return false;
    }
  }

  // The label a human would read for this control. ATS markup is inconsistent
  // enough that all five strategies are needed in practice.
  function labelTextFor(el) {
    if (!el) return '';
    if (el.id) {
      const l = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (l) return clean(l.textContent);
    }
    const wrapping = el.closest('label');
    if (wrapping) return clean(wrapping.textContent);
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const target = document.getElementById(labelledBy);
      if (target) return clean(target.textContent);
    }
    // Field-group wrapper: the nearest preceding label-ish node.
    const group = el.closest('[class*="field"], [class*="question"], fieldset, .form-group');
    if (group) {
      const l = group.querySelector('label, legend, [class*="label"]');
      if (l) return clean(l.textContent);
    }
    return clean(el.getAttribute('placeholder') || el.name || '');
  }

  function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').replace(/\*$/, '').trim();
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
  }

  function isRequired(el) {
    if (!el) return false;
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    const label = labelTextFor(el);
    if (/\*/.test(label)) return true;
    const group = el.closest('[class*="field"], [class*="question"]');
    return Boolean(group && /required|\*/i.test(group.className));
  }

  function visible(el) {
    if (!el) return false;
    if (el.type === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  return {
    setNativeValue, fillText, fillSelect, fillRadio, attachFile,
    labelTextFor, isRequired, visible, clean,
  };
})();

/*
 * react-select comboboxes.
 *
 * Greenhouse's current board renders every dropdown as react-select, not a
 * native <select> - a live Scale AI posting had twelve questions and zero
 * <select> elements. Two consequences this module exists to handle:
 *
 *   1. The options do not exist in the DOM until the menu is opened, so
 *      discovery reported these as free-text with no options. That silently
 *      disabled the option-match guard, which is the thing stopping a
 *      work-authorisation answer from being filled with a value the form
 *      never offered.
 *   2. react-select commits on a pointer sequence, not on .value assignment
 *      and not on a bare click. Verified live: pointerdown -> mousedown ->
 *      mouseup -> click opens the menu and selects an option; focus+ArrowDown
 *      does not.
 */
HP.combobox = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function is(el) {
    return Boolean(
      el
      && el.getAttribute
      && el.getAttribute('role') === 'combobox'
      && (el.getAttribute('aria-haspopup') === 'true' || el.getAttribute('aria-autocomplete') === 'list')
    );
  }

  function containerFor(el) {
    return el.closest('[class*="select__container"], [class*="select-shell"]')
      || el.closest('[class*="select"]')
      || el.parentElement;
  }

  // react-select keeps the committed value in a separate input next to the
  // combobox. It carries the same label, so discovery would emit the question
  // twice and the fill would target the wrong node. Anything inside a select
  // container that is not the combobox itself is that shadow input.
  function isHiddenValueInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (is(el)) return false;
    const c = el.closest('[class*="select__container"], [class*="select-shell"]');
    if (!c) return false;
    return Boolean(c.querySelector('[role="combobox"]'));
  }

  function pointerSeq(el) {
    const specs = [['pointerdown', window.PointerEvent], ['mousedown', MouseEvent],
      ['mouseup', MouseEvent], ['click', MouseEvent]];
    for (const [type, Ctor] of specs) {
      if (!Ctor) continue;
      try {
        el.dispatchEvent(new Ctor(type, {
          bubbles: true, cancelable: true, button: 0, buttons: 1, composed: true,
        }));
      } catch { /* PointerEvent unsupported - the mouse events still land */ }
    }
  }

  function menuFor(el) {
    const id = el.getAttribute('aria-controls');
    if (id) {
      const byId = document.getElementById(id);
      if (byId) return byId;
    }
    const c = containerFor(el);
    return c ? c.querySelector('[class*="menu"], [role="listbox"]') : null;
  }

  async function open(el) {
    const c = containerFor(el);
    const control = (c && c.querySelector('[class*="select__control"], [class*="control"]')) || el;
    // Retried: react-select can need a beat after a previous close before it
    // will reopen.
    for (let i = 0; i < 4; i += 1) {
      pointerSeq(control);
      await sleep(350);
      const m = menuFor(el);
      if (m) return m;
    }
    return null;
  }

  function close(el) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  function optionsIn(menu) {
    return Array.from(menu.querySelectorAll('[role="option"], [class*="option"]'))
      .map((o) => HP.fields.clean(o.textContent))
      .filter(Boolean);
  }

  // Opens, reads the real option list, closes again. Used by discovery so the
  // review screen shows the choices the employer actually offers.
  async function readOptions(el) {
    const menu = await open(el);
    if (!menu) return null;
    const opts = optionsIn(menu);
    close(el);
    await sleep(150);
    return opts;
  }

  function selectedText(el) {
    const c = containerFor(el);
    const sv = c && c.querySelector('[class*="singleValue"], [class*="single-value"]');
    return sv ? HP.fields.clean(sv.textContent) : null;
  }

  // Exact match only, same rule as fillSelect: choosing the "closest" option on
  // a sponsorship or salary dropdown is the kind of guess that becomes a
  // misrepresentation.
  async function choose(el, value) {
    if (!value) return false;
    const menu = await open(el);
    if (!menu) return false;
    const want = String(value).trim().toLowerCase();
    const target = Array.from(menu.querySelectorAll('[role="option"], [class*="option"]'))
      .find((o) => HP.fields.clean(o.textContent).toLowerCase() === want);
    if (!target) {
      close(el);
      return false;
    }
    pointerSeq(target);
    await sleep(400);
    return selectedText(el)?.toLowerCase() === want;
  }

  return { is, open, close, readOptions, choose, optionsIn, selectedText, containerFor, isHiddenValueInput };
})();

/*
 * Conditions that must hand control back to the user. Detected generically
 * because every one of these can appear on any of the platforms.
 */
HP.gates = (() => {
  // Only an *interactive* challenge is a gate. Greenhouse (and many others)
  // embed reCAPTCHA Enterprise in invisible/score mode: the anchor iframe is
  // present and technically visible as a badge, but there is nothing for the
  // user to solve. Treating that as a gate paused every single Greenhouse
  // application on a CAPTCHA that did not exist - confirmed live on a Scale AI
  // posting whose anchor carried size=invisible alongside a .grecaptcha-badge.
  function invisibleRecaptchaOnly() {
    const anchors = Array.from(document.querySelectorAll('iframe[src*="recaptcha"]'));
    if (!anchors.length) return false;
    const everyAnchorInvisible = anchors.every((f) => /[?&]size=invisible/i.test(f.getAttribute('src') || ''));
    // The solve-me popup lives in a separate "bframe" iframe and only appears
    // when the score check actually fails.
    const challengeOpen = Array.from(document.querySelectorAll('iframe[src*="recaptcha"][src*="bframe"]'))
      .some((f) => {
        const r = f.getBoundingClientRect();
        return r.width > 100 && r.height > 100 && getComputedStyle(f).visibility !== 'hidden';
      });
    return everyAnchorInvisible && !challengeOpen;
  }

  function captcha() {
    if (invisibleRecaptchaOnly()) return false;

    const sel = [
      'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
      '.g-recaptcha', '#g-recaptcha', '[data-sitekey]',
      'iframe[src*="challenges.cloudflare.com"]', '.cf-turnstile',
      'iframe[title*="challenge" i]',
    ];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (!el || !HP.fields.visible(el)) continue;
      // A score-mode badge is not something the user can action.
      if (el.classList?.contains('grecaptcha-badge')) continue;
      if (el.closest?.('.grecaptcha-badge')) continue;
      return true;
    }
    return false;
  }

  function loginWall() {
    const pw = Array.from(document.querySelectorAll('input[type="password"]'))
      .filter(HP.fields.visible);
    if (pw.length) return true;
    const text = (document.body.innerText || '').slice(0, 3000);
    return /sign in to (continue|apply)|log ?in to (continue|apply)|create an account to apply/i.test(text);
  }

  function mfa() {
    const text = (document.body.innerText || '').slice(0, 3000);
    if (/one[- ]time (code|password)|verification code|two[- ]factor|enter the code we sent|authenticator app/i.test(text)) return true;
    return Boolean(document.querySelector('input[autocomplete="one-time-code"]'));
  }

  // Consent and certification checkboxes are never auto-ticked: the user is
  // personally asserting something. Returns the ones still unchecked.
  function pendingConsents() {
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
      .filter(HP.fields.visible)
      .filter((b) => !b.checked);
    return boxes
      .map((b) => ({ el: b, label: HP.fields.labelTextFor(b) }))
      .filter(({ el, label }) => (
        HP.fields.isRequired(el)
        && /consent|agree|acknowledg|certif|attest|terms|privacy|declare|accurate|authoriz.*(check|verif)/i.test(label)
      ));
  }

  function check() {
    if (captcha()) return { paused: true, reason: 'captcha' };
    if (mfa()) return { paused: true, reason: 'mfa' };
    if (loginWall()) return { paused: true, reason: 'login' };
    const consents = pendingConsents();
    if (consents.length) {
      return {
        paused: true,
        reason: 'consent',
        detail: consents.map((c) => c.label).slice(0, 3).join(' | '),
      };
    }
    return { paused: false };
  }

  return { check, captcha, loginWall, mfa, pendingConsents };
})();
