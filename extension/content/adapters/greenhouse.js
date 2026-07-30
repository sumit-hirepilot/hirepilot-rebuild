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

  /*
   * Hostname is not sufficient. Roughly a third of Greenhouse boards redirect to
   * the company's own careers domain and embed the form there - verified live
   * that job-boards.greenhouse.io/okta/... lands on www.okta.com, which still
   * serves a genuine Greenhouse application form. Matching only on hostname
   * meant no adapter claimed those pages at all.
   */
  matches() {
    if (/greenhouse\.io/i.test(location.hostname)) return true;
    // Greenhouse's own job id, carried through the redirect.
    if (/[?&]gh_jid=/i.test(location.search)) return true;
    // Embedded board: its markup and asset host are distinctive.
    if (document.querySelector('#application_form, #application-form, #grnhse_app')) return true;
    if (document.querySelector('[src*="greenhouse.io"], [href*="greenhouse.io"], [action*="greenhouse.io"]')) return true;
    // The legacy embed names its fields job_application[...].
    return Boolean(document.querySelector('input[name^="job_application"]'));
  },

  // Greenhouse serves the form on the posting page itself (React board) or at
  // a /application path (legacy). Returns the form root, or null if we are on
  // a posting page that still needs the "Apply" click.
  /*
   * Known ids first, then a markup-agnostic fallback.
   *
   * On a company careers domain the embed is rendered into the host page's own
   * markup, which uses none of Greenhouse's ids and may not even be a <form>
   * element - verified on www.okta.com, where the form is present (it appears in
   * a rendered screenshot) but every fixed selector missed it. Anchoring on the
   * resume file input instead works regardless of the surrounding markup: if
   * there is a resume upload, that is the application form.
   */
  formRoot() {
    const known = document.querySelector(
      '#application_form, form#application-form, [data-testid="application-form"], form[action*="application"], #grnhse_app'
    );
    if (known) return known;

    const fileInput = Array.from(document.querySelectorAll('input[type="file"]'))
      .find((i) => /resume|cv/i.test(`${i.id} ${i.name} ${HP.fields.labelTextFor(i)}`))
      || document.querySelector('input[type="file"]');
    if (fileInput) {
      // Walk up to a container that also holds the identity fields, so the root
      // spans the whole form rather than just the upload widget.
      let node = fileInput.parentElement;
      for (let i = 0; i < 8 && node; i += 1) {
        if (node.querySelector('input[type="email"], input[type="tel"]')) return node;
        node = node.parentElement;
      }
      return fileInput.closest('form') || document.body;
    }

    return document.querySelector('main form') || document.querySelector('form') || null;
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
