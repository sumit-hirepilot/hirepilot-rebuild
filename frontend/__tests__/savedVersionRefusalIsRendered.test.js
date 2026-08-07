/*
 * Feature 8, boundary honesty — the save refusal reaches the screen.
 *
 * `POST /api/resume/company-versions` answers 422 with `{reason, detail}` when
 * the job has no company to file the version under: a pasted JD has no
 * verified employer, a linked job whose page never named one is stored NULL,
 * and aggregators have written placeholders like "name" into the field.
 *
 * The server refusing correctly is worth nothing if the page drops it. That
 * exact shape has now shipped twice in this codebase - preparationFailed on
 * the Jobs page and needsConfirmation on the Tailor tab - so it is asserted
 * here as the feature is built rather than swept for afterwards.
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'pages', 'resume.js'), 'utf8');

/*
 * The rule's own body, by braces - not a fixed character window.
 *
 * The first version of this took `slice(indexOf('.holdList'), indexOf('.holdNote') + 200)`
 * and matched /red/i over it. That window ran past the rule into the next
 * comment, and "red" matched inside "tailo(red)". A colour assertion that
 * fires on ordinary prose is a test that will be deleted the first time it
 * cries wolf.
 */
function ruleBody(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/* Colour DECLARATIONS, not words that happen to contain a colour name. */
const ALARMING = /(?:color|background|background-color|border(?:-[a-z]+)?)\s*:\s*[^;]*(?:--error|--danger|--red|#ef4444|#f87171|#dc2626|\bred\b|crimson)/i;

const handler = src.slice(src.indexOf('const handleSaveVersion'), src.indexOf('const handleConfirm'));

describe('the save handler keeps the failure', () => {
  it('reads the server\'s own sentence rather than inventing one', () => {
    expect(handler).toMatch(/data\.detail/);
  });

  it('falls back to something concrete, never an empty box', () => {
    // A blank refusal is indistinguishable from a success that did nothing.
    expect(handler).toMatch(/data\.detail \|\| data\.error \|\|/);
    expect(handler).toMatch(/res\.status/);
  });

  it('distinguishes success from refusal rather than one shared flag', () => {
    expect(handler).toMatch(/ok: true/);
    expect(handler).toMatch(/ok: false/);
  });

  it('cannot be fired twice while in flight', () => {
    expect(handler).toMatch(/if \(savingVersion/);
  });

  it('clears the busy state even when the request throws', () => {
    expect(handler).toMatch(/finally\s*\{\s*setSavingVersion\(false\)/);
  });
});

describe('the refusal is rendered', () => {
  it('has its own branch in the markup', () => {
    expect(src).toMatch(/saveVersionState && !saveVersionState\.ok/);
    expect(src).toMatch(/\{saveVersionState\.detail\}/);
  });

  it('says when it replaced an earlier version, because the user had one', () => {
    expect(src).toMatch(/saveVersionState\.replaced/);
    expect(src).toMatch(/replaced the version you had saved/i);
  });

  it('is not styled as an error', () => {
    /*
     * Nothing has gone wrong: the product is declining to file a resume under a
     * company it cannot verify. Red would blame the user for the absence.
     */
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'Resume.module.css'), 'utf8');
    expect(ruleBody(css, '.versionRefused')).not.toMatch(ALARMING);
  });
});
