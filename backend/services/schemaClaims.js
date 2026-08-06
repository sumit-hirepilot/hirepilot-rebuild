/*
 * Every claim this codebase makes about the database, read back from the
 * database.
 *
 * runMigrations logs a failed statement and continues. So a migration that
 * threw and one that succeeded produce identical output, and a test that
 * regexes migrations.js for the statement is green either way. That is not a
 * weak test - it is a test of the wrong thing. It proves a statement is
 * WRITTEN. Nothing in it can prove the statement RAN.
 *
 * The indexes already had the second half: declared in a test, then read back
 * from pg_indexes through /api/jobs/db-health. Nobody noticed that the CHECK
 * constraints, the receipts table, its immutability TRIGGER and its unique
 * index had only the first half - and those are the ones holding up "applied
 * status requires a submission record". A trigger that silently never got
 * created leaves receipts editable, and the test would still pass.
 *
 * So: one declarative list of claims, each resolvable against a system
 * catalogue, and an endpoint that reports them. A claim that cannot be read
 * back does not belong on this list.
 */

/**
 * kind      what to look in
 * name      what to look for
 * why       what breaks if it is absent - written for whoever reads the report
 */
const CLAIMS = [
  {
    kind: 'table', name: 'submission_receipts',
    why: 'no receipt store, so "applied" could not be backed by a submission record',
  },
  {
    kind: 'trigger', name: 'trg_submission_receipts_immutable', table: 'submission_receipts',
    why: 'receipts would be editable after the fact, which is the one thing a receipt must not be',
  },
  {
    kind: 'index', name: 'idx_submission_receipts_app_unique', unique: true,
    why: 'one application could carry two receipts, and neither would be authoritative',
  },
  {
    kind: 'constraint', name: 'applications_applied_at_requires_submitted', table: 'applications',
    why: 'applied_at could be stamped on a row that was never submitted',
  },
  {
    kind: 'constraint', name: 'applications_applied_requires_submission', table: 'applications',
    why: 'a row could claim status=applied with no evidence anything was sent',
  },
  {
    kind: 'index', name: 'idx_jobs_active_posted',
    why: 'the ranked feed falls back to a sequential scan of every job',
  },
  {
    kind: 'table', name: 'data_corrections',
    why: 'corrective migrations would have nowhere to record what they changed',
  },
  {
    /*
     * The absence IS the claim. applied_at carried DEFAULT CURRENT_TIMESTAMP,
     * so every inserted row looked applied the moment it existed; a migration
     * drops it. If that ALTER silently failed the default is back and every
     * queued row mints a false "applied" timestamp - invisible until someone
     * reads the tracker and believes it.
     */
    kind: 'no_column_default', name: 'applications.applied_at',
    why: 'a default would stamp applied_at on rows nothing ever submitted',
  },
];

async function readBack(query) {
  const [tables, indexes, constraints, triggers, defaults] = await Promise.all([
    query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`),
    query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`),
    query(`SELECT conname, conrelid::regclass::text AS tbl FROM pg_constraint`),
    query(`SELECT tgname, tgrelid::regclass::text AS tbl FROM pg_trigger WHERE NOT tgisinternal`),
    query(`SELECT table_name, column_name, column_default
             FROM information_schema.columns WHERE table_schema = 'public'`),
  ]);

  const tableSet = new Set(tables.rows.map((r) => r.table_name));
  const indexMap = new Map(indexes.rows.map((r) => [r.indexname, r.indexdef]));
  const consMap = new Map(constraints.rows.map((r) => [r.conname, r.tbl]));
  const trigMap = new Map(triggers.rows.map((r) => [r.tgname, r.tbl]));
  const defMap = new Map(defaults.rows.map((r) => [`${r.table_name}.${r.column_name}`, r.column_default]));

  return CLAIMS.map((c) => {
    let present = false;
    let detail = null;

    if (c.kind === 'table') {
      present = tableSet.has(c.name);
    } else if (c.kind === 'index') {
      detail = indexMap.get(c.name) || null;
      /*
       * A unique index that came back non-unique enforces nothing. Matched on
       * `CREATE UNIQUE INDEX` and not on the word "unique" anywhere in the
       * definition - the index is NAMED ..._app_unique, so the loose test
       * matched its own name and reported a plain index as unique. Caught by
       * the test for exactly this case, which is the argument for writing it.
       */
      present = indexMap.has(c.name) && (!c.unique || /CREATE\s+UNIQUE\s+INDEX/i.test(detail || ''));
    } else if (c.kind === 'constraint') {
      present = consMap.get(c.name) === c.table;
    } else if (c.kind === 'trigger') {
      present = trigMap.get(c.name) === c.table;
    } else if (c.kind === 'no_column_default') {
      // Absent from the catalogue is not the same as "no default" - a column
      // that does not exist would otherwise read as a satisfied claim.
      const known = defMap.has(c.name);
      detail = defMap.get(c.name) || null;
      present = known && detail === null;
    }

    return { kind: c.kind, name: c.name, present, why: c.why, detail };
  });
}

/**
 * What the database actually occupies, read from the running database.
 *
 * A full volume stops WRITES - no ingest, no application records, no crash
 * reports - and it does so silently. It already caused five outages here in a
 * quieter form: the feed's temp-file spill failed with 53100 because the volume
 * had no room left for it.
 *
 * Sizes come from pg_total_relation_size (table + indexes + TOAST), because the
 * table alone understates a row set whose bulk is long text held out of line -
 * which is exactly what jobs.description and jobs.requirements are.
 */
async function readStorage(query) {
  const [db, tables, settings] = await Promise.all([
    query('SELECT pg_database_size(current_database())::bigint AS bytes'),
    query(`SELECT relname AS table,
                  pg_total_relation_size(c.oid)::bigint AS total_bytes,
                  pg_relation_size(c.oid)::bigint       AS table_bytes,
                  pg_indexes_size(c.oid)::bigint        AS index_bytes,
                  COALESCE(s.n_live_tup, 0)             AS live_rows,
                  COALESCE(s.n_dead_tup, 0)             AS dead_rows
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
            WHERE n.nspname = 'public' AND c.relkind = 'r'
            ORDER BY pg_total_relation_size(c.oid) DESC
            LIMIT 15`),
    query(`SELECT name, setting FROM pg_settings WHERE name IN ('work_mem','maintenance_work_mem','data_directory')`),
  ]);

  const mb = (b) => Math.round(Number(b) / 1048576);
  return {
    databaseMb: mb(db.rows[0].bytes),
    settings: Object.fromEntries(settings.rows.map((r) => [r.name, r.setting])),
    tables: tables.rows.map((r) => ({
      table: r.table,
      totalMb: mb(r.total_bytes),
      tableMb: mb(r.table_bytes),
      indexMb: mb(r.index_bytes),
      liveRows: Number(r.live_rows),
      // Dead rows are the bloat left by the duplicate-key insert flood and by
      // every UPDATE the ingest ran; they hold disk until a VACUUM reclaims it.
      deadRows: Number(r.dead_rows),
    })),
  };
}

module.exports = { CLAIMS, readBack, readStorage };
