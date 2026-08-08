/*
 * The dashboard header must FIT at 375, and it did not.
 *
 * Measured on production, with getBoundingClientRect on every element rather
 * than by looking: ten had a right edge past the 375px viewport. The worst was
 * the Auto-Pilot toggle at 452px - a safety control 77px off-screen and
 * unreachable on a phone. The notification bell was at 396px and a tab at
 * 403px.
 *
 * `document.scrollWidth` read exactly 375 the whole time, which is why nothing
 * caught it. The header is a non-wrapping flex row, so what happens is not
 * overflow-you-can-scroll-to but CLIPPING, and a page reports no overflow when
 * its content is clipped. That is D5 again: a 530px header inside 375 rendered
 * the number "4500" as "45", and the overflow property said everything was
 * fine there too.
 *
 * A rendering test would be the right instrument and this page needs a live
 * session to reach; what is asserted here is that the rules which make it fit
 * exist and say why, so removing them is a deliberate edit.
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'Dashboard.module.css'), 'utf8');

/** The body of the narrow-viewport media query. */
function narrowBlock() {
  const at = css.indexOf('@media (max-width: 640px)');
  if (at < 0) return '';
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(at, i + 1);
    }
  }
  return '';
}

const narrow = narrowBlock();

describe('at 375 the header cannot push controls off-screen', () => {
  it('has a narrow-viewport block at all', () => {
    expect(narrow.length).toBeGreaterThan(200);
  });

  it('drops the extension button\'s visible label', () => {
    // Its accessible name stays; only the text goes.
    expect(narrow).toMatch(/\.extensionCtaLabel\s*\{[^}]*display:\s*none/);
  });

  it('shrinks the credits pill to its number', () => {
    expect(narrow).toMatch(/\.creditsNum/);
  });

  it('lets the title truncate instead of pushing the row wider', () => {
    const title = narrow.slice(narrow.indexOf('.headerTitle'));
    expect(title).toMatch(/min-width:\s*0/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('stops the header forcing the row wider than the viewport', () => {
    const header = narrow.slice(narrow.indexOf('.header {'));
    expect(header).toMatch(/overflow:\s*hidden/);
  });

  it('keeps the Auto-Pilot control reachable rather than hiding it', () => {
    /*
     * The fix must not be "hide the toggle". It is the kill switch for
     * automated submission; a control that disappears on a phone is worse than
     * a cramped one.
     */
    /*
     * The rule for the PILL, not the one for its label span. `.autoPilotPill
     * span:first-child { display: none }` legitimately hides the word
     * "Auto-Pilot" while the toggle itself stays - a first cut of this
     * assertion sliced from the first occurrence of the class name and caught
     * that, failing on correct code.
     */
    const at = narrow.indexOf('.autoPilotPill {');
    expect(at).toBeGreaterThan(-1);
    const body = narrow.slice(narrow.indexOf('{', at) + 1, narrow.indexOf('}', at));
    expect(body).not.toMatch(/display:\s*none/);
  });
});
