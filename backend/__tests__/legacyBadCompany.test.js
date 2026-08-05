/*
 * A7.2 (second half) — the guard stopped new rows; the old ones were never
 * corrected.
 *
 * Found during the A7.5 sweep. The resume editor's "Tailor to a job" list
 * reads "UI/UX Engineer — name". Production confirms 181 himalayas rows whose
 * company_name is the literal string `name`, live and applyable, and
 * field-integrity has been counting them the whole time without anything
 * acting on the count.
 *
 * parsedField already rejects the token, so nothing new can be stored - these
 * predate it. The A7.2 comment predicted exactly how they would surface: "the
 * render guard protects surfaces that route through it, and there is no
 * guarantee every future surface will." The resume editor is that surface.
 *
 * The correction nulls the column rather than deleting the row: `name` was
 * never information, the posting is real, and every surface that uses parsedOr
 * then says "Company not stated" honestly. It is recorded before it is
 * applied - a corrector that overwrites in place and keeps no record makes who
 * was affected unknowable, which was the explicit lesson from A5.
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'migrations.js'), 'utf8');
const { NOT_PARSED } = require('../services/parsedField');

describe('A7.2 — legacy unparsed companies are corrected, not just counted', () => {
  it('nulls a company that is a field-name token rather than an employer', () => {
    expect(src).toMatch(/UPDATE jobs\s+SET company_name = NULL/);
    expect(src).toMatch(/LOWER\(TRIM\(company_name\)\)\s*=\s*ANY/);
  });

  it('uses the same vocabulary as the ingest guard, not a second list', () => {
    /*
     * A hardcoded ARRAY['name','title'] in SQL is a second definition that
     * drifts from NOT_PARSED the first time a token is added - the same defect
     * as A7.17's three ranking paths. The migration builds its list FROM the
     * shared set.
     */
    expect(src).toMatch(/NOT_PARSED/);
    expect(src).not.toMatch(/ARRAY\['name'/);
  });

  it('records what it changed before changing it', () => {
    // A5's lesson, verbatim: a corrector that overwrites in place and keeps no
    // record makes who was affected unknowable.
    const update = src.search(/UPDATE jobs\s+SET company_name = NULL/);
    const record = src.indexOf("'a7.2-null-unparsed-company'");
    expect(record).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(record).toBeLessThan(update);
    // The ids AND the values, so the record answers "which rows" and "what did
    // they say" without needing the row that no longer holds it.
    const block = src.slice(record, update);
    expect(block).toMatch(/jsonb_agg\(id\)/);
    expect(block).toMatch(/jsonb_agg\(DISTINCT company_name\)/);
  });

  it('writes into the table that exists, with the columns it has', () => {
    /*
     * A7.12 already created data_corrections. A second CREATE TABLE IF NOT
     * EXISTS with different columns is a silent no-op against the existing
     * table, and the INSERT then fails into runMigrations' swallowed error
     * path - a correction that records nothing while looking like it worked.
     * There must be exactly one definition, and it must be A7.12's.
     */
    const creates = src.match(/CREATE TABLE IF NOT EXISTS data_corrections/g) || [];
    expect(creates).toHaveLength(1);
    const schema = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS data_corrections'));
    expect(schema.slice(0, 300)).toMatch(/correction VARCHAR/);
    expect(src).toMatch(/INSERT INTO data_corrections \(correction, table_name, row_count, detail\)[\s\S]{0,200}a7\.2-null-unparsed-company/);
  });

  it('touches nothing but that column', () => {
    // Scoped to the correction itself. A fixed-size window from the table
    // definition ran into unrelated statements and failed on their DROP INDEX.
    const from = src.indexOf("'a7.2-null-unparsed-company'");
    const end = src.search(/UPDATE jobs\s+SET company_name = NULL/);
    // Ends at the UPDATE's own closing backtick. A fixed +300 window ran into
    // A7.17's unrelated DROP INDEX statements and failed on those.
    const block = src.slice(from, src.indexOf('`,', end) + 2);
    expect(block).not.toMatch(/DELETE FROM jobs|DROP |TRUNCATE|is_active = false/);
  });

  it('is re-runnable, so a redeploy does not double-record', () => {
    const from = src.indexOf("'a7.2-null-unparsed-company'");
    const block = src.slice(from, from + 900);
    // Only rows still holding a bad value are recorded, and the UPDATE clears
    // them - so the second boot selects nothing.
    expect(block).toMatch(/LOWER\(TRIM\(company_name\)\)\s*=\s*ANY/);
  });

  it('keeps the token list in the shared module', () => {
    expect(NOT_PARSED.has('name')).toBe(true);
    expect(NOT_PARSED.has('company')).toBe(true);
  });
});
