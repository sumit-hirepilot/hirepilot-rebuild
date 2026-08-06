/*
 * A7.4 — the two humanise implementations must agree.
 *
 * backend/services/labels.js and frontend/lib/labels.js are the same function
 * in two packages that share no module. Duplication is forced; drift is not.
 * Same arrangement parsedField already uses for NOT_PARSED.
 */

const fs = require('fs');
const path = require('path');
const { humanise, questionLabel } = require('../services/labels');

describe('A7.4 — backend and frontend humanise identically', () => {
  const feSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'lib', 'labels.js'), 'utf8'
  );

  it('shares the transformation, character for character', () => {
    // Compare the body rather than the output on a sample: a sample agrees
    // right up to the input nobody thought to try.
    const body = (src) => (src.match(/replace\([^)]*\)[\s\S]*?toLowerCase\(\);/) || [''])[0]
      .replace(/\s+/g, '');
    const beSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'labels.js'), 'utf8');
    expect(body(beSrc)).toBe(body(feSrc));
    expect(body(beSrc).length).toBeGreaterThan(40);
  });

  it.each([
    ['are_you_hispanic_latino', 'Are you hispanic latino'],
    ['veteran_status', 'Veteran status'],
    ['disability_status', 'Disability status'],
  ])('humanises %s', (k, want) => {
    expect(humanise(k)).toBe(want);
  });
});

describe('A7.4 — a demographic key is never quoted back at the user', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'screeningPrefill.js'), 'utf8'
  );

  it('names the answer that did not fit, not the question key it came from', () => {
    /*
     * The page read: Your saved answer to "are_you_hispanic_latino" is not one
     * of this form's options. Preferring conceptLabel did not fix it - the
     * stored concept labels ARE those keys, so the first attempt printed the
     * same token by a different route.
     *
     * Rewritten from matching the sentence literal, which A7.4b's extraction
     * into optionMismatchReason moved: the guard failed on a change that did
     * not touch the behaviour. The property is that no reason is built from a
     * question identifier.
     */
    const reasons = src.match(/reason: [^,\n]+/g) || [];
    expect(reasons.length).toBeGreaterThanOrEqual(4);
    for (const r of reasons) {
      expect(r).not.toMatch(/matchedQuestion|conceptLabel|questionLabel/);
    }
  });

  it('says the same thing in both branches', () => {
    // Two messages for one situation is two situations to a reader, so the
    // sentence has exactly one definition and both branches call it.
    const literals = src.match(/`Your saved answer \([^`]*`/g) || [];
    expect(literals).toHaveLength(1);
    expect((src.match(/optionMismatchReason\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('still humanises a bare key wherever one is displayed', () => {
    const out = questionLabel({ matchedQuestion: 'are_you_hispanic_latino' });
    expect(out).not.toMatch(/_/);
    expect(out).toBe('Are you hispanic latino');
  });

  it('leaves a real question alone', () => {
    // Already written for people - lowercasing it would be a regression.
    const q = 'Are you currently located in the US?';
    expect(questionLabel({ matchedQuestion: q })).toBe(q);
  });
});
