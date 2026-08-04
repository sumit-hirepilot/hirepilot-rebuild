/*
 * G0.2 + G0.5 — the landing page must not carry invented figures.
 *
 * This asserts on properties of the source, not on literals, per the standing
 * rule. It is a guard against regression: the page has twice shipped numbers
 * that were not computed - "180+" gated on a boolean while the truth was 153,
 * and a fabricated 87% match on a job that does not exist.
 *
 * Deliberately reads the SOURCE rather than rendering. A caption saying
 * "illustrative" is exactly what this is meant to catch, and a renderer would
 * happily produce it.
 */

const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, '..', 'pages', 'index.js');
const src = fs.readFileSync(INDEX, 'utf8');

// Strip comments: the file legitimately DISCUSSES the old fabrications, and
// prose about a bug must not read as the bug.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('landing page carries no invented figures', () => {
  it('renders no "Illustrative example" label', () => {
    // `code`, not `src`: comments in this file discuss the old label, and a
    // comment does not render. Checking the raw source would fail on its own
    // documentation - which is precisely the mistake this assertion caught.
    expect(code).not.toMatch(/Illustrative example/i);
  });

  it('renders no hardcoded count with a + or k suffix', () => {
    // "180+", "5k+", "1M+" - the shape of a figure someone rounded up rather
    // than counted. Excludes CSS-ish and unicode-range noise by requiring the
    // match to sit inside a quoted string.
    const suffixed = code.match(/['"`]\s*\d[\d,.]*\s*[+kKmM]\+?\s*['"`]/g) || [];
    expect(suffixed).toEqual([]);
  });

  it('renders no hardcoded percentage as a display string', () => {
    const pct = code.match(/['"`]\s*\d{1,3}\s*%\s*['"`]/g) || [];
    expect(pct).toEqual([]);
  });

  it('declares no example/mock/sample/fake data constant', () => {
    const mocks = code.match(/const\s+\w*(EXAMPLE|MOCK|SAMPLE|FAKE|DUMMY|PLACEHOLDER)\w*\s*=/gi) || [];
    expect(mocks).toEqual([]);
  });

  it('shows scoring weights that sum to 100 and match the engine', () => {
    // The weights are a claim about how the product works. If the engine's
    // weights change and these do not, the page is lying about its own maths.
    const engine = fs.readFileSync(
      path.join(__dirname, '..', '..', 'backend', 'services', 'matchingEngine.js'),
      'utf8'
    );
    const fromEngine = [...engine.matchAll(/Score \* (0\.\d+)/g)]
      .map((m) => Math.round(parseFloat(m[1]) * 100))
      .sort((a, b) => b - a);
    const fromPage = [...code.matchAll(/weight:\s*(\d+)/g)]
      .map((m) => Number(m[1]))
      .sort((a, b) => b - a);

    expect(fromPage.length).toBeGreaterThan(0);
    expect(fromPage.reduce((a, b) => a + b, 0)).toBe(100);
    expect(fromPage).toEqual(fromEngine);
  });
});
