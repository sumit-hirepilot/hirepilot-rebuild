/*
 * A2c — the class guard.
 *
 * The per-value rules live in renderState.test.js. This one stops the class
 * reappearing in a component nobody has touched yet, because that is how it
 * spread: three separate pages each independently wrote `useState(0)` for a
 * count and `|| 0` for a response field, and each looked reasonable in
 * isolation.
 *
 * Source-level on purpose. Rendering every page would need each page's whole
 * mock surface, and the defect is visible in the source: a count whose initial
 * value is 0 cannot distinguish "not asked yet" from "the server said none".
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  walk(path.join(ROOT, 'pages'));
  walk(path.join(ROOT, 'components'));
  return out;
}

// Comments legitimately quote the old broken code - including in this repo's
// own fix commentary. Prose about a bug is not the bug.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FILES = sourceFiles().map((f) => ({
  file: path.relative(ROOT, f),
  code: stripComments(fs.readFileSync(f, 'utf8')),
}));

describe('A2c — no component may represent "unknown" as zero', () => {
  it('finds source files to check at all', () => {
    // A guard that silently scans nothing is the failure mode this project has
    // already hit twice. Assert the corpus is non-empty before trusting it.
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('initialises no count-like state to 0', () => {
    const offenders = [];
    for (const { file, code } of FILES) {
      const hits = code.match(
        /const \[\w*(?:[Cc]ount|[Tt]otal)\w*, set\w+\] = useState\(0\)/g
      ) || [];
      if (hits.length) offenders.push(`${file}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('never coerces an absent count from a response into 0', () => {
    // `data.total || 0` turns a missing field, a failed parse and a real zero
    // into the same number.
    const offenders = [];
    for (const { file, code } of FILES) {
      const hits = code.match(
        /set\w*(?:Count|Total)\w*\(\s*\w+\.\w+\s*\|\|\s*0\s*\)/g
      ) || [];
      if (hits.length) offenders.push(`${file}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('writes a literal 0 to a count only where the zero is measured', () => {
    /*
     * A failure branch that writes 0 renders the failure as an empty result
     * set - which is what made a broken job search read as "no jobs".
     *
     * But some zeros are real: marking every notification read genuinely
     * leaves zero unread. Rather than ban the assignment, require it to be
     * annotated `real-zero:` with the reason. The first version of this
     * assertion flagged exactly that case, which is why it is a marker and
     * not a blanket rule - reading the hit before counting it as evidence.
     */
    const offenders = [];
    for (const { file } of FILES) {
      const raw = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
      raw.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return; // prose, not code
        if (!/set\w*(?:Count|Total)\w*\(\s*0\s*\)/.test(line)) return;
        if (/real-zero:/.test(line)) return; // justified in place
        offenders.push(`${file}:${i + 1} ${trimmed}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
