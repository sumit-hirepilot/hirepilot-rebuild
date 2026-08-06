/*
 * Item A — tailoring may not put a skill on someone's resume that they do not
 * have. Constraint 2, and the most consequential guard in the product: a
 * fabricated claim reaches a real employer under a real person's name and
 * cannot be unsent.
 *
 * Found by walking a fresh account through the whole path on production. A
 * resume containing no marketing anywhere came back reading "Additional
 * relevant skills for this role: Marketing", taken from the job description.
 *
 * The guard existed and was well designed - the document editor turns an
 * untraceable skill into a QUESTION rather than a silent addition - and
 * POST /api/resume/tailor simply did not call it. Two paths for one
 * operation, one of them guarded, which is A7.17's lesson exactly.
 */

const { buildCorpus, verifyAdditions } = require('../services/resumeGuard');
const { buildTailoredText } = require('../services/resumeTailorEngine');

const RESUME = [
  'Asha Menon',
  'Senior Product Designer, Bengaluru',
  'Led the design system used by 3 product teams.',
  'Shipped an onboarding redesign that lifted activation 12%.',
  'SKILLS',
  'Figma, design systems, user research, accessibility, prototyping',
].join('\n');

const corpus = () => buildCorpus({
  resumeText: RESUME,
  skills: ['Figma', 'design systems', 'user research', 'accessibility', 'prototyping'],
  experience: [],
});

describe('Item A — a skill from the job description is not a skill the person has', () => {
  it('refuses a skill that appears nowhere in the user material', () => {
    const [checked] = verifyAdditions([{ text: 'Marketing', kind: 'skill' }], corpus());
    expect(checked.ok).toBe(false);
  });

  it('accepts a skill the user actually lists', () => {
    // The negative above means nothing unless the positive still passes.
    const [checked] = verifyAdditions([{ text: 'Figma', kind: 'skill' }], corpus());
    expect(checked.ok).toBe(true);
  });
});

/*
 * The three source-scanning tests that stood here are gone deliberately.
 *
 * They asserted that routes/resume.js CONTAINS `verifyAdditions(` and
 * `needsConfirmation`. That is presence, not function: it stays green if the
 * call moves after the write, if its result is ignored, or if the route is
 * never reached at all - which is precisely the defect this file was written
 * for. Reading a guard's name in a file is not evidence the guard runs.
 *
 * The behaviour they were reaching for is now asserted where it can actually
 * be observed, in guardsFireOnTheEndpoint.test.js: the endpoint is sent a job
 * description naming a skill the resume does not have, and the response is
 * checked for the refusal. Those tests are re-run with the guard's call
 * removed by tools/prove-endpoint-guards-red.js, so they are known to fail
 * when it is unwired.
 */

describe('Item A — the engine itself only ever adds', () => {
  it('never removes existing content', () => {
    const out = buildTailoredText(RESUME, 'Marketing Figma', 'honest');
    for (const line of RESUME.split('\n')) {
      expect(out.tailoredText).toContain(line);
    }
  });

  it("keeps the user's own figure intact", () => {
    const out = buildTailoredText(RESUME, 'Figma', 'honest');
    expect(out.tailoredText).toContain('12%');
  });
});
