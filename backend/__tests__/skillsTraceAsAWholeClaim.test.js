/*
 * A skill must trace to the user's material as a WHOLE CLAIM, not as a bag of
 * words that each turn up somewhere.
 *
 * Found on production, tailoring a real resume against real Greenhouse
 * postings. Two skills were written into the resume that the person had never
 * claimed:
 *
 *   "Marketing"  stem() strips -ing, so "marketing" becomes "market", and the
 *                resume contains "aligning product experience with market
 *                positioning". The word "marketing" appears nowhere in the
 *                resume, the recorded skills, or the work history.
 *   "UI Design"  assembled from "UX/UI redesign" in one role and "design" in
 *                another - two unrelated places, neither making that claim.
 *
 * "Marketing" is the literal example in the comment on the tailor route
 * describing what this guard was built to stop, so the defect had come all the
 * way back round while every test stayed green. The tests that existed checked
 * that an obviously-invented skill was rejected; none checked a skill whose
 * WORDS were present but whose CLAIM was not.
 *
 * A resume goes out under someone's name and cannot be unsent. Constraint 2.
 */

const { buildCorpus, verifyAdditions } = require('../services/resumeGuard');

/* The shape of the real resume that surfaced this. */
const corpus = buildCorpus({
  resumeText: `
    Senior Product Designer, AI and Enterprise SaaS UX, 9+ years.
    Defined UX strategy for the BuzzED EdTech platform, aligning product
    experience with market positioning and investor roadmap expectations.
    Led UX/UI redesign of the Grant Thornton corporate website.
    Stakeholder Workshops, RFP / GTM Strategy.
  `,
  skills: ['Figma', 'UX Design', 'Design Systems', 'Prototyping', 'Usability Testing'],
  experience: [{ company_name: 'Genpact', job_title: 'Principal Design Manager' }],
});

const check = (skill) => verifyAdditions([{ text: skill, kind: 'skill' }], corpus)[0];

describe('a skill is a claim, not a word list', () => {
  it('rejects Marketing, which only survived because -ing stemmed it to market', () => {
    const r = check('Marketing');
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.rule)).toContain('untraceable_skill');
  });

  it('rejects UI Design, assembled from two unrelated places', () => {
    expect(check('UI Design').ok).toBe(false);
  });

  it('the reason distinguishes the words from the claim', () => {
    // A refusal nobody understands gets overridden.
    expect(check('Marketing').violations.find((v) => v.rule === 'untraceable_skill').why)
      .toMatch(/not the same claim/i);
  });
});

describe('it still accepts what the person actually claims', () => {
  it.each(['Figma', 'UX Design', 'Design Systems', 'Prototyping', 'Usability Testing'])(
    'accepts %s, which is a recorded skill',
    (skill) => expect(check(skill).ok).toBe(true)
  );

  it('accepts a phrase written in the resume itself', () => {
    expect(check('GTM Strategy').ok).toBe(true);
  });

  it('matches across singular and plural, so Design System still traces', () => {
    // The corpus says "Design Systems"; stemming both sides is what makes the
    // phrase rule usable rather than brittle.
    expect(check('Design System').ok).toBe(true);
  });
});

describe('prose is still allowed to recombine the user\'s own words', () => {
  it('a bullet is judged word by word, not as a phrase', () => {
    /*
     * The phrase rule applies to kind:'skill' only. Applying it to prose would
     * mean the editor could only ever reproduce sentences verbatim, which is
     * not an editor - and the word-level rule already blocks new facts.
     */
    const bullet = verifyAdditions(
      [{ text: 'Worked on design systems for enterprise products', kind: 'bullet' }],
      corpus
    )[0];
    expect(bullet.ok).toBe(true);
  });

  it('but prose still cannot introduce a new fact', () => {
    const bullet = verifyAdditions(
      [{ text: 'Managed Kubernetes clusters in production', kind: 'bullet' }],
      corpus
    )[0];
    expect(bullet.ok).toBe(false);
  });

  it('and still cannot introduce a number the person never gave', () => {
    const bullet = verifyAdditions(
      [{ text: 'Increased conversion by 87%', kind: 'bullet' }],
      corpus
    )[0];
    expect(bullet.ok).toBe(false);
    expect(bullet.violations.map((v) => v.rule)).toContain('invented_number');
  });
});
