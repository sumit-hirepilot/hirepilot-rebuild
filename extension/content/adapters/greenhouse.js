/*
 * Greenhouse adapter.
 *
 * Two markup generations are live simultaneously and both are common:
 *   - job-boards.greenhouse.io  (current React board)
 *   - boards.greenhouse.io      (legacy Rails board, still widely embedded)
 * Known ids are tried first because they are unambiguous when present; label
 * matching is the fallback so a markup change degrades to "found by label"
 * rather than to a silent empty submission.
 */

window.HP = window.HP || {};
HP.adapters = HP.adapters || {};

HP.adapters.greenhouse = {
  name: 'greenhouse',

  matches() {
    return /greenhouse\.io/i.test(location.hostname);
  },

  // Greenhouse serves the form on the posting page itself (React board) or at
  // a /application path (legacy). Returns the form root, or null if we are on
  // a posting page that still needs the "Apply" click.
  formRoot() {
    return document.querySelector('#application_form, form#application-form, [data-testid="application-form"], form[action*="application"]')
      || document.querySelector('main form')
      || null;
  },

  // Some boards gate the form behind an Apply button.
  async openForm() {
    if (this.formRoot()) return true;
    const btn = Array.from(document.querySelectorAll('a, button')).find(
      (el) => /^(apply|apply now|apply for this job)$/i.test(HP.fields.clean(el.textContent))
    );
    if (btn) {
      btn.click();
      await new Promise((r) => setTimeout(r, 1500));
      return Boolean(this.formRoot());
    }
    return false;
  },

  identityFields() {
    return {
      first_name: '#first_name, input[name="job_application[first_name]"], input[autocomplete="given-name"]',
      last_name: '#last_name, input[name="job_application[last_name]"], input[autocomplete="family-name"]',
      email: '#email, input[name="job_application[email]"], input[type="email"]',
      phone: '#phone, input[name="job_application[phone]"], input[type="tel"]',
    };
  },

  resumeInput() {
    const root = this.formRoot() || document;
    return root.querySelector('input[type="file"][id*="resume" i], input[type="file"][name*="resume" i]')
      || Array.from(root.querySelectorAll('input[type="file"]')).find((i) => {
        const label = HP.fields.labelTextFor(i);
        return /resume|cv/i.test(label);
      })
      || root.querySelector('input[type="file"]');
  },

  coverLetterField() {
    const root = this.formRoot() || document;
    return root.querySelector('textarea[id*="cover" i], textarea[name*="cover" i]')
      || Array.from(root.querySelectorAll('textarea')).find(
        (t) => /cover letter/i.test(HP.fields.labelTextFor(t))
      )
      || null;
  },

  submitButton() {
    const root = this.formRoot() || document;
    return root.querySelector('#submit_app, button[type="submit"], input[type="submit"]')
      || Array.from(root.querySelectorAll('button')).find(
        (b) => /submit application|submit/i.test(HP.fields.clean(b.textContent))
      )
      || null;
  },

  // Every field that is not identity, resume, or cover letter - i.e. the
  // employer's own screening questions.
  customQuestions() {
    return HP.discovery.genericQuestions(this);
  },
};
