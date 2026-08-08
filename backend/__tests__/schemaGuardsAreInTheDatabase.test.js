/*
 * Dead branches — a CHECK constraint that is not in the table enforces nothing,
 * however carefully its predicate is written.
 *
 * Both application constraints were asserted by reading migrations.js and
 * regexing it for the constraint text. That proves the statement is WRITTEN.
 * It cannot prove the statement RAN: runMigrations logs a failed statement and
 * continues, so an ADD CONSTRAINT that threw and one that succeeded produce
 * the same output and the same green test. The indexes were already treated
 * this way - declared in a test, then read back from pg_indexes through
 * /api/jobs/db-health because declaring is necessary and not sufficient. The
 * constraints never got the second half.
 *
 * So db-health now reads pg_constraint too, and these tests prove it can tell
 * the difference. A reporter that says "present" whatever the database
 * contains is the same defect one level up.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
  attachUserIfPresent: (req, _res, next) => { req.user = req.user || { id: 42 }; next(); },
}));

const { query } = require('../db');

const BOTH = [
  {
    conname: 'applications_applied_at_requires_submitted',
    def: "CHECK (applied_at IS NULL OR (status)::text = 'submitted'::text)",
  },
  {
    conname: 'applications_applied_requires_submission',
    def: "CHECK ((status)::text <> 'applied'::text OR COALESCE(is_manual, false) = true OR submitted_at IS NOT NULL)",
  },
  /*
   * Feature 3. A tailored resume built from a PASTED job description has no
   * row in `jobs` and never will, so job_id had to stop being NOT NULL - and
   * the moment it could be null, nothing stopped a job-less row being rendered
   * as though a real employer were behind it. The constraint is what keeps the
   * two states honest, and this is here so it is read back from the running
   * database rather than believed because migrations.js contains the text.
   */
  {
    conname: 'tailored_resumes_source_ck',
    def: "CHECK (((source)::text = 'pasted_jd'::text AND job_id IS NULL) "
      + "OR ((source)::text = 'indexed_job'::text AND job_id IS NOT NULL))",
  },
];

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/jobs', require('../routes/jobs'));
  return a;
}

const withConstraints = (rows) => query.mockImplementation((sql) => {
  if (/FROM pg_constraint/.test(sql)) return Promise.resolve({ rows });
  if (/FROM pg_indexes/.test(sql)) {
    return Promise.resolve({ rows: [{ indexname: 'idx_jobs_active_posted', tablename: 'jobs' }] });
  }
  if (/EXPLAIN/i.test(sql)) return Promise.resolve({ rows: [] });
  return Promise.resolve({ rows: [] });
});

beforeEach(() => query.mockReset());

describe('db-health reads the constraints from the running database', () => {
  it('reports both present when the table actually carries them', async () => {
    withConstraints(BOTH);
    const res = await request(app()).get('/api/jobs/db-health');

    expect(res.status).toBe(200);
    expect(res.body.allConstraintsPresent).toBe(true);
    expect(res.body.expectedConstraints.map((c) => c.name)).toEqual([
      'applications_applied_at_requires_submitted',
      'applications_applied_requires_submission',
    ]);
  });

  it('reports the missing one when a migration silently failed', async () => {
    /*
     * The case that matters, and the one the source-regex tests could never
     * see: the statement is in migrations.js, it threw at boot, and the table
     * has no such constraint. Prove the instrument on a known negative before
     * trusting it to say "present".
     */
    withConstraints([BOTH[0]]);
    const res = await request(app()).get('/api/jobs/db-health');

    expect(res.body.allConstraintsPresent).toBe(false);
    const missing = res.body.expectedConstraints.filter((c) => !c.present);
    expect(missing).toHaveLength(1);
    expect(missing[0].name).toBe('applications_applied_requires_submission');
  });

  it('reports none present on a table that carries no CHECK at all', async () => {
    withConstraints([]);
    const res = await request(app()).get('/api/jobs/db-health');

    expect(res.body.allConstraintsPresent).toBe(false);
    expect(res.body.expectedConstraints.every((c) => !c.present)).toBe(true);
  });

  it('hands back the predicate, not just the name', async () => {
    // A constraint can exist under the right name with a predicate that was
    // edited later. The name alone would not show that.
    withConstraints(BOTH);
    const res = await request(app()).get('/api/jobs/db-health');

    const applied = res.body.expectedConstraints
      .find((c) => c.name === 'applications_applied_requires_submission');
    expect(applied.def).toMatch(/is_manual/);
  });
});

/* ------------------------------------------------------------------ *
 * Every remaining database claim, read back rather than regexed.
 *
 * submissionReceipt.test.js asserts a table, an immutability TRIGGER and a
 * unique index by matching migrations.js. Those three are what stand behind
 * "applied status requires a submission record" - a trigger that never got
 * created leaves receipts editable, and the source-matching test passes just
 * the same. These prove the reporter can tell the difference.
 * ------------------------------------------------------------------ */

const { readBack, CLAIMS } = require('../services/schemaClaims');

const FULL = {
  tables: ['submission_receipts', 'data_corrections', 'applications', 'jobs', 'tailored_resumes'],
  indexes: [
    { indexname: 'idx_submission_receipts_app_unique', indexdef: 'CREATE UNIQUE INDEX idx_submission_receipts_app_unique ON public.submission_receipts USING btree (application_id)' },
    { indexname: 'idx_jobs_active_posted', indexdef: 'CREATE INDEX idx_jobs_active_posted ON public.jobs USING btree (is_active, posted_at)' },
  ],
  constraints: [
    { conname: 'applications_applied_at_requires_submitted', tbl: 'applications' },
    { conname: 'applications_applied_requires_submission', tbl: 'applications' },
    // Feature 3 — keeps a job-less tailored resume from reading as a real employer.
    { conname: 'tailored_resumes_source_ck', tbl: 'tailored_resumes' },
  ],
  triggers: [{ tgname: 'trg_submission_receipts_immutable', tbl: 'submission_receipts' }],
  columns: [
    { table_name: 'applications', column_name: 'applied_at', column_default: null, is_nullable: 'YES' },
    // 2026-08-08 — job_url went nullable so a manual tracker entry with no
    // posting URL can be stored without inventing one.
    { table_name: 'jobs', column_name: 'job_url', column_default: null, is_nullable: 'YES' },
    // Q2 — the internal-account flag the scrub and the auto-apply sweep key on.
    { table_name: 'users', column_name: 'is_internal', column_default: 'false', is_nullable: 'YES' },
  ],
};

const fakeDb = (world) => (sql) => {
  if (/information_schema\.tables/.test(sql)) return Promise.resolve({ rows: world.tables.map((t) => ({ table_name: t })) });
  if (/pg_indexes/.test(sql)) return Promise.resolve({ rows: world.indexes });
  if (/pg_constraint/.test(sql)) return Promise.resolve({ rows: world.constraints });
  if (/pg_trigger/.test(sql)) return Promise.resolve({ rows: world.triggers });
  if (/information_schema\.columns/.test(sql)) return Promise.resolve({ rows: world.columns });
  return Promise.resolve({ rows: [] });
};

const clone = (o) => JSON.parse(JSON.stringify(o));

describe('schema claims are read back, not asserted from the migration source', () => {
  it('reports every claim present against a database that has them all', async () => {
    const out = await readBack(fakeDb(FULL));
    expect(out).toHaveLength(CLAIMS.length);
    expect(out.filter((c) => !c.present)).toEqual([]);
  });

  it('catches the immutability trigger silently not existing', async () => {
    const w = clone(FULL); w.triggers = [];
    const out = await readBack(fakeDb(w));
    const trig = out.find((c) => c.kind === 'trigger');
    expect(trig.present).toBe(false);
    expect(trig.why).toMatch(/editable/);
  });

  it('catches the trigger existing on the WRONG table', async () => {
    const w = clone(FULL);
    w.triggers = [{ tgname: 'trg_submission_receipts_immutable', tbl: 'jobs' }];
    expect((await readBack(fakeDb(w))).find((c) => c.kind === 'trigger').present).toBe(false);
  });

  it('catches a unique index that came back NOT unique', async () => {
    // The name alone would pass. A non-unique index enforces nothing, so the
    // definition has to be read, not just the existence.
    const w = clone(FULL);
    w.indexes[0].indexdef = 'CREATE INDEX idx_submission_receipts_app_unique ON public.submission_receipts USING btree (application_id)';
    const idx = (await readBack(fakeDb(w))).find((c) => c.name === 'idx_submission_receipts_app_unique');
    expect(idx.present).toBe(false);
  });

  it('catches the receipts table missing entirely', async () => {
    const w = clone(FULL); w.tables = w.tables.filter((t) => t !== 'submission_receipts');
    expect((await readBack(fakeDb(w))).find((c) => c.name === 'submission_receipts').present).toBe(false);
  });

  it('catches applied_at getting its DEFAULT back', async () => {
    /*
     * The absence is the claim. applied_at carried DEFAULT CURRENT_TIMESTAMP,
     * so every row looked applied the moment it existed. If that ALTER
     * silently failed, every queued row mints a false applied timestamp.
     */
    const w = clone(FULL);
    w.columns = [{ table_name: 'applications', column_name: 'applied_at', column_default: 'CURRENT_TIMESTAMP' }];
    const claim = (await readBack(fakeDb(w))).find((c) => c.kind === 'no_column_default');
    expect(claim.present).toBe(false);
    expect(claim.detail).toBe('CURRENT_TIMESTAMP');
  });

  it('does not read a MISSING column as a satisfied no-default claim', async () => {
    // Absent from the catalogue is not the same as "has no default", and the
    // lenient reading would report a dropped column as healthy.
    const w = clone(FULL); w.columns = [];
    expect((await readBack(fakeDb(w))).find((c) => c.kind === 'no_column_default').present).toBe(false);
  });

  it('surfaces every claim through db-health', async () => {
    query.mockImplementation((sql) => {
      if (/FROM pg_constraint\b/.test(sql) && /pg_get_constraintdef/.test(sql)) return Promise.resolve({ rows: BOTH });
      if (/EXPLAIN/i.test(sql)) return Promise.resolve({ rows: [] });
      return fakeDb(FULL)(sql);
    });
    const res = await request(app()).get('/api/jobs/db-health');
    expect(res.status).toBe(200);
    expect(res.body.allSchemaClaimsPresent).toBe(true);
    expect(res.body.schemaClaims.map((c) => c.kind)).toEqual(expect.arrayContaining(['trigger', 'table', 'index', 'constraint', 'no_column_default']));
  });
});
