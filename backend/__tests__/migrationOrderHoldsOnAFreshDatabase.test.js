/*
 * A CHECK constraint is validated against the table AS IT STANDS when its
 * ALTER runs. So every column the constraint names has to already exist at
 * that point in STATEMENTS - and nothing in the statement's own text shows
 * whether it does.
 *
 * That is how the real one got through. `applications_applied_requires_
 * submission` reads `is_manual`, and `is_manual` was added ~120 statements
 * further down with the tracker columns. On a database that already had the
 * column from an earlier deploy the constraint was created and everything
 * looked right. On a FRESH database the statement failed with
 * `column "is_manual" does not exist`, runMigrations logged it and carried on
 * (by design - one bad statement must not stop the rest), and the environment
 * came up missing the single constraint standing behind "applied status
 * requires a submission record".
 *
 * It surfaced only when a brand-new Railway environment was built and
 * /api/jobs/db-health read the claims back from pg_constraint: 8 of 9. No
 * amount of reading migrations.js would have found it, because the statement
 * is written correctly. It just ran too early.
 *
 * This test is the cheap half of that check - it fails at the ordering rather
 * than waiting for someone to build a fresh environment and notice. The
 * expensive half stays where it belongs, in the db-health readback against a
 * real database.
 */

const fs = require('fs');
const path = require('path');
const { STATEMENTS } = require('../services/migrations');

/* Columns the base schema creates, per table - those are present before
 * statement 0 and must not be reported as missing. */
function baseSchemaColumns() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const tables = {};
  const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(sql))) {
    const [, table, body] = m;
    tables[table] = new Set(
      body
        .split('\n')
        .map((line) => line.replace(/--.*$/, '').trim())
        .filter(Boolean)
        // A column definition starts with the name; UNIQUE(...)/PRIMARY KEY
        // table constraints do not.
        .map((line) => (/^(UNIQUE|PRIMARY|FOREIGN|CONSTRAINT|CHECK)\b/i.test(line) ? null : line.match(/^(\w+)/)))
        .filter(Boolean)
        .map((mm) => mm[1].toLowerCase())
    );
  }
  return tables;
}

/* Words that appear inside a CHECK body but are not columns. */
const NOT_A_COLUMN = new Set([
  'or', 'and', 'not', 'is', 'null', 'true', 'false', 'in', 'between', 'like',
  'coalesce', 'check', 'add', 'constraint', 'alter', 'table', 'exists', 'case',
  'when', 'then', 'else', 'end', 'cast', 'as', 'char_length', 'length', 'lower',
  'upper', 'array', 'any', 'all', 'boolean', 'integer', 'text', 'timestamp',
]);

describe('a CHECK constraint never names a column added later', () => {
  it('every column referenced already exists at that point in STATEMENTS', () => {
    const known = baseSchemaColumns();
    const offenders = [];

    STATEMENTS.forEach((stmt, i) => {
      // Track columns as they are introduced, in order.
      const added = stmt.match(/ALTER TABLE\s+(\w+)\s+ADD COLUMN IF NOT EXISTS\s+(\w+)/i);
      if (added) {
        const [, table, col] = added;
        (known[table] = known[table] || new Set()).add(col.toLowerCase());
        return;
      }

      const check = stmt.match(/ALTER TABLE\s+(\w+)\s+ADD CONSTRAINT\s+(\w+)\s+CHECK\s*\(([\s\S]*?)\)\s*;?/i);
      if (!check) return;
      const [, table, name, body] = check;

      const identifiers = body
        .replace(/'[^']*'/g, ' ')          // string literals are not columns
        .match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];

      for (const id of new Set(identifiers.map((s) => s.toLowerCase()))) {
        if (NOT_A_COLUMN.has(id)) continue;
        if (!(known[table] && known[table].has(id))) {
          offenders.push(`statement ${i}: ${name} on ${table} reads "${id}" before it exists`);
        }
      }
    });

    expect(offenders).toEqual([]);
  });

  it('the constraint that caused this reads is_manual, and the column comes first', () => {
    /*
     * Pins the specific ordering, so a later edit that moves is_manual back
     * down with the tracker columns fails here by name rather than as an
     * anonymous list entry.
     */
    const col = STATEMENTS.findIndex((s) => /ADD COLUMN IF NOT EXISTS is_manual\b/i.test(s));
    const con = STATEMENTS.findIndex((s) => /applications_applied_requires_submission/.test(s) && /ADD CONSTRAINT/i.test(s));

    expect(col).toBeGreaterThan(-1);
    expect(con).toBeGreaterThan(-1);
    expect(col).toBeLessThan(con);
  });
});
