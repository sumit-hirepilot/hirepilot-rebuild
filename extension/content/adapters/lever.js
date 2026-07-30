/*
 * Lever adapter.
 *
 * Lever's form lives at /{company}/{postingId}/apply and uses stable `name`
 * attributes, including bracketed URL fields (urls[LinkedIn]) which need
 * attribute selectors rather than id lookups.
 */

window.HP = window.HP || {};
HP.adapters = HP.adapters || {};

HP.adapters.lever = {
  name: 'lever',

  matches() {
    if (/lever\.co/i.test(location.hostname)) return true;
    // Lever's hosted-form embed keeps its own field names and asset host.
    if (document.querySelector('[src*="lever.co"], [action*="lever.co"], form.application-form')) return true;
    return Boolean(document.querySelector('input[name="urls[LinkedIn]"], input[name="resume"][data-qa]'));
  },

  formRoot() {
    return document.querySelector('form.application-form, form[action*="apply"], #application-form')
      || document.querySelector('form')
      || null;
  },

  // On a posting page the apply form is one navigation away; Lever's URL scheme
  // makes this deterministic, so navigate rather than hunting for a button.
  async openForm() {
    if (this.formRoot() && document.querySelector('input[name="name"], input[name="email"]')) return true;
    if (!/\/apply\/?$/.test(location.pathname)) {
      const target = `${location.origin}${location.pathname.replace(/\/$/, '')}/apply`;
      location.href = target;
      // Navigation tears down this content script; the runner re-attaches on
      // the new page load rather than waiting here.
      return 'navigating';
    }
    return Boolean(this.formRoot());
  },

  identityFields() {
    return {
      full_name: 'input[name="name"]',
      email: 'input[name="email"]',
      phone: 'input[name="phone"]',
      current_company: 'input[name="org"]',
      linkedin_url: 'input[name="urls[LinkedIn]"], input[name*="LinkedIn"]',
      portfolio_url: 'input[name="urls[Portfolio]"], input[name*="Portfolio"]',
      github_url: 'input[name="urls[GitHub]"], input[name*="Github"], input[name*="GitHub"]',
    };
  },

  resumeInput() {
    const root = this.formRoot() || document;
    return root.querySelector('input[name="resume"], input[type="file"][name*="resume" i]')
      || root.querySelector('input[type="file"]');
  },

  coverLetterField() {
    const root = this.formRoot() || document;
    return root.querySelector('textarea[name="comments"], textarea[name*="cover" i]')
      || Array.from(root.querySelectorAll('textarea')).find(
        (t) => /cover letter|additional information/i.test(HP.fields.labelTextFor(t))
      )
      || null;
  },

  submitButton() {
    const root = this.formRoot() || document;
    return root.querySelector('button.template-btn-submit, button[type="submit"], input[type="submit"]')
      || Array.from(root.querySelectorAll('button')).find(
        (b) => /submit application|submit/i.test(HP.fields.clean(b.textContent))
      )
      || null;
  },

  customQuestions() {
    return HP.discovery.genericQuestions(this);
  },
};
