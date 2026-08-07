/*
 * The facet and the filter answer the same question with the same SQL.
 *
 * They did not. The filter had four experience bands - the fourth, `mid`,
 * being the negation of the other three - and the facet counted only three.
 * On production that read:
 *
 *   facet says experience is known for   9,709 of 25,431 jobs
 *   filtering by "Mid level" returns    16,129 jobs
 *
 * Same question, two answers, and the one a person reads before choosing was
 * the wrong one. Nothing could catch it: both were correct SQL, both were
 * green, and the disagreement only appears if you read the chip against the
 * result of clicking it.
 *
 * The cause was two copies of one definition. This pins the single one.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'jobs.js'), 'utf8');

describe('one experience definition, used by both the filter and the facet', () => {
  it('defines the bands once, at module scope', () => {
    const defs = SRC.match(/const EXPERIENCE_SQL\s*=/g) || [];
    expect(defs).toHaveLength(1);

    // Module scope, not inside the handler: an indented `const` here means it
    // was redeclared in a function and the facet cannot reach it.
    expect(SRC).toMatch(/^const EXPERIENCE_SQL = \{/m);
  });

  it('gives the facet every band the filter offers, mid included', () => {
    const facet = SRC.slice(SRC.indexOf('COUNT(*) FILTER'), SRC.indexOf('AS staff') + 20);
    for (const band of ['entry', 'mid', 'senior', 'staff']) {
      expect(facet).toContain(`EXPERIENCE_SQL.${band}`);
    }
  });

  it('classifies a single job from the same terms as the filter', () => {
    /*
     * A third copy lived in classifyExperience, which labels each card. A card
     * could read "Senior" from one definition while the filter that surfaced
     * it used another.
     */
    const fn = SRC.slice(SRC.indexOf('function classifyExperience'), SRC.indexOf('function classifyExperience') + 600);
    for (const band of ['staff', 'senior', 'entry']) {
      expect(fn).toContain(`EXPERIENCE_TERMS.${band}`);
    }
  });

  it('never inlines a band regex a second time', () => {
    /*
     * The exact failure: the facet carried its own literal copy of the three
     * title regexes. A second copy is how they drifted apart, so the terms may
     * appear only in EXPERIENCE_TERMS.
     */
    const terms = SRC.slice(SRC.indexOf('const EXPERIENCE_TERMS'), SRC.indexOf('const EXPERIENCE_SQL'));
    const rest = SRC.replace(terms, '');
    expect(rest).not.toMatch(/junior\|jr/);
    expect(rest).not.toMatch(/staff\|principal\|distinguished/);
  });

  it('tells the client the bands overlap, because they are matched on the title', () => {
    // "Senior Staff Engineer" is both senior and staff, so the counts do not
    // sum to the index and must not be rendered as a breakdown of the whole.
    expect(SRC).toMatch(/experienceOverlapping:\s*true/);
  });
});
