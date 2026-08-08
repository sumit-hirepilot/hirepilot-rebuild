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

/*
 * EVERY narrow-viewport block, concatenated - not just the first.
 *
 * The rules that make the header fit had to move to the end of the sheet:
 * `.extensionCta` and `.creditsPill` are defined at ~1250 and ~1330, so an
 * override placed in the earlier media query lost to them at equal specificity
 * and silently did nothing. A test that reads only the first block would have
 * gone green while the header was still clipped - which is the failure mode
 * this whole file exists to catch.
 */
function narrowBlocks() {
  const out = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf('@media (max-width: 640px)', from);
    if (at < 0) break;
    let depth = 0;
    let end = css.length;
    for (let i = css.indexOf('{', at); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    out.push(css.slice(at, end));
    from = end;
  }
  return out;
}

const blocks = narrowBlocks();
const narrow = blocks.join('\n');

describe('at 375 the header cannot push controls off-screen', () => {
  it('has narrow-viewport rules at all', () => {
    expect(blocks.length).toBeGreaterThan(0);
    expect(narrow.length).toBeGreaterThan(200);
  });

  it('the shrinking rules come AFTER the base rules they override', () => {
    /*
     * A media query adds no specificity, so an override earlier in the sheet
     * than the rule it targets simply loses. Both of these did, and did
     * nothing, until they were moved.
     */
    const label = css.indexOf('.extensionCtaLabel {\n    display: none;');
    const baseCta = css.indexOf('.extensionCta {');
    const baseCredits = css.indexOf('.creditsPill, .creditsPillLow {');
    expect(label).toBeGreaterThan(baseCta);
    expect(label).toBeGreaterThan(baseCredits);
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
