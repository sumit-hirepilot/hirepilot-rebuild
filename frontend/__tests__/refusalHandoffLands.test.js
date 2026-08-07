/*
 * The refusal handoff has to LAND, not just point.
 *
 * When a board declines an automated request, feature 4a's refusal is the
 * product's answer, not an error: it names the board and offers
 * "Paste the description instead ->" at /resume?tab=Tailor%20for%20a%20Job.
 *
 * The href was correct and the destination ignored it. /resume never honoured
 * `?tab=`, so the link opened Resume Manager and the paste box - the one path
 * that always works when a board refuses - was unreachable from the place that
 * offers it.
 *
 * Nothing caught it because everything about it looked right: the component
 * rendered, the link existed, the URL was well-formed. It was found by
 * CLICKING it on production and reading which tab came up.
 *
 * So this asserts the two halves that have to agree, on both sides of the
 * jump, rather than either one alone.
 */

const fs = require('fs');
const path = require('path');
const { stripComments } = require('../test-utils/source');

const read = (...p) => stripComments(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

describe('a refusal points somewhere that opens the paste box', () => {
  const link = read('components', 'AddJobByLink.js');
  const resume = read('pages', 'resume.js');

  it('offers the handoff whenever the board says the paste box would work', () => {
    expect(link).toMatch(/canPaste\s*&&/);
    expect(link).toMatch(/Paste the description instead/);
  });

  it('points at the Tailor tab by its real name', () => {
    /*
     * The tab name is matched against TABS on the other side, so a typo here
     * silently falls back to the default tab - which is the defect, exactly.
     */
    const href = link.match(/href="\/resume\?tab=([^"]+)"/);
    expect(href).not.toBeNull();
    const wanted = decodeURIComponent(href[1]);

    const tabs = resume.match(/const TABS = \[([^\]]+)\]/);
    expect(tabs).not.toBeNull();
    expect(tabs[1]).toContain(`'${wanted}'`);
  });

  it('and /resume actually honours ?tab=, which is what was missing', () => {
    expect(resume).toMatch(/router\.query\.tab/);
    expect(resume).toMatch(/TABS\.includes\(t\)/);
    expect(resume).toMatch(/setTab\(t\)/);
  });

  it('uses next/link, because an <a> to an internal page fails the build', () => {
    /*
     * Not style. `next build` treats <a href="/resume"> as an ERROR, so this
     * exact line is what stopped feature 4a's frontend from ever deploying -
     * the gate ran ten stages of green tests over a bundle that could not be
     * built.
     */
    expect(link).toMatch(/<Link\b[^>]*href="\/resume/);
    expect(link).not.toMatch(/<a\b[^>]*href="\/(resume|jobs|settings|tracker)/);
  });
});
