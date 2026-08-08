/*
 * The ATS checker counted stopwords as posting keywords.
 *
 * Observed on production 2026-08-08 against a real Greenhouse JD: 253
 * "meaningful terms" included why, how, gets, done, what, who, we'd and http,
 * the score was deflated by a denominator most of which is ordinary English,
 * and the guide advised adding the word "why" to a resume. The STOPWORDS and
 * BOILERPLATE sets covered ~50 function words of a language that needs a few
 * hundred filtered.
 *
 * Per D24, the instrument is proved in both directions: real vocabulary must
 * still come through (the known positive) before the absence of junk counts
 * as evidence of anything.
 */

const { checkAts, uniqueKeywords } = require('../services/atsChecker');

// Sentences assembled from the production JD that produced the finding.
const JD_PROSE = `
  Why join? We'd love to show you how the job's done here - what gets built,
  who takes ownership, and where your best work comes from. We're never
  satisfied and we believe over time each of us moves fast, takes ownership
  and pushes through. You'll own it from day one. Visit https://example.com
  for more. This is a rare chance to do real work at a true inflection point,
  alongside people who share the drive.
`;

const JD_REAL = `
  Staff Web Designer. Deep command of Figma and modern design systems.
  Establish component libraries, governance and accessibility standards.
  Partner with engineers on responsive prototyping and user research.
`;

describe('uniqueKeywords filters function words and URL debris', () => {
  const kws = uniqueKeywords(JD_PROSE);

  it.each([
    'why', 'how', 'what', 'who', 'where', 'when',
    'gets', 'done', 'takes', 'comes', 'moves', 'through',
    'never', 'over', 'each', 'here', 'day', 'one',
    "we'd", "we're", "you'll", "job's",
    'https', 'http', 'com', 'example',
  ])('does not count %s as a posting keyword', (w) => {
    expect(kws).not.toContain(w);
  });

  it('keeps real vocabulary - the known positive that proves the filter can see', () => {
    const real = uniqueKeywords(JD_REAL);
    for (const w of ['figma', 'design', 'component', 'libraries', 'accessibility',
      'responsive', 'prototyping', 'research', 'governance']) {
      expect(real).toContain(w);
    }
  });
});

describe('checkAts scores against vocabulary, not connectives', () => {
  it('a resume covering the real terms is not dragged down by prose filler', () => {
    const resume = `
      Principal designer. Figma, design systems, component libraries,
      accessibility standards, responsive prototyping, user research,
      design governance.
    `;
    const r = checkAts(JD_REAL + JD_PROSE, resume);
    // The real terms are covered; with the filler filtered the score reflects
    // that. Property, not literal: comfortably above the failing 15% the
    // unfiltered denominator produced for a fully-qualified candidate.
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.missing).not.toContain('why');
    expect(r.missing).not.toContain('gets');
    expect(r.missing).not.toContain("we'd");
  });

  it('possessives match their base form instead of reading as new words', () => {
    // "Harvey's platform" in a JD and "Harvey" in a resume are the same claim.
    const r = checkAts("Harvey's platform needs a designer for Figma work", 'Worked at Harvey. Figma expert.');
    expect(r.missing).not.toContain("harvey's");
    expect(r.matched).toContain('harvey');
  });
});
