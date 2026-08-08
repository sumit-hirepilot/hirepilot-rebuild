/*
 * E2 — the check the sandbox structurally cannot do.
 *
 * The ATS sandbox is built to the Greenhouse adapter's own selectors, so it
 * can only ever confirm the adapter agrees with itself. This runs the SHIPPED
 * adapter (extension/content/fields.js + adapters/greenhouse.js, loaded
 * unmodified) against REAL Greenhouse application DOM captured from production
 * boards, and asserts the load-bearing selectors still resolve.
 *
 * Read-only: the adapter's resolver methods are called; nothing is filled,
 * clicked or submitted, and no network request is made (fixtures are on disk).
 * Refresh the fixtures with `node tools/check-greenhouse-selectors.js --live`.
 *
 * jsdom sees server-rendered DOM. The modern job-boards.greenhouse.io board
 * renders the whole form server-side, so this is faithful to what the content
 * script queries there. Careers-domain embeds mount the form with client JS
 * and are out of jsdom's reach by construction - they are asserted to be
 * DETECTED as such, not silently passed.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const FIX = path.join(__dirname, '..', '..', 'extension', 'test', 'fixtures', 'greenhouse');
const EXT = path.join(__dirname, '..', '..', 'extension', 'content');
const FIELDS = fs.readFileSync(path.join(EXT, 'fields.js'), 'utf8');
const ADAPTER = fs.readFileSync(path.join(EXT, 'adapters', 'greenhouse.js'), 'utf8');

function adapterOn(html, url = 'https://job-boards.greenhouse.io/x/jobs/1') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const ctx = dom.getInternalVMContext();
  vm.runInContext(FIELDS, ctx);
  vm.runInContext(ADAPTER, ctx);
  return dom.window;
}

// The server-rendered boards whose form is fully in the SSR HTML.
const SSR_BOARDS = ['anthropic', 'cloudflare', 'gitlab'];

describe('Greenhouse adapter resolves the load-bearing selectors on real DOM', () => {
  for (const board of SSR_BOARDS) {
    describe(board, () => {
      const html = fs.readFileSync(path.join(FIX, `${board}.html`), 'utf8');
      const w = adapterOn(html);
      const A = w.HP.adapters.greenhouse;
      const root = A.formRoot();

      it('claims the page', () => expect(A.matches()).toBe(true));
      it('finds the application form', () => {
        expect(root).toBeTruthy();
        expect(root.tagName).toBe('FORM');
        expect(root.id).toBe('application-form');
      });
      it('resolves first name, last name and email uniquely', () => {
        const ids = A.identityFields();
        for (const k of ['first_name', 'last_name', 'email']) {
          const n = root.querySelectorAll(ids[k]).length;
          expect(n).toBe(1);
        }
      });
      it('finds the resume file input and the submit button', () => {
        expect(A.resumeInput()).toBeTruthy();
        expect(A.submitButton()).toBeTruthy();
      });
    });
  }

  it('detects a careers-domain client-rendered embed rather than misreading it', () => {
    const html = fs.readFileSync(path.join(FIX, 'elastic-careersdomain.html'), 'utf8');
    const w = adapterOn(html, 'https://jobs.elastic.co/jobs?gh_jid=1');
    // matches (the page advertises greenhouse) but the SSR DOM has no controls
    expect(w.HP.adapters.greenhouse.matches()).toBe(true);
    expect(w.document.querySelectorAll('input, textarea, select').length).toBe(0);
  });

  it('would FAIL if the form id and email selector drifted (instrument proven bad-direction)', () => {
    const base = fs.readFileSync(path.join(FIX, 'anthropic.html'), 'utf8');
    const drifted = base
      .replace(/id="application-form"/g, 'id="app-form-v2"')
      .replace(/id="email"/g, 'id="email_address"')
      .replace(/name="email"/g, 'name="email_address"')
      .replace(/type="email"/g, 'type="text"');
    const w = adapterOn(drifted);
    const A = w.HP.adapters.greenhouse;
    const root = A.formRoot();
    const emailMatches = (root || w.document).querySelectorAll(A.identityFields().email).length;
    // On drifted markup the proper form id is gone and email no longer resolves.
    const properForm = root && root.tagName === 'FORM' && root.id === 'application-form';
    expect(properForm).toBe(false);
    expect(emailMatches).toBe(0);
  });
});
