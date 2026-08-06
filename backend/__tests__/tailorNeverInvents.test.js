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

const fs = require('fs');
const path = require('path');
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

describe('Item A — the tailor route runs the guard', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'resume.js'), 'utf8');
  const route = src.slice(src.indexOf("router.post('/tailor'"), src.indexOf("router.delete('/tailored/:id'"));

  it('verifies every proposed skill before it can reach the text', () => {
    expect(route).toMatch(/verifyAdditions\(/);
    expect(route).toMatch(/corpusFor\(req\.user\.id/);
  });

  it('builds the tailored text from the ALLOWED set, not the proposed set', () => {
    /*
     * Filtering the finished text instead would leave the sentence that
     * introduces the skills in place - a heading promising skills that are not
     * there is its own small lie.
     */
    expect(route).toMatch(/allowedSkills/);
    expect(route).not.toMatch(/const \{ tailoredText, addedSkills, matchedSkills \} = buildTailoredText/);
  });

  it('states what it withheld rather than dropping it silently', () => {
    // A skill the user genuinely has but never listed is theirs to confirm.
    expect(route).toMatch(/needsConfirmation/);
  });
});

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
