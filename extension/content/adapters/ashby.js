/*
 * Ashby adapter.
 *
 * Ashby's board is a React app with hashed class names and no stable ids, so
 * this adapter is almost entirely label-driven. It also renders inputs inside
 * `_fieldEntry` wrappers whose label is a sibling rather than a <label for>,
 * which is why fields.labelTextFor walks the field-group wrapper.
 */

window.HP = window.HP || {};
HP.adapters = HP.adapters || {};

HP.adapters.ashby = {
  name: 'ashby',

  matches() {
    return /jobs\.ashbyhq\.com/i.test(location.hostname);
  },

  formRoot() {
    return document.querySelector('form')
      || document.querySelector('[class*="application" i]')
      || null;
  },

  async openForm() {
    if (document.querySelector('input[type="file"]')) return true;
    const btn = Array.from(document.querySelectorAll('a, button')).find(
      (el) => /^(apply|apply for this job|application)$/i.test(HP.fields.clean(el.textContent))
    );
    if (btn) {
      btn.click();
      await new Promise((r) => setTimeout(r, 1500));
      return Boolean(this.formRoot());
    }
    return Boolean(this.formRoot());
  },

  // No stable selectors to offer; resolved by label in fillIdentity's fallback.
  identityFields() {
    return {
      email: 'input[type="email"]',
      phone: 'input[type="tel"]',
    };
  },

  // Label-based, since Ashby's file inputs carry no descriptive attributes.
  resumeInput() {
    const root = this.formRoot() || document;
    const inputs = Array.from(root.querySelectorAll('input[type="file"]'));
    return inputs.find((i) => /resume|cv/i.test(HP.fields.labelTextFor(i)))
      || inputs.find((i) => {
        // Ashby puts the word "Resume" in a drop-zone sibling rather than a label.
        const zone = i.closest('[class*="field" i], div');
        return zone && /resume|cv/i.test(zone.textContent || '');
      })
      || inputs[0]
      || null;
  },

  coverLetterField() {
    const root = this.formRoot() || document;
    return Array.from(root.querySelectorAll('textarea')).find(
      (t) => /cover letter/i.test(HP.fields.labelTextFor(t))
    ) || null;
  },

  submitButton() {
    const root = this.formRoot() || document;
    return Array.from(root.querySelectorAll('button')).find(
      (b) => /submit application|submit/i.test(HP.fields.clean(b.textContent))
    ) || root.querySelector('button[type="submit"]') || null;
  },

  customQuestions() {
    return HP.discovery.genericQuestions(this);
  },
};
