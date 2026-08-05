/*
 * Every path that can submit must honour the verified-adapter whitelist.
 *
 * The server whitelist alone is not blocking: the extension resolves its
 * adapter from the PAGE, not from the server, so a user sitting on a posting
 * whose adapter has never been verified can reach it directly. The queue-run
 * path checked item.automationSupported; the drawer's "Fill this form" did not,
 * so the same application the queue refused to touch could be submitted by
 * hand through unverified code.
 *
 * This pins BOTH gates. A new submit entry point added without one fails here.
 */

const fs = require('fs');
const path = require('path');

const bg = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extension', 'background.js'), 'utf8'
);

// Each block that can reach HP_EXECUTE, with comments stripped so prose about
// the gate cannot pass for the gate.
function blockFor(marker, end) {
  const i = bg.indexOf(marker);
  const j = end ? bg.indexOf(end, i) : bg.length;
  return bg.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('every submit path honours the verified-adapter whitelist', () => {
  it('the queue-run path refuses an unsupported adapter', () => {
    const run = blockFor('async function processOne', 'async function pause');
    expect(run).toMatch(/!item\.automationSupported\b/);
    // Anchored: /HP_EXECUTE/ is satisfied by HP_EXECUTE_ANYTHING.
    expect(run).toMatch(/\bHP_EXECUTE\b/);
  });

  it('the drawer fill path refuses an unsupported adapter', () => {
    const drawer = blockFor("case 'HP_DRAWER_FILL'", "case 'HP_SET_SUBMIT'");
    expect(drawer).toMatch(/\bHP_EXECUTE\b/);
    // The gate must exist, and must sit BEFORE the execute call - a check after
    // the form has been filled is not a gate.
    expect(drawer).toMatch(/\bautomationSupported\b/);
    expect(drawer.indexOf('automationSupported')).toBeLessThan(drawer.indexOf('HP_EXECUTE'));
  });

  /*
   * COARSE BACKSTOP - this one passed against the ungated version, because
   * processOne's check appears earlier in the file and "somewhere before" is
   * satisfied by an unrelated occurrence. It catches a new HP_EXECUTE added to
   * a file with no whitelist logic at all; it does NOT catch one added below an
   * existing gate that does not apply to it. The two tests above do the real
   * work, and a third entry point needs its own explicit test.
   */
  it('every HP_EXECUTE send in the file is preceded by a whitelist check', () => {
    const stripped = bg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const executes = [...stripped.matchAll(/type:\s*'HP_EXECUTE'/g)].map((m) => m.index);
    expect(executes.length).toBeGreaterThan(0);
    for (const at of executes) {
      const before = stripped.slice(0, at);
      expect(before).toMatch(/\bautomationSupported\b/);
    }
  });
});
