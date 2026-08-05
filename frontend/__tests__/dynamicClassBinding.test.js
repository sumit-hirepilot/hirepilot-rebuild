/*
 * A3-a — classes reached by a computed key, bound to their enum.
 *
 * cssClassResolution.test.js matches `styles.foo`, so it cannot see
 * ``page[`state_${c.state}`]`` or ``page[`s_${item.status}`]``. Extending the
 * regex to parse those expressions is the wrong instrument: regex over source
 * has already produced BOTH error directions in this project - H4 was a false
 * positive (grouped selectors a line-anchored pattern could not see) and
 * `state_${x}` a false negative.
 *
 * So bind to the enum instead, the way adapterStatus.test.js binds coverage to
 * SUPPORTED_ATS. Both directions, so neither list can drift:
 *   every value the code can produce  ->  has a class
 *   every class the sheet defines     ->  has a value that reaches it
 * No expression is parsed at all.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function definedClasses(cssPath, prefix) {
  const css = fs.readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set();
  for (const block of css.split('}')) {
    const selector = block.split('{')[0];
    if (!selector) continue;
    for (const m of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      if (m[1].startsWith(prefix)) names.add(m[1].slice(prefix.length));
    }
  }
  return names;
}

describe('A3-a — Auto Apply coverage dots', () => {
  const source = fs.readFileSync(path.join(ROOT, 'pages', 'auto-apply.js'), 'utf8');
  const sheet = path.join(ROOT, 'styles', 'AutoApply.module.css');

  // The enum is every `state` the COVERAGE table can hold - the only values
  // that can ever reach page[`state_${c.state}`].
  const block = source.slice(source.indexOf('const COVERAGE = ['));
  const states = new Set(
    [...block.slice(0, block.indexOf('];')).matchAll(/state:\s*'(\w+)'/g)].map((m) => m[1])
  );
  const classes = definedClasses(sheet, 'state_');

  it('reads a non-empty enum and a non-empty class set', () => {
    // Either side coming back empty would make the checks below vacuous - the
    // exact way a source-scan guard passes while testing nothing.
    expect(states.size).toBeGreaterThan(0);
    expect(classes.size).toBeGreaterThan(0);
  });

  it('defines a class for every state the code can produce', () => {
    expect([...states].filter((s) => !classes.has(s))).toEqual([]);
  });

  it('has no state_ class that no state can reach', () => {
    expect([...classes].filter((c) => !states.has(c))).toEqual([]);
  });
});

describe('A3-a — Apply Queue status pills', () => {
  const source = fs.readFileSync(path.join(ROOT, 'pages', 'apply-queue.js'), 'utf8');
  const sheet = path.join(ROOT, 'styles', 'ApplyQueue.module.css');

  /*
   * These statuses come from the server, not from a literal table, so the enum
   * is the apply pipeline's own vocabulary. Pinning it here means adding a
   * status server-side without styling it fails a test rather than rendering
   * an unstyled pill.
   */
  const STATUSES = ['needs_user', 'approved', 'submitting', 'submitted', 'failed', 'ready_for_review'];
  const classes = definedClasses(sheet, 's_');

  it('reads a non-empty class set', () => {
    expect(classes.size).toBeGreaterThan(0);
  });

  it('defines a class for every pipeline status', () => {
    expect(STATUSES.filter((s) => !classes.has(s))).toEqual([]);
  });

  it('has no s_ class outside the pipeline vocabulary', () => {
    expect([...classes].filter((c) => !STATUSES.includes(c))).toEqual([]);
  });

  it('uses the same vocabulary the backend writes', () => {
    // If the server can emit a status this list does not know about, the pill
    // renders unstyled and this test is the only thing that would say so.
    const applyRoute = fs.readFileSync(
      path.join(ROOT, '..', 'backend', 'routes', 'apply.js'), 'utf8'
    );
    const serverStatuses = new Set(
      [...applyRoute.matchAll(/status\s*=\s*'(\w+)'/g)].map((m) => m[1])
    );
    const unstyled = [...serverStatuses].filter(
      (s) => !STATUSES.includes(s) && !['skipped', 'discarded', 'applied'].includes(s)
    );
    expect(unstyled).toEqual([]);
  });
});
