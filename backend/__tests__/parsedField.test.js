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

  it('withholds an unparsed row rather than storing it', () => {
    /*
     * Asserts the PROPERTY, not the call. A7.12 replaced the direct isParsed
     * calls here with notAJobReason(), which subsumes them - and these
     * assertions, matching the old literal shape, went red on a change that
     * strictly strengthened the guard. That is what asserting on an
     * implementation detail buys you.
     *
     * What must hold: an unparseable title or company never reaches storeJob.
     */
    const { notAJobReason } = require('../services/parsedField');
    expect(notAJobReason({ title: 'Designer', company_name: 'name' })).toBeTruthy();
    expect(notAJobReason({ title: 'name', company_name: 'Vercel' })).toBeTruthy();
    expect(notAJobReason({ title: 'Designer', company_name: 'Vercel' })).toBeNull();

    // ...and the aggregator consults it before storing.
    const guardLine = src.indexOf('notAJobReason(normalized)');
    const storeLine = src.indexOf('await storeJob(normalized)');
    expect(guardLine).toBeGreaterThan(-1);
    expect(storeLine).toBeGreaterThan(guardLine);
  });

  it('records why a row was withheld rather than skipping silently', () => {
    // A silent skip is how the first one went unnoticed for months.
    expect(src).toMatch(/sourceStats\.(unparsed|notAJob)/);
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
