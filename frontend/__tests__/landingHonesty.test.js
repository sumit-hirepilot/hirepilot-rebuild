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

describe('G0.3 — meta and copy hygiene', () => {
  const layout = fs.readFileSync(path.join(__dirname, '..', 'components', 'Layout.js'), 'utf8');

  it('computes the copyright year rather than hardcoding it', () => {
    expect(layout).toMatch(/getFullYear\(\)/);
    // Any bare four-digit year in the footer line is a year that will go stale.
    const footerLine = layout.split('\n').find((l) => /©|&copy;/.test(l)) || '';
    expect(footerLine).not.toMatch(/\b(19|20)\d{2}\b/);
  });

  it('has OG and Twitter card tags', () => {
    /*
     * Anchored on the closing quote, not toContain.
     *
     * `expect(code).toContain('og:image')` is satisfied by `og:imagex` - the
     * substring is still there. The mutation audit caught this: renaming every
     * og:image to og:imagex left this assertion green, so the tag could be
     * misspelled into non-existence and the guard would not notice.
     */
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card', 'twitter:image']) {
      expect(code).toMatch(new RegExp(`["']${tag}["']`));
    }
    expect(code).toMatch(/twitter:card"\s+content="summary_large_image"/);
  });

  it('does not lead the homepage with what the product lacks', () => {
    // The "NO FAKE AUTO-SUBMIT" block sat in the main scroll. Its substance
    // moved to the FAQ; leading with a disclaimer is not a value proposition.
    expect(code).not.toMatch(/NO FAKE AUTO-SUBMIT/i);
  });

  it('does not claim it cannot submit, which is no longer true', () => {
    // The FAQ said "Not yet" after the extension had already submitted with a
    // captured employer confirmation. Copy follows the product.
    expect(code).not.toMatch(/does not currently submit/i);
  });
});
