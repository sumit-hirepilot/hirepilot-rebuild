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
 * Conditions that must hand control back to the user. Detected generically
 * because every one of these can appear on any of the platforms.
 */
HP.gates = (() => {
  function captcha() {
    const sel = [
      'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
      '.g-recaptcha', '#g-recaptcha', '[data-sitekey]',
      'iframe[src*="challenges.cloudflare.com"]', '.cf-turnstile',
      'iframe[title*="challenge" i]',
    ];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (el && HP.fields.visible(el)) return true;
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
