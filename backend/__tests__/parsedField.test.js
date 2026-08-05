/*
 * A7.2 — a field that failed to parse must never be stored.
 *
 * A2c guarded the RENDER side: users stopped seeing `name` where an employer
 * belongs. This guards ingestion, because the render guard only protects
 * surfaces that route through it and there is no guarantee every future one
 * will. Himalayas wrote company_name = 'name' on roughly a fifth of its ~4,900
 * rows before either guard existed.
 */

const fs = require('fs');
const path = require('path');
const { isParsed, NOT_PARSED } = require('../services/parsedField');

describe('A7.2 — isParsed rejects what did not parse', () => {
  it('rejects a value that is its own column name', () => {
    for (const v of ['name', 'Name', ' NAME ', 'company_name', 'title', 'location']) {
      expect(isParsed(v)).toBe(false);
    }
  });

  it('rejects blanks and parser placeholders', () => {
    for (const v of ['', '   ', null, undefined, 'null', 'undefined', 'N/A', '-', 'none', 'nan']) {
      expect(isParsed(v)).toBe(false);
    }
  });

  it('keeps real employers, including ones that merely look odd', () => {
    for (const v of ['Vercel', 'name.com', 'X', '37signals', 'Nameless Co', 'Red Cell Partners']) {
      expect(isParsed(v)).toBe(true);
    }
  });
});

describe('A7.2 — the aggregator withholds unparsed rows', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'jobAggregator.js'), 'utf8'
  );

  it('gates on isParsed, not on truthiness', () => {
    // The old gate was `!normalized.company_name`, which the string 'name'
    // satisfies. Truthiness cannot tell a value from a placeholder.
    expect(src).toMatch(/isParsed\(normalized\.company_name\)/);
    expect(src).toMatch(/isParsed\(normalized\.title\)/);
  });

  it('counts what it withheld rather than skipping silently', () => {
    // A silent skip is how the first one went unnoticed for months.
    expect(src).toMatch(/sourceStats\.unparsed/);
  });
});

describe('A7.2 — the two placeholder lists cannot drift', () => {
  /*
   * The list is duplicated in frontend/lib/renderState.js because the packages
   * share no module. Duplication is acceptable; SILENT divergence is not, so
   * this binds them - adding a placeholder to one side without the other fails
   * here rather than leaving one surface unguarded.
   */
  const frontend = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'lib', 'renderState.js'), 'utf8'
  );

  it('reads a non-empty list from the frontend module', () => {
    const block = frontend.slice(frontend.indexOf('const NOT_PARSED'));
    const values = [...block.slice(0, block.indexOf(']')).matchAll(/'([^']*)'/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(5);
  });

  it('holds exactly the same placeholders on both sides', () => {
    const block = frontend.slice(frontend.indexOf('const NOT_PARSED'));
    const frontendSet = new Set(
      [...block.slice(0, block.indexOf(']')).matchAll(/'([^']*)'/g)].map((m) => m[1])
    );
    const backendSet = NOT_PARSED;

    const onlyFrontend = [...frontendSet].filter((v) => !backendSet.has(v));
    const onlyBackend = [...backendSet].filter((v) => !frontendSet.has(v));
    expect({ onlyFrontend, onlyBackend }).toEqual({ onlyFrontend: [], onlyBackend: [] });
  });
});
