/*
 * The tailored result survives the refresh that follows it.
 *
 * handleTailor does `setResult(data)` and then `reload()`. reload() called
 * loadData, which set loading=true unconditionally, and the page swaps the
 * whole tab body for a spinner while loading - so the component unmounted and
 * its local state, including the result stored one line earlier, was destroyed.
 *
 * On production: paste a job description, press Tailor resume, the request
 * succeeds and writes a row, the mode resets to "Pick a job we have" and the
 * user sees nothing at all. The work happened and the screen threw it away.
 * It hit BOTH tailoring paths.
 *
 * Found by pasting a JD and pressing the button. No test covered it, because
 * every unit involved worked: the endpoint returned 201, the row was written,
 * the component set its state. The defect was in what happened next.
 */

const fs = require('fs');
const path = require('path');
const { stripComments } = require('../test-utils/source');

const src = stripComments(fs.readFileSync(path.join(__dirname, '..', 'pages', 'resume.js'), 'utf8'));

describe('a refresh after tailoring does not blank the tab', () => {
  it('loadData can refresh without switching on the spinner', () => {
    expect(src).toMatch(/loadData = useCallback\(async \(authToken, \{ quiet = false \} = \{\}\)/);
    expect(src).toMatch(/if \(!quiet\) setLoading\(true\)/);
  });

  it('every reload passed to a child is the quiet one', () => {
    /*
     * The assertion that matters: a single loud reload left anywhere puts the
     * defect straight back, and it is invisible in review because the call
     * looks identical.
     */
    /*
     * Line-based, because the call contains `{ quiet: true }` and a regex
     * bounded by `[^}]*` stops at that first brace - which is how the first
     * cut of this assertion found zero reloads and failed in every state,
     * including the fixed one. A test that fails identically before and after
     * the fix is measuring nothing.
     */
    const reloads = src.split('\n').filter((l) => /reload=\{/.test(l));
    expect(reloads.length).toBeGreaterThan(0);
    for (const r of reloads) expect(r).toMatch(/quiet: true/);
  });

  it('still spins on the first load, which genuinely has nothing to show', () => {
    // The spinner is correct on arrival - the fix must not remove it.
    expect(src).toMatch(/loading \?/);
    expect(src).toMatch(/setLoading\(true\)/);
  });
});
