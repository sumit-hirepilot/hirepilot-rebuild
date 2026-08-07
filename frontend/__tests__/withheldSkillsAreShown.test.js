/*
 * A skill the guard withheld must be visible on every page that tailors.
 *
 * The design behind the honesty guard is that an untraceable skill becomes a
 * QUESTION rather than a silent addition - the API returns it as
 * `needsConfirmation` with a reason. The resume editor had always rendered
 * them. The Tailor tab on /resume never did: it showed `matchedSkills` and the
 * score and discarded `needsConfirmation` entirely.
 *
 * That mattered much more after D51, which stopped "Marketing" (matched only
 * against "market positioning") and "UI Design" (assembled from "UX/UI
 * redesign" plus "design") from being written in. Before D51 few things were
 * withheld, so little was lost. After it, the page silently dropped exactly the
 * questions the guard exists to ask.
 *
 * Asserted on the source rather than by rendering, because this page needs a
 * live session and a real tailor result to reach that branch; the check that
 * matters is that the field reaches the markup at all.
 */

const fs = require('fs');
const path = require('path');

const pages = {
  'resume.js': fs.readFileSync(path.join(__dirname, '..', 'pages', 'resume.js'), 'utf8'),
  'resume-editor.js': fs.readFileSync(path.join(__dirname, '..', 'pages', 'resume-editor.js'), 'utf8'),
};

describe('every page that tailors shows what was withheld', () => {
  for (const [name, src] of Object.entries(pages)) {
    it(`${name} reads needsConfirmation`, () => {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code).toMatch(/needsConfirmation/);
    });
  }

  it('the Tailor tab renders the withheld skill AND its reason', () => {
    const src = pages['resume.js'];
    // The name alone is not enough - "why" is what makes it answerable.
    expect(src).toMatch(/needsConfirmation\?\.length > 0/);
    expect(src).toMatch(/s\.why/);
  });

  it('it is not presented as an error', () => {
    /*
     * Nothing has gone wrong: the job asks for something the resume does not
     * evidence. Styling it as a fault would tell the user their resume is
     * broken when the product is simply refusing to speak for them.
     */
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'Resume.module.css'), 'utf8');
    const block = css.slice(css.indexOf('.holdList'), css.indexOf('.holdNote') + 200);
    expect(block).not.toMatch(/--error|--danger|#ef4444|red/i);
  });

  it('tells the user what to do about it', () => {
    // A refusal with no next step is a dead end.
    expect(pages['resume.js']).toMatch(/Add them to your profile/i);
  });
});
