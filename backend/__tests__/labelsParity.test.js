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
  it('prefers the concept label written for people', () => {
    expect(questionLabel({ conceptLabel: 'Race and Ethnicity', matchedQuestion: 'are_you_hispanic_latino' }))
      .toBe('Race and Ethnicity');
  });

  it('humanises a bare key rather than printing it', () => {
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
