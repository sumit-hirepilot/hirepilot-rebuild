/*
 * A column read off `applications a` must actually be a column of applications.
 *
 * The receipt-freeze query selected `a.resume_id` and `a.ats`. Both are columns
 * of submission_receipts - the table it INSERTS into - and neither has ever
 * existed on applications. Postgres threw `column a.resume_id does not exist`
 * on every submission, the surrounding catch turned it into
 * `{frozen: false, reason: 'receipt could not be written'}`, and the evidence
 * endpoint answered 200 with the application marked submitted.
 *
 * So A4's frozen receipt - the record behind "applied status requires a
 * submission record" - had never once been written, on any environment, while
 * every submission reported success. The old production held 0 receipts and
 * that had been read as "nobody has submitted yet".
 *
 * Nothing caught it because every test mocks the database, and a mock answers
 * whatever it is told to. Only real Postgres knows its own columns. This test
 * is the cheap half: the column list is derived from schema.sql plus the
 * migration statements, and every `a.<column>` reference is checked against it.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const schemaSql = fs.readFileSync(path.join(BACKEND, 'schema.sql'), 'utf8');
const migrations = fs.readFileSync(path.join(BACKEND, 'services', 'migrations.js'), 'utf8');

/** Columns a table has after schema.sql and every ADD COLUMN in migrations. */
function columnsOf(table) {
  const cols = new Set();

  const create = new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\s*\\(([\\s\\S]*?)\\n\\);`).exec(schemaSql);
  if (create) {
    for (const line of create[1].split('\n')) {
      const clean = line.replace(/--.*$/, '').trim();
      if (!clean || /^(UNIQUE|PRIMARY|FOREIGN|CONSTRAINT|CHECK)\b/i.test(clean)) continue;
      const m = /^(\w+)/.exec(clean);
      if (m) cols.add(m[1].toLowerCase());
    }
  }

  const add = new RegExp(`ALTER TABLE\\s+${table}\\s+ADD COLUMN IF NOT EXISTS\\s+(\\w+)`, 'gi');
  let m;
  while ((m = add.exec(migrations))) cols.add(m[1].toLowerCase());

  return cols;
}

/*
 * Aliases used consistently across this codebase for the tables that carry the
 * submission guarantees. Deliberately a small, explicit list: a scan that
 * guessed which table an alias meant would produce false failures, and a guard
 * nobody trusts gets deleted.
 */
const ALIASES = [
  { file: 'routes/apply.js', alias: 'a', table: 'applications' },
  { file: 'routes/applications.js', alias: 'a', table: 'applications' },
  { file: 'routes/tracker.js', alias: 'a', table: 'applications' },
];

/* Words that follow `a.` but are not columns: SQL functions and keywords. */
const NOT_A_COLUMN = new Set(['*']);

describe('every aliased column exists on the table it names', () => {
  for (const { file, alias, table } of ALIASES) {
    const full = path.join(BACKEND, file);
    if (!fs.existsSync(full)) continue;

    it(`${file}: every ${alias}.<col> is a column of ${table}`, () => {
      const src = fs.readFileSync(full, 'utf8');
      const cols = columnsOf(table);
      expect(cols.size).toBeGreaterThan(5);

      /*
       * Only inside template literals that look like SQL, so `a.b` in ordinary
       * JavaScript is not mistaken for a column reference.
       */
      const sqlBlocks = [...src.matchAll(/`([^`]*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*)`/gi)].map((m) => m[1]);

      const bad = [];
      for (const sql of sqlBlocks) {
        // Skip blocks that alias the name to something else entirely.
        const re = new RegExp(`(?<![\\w.])${alias}\\.(\\w+)`, 'g');
        let m;
        while ((m = re.exec(sql))) {
          const col = m[1].toLowerCase();
          if (NOT_A_COLUMN.has(col)) continue;
          if (!cols.has(col)) bad.push(`${alias}.${col}`);
        }
      }

      expect([...new Set(bad)]).toEqual([]);
    });
  }

  it('knows the columns that caused this, so the guard itself is checked', () => {
    const cols = columnsOf('applications');
    // Present - the query legitimately reads these.
    expect(cols.has('screening_answers')).toBe(true);
    expect(cols.has('tailored_resume_id')).toBe(true);
    expect(cols.has('submission_channel')).toBe(true);
    // Absent - these belong to submission_receipts, and reading them off
    // applications is the defect.
    expect(cols.has('resume_id')).toBe(false);
    expect(cols.has('ats')).toBe(false);
  });
});
