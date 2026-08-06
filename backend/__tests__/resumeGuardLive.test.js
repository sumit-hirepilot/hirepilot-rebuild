/*
 * Item 0 — the tailoring guards are the only thing between autonomous apply
 * and a fabricated resume reaching an employer. Proven in BOTH directions,
 * because a guard that blocks everything is as useless as one that blocks
 * nothing: if honest tailoring never passes, the feature is dead and the
 * pressure is to route around the guard.
 *
 * Found by running it rather than assuming it: normalise keeps `.` and `%`
 * because they carry meaning inside a token (12%, node.js, c++), and it left
 * them hanging off the END of ordinary words too. The corpus held "12%." and
 * "teams." while an addition offered "12%" and "redesign." - so the guard
 * rejected the user's OWN figures as invented and their own words as
 * untraceable claims.
 */

const { buildCorpus, verifyAdditions, trimToken } = require('../services/resumeGuard');

const RESUME = [
  'Senior Product Designer at Valtech.',
  'Led design system work for 3 teams.',
  'Shipped onboarding redesign that lifted activation 12%.',
  'Skills: Figma, design systems, user research, accessibility.',
].join(' ');

const corpus = () => buildCorpus({
  resumeText: RESUME,
  skills: ['Figma', 'design systems', 'user research', 'accessibility'],
  experience: [],
});

const rulesFor = (candidate) => {
  /*
   * Through verifyAdditions, which is the function the endpoints actually
   * call. This used to reach past it to verify() - a function nothing in the
   * product invoked - so a green run here said nothing about the live path.
   */
  const [r] = verifyAdditions([{ text: candidate, kind: 'line' }], corpus());
  return { ok: r.ok, rules: [...new Set(r.violations.map((v) => v.rule))] };
};

describe('Item 0 — the guards fire on what they exist to stop', () => {
  /*
   * The deletion case that stood here is gone with the rule it tested.
   *
   * no_deletion lived in verify(), whose only caller passes an empty current
   * text - so the diff could never contain a removal and the rule could never
   * fire. It was a green test over code with zero live executions. "Tailoring
   * may only add" is asserted where it is observable, in tailorNeverInvents:
   * the engine's output still contains every line of its input.
   */

  it('blocks an invented number', () => {
    const r = rulesFor(`${RESUME} Increased retention by 47%.`);
    expect(r.ok).toBe(false);
    expect(r.rules).toContain('invented_number');
  });

  it('blocks an untraceable claim', () => {
    const r = rulesFor(`${RESUME} Expert in Kubernetes orchestration.`);
    expect(r.ok).toBe(false);
    expect(r.rules).toContain('untraceable_claim');
  });
});

describe('Item 0 — and let honest tailoring through', () => {
  it("accepts the user's own figure, restated", () => {
    /*
     * NOTE: diffWordsWithSpace aligns "12%" as shared text here, so this case
     * documents the end-to-end result rather than exercising the number rule.
     * The case below is the one that reaches it.
     */
    const r = rulesFor(`${RESUME} Activation lifted 12% after the onboarding redesign.`);
    expect(r.rules).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("accepts the user's own figure inside genuinely new wording", () => {
    // "(12%)" is a new token the differ must treat as an addition, and it
    // carries the resume's own number. Before punctuation was stripped, the
    // corpus held "12%." and this was reported as an invented figure.
    const r = rulesFor(`${RESUME} Activation, design systems, user research (12%).`);
    expect(r.rules).not.toContain('invented_number');
  });

  it("accepts a restatement built only from the user's own skills", () => {
    const r = rulesFor(`${RESUME} Focus: design systems, user research, accessibility.`);
    expect(r.ok).toBe(true);
  });
});

describe('Item 0 — punctuation is not part of a word', () => {
  it('strips trailing punctuation from tokens', () => {
    expect(trimToken('teams.')).toBe('teams');
    expect(trimToken('12%.')).toBe('12%');
    expect(trimToken('redesign,')).toBe('redesign');
  });

  it('keeps punctuation that is inside a token', () => {
    // These are real skills, and mangling them would make them untraceable.
    expect(trimToken('node.js')).toBe('node.js');
    expect(trimToken('c++')).toBe('c++');
    expect(trimToken('front-end')).toBe('front-end');
  });

  it('stores the number as the resume writes it', () => {
    expect([...corpus().numbers]).toContain('12%');
    expect([...corpus().numbers]).not.toContain('12%.');
  });
});
