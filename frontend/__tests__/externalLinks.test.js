/*
 * A7.21 — an external link must not hand over the opener.
 *
 * The audit found every external link on production already carrying
 * rel="noreferrer" - 29 route/width combinations, zero misses. This guard
 * exists so the next one added cannot be the exception, which is the only way
 * this defect ever appears.
 *
 * target="_blank" without rel gives the opened page a window.opener handle on
 * the tab it came from. Every external link here goes to a job board or a
 * LinkedIn search - third-party pages, reached from a page holding a signed-in
 * session.
 */

const fs = require('fs');
const path = require('path');
const { stripComments } = require('../test-utils/source');

const roots = [path.join(__dirname, '..', 'pages'), path.join(__dirname, '..', 'components')];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}

describe('A7.21 — every new-tab link is opener-safe', () => {
  it('has no target="_blank" without rel noopener or noreferrer', () => {
    const offenders = [];
    for (const root of roots) {
      for (const f of walk(root)) {
        const src = stripComments(fs.readFileSync(f, 'utf8'));
        // Each <a ...> tag that opens a new tab, checked for its own rel.
        for (const tag of src.match(/<a\b[^>]*>/g) || []) {
          if (!/target=\{?["']_blank/.test(tag)) continue;
          if (!/rel=\{?["'][^"'}]*no(opener|referrer)/.test(tag)) {
            offenders.push(`${path.basename(f)}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds the new-tab links it is meant to be checking', () => {
    /*
     * D24 - the negative above is worthless unless this scan can see the thing
     * it scans for. If a refactor moved every external link into a component
     * this file does not read, "no offenders" would be vacuously true.
     */
    let blanks = 0;
    for (const root of roots) {
      for (const f of walk(root)) {
        blanks += (stripComments(fs.readFileSync(f, 'utf8')).match(/target=\{?["']_blank/g) || []).length;
      }
    }
    expect(blanks).toBeGreaterThan(2);

    /*
     * Anchored to a page known to carry one. A repo-wide floor alone cannot
     * fail when a single file loses its links - the rest of the codebase keeps
     * the count above the floor - so the sentinel would be untestable, which
     * is the same defect it exists to prevent.
     */
    const network = stripComments(
      fs.readFileSync(path.join(__dirname, '..', 'pages', 'network.js'), 'utf8')
    );
    expect((network.match(/target=\{?["']_blank/g) || []).length).toBeGreaterThan(0);
  });
});
