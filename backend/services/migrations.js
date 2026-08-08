const fs = require('fs');
const path = require('path');
const { query } = require('../db');
const { NOT_PARSED } = require('./parsedField');

/*
 * A7.2 — the migration's token list is DERIVED from the shared set, never
 * spelled out in SQL. A hardcoded ARRAY[...] is a second definition, and it
 * drifts the first time a token is added on one side only - the same shape as
 * A7.17's three ranking paths disagreeing.
 *
 * The empty string is dropped: TRIM('') = '' would match a company that is
 * blank rather than mis-parsed, and those are already NULL or absent.
 */
const NOT_PARSED_SQL = `ARRAY[${[...NOT_PARSED]
  .filter((t) => t !== '')
  .map((t) => `'${t.replace(/'/g, "''")}'`)
  .join(', ')}]`;

// schema.sql creates the base tables and is entirely CREATE TABLE IF NOT
// EXISTS / CREATE INDEX IF NOT EXISTS, so running it on every boot is a
// no-op once the schema exists. It was previously applied by hand exactly
// once, which meant a fresh/replaced database came up with no tables at all
// and every request failed - the migrations below only ALTER tables that
// schema.sql is responsible for creating. Applying it here first makes the
// app self-bootstrapping on an empty database.
const applyBaseSchema = async () => {
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  let sql;
  try {
    sql = fs.readFileSync(schemaPath, 'utf8');
  } catch (err) {
    console.error('Could not read schema.sql, skipping base schema:', err.message);
    return;
  }
  try {
    await query(sql);
    console.log('Base schema applied (no-op if it already existed)');
  } catch (err) {
    console.error('Base schema apply failed:', err.message);
  }
};

// Idempotent, additive-only migrations. Safe to run on every startup.
const STATEMENTS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS title VARCHAR(255)`,

  `ALTER TABLE search_agents ADD COLUMN IF NOT EXISTS min_match_score DECIMAL(3,2) DEFAULT 0.75`,
  `ALTER TABLE search_agents ADD COLUMN IF NOT EXISTS remote_ok BOOLEAN DEFAULT TRUE`,

  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS default_roles VARCHAR(255)[] DEFAULT '{}'`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS auto_apply_min_score DECIMAL(3,2) DEFAULT 0.75`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS blacklist_companies VARCHAR(255)[] DEFAULT '{}'`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS dream_companies VARCHAR(255)[] DEFAULT '{}'`,

  `ALTER TABLE referrals ALTER COLUMN job_id DROP NOT NULL`,
  `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'identified'`,

  `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS label VARCHAR(255)`,

  `CREATE TABLE IF NOT EXISTS tailored_resumes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resume_id INTEGER REFERENCES resumes(id) ON DELETE SET NULL,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    tailored_summary TEXT,
    highlighted_skills VARCHAR(255)[],
    ats_score INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tailored_resumes_user_id ON tailored_resumes(user_id)`,

  // Application pipeline stages were renamed (interview -> technical_interview)
  `UPDATE applications SET status = 'technical_interview' WHERE status = 'interview'`,

  // Notification Center (reuses activity_log as the notification stream)
  `ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE`,

  // Saved Jobs
  `CREATE TABLE IF NOT EXISTS saved_jobs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, job_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_saved_jobs_user_id ON saved_jobs(user_id)`,

  // Cover letters (per job, like tailored_resumes)
  `CREATE TABLE IF NOT EXISTS cover_letters (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    content TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cover_letters_user_id ON cover_letters(user_id)`,

  // Screening question answers
  `CREATE TABLE IF NOT EXISTS screening_answers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Applications: failure tracking + link to cover letter/tailored resume used,
  // and mark which applications were sent by automation vs the user
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS failure_reason TEXT`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS submitted_by VARCHAR(20) DEFAULT 'user'`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS cover_letter_id INTEGER REFERENCES cover_letters(id) ON DELETE SET NULL`,

  // Onboarding tracking
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP`,

  // One-time repair of RemoteOK postings ingested before the mojibake fix
  // (UTF-8 bytes mis-decoded as Latin-1 upstream, e.g. "PreparaciÃ³n").
  // Scoped to rows that still show the tell-tale characters so it's a no-op
  // once repaired; wrapped safely by the try/catch in runMigrations below.
  `UPDATE jobs SET title = convert_from(convert_to(title, 'LATIN1'), 'UTF8')
   WHERE source = 'remoteok' AND title ~ '[ÃÂâ]'`,
  `UPDATE jobs SET company_name = convert_from(convert_to(company_name, 'LATIN1'), 'UTF8')
   WHERE source = 'remoteok' AND company_name ~ '[ÃÂâ]'`,
  `UPDATE jobs SET description = convert_from(convert_to(description, 'LATIN1'), 'UTF8')
   WHERE source = 'remoteok' AND description ~ '[ÃÂâ]'`,

  // Per-source ingestion metrics for the job aggregation pipeline (latency,
  // success/failure, counts per run) - powers source health monitoring.
  `CREATE TABLE IF NOT EXISTS source_ingestion_runs (
    id SERIAL PRIMARY KEY,
    source VARCHAR(50) NOT NULL,
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP,
    duration_ms INTEGER,
    jobs_fetched INTEGER DEFAULT 0,
    jobs_new INTEGER DEFAULT 0,
    jobs_updated INTEGER DEFAULT 0,
    success BOOLEAN,
    retried BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_source_ingestion_runs_source ON source_ingestion_runs(source, created_at DESC)`,

  // Store the exact original uploaded resume file so it can always be
  // downloaded byte-for-byte unchanged, and so tailoring can diff against a
  // stable original snapshot even if newer resumes are uploaded later.
  `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_data BYTEA`,
  `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255)`,
  `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS original_mimetype VARCHAR(100)`,

  // Diff-based tailoring: keep the original text snapshot, the machine
  // diff, and the user-approved final text (after accept/reject) alongside
  // the draft tailored text.
  `ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS original_snapshot TEXT`,
  `ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS diff_json JSONB`,

  /*
   * Feature 3 — a tailored resume can come from a JD the user PASTED, which
   * has no row in `jobs` and never will. job_id was NOT NULL, so that write
   * was a guaranteed 500: the same shape as the approve endpoint writing a
   * status the CHECK constraint refuses. Found by reading the constraint
   * before shipping the path rather than after.
   *
   * Relaxing a NOT NULL is non-destructive - no row loses data and every
   * existing row still satisfies it.
   */
  `ALTER TABLE tailored_resumes ALTER COLUMN job_id DROP NOT NULL`,

  /*
   * Feature 4a — a job the USER linked, not one this product indexed.
   *
   * `added_by_user_id` marks it and, with is_active = false, keeps it out of
   * every shared surface: 16 separate queries filter is_active, so the feed,
   * the counts and all five facets exclude it without one change to the hot
   * path. It stays reachable BY ID, which is all that scoring, tailoring and
   * queueing need.
   *
   * That is the ToS line made structural rather than promised: one person's
   * link never becomes a row in an index served to everyone else.
   */
  `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS added_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_added_by_user ON jobs(added_by_user_id) WHERE added_by_user_id IS NOT NULL`,

  /*
   * company_name was NOT NULL, and a generic careers page often does not say
   * the company anywhere a parser can reach. A NOT NULL that forces a value
   * forces an INVENTED one, which is the constraint that actually matters
   * here - so the column is relaxed and the absence is stored as absence. The
   * UI already renders `parsedOr(company_name, 'Company not stated')`.
   *
   * Non-destructive: no existing row loses anything, and every aggregator
   * insert still supplies it.
   */
  `ALTER TABLE jobs ALTER COLUMN company_name DROP NOT NULL`,

  /*
   * D49 — the skills denominator changed from the user's own skill count to
   * the posting's requirement count. Every stored score in job_matches was
   * computed with the old formula, so leaving them is a table full of numbers
   * that no longer mean what the engine now produces.
   *
   * Marked rather than recomputed here: recomputing needs each user's skills
   * and each job's text, which is application work, not a migration. This
   * stamps the rows so the re-score pass knows what it has left to do and can
   * resume after a restart - the ingest OOM lesson says never hold 25,000
   * rows in memory to find out.
   */
  `ALTER TABLE job_matches ADD COLUMN IF NOT EXISTS scored_formula VARCHAR(16) DEFAULT 'v1_user_denom'`,
  `CREATE INDEX IF NOT EXISTS idx_job_matches_formula ON job_matches(scored_formula) WHERE scored_formula <> 'v2_job_denom'`,
  `ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'indexed_job'`,

  /*
   * The honesty lives in the DATABASE, not only in the route.
   *
   * A row with no job_id must say it came from a paste, and a row claiming to
   * come from an indexed job must actually have one. Without this, a future
   * path could write a job-less row that the UI renders as a real employer -
   * a fabricated record, which is Constraint 1.
   */
  `ALTER TABLE tailored_resumes DROP CONSTRAINT IF EXISTS tailored_resumes_source_ck`,
  `ALTER TABLE tailored_resumes ADD CONSTRAINT tailored_resumes_source_ck CHECK (
     (source = 'pasted_jd' AND job_id IS NULL) OR (source = 'indexed_job' AND job_id IS NOT NULL)
   )`,
  `ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS final_text TEXT`,
  `ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP`,

  // Auto-Pilot behavior controls: how aggressively to inject missing
  // keywords into tailored resumes, whether to auto-generate a cover letter
  // only when a posting actually asks for one, and whether auto-applied
  // jobs need your approval before they're marked as actually applied.
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS resume_tailor_mode VARCHAR(20) DEFAULT 'honest'`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS auto_tailor_resume BOOLEAN DEFAULT true`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS cover_letter_mode VARCHAR(20) DEFAULT 'always'`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS review_before_submit BOOLEAN DEFAULT false`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS tailored_resume_id INTEGER REFERENCES tailored_resumes(id) ON DELETE SET NULL`,

  // One-time correction: Himalayas's public pubDate field was found to not
  // reliably reflect a job's true original publish date (confirmed against
  // the same job's own Himalayas page showing a date up to 2 months
  // earlier) - the parser no longer trusts it, but rows already ingested
  // under the old mapping need clearing too. Jobs still within the active
  // re-fetch window self-heal to null automatically going forward; this
  // catches the rest (aged-out/inactive rows the ingester no longer
  // revisits) in one pass. Safe to run repeatedly - a no-op once applied.
  `UPDATE jobs SET posted_at = NULL WHERE source = 'himalayas' AND posted_at IS NOT NULL`,

  // Job Application Profile: the standard answers employer forms ask for on
  // every application. Stored once so screening questions can be pre-filled
  // instead of retyped per job. Deliberately separate from user_preferences,
  // which holds Auto-Pilot behaviour rather than answers submitted to
  // employers - these values go into legally binding forms, so they are kept
  // as their own explicitly-managed record.
  `CREATE TABLE IF NOT EXISTS application_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    current_location VARCHAR(255),
    linkedin_url VARCHAR(512),
    portfolio_url VARCHAR(512),
    github_url VARCHAR(512),
    years_experience NUMERIC(4,1),
    current_company VARCHAR(255),
    current_title VARCHAR(255),
    -- Work authorisation answers. Nullable on purpose: an unanswered question
    -- must stay unanswered rather than defaulting to a guess, because a wrong
    -- value here is a misrepresentation on a real application.
    work_authorization VARCHAR(100),
    requires_sponsorship BOOLEAN,
    willing_to_relocate BOOLEAN,
    notice_period VARCHAR(100),
    salary_expectation VARCHAR(100),
    salary_currency VARCHAR(10),
    pronouns VARCHAR(50),
    -- Free-form answers keyed by a normalised question, for prompts that
    -- recur but are not standard enough to be columns.
    custom_answers JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // The extension's content script only runs on the ATS domains. Greenhouse's
  // absolute_url points at the company's own careers site for roughly 56% of
  // boards, so those postings could never be automated. external_id already
  // encodes gh-{slug}-{jobid}, so the canonical board URL - which serves the
  // same form and does match the content script - can be rebuilt for every
  // existing row as well as at ingestion.
  `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_url VARCHAR(1024)`,
  `UPDATE jobs
     SET apply_url = 'https://job-boards.greenhouse.io/'
       || substring(external_id from '^gh-(.+)-[0-9]+$') || '/jobs/'
       || substring(external_id from '^gh-.+-([0-9]+)$')
   WHERE source = 'greenhouse'
     AND apply_url IS NULL
     AND external_id ~ '^gh-.+-[0-9]+$'`,
  // Lever and Ashby already publish URLs on their own domains.
  `UPDATE jobs SET apply_url = job_url
   WHERE source IN ('lever','ashby') AND apply_url IS NULL`,

  /*
   * Growing knowledge base of ATS question wordings.
   *
   * Every question the extension meets is recorded against the canonical concept
   * it classified to, with the ATS and company it came from. Two purposes:
   * answers given once get reused for a wording never seen before, and the
   * concept patterns can be reviewed against what employers actually ask rather
   * than what I guessed they would ask.
   *
   * Shared across users on purpose - the wording of "do you need sponsorship" is
   * not personal data. ANSWERS stay per-user in application_profiles; this table
   * holds only the question text.
   */
  `CREATE TABLE IF NOT EXISTS question_variations (
    id SERIAL PRIMARY KEY,
    concept_id VARCHAR(60),
    question_text TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    ats VARCHAR(50),
    company VARCHAR(255),
    field_type VARCHAR(30),
    options_count INTEGER,
    times_seen INTEGER DEFAULT 1,
    confirmed_by_user BOOLEAN DEFAULT FALSE,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(normalized_text)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_question_variations_concept ON question_variations(concept_id)`,
  `CREATE INDEX IF NOT EXISTS idx_question_variations_seen ON question_variations(times_seen DESC)`,

  // Work authorisation is per-country, not a single yes/no. Storing one value
  // meant "Are you legally authorized to work in the country where the job is
  // located?" got the same answer on a Bengaluru posting and a San Francisco
  // one - and for a candidate authorised only in India, answering Yes on a US
  // form is a false statement on a legally binding document.
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS authorized_countries TEXT[] DEFAULT '{}'`,

  // Verified-submission tracking. Previously a row was inserted with
  // status='applied' the moment the user clicked, which asserted an employer
  // had received something when nothing had been sent. These columns make the
  // distinction explicit and let the status be driven by evidence.
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS submission_channel VARCHAR(50)`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS employer_confirmation_id VARCHAR(255)`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS employer_confirmation_text TEXT`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS confirmation_captured_at TIMESTAMP`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP`,
  /*
   * is_manual lives HERE, beside the other columns the
   * applications_applied_requires_submission CHECK reads, and not down with the
   * tracker columns where it was first added.
   *
   * A CHECK constraint is validated against the table as it stands when the
   * ALTER runs. That statement referenced is_manual while the column was still
   * ~120 statements further down the list, so on a database that already had
   * the column from an earlier deploy the constraint was created, and on a
   * FRESH database the statement failed with `column "is_manual" does not
   * exist`, runMigrations logged it and carried on, and the environment came up
   * without the one constraint standing behind "applied status requires a
   * submission record".
   *
   * Found by /api/jobs/db-health reading the claim back from pg_constraint on a
   * new deploy: 8 of 9 present. Nothing that inspects migrations.js could have
   * found it, because the statement is written correctly - it just ran too
   * early.
   */
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS target_form_url VARCHAR(1024)`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS screening_answers JSONB DEFAULT '{}'::jsonb`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0`,
  // The queue is FIFO on creation time. applied_at/updated_at both move after
  // the fact, so neither is a stable ordering key for a queue.
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE applications SET created_at = COALESCE(applied_at, updated_at, CURRENT_TIMESTAMP) WHERE created_at IS NULL`,
  // applied_at carried DEFAULT CURRENT_TIMESTAMP, so every row got an "applied"
  // date at INSERT - including queued and failed ones that never reached an
  // employer. Analytics, the tracker and the auto-pilot daily cap all read this
  // column, so they were all counting non-applications. Drop the default, clear
  // the rows it contaminated, then enforce the rule in the schema so no future
  // code path can reintroduce it.
  `ALTER TABLE applications ALTER COLUMN applied_at DROP DEFAULT`,
  `UPDATE applications SET applied_at = NULL WHERE status <> 'submitted' AND applied_at IS NOT NULL`,

  // Legacy rows marked 'applied' by the pre-verification code path. They have
  // no confirmation evidence because nothing was ever sent, so leaving them as
  // "applied" would keep asserting an application the employer never received.
  `UPDATE applications
     SET status = 'failed',
         applied_at = NULL,
         failure_reason = COALESCE(failure_reason, '') ||
           'Recorded as applied by an earlier build that created tracker rows without submitting to the employer. Never sent - re-queue it to apply for real.'
   WHERE status = 'applied'
     AND employer_confirmation_id IS NULL
     AND verified_at IS NULL`,

  /*
   * A7.12 — withhold rows that are not job postings.
   *
   * A candidate's own bio was indexed as a job with a working Apply Now, and
   * four sibling rows resolved to greenhouse, the one enabled adapter, so they
   * were reachable by automated apply with Auto-Pilot on. The ingest guard
   * stops new ones; these are the rows already live.
   *
   * is_active = false, never DELETE: reversible, and the row is preserved so
   * the count stays auditable. An audit row is written BEFORE the mutation,
   * per the standing rule - the earlier corrective UPDATE overwrote in place
   * and left no way to answer who had been affected.
   */
  `CREATE TABLE IF NOT EXISTS data_corrections (
     id SERIAL PRIMARY KEY,
     correction VARCHAR(120) NOT NULL,
     table_name VARCHAR(120) NOT NULL,
     row_count INTEGER,
     detail JSONB,
     applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,

  `INSERT INTO data_corrections (correction, table_name, row_count, detail)
   SELECT 'a7.12-withhold-non-job-rows', 'jobs', COUNT(*),
          jsonb_build_object('ids', COALESCE(jsonb_agg(id), '[]'::jsonb))
     FROM jobs
    WHERE is_active = true
      AND (LENGTH(COALESCE(company_name, '')) > 80
        OR company_name ~* '^(hi[!,. ]|hey |i am |i''m |my name is )'
        OR title ~* '^(hi[!,. ]|hey |i am |i''m |my name is )'
        OR COALESCE(apply_url, job_url, '') ~* 'linkedin\\.com/in/')
      AND NOT EXISTS (SELECT 1 FROM data_corrections
                       WHERE correction = 'a7.12-withhold-non-job-rows')`,

  `UPDATE jobs SET is_active = false
    WHERE is_active = true
      AND (LENGTH(COALESCE(company_name, '')) > 80
        OR company_name ~* '^(hi[!,. ]|hey |i am |i''m |my name is )'
        OR title ~* '^(hi[!,. ]|hey |i am |i''m |my name is )'
        OR COALESCE(apply_url, job_url, '') ~* 'linkedin\\.com/in/')`,

  `ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_applied_at_requires_submitted`,
  `ALTER TABLE applications ADD CONSTRAINT applications_applied_at_requires_submitted
     CHECK (applied_at IS NULL OR status = 'submitted')`,

  /*
   * A1 / D10a — an automatic "applied" must carry a submission record.
   *
   * The UPDATE above corrects the rows that exist; it does nothing about the
   * next write. POST /api/applications wrote status='applied' as a literal, so
   * every deploy re-corrected rows that the running app immediately recreated.
   * The rule belongs in the table.
   *
   * is_manual rows are exempt BY DESIGN (D10). A user logging an application
   * they sent themselves is honestly applied with no HirePilot submission
   * record; treating those as false would relabel honest entries as failures,
   * committing a Constraint 1 violation while enforcing Constraint 7.
   * COALESCE because a CHECK passes on NULL, which would otherwise be a hole.
   *
   * The evidence set here is deliberately a SUPERSET of what the corrective
   * UPDATE above leaves behind (it keeps rows with employer_confirmation_id or
   * verified_at). If this were the narrower set, rows that survived the UPDATE
   * could still violate the constraint, ADD CONSTRAINT would fail, and
   * runMigrations would log-and-continue - leaving the hole open while the boot
   * log read "Migrations complete".
   *
   * Guarded by a catalog lookup rather than a bare ADD, because Postgres has no
   * ADD CONSTRAINT IF NOT EXISTS and a duplicate would throw on every boot.
   */
  /*
   * A4 — the immutable submission receipt.
   *
   * screening_answers on the application is CURRENT state: later discovery runs
   * rewrite it. Rendering it as "what was sent" is a Constraint 1 violation, so
   * the receipt is a separate row written once, at the moment the employer's
   * confirmation is captured, and never touched again.
   *
   * Immutability is enforced by the DATABASE, not by convention. A rule that
   * lives only in application code is one careless UPDATE away from being
   * false, and the whole point of a receipt is that it can be trusted when
   * someone disputes what went out under their name.
   */
  `CREATE TABLE IF NOT EXISTS submission_receipts (
     id SERIAL PRIMARY KEY,
     application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     submitted_at TIMESTAMP NOT NULL,
     -- What was sent, frozen. JSONB so the shape can grow without a migration
     -- that would rewrite existing receipts.
     answers_sent JSONB NOT NULL DEFAULT '{}'::jsonb,
     fields_sent JSONB NOT NULL DEFAULT '{}'::jsonb,
     -- Which file, identified by content rather than by a mutable row id.
     resume_id INTEGER,
     resume_sha256 VARCHAR(64),
     resume_filename VARCHAR(255),
     -- The platform's own words back, capped for the 500MB volume.
     platform_response TEXT,
     platform_confirmation_id VARCHAR(255),
     platform_url VARCHAR(1024),
     ats VARCHAR(50),
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_submission_receipts_app ON submission_receipts(application_id)`,
  `CREATE INDEX IF NOT EXISTS idx_submission_receipts_user ON submission_receipts(user_id)`,

  // One receipt per application. A second submit cannot quietly replace the
  // first one's account of what was sent.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_receipts_app_unique
     ON submission_receipts(application_id)`,

  `CREATE OR REPLACE FUNCTION submission_receipts_are_immutable()
     RETURNS TRIGGER AS $fn$
     BEGIN
       RAISE EXCEPTION
         'submission_receipts is append-only: % on receipt % was rejected',
         TG_OP, COALESCE(OLD.id, NEW.id);
     END;
     $fn$ LANGUAGE plpgsql`,

  `DROP TRIGGER IF EXISTS trg_submission_receipts_immutable ON submission_receipts`,
  `CREATE TRIGGER trg_submission_receipts_immutable
     BEFORE UPDATE OR DELETE ON submission_receipts
     FOR EACH ROW EXECUTE FUNCTION submission_receipts_are_immutable()`,

  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'applications_applied_requires_submission'
          AND conrelid = 'applications'::regclass
     ) THEN
       ALTER TABLE applications
         ADD CONSTRAINT applications_applied_requires_submission
         CHECK (
           status <> 'applied'
           OR COALESCE(is_manual, FALSE) = TRUE
           OR submitted_at IS NOT NULL
           OR confirmation_captured_at IS NOT NULL
           OR employer_confirmation_id IS NOT NULL
           OR verified_at IS NOT NULL
         );
     END IF;
   END $$;`,

  /*
   * The controlled submission target's capture log (A5 workaround).
   *
   * Separate table on purpose. It records what an EMPLOYER-SHAPED endpoint
   * received, which is evidence about the pipeline, not a record of the user's
   * job search - it must never be confused with `applications` or with
   * `submission_receipts`, and nothing user-facing reads it.
   *
   * Bounded: JSONB columns are written from already-truncated strings, and rows
   * are pruned by the retention sweep. The 500MB volume is the reason.
   */
  `CREATE TABLE IF NOT EXISTS ats_sandbox_submissions (
     id SERIAL PRIMARY KEY,
     confirmation_id VARCHAR(64) NOT NULL UNIQUE,
     fields JSONB NOT NULL DEFAULT '{}'::jsonb,
     answers JSONB NOT NULL DEFAULT '{}'::jsonb,
     file_info JSONB,
     received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_ats_sandbox_received ON ats_sandbox_submissions(received_at)`,

  /*
   * Feature 8 — a saved resume version per company.
   *
   * Stores a REFERENCE to an existing tailored_resumes row, never a copy of the
   * text. The 500MB volume filled once and killed Postgres; duplicating resume
   * bodies per company is exactly how that happens again.
   *
   * `company_key` is the normalised name and carries the uniqueness, so
   * "Discord", "discord" and "Discord " are one company rather than three.
   * `company_name` keeps the form the posting actually used, because that is
   * what the user recognises.
   *
   * ON DELETE CASCADE from tailored_resumes: a saved version whose resume has
   * been deleted is not a version, it is a dangling promise. Better to lose the
   * pointer than to offer a reuse that resolves to nothing.
   */
  `CREATE TABLE IF NOT EXISTS company_resume_versions (
     id SERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     company_key VARCHAR(120) NOT NULL,
     company_name VARCHAR(255) NOT NULL,
     tailored_resume_id INTEGER NOT NULL REFERENCES tailored_resumes(id) ON DELETE CASCADE,
     label VARCHAR(120),
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_company_resume_versions_unique
     ON company_resume_versions(user_id, company_key)`,
  `CREATE INDEX IF NOT EXISTS idx_company_resume_versions_user
     ON company_resume_versions(user_id, updated_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(user_id, status)`,

  /*
   * Crash reasons that survive the process that wrote them.
   *
   * Three outages, cause still unknown. The instrumentation added in c1cc33a
   * logs a stack before dying, but Railway's log retention on a crash-looping
   * service is exactly the condition where those logs are least likely to
   * still be readable - and a diagnosis you cannot read after the fact is not
   * a diagnosis. So the reason is written where it outlives the container.
   */
  `CREATE TABLE IF NOT EXISTS crash_reports (
     id SERIAL PRIMARY KEY,
     event VARCHAR(40) NOT NULL,
     message TEXT,
     stack TEXT,
     rss_mb INTEGER,
     uptime_seconds INTEGER,
     occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_crash_reports_time ON crash_reports(occurred_at DESC)`,

  /*
   * Wave C target user: 1-15 years, self-taught through senior.
   *
   * Stored as a NUMERIC RANGE, never as the label. The UI says "Mid" and
   * "Senior" because those are the words people use about themselves; scoring
   * needs years. Keeping the label in the database would mean re-deriving the
   * range at every read and re-labelling every row whenever the bands move.
   */
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS experience_min_years INTEGER`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS experience_max_years INTEGER`,

  /*
   * work_mem was 4 MB, and the database has spilled 13,326 MB across 3,120
   * temp files because of it - measured from pg_stat_database, not estimated.
   * That spill is what failed with 53100 when the volume ran out of room, and
   * it caused five outages.
   *
   * The window function that produced most of it is gone (1f), but 4 MB is the
   * wrong ceiling regardless: the next sort, join or aggregate that outgrows it
   * spills exactly the same way, and the jobs table only grows.
   *
   * 32 MB is chosen against measured headroom, not by feel. The Postgres
   * service reports effective_cache_size 5,242,888 kB and shared_buffers
   * 163,848 kB, so it has gigabytes available - it is a different container
   * from the 1 GB app. Worst case here is roughly (pool max 15) x (a few sorts)
   * x 32 MB, comfortably inside that.
   *
   * ALTER DATABASE rather than ALTER SYSTEM: it needs no reload, no superuser,
   * and applies to new connections. Idempotent, and reversible with RESET.
   */
  `DO $$
   BEGIN
     EXECUTE format('ALTER DATABASE %I SET work_mem = ''32MB''', current_database());
   EXCEPTION WHEN insufficient_privilege THEN
     RAISE NOTICE 'work_mem unchanged: insufficient privilege';
   END $$;`,

  /* ---------------------------------------------------------------- *
   * PRD build-out: Inbox, Tracker, Profile defaults, plans & credits
   * ---------------------------------------------------------------- */

  /*
   * Inbox. Recruiter mail routed to a per-user proxy address and categorised.
   *
   * body_text is capped by the ingest route rather than here, because this
   * database lives on a small volume that a stream of full HTML emails would
   * fill in days. The full message stays with the mail provider; this stores
   * what the list and reader need.
   */
  `CREATE TABLE IF NOT EXISTS inbox_messages (
     id SERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
     message_id VARCHAR(500),
     from_email VARCHAR(320),
     from_name VARCHAR(255),
     subject VARCHAR(500),
     body_text TEXT,
     category VARCHAR(32) NOT NULL DEFAULT 'other',
     otp_code VARCHAR(16),
     company_name VARCHAR(255),
     is_read BOOLEAN DEFAULT FALSE,
     received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_message_id ON inbox_messages(user_id, message_id) WHERE message_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_user_cat ON inbox_messages(user_id, category, received_at DESC)`,

  // The proxy address the user's recruiter mail is forwarded to.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS proxy_email VARCHAR(320)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_proxy_email ON users(proxy_email) WHERE proxy_email IS NOT NULL`,

  /*
   * Tracker. Kanban stage is deliberately SEPARATE from applications.status.
   * status is machine state (submitting/submitted/failed); stage is where the
   * human conversation has got to. Conflating them means a recruiter reply
   * would have to overwrite the record of whether we actually submitted.
   */
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS tracker_stage VARCHAR(32)`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications(user_id, tracker_stage)`,

  /*
   * Application defaults (PRD 3.8). Kept on application_profiles beside the
   * answers they feed, so the pre-fill engine reads one row.
   *
   * Self-identification stays nullable with no default: an unanswered EEO
   * question is a legitimate answer, and a column defaulting to anything would
   * put a claim on a real application that the user never made.
   */
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS visa_type VARCHAR(64)`,
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS in_person_ok BOOLEAN`,
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS has_transport BOOLEAN`,
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS needs_accommodation BOOLEAN`,
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS start_immediately BOOLEAN`,
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS prior_employee BOOLEAN`,
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS gov_clearance VARCHAR(64)`,
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS gov_ties BOOLEAN`,
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS self_id_gender VARCHAR(64)`,
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS self_id_ethnicity VARCHAR(64)`,
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS self_id_veteran VARCHAR(64)`,
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS self_id_disability VARCHAR(64)`,
  `ALTER TABLE application_profiles ADD COLUMN IF NOT EXISTS zip_code VARCHAR(16)`,

  /*
   * Plans and credits (PRD 6). Caps are stored per user rather than derived
   * from the tier name, so changing a plan's allowance later does not silently
   * rewrite what existing users were sold.
   */
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(16) DEFAULT 'starter'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_total INTEGER DEFAULT 600`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_used INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_reset_at TIMESTAMP`,

  /*
   * Apply behaviour (PRD 4). Two account-level toggles.
   *
   * review_before_submit defaults FALSE here, against the PRD's recommended
   * default, because this account explicitly asked for the approval step to be
   * removed. It is a setting either way - the disagreement is only about the
   * default, and the safer one is a switch away.
   */
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS auto_approve BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS review_before_submit BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS resume_optimization VARCHAR(16) DEFAULT 'honest'`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS auto_cover_letter BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS timezone VARCHAR(64)`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS notify_recommendations BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS notify_product BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS portfolio_public BOOLEAN DEFAULT FALSE`,

  /*
   * Networking (PRD 3.6). Outreach drafts and the daily lookup counter.
   */
  `CREATE TABLE IF NOT EXISTS outreach_contacts (
     id SERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     company_name VARCHAR(255) NOT NULL,
     contact_name VARCHAR(255),
     contact_title VARCHAR(255),
     contact_profile_url VARCHAR(600),
     source VARCHAR(64),
     draft_message TEXT,
     status VARCHAR(24) DEFAULT 'draft',
     sent_at TIMESTAMP,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_outreach_user ON outreach_contacts(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS outreach_lookups (
     id SERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     company_name VARCHAR(255),
     looked_up_on DATE DEFAULT CURRENT_DATE
   )`,
  `CREATE INDEX IF NOT EXISTS idx_outreach_lookups_day ON outreach_lookups(user_id, looked_up_on)`,

  /*
   * Resume versions (PRD 3.7). Default version plus duplicates/imports.
   */
  `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS version_name VARCHAR(120)`,
  `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS template VARCHAR(32) DEFAULT 'standard'`,

  /* ---------------------------------------------------------------- *
   * Structured resume document
   *
   * The editor needs addressable parts - you cannot reorder a section or mark
   * one bullet as pending when the whole resume is a single string. `doc` is
   * the source of truth; original_file_text stays as the DERIVED flat view,
   * regenerated on every write, because the extension, the ATS checker and
   * every stored tailored row already read it.
   * ---------------------------------------------------------------- */
  `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS doc JSONB`,
  `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS doc_updated_at TIMESTAMP`,
  /*
   * Who last wrote the document: the importer, or the user.
   *
   * This started as a comparison of doc_updated_at against updated_at, which
   * was exactly backwards - the import sets doc_updated_at to now, making every
   * freshly imported row look edited, so the re-parse skipped all of them. An
   * explicit marker cannot be misread that way.
   */
  `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS doc_source VARCHAR(16)`,
  `UPDATE resumes SET doc_source = 'import' WHERE doc IS NOT NULL AND doc_source IS NULL`,

  // Per-document formatting (PRD 3.7 toolbar). Stored beside the content so a
  // version carries its own look rather than inheriting a global setting.
  `ALTER TABLE resumes ADD COLUMN IF NOT EXISTS style JSONB`,

  /*
   * Edit rules the user has set ("keep bullets under two lines"). Applied as
   * constraints on what the editor may propose, and shown back to them so a
   * rule they forgot setting is not silently shaping their resume.
   */
  `CREATE TABLE IF NOT EXISTS resume_edit_rules (
     id SERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     rule TEXT NOT NULL,
     active BOOLEAN DEFAULT TRUE,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_resume_edit_rules_user ON resume_edit_rules(user_id)`,

  // Tailoring against a JD writes pending nodes into a doc snapshot, so the
  // preview can show them highlighted before anything is accepted.
  `ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS doc JSONB`,

  /* ---------------------------------------------------------------- *
   * Apply runs
   *
   * "3 of 20 need you, from this run" had nothing to read: the extension's
   * counters lived in service-worker memory, which is evicted routinely, so a
   * progress display built on them would blank out mid-run and show nothing at
   * all on another device.
   *
   * Deliberately NO counter columns. Progress is derived by counting
   * applications with this run_id, so there is no second number that can drift
   * from what actually happened - the applications are the count.
   * ---------------------------------------------------------------- */
  `CREATE TABLE IF NOT EXISTS apply_runs (
     id SERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     ended_at TIMESTAMP,
     source VARCHAR(24) DEFAULT 'extension'
   )`,
  `CREATE INDEX IF NOT EXISTS idx_apply_runs_user ON apply_runs(user_id, started_at DESC)`,

  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS run_id INTEGER REFERENCES apply_runs(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_applications_run ON applications(run_id)`,

  /*
   * A7.17 - ONE index, and it is the one the planner asks for.
   *
   * Four went in on the reasoning that removing the 500-row cap made the index
   * the universe. Then EXPLAIN ANALYZE on production said otherwise, and the
   * numbers decided it:
   *
   *   unfiltered feed  42.19ms  2 seq scans  indexes used: none
   *   24h filtered      1.47ms  1 seq scan   uses idx_jobs_active_posted
   *
   * The unfiltered feed reads essentially every active row, so a seq scan IS
   * the right plan and no index can improve it. The selective path is the one
   * A7.17 actually unlocked - "past 24 hours" went from 9 rows to 617 because
   * the filter now runs against the whole index instead of inside a 500-row
   * store - and there this index is worth 28x.
   *
   * The other three were speculation: jobs(source) cannot help a window that
   * already sorts the full scan, and both job_matches indexes lose to a hash
   * join over a table the match store caps at 500 rows. No plan named them.
   * On a volume that has filled once and taken production down with it, an
   * index no plan names is pure cost. Dropped, including on databases that
   * already created them.
   *
   * The rule, so this does not get re-litigated: an index earns its place by
   * appearing in a plan. /api/jobs/db-health prints the plan.
   */
  `CREATE INDEX IF NOT EXISTS idx_jobs_active_posted
     ON jobs (is_active, posted_at DESC NULLS LAST)`,

  /*
   * A7.20 — marks a score computed because a user was looking at the job,
   * rather than by the periodic sweep. The sweep deletes everything outside
   * its top-N; without this flag it would evict on-demand scores within the
   * hour and the same rows would be re-scored on every visit.
   */
  `ALTER TABLE job_matches ADD COLUMN IF NOT EXISTS on_demand BOOLEAN NOT NULL DEFAULT FALSE`,

  /*
   * Item 0 — the global submission kill switch. A row, not an env var, so an
   * operator can halt every account's submissions on the next request without
   * a deploy or a restart. Absent row means not halted; the gate fails closed
   * if the table cannot be read at all.
   */
  `CREATE TABLE IF NOT EXISTS system_flags (
     key VARCHAR(64) PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `INSERT INTO system_flags (key, value) VALUES ('submissions_halted', 'false')
     ON CONFLICT (key) DO NOTHING`,

  /*
   * Item 0 — an operator lever that needs no environment access.
   *
   * ADMIN_HALT_SECRET cannot be set from here: the app's Railway project is
   * not under the account this machine is logged into. A kill switch nobody
   * can pull is not a kill switch, so the owner's own account can pull it.
   *
   * Seeded to the lowest user id, which is the account that predates every
   * tester. Additive and idempotent; no other account gains anything.
   */
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE`,
  `UPDATE users SET is_admin = TRUE
     WHERE id = (SELECT MIN(id) FROM users) AND is_admin = FALSE`,

  /*
   * A7.2 (second half) — correct the rows that predate the ingest guard.
   *
   * 181 himalayas rows carry the literal string `name` as company_name. The
   * parser is correct now and nothing new can be stored, so these are legacy;
   * field-integrity has been counting them without anything acting on it, and
   * the resume editor renders company_name raw, so they read as an employer
   * called "name" on a live, applyable card.
   *
   * Null, not delete: `name` was never information, the posting itself is
   * real, and every surface using parsedOr then says "Company not stated"
   * honestly rather than confidently wrong.
   *
   * Recorded BEFORE it is applied. A corrector that overwrites in place and
   * keeps no record makes who was affected unknowable - the explicit lesson
   * from A5, and it is not softened here.
   *
   * The token list comes from the shared NOT_PARSED set rather than being
   * spelled out in SQL, so adding a token cannot leave the migration behind.
   */
  /*
   * Uses the data_corrections table A7.12 already created, with A7.12's
   * columns. A second CREATE TABLE IF NOT EXISTS carrying a different shape is
   * a silent no-op against the existing table, and every INSERT against the
   * shape that never got created then fails into runMigrations' swallowed
   * error path - a correction that logs nothing while appearing to work.
   * Caught by the guard below rather than in production.
   */
  /*
   * Must precede the UPDATE. company_name was VARCHAR(255) NOT NULL, so the
   * first attempt at this correction raised a constraint violation that
   * runMigrations logged and swallowed - it recorded 399 rows and changed
   * none, while the boot log still said "Migrations complete".
   *
   * The constraint is also what made the fabricated value the only storable
   * one: "we do not know this employer" had no representation, so `name` went
   * in instead. Relaxing it destroys nothing - notAJobReason refuses an
   * unparsed company at ingest, which is stricter than the column ever was.
   */
  `ALTER TABLE jobs ALTER COLUMN company_name DROP NOT NULL`,
  `INSERT INTO data_corrections (correction, table_name, row_count, detail)
     SELECT 'a7.2-null-unparsed-company', 'jobs', COUNT(*),
            jsonb_build_object(
              'ids', COALESCE(jsonb_agg(id), '[]'::jsonb),
              'values', COALESCE(jsonb_agg(DISTINCT company_name), '[]'::jsonb),
              'reason', 'field-name token stored as an employer; predates the A7.2 ingest guard'
            )
       FROM jobs
      WHERE LOWER(TRIM(company_name)) = ANY(${NOT_PARSED_SQL})
     HAVING COUNT(*) > 0`,
  `UPDATE jobs
      SET company_name = NULL
    WHERE LOWER(TRIM(company_name)) = ANY(${NOT_PARSED_SQL})`,
  `DROP INDEX IF EXISTS idx_jobs_source`,
  `DROP INDEX IF EXISTS idx_job_matches_user_job`,
  `DROP INDEX IF EXISTS idx_job_matches_user_score`,

  /*
   * 2026-08-08 — a manual tracker entry has no posting URL to store. The base
   * schema's NOT NULL described aggregated jobs, where a URL always exists;
   * against POST /tracker/manual and /import it forced a choice between
   * fabricating a URL (absence must stay absent) and the 500 production
   * actually served: `null value in column "job_url"`. Aggregated sources are
   * unaffected - every adapter supplies a real URL. Idempotent: DROP NOT NULL
   * on an already-nullable column is a no-op. Read back through the
   * jobs.job_url column_nullable claim in schemaClaims.js, because a
   * statement this runner swallows on failure is not a statement that ran.
   */
  `ALTER TABLE jobs ALTER COLUMN job_url DROP NOT NULL`,

  /*
   * Q2 (2026-08-08) — the verification account holds a real person's data.
   *
   * autonomy-verify-2026-08-08@hirepilot.local was seeded from the
   * operator's REAL profile: real name on users, real phone/email/employers
   * in the resume text, real employment history, the real name signed under
   * a generated cover letter. These statements replace the CONTENT with
   * clearly synthetic equivalents while keeping every row and id intact -
   * PROJECT.md's evidence trail names those ids.
   *
   * Shape rules honoured: audit row FIRST (a correction that does not record
   * what it changed cannot be told from one that never ran); every statement
   * keys on the email, never an id (ids differ per environment); every
   * content mutation carries its own already-synthetic guard so re-runs are
   * no-ops; nothing drops or alters a column. On a fresh database the
   * account does not exist and every statement is a clean no-op.
   */
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT FALSE`,

  `INSERT INTO data_corrections (correction, table_name, row_count, detail)
     SELECT 'q2-internal-account-scrub', 'users+resumes+user_experience+cover_letters', COUNT(*),
            jsonb_build_object(
              'email', 'autonomy-verify-2026-08-08@hirepilot.local',
              'reason', 'verification account was seeded from a real profile; content replaced with synthetic equivalents, rows and ids kept'
            )
       FROM users
      WHERE email = 'autonomy-verify-2026-08-08@hirepilot.local'
        AND COALESCE(is_internal, FALSE) = FALSE
     HAVING COUNT(*) > 0`,

  `UPDATE users
      SET full_name = 'Internal Verification Account', is_internal = TRUE
    WHERE email = 'autonomy-verify-2026-08-08@hirepilot.local'`,

  `UPDATE resumes
      SET original_file_text = 'SYNTHETIC VERIFICATION RESUME' || chr(10) ||
            'This account exercises production surfaces end to end. Nothing in this document describes a real person.' || chr(10) || chr(10) ||
            'SKILLS' || chr(10) ||
            'Design Systems, Figma, Prototyping, User Research, UX Design, UX Research, Usability Testing, Wireframing, Accessibility, Stakeholder Management, Leadership' || chr(10) || chr(10) ||
            'EXPERIENCE' || chr(10) ||
            'Verification Employer A - Verification Designer - Jan 2020-Present - Synthetic City' || chr(10) ||
            'Exercises parsing, scoring, tailoring and application paths with clearly synthetic content.' || chr(10) || chr(10) ||
            'Verification Employer B - Verification Designer - Jan 2016-Dec 2019 - Synthetic City' || chr(10) ||
            'Synthetic history kept so the profile stays scoreable for verification runs.',
          label = 'Internal verification resume',
          doc = NULL, doc_source = NULL, file_data = NULL, original_filename = NULL
    WHERE user_id IN (SELECT id FROM users WHERE email = 'autonomy-verify-2026-08-08@hirepilot.local')
      AND original_file_text NOT LIKE '%SYNTHETIC VERIFICATION RESUME%'`,

  `UPDATE user_experience
      SET company_name = 'Verification Employer ' || id,
          job_title = 'Verification Designer ' || id,
          start_date = DATE '2020-01-01', end_date = NULL, currently_working = FALSE
    WHERE user_id IN (SELECT id FROM users WHERE email = 'autonomy-verify-2026-08-08@hirepilot.local')
      AND company_name NOT LIKE 'Verification Employer%'`,

  `UPDATE cover_letters
      SET content = 'Synthetic verification cover letter. The generated original carried the real profile it was built from and was scrubbed 2026-08-08; this row remains as evidence that generation and persistence worked (PROJECT.md section 6).'
    WHERE user_id IN (SELECT id FROM users WHERE email = 'autonomy-verify-2026-08-08@hirepilot.local')
      AND content NOT LIKE '%Synthetic verification cover letter%'`,

  `UPDATE screening_answers
      SET answer = 'Synthetic verification answer (scrubbed 2026-08-08).'
    WHERE user_id IN (SELECT id FROM users WHERE email = 'autonomy-verify-2026-08-08@hirepilot.local')
      AND COALESCE(answer, '') NOT LIKE '%Synthetic verification answer%'`,

  `UPDATE tailored_resumes
      SET tailored_summary = 'Synthetic verification content (scrubbed 2026-08-08).',
          original_snapshot = NULL, diff_json = NULL,
          final_text = 'Synthetic verification content (scrubbed 2026-08-08).'
    WHERE user_id IN (SELECT id FROM users WHERE email = 'autonomy-verify-2026-08-08@hirepilot.local')
      AND COALESCE(final_text, '') NOT LIKE '%Synthetic verification content%'`,

  /*
   * L2 (2026-08-08) — delete match rows minted for unscoreable profiles.
   *
   * Before the on-demand scorer gained the A2 guard, a zero-skill,
   * zero-experience account browsing the feed got defaults-only "30%" rows
   * PERSISTED into job_matches, and the join replayed them forever. These
   * are scores computed from no information about the person - fabricated
   * data by this project's own definition - and by that definition a user
   * with no skills and no dated experience can have no honest match rows at
   * all. Audit first; idempotent (the second run matches zero users).
   */
  `INSERT INTO data_corrections (correction, table_name, row_count, detail)
     SELECT 'l2-unscoreable-profile-scores', 'job_matches', COUNT(*),
            jsonb_build_object('reason', 'match rows existed for profiles with no skills and no dated experience; scores computed from no information')
       FROM job_matches jm
      WHERE NOT EXISTS (SELECT 1 FROM user_skills us WHERE us.user_id = jm.user_id)
        AND NOT EXISTS (SELECT 1 FROM user_experience ue WHERE ue.user_id = jm.user_id AND ue.start_date IS NOT NULL)
     HAVING COUNT(*) > 0`,

  `DELETE FROM job_matches jm
      WHERE NOT EXISTS (SELECT 1 FROM user_skills us WHERE us.user_id = jm.user_id)
        AND NOT EXISTS (SELECT 1 FROM user_experience ue WHERE ue.user_id = jm.user_id AND ue.start_date IS NOT NULL)`,

  /*
   * L5 (2026-08-08) — the receipts trigger gains its one legitimate
   * exception. Receipts are append-only against EDITING history; account
   * deletion is not editing, it is the person leaving and taking their
   * records with them, and without this the users cascade throws on the
   * first receipt and no account holding one can ever be deleted. DELETE
   * passes only when the transaction-local account-deletion flag is set
   * (SET LOCAL, so it cannot leak past the transaction); UPDATE never
   * passes in any state - history stays unrewritable.
   */
  `CREATE OR REPLACE FUNCTION submission_receipts_are_immutable()
     RETURNS TRIGGER AS $fn$
     BEGIN
       IF TG_OP = 'DELETE'
          AND current_setting('hirepilot.account_deletion', true) = 'on' THEN
         RETURN OLD;
       END IF;
       RAISE EXCEPTION
         'submission_receipts is append-only: % on receipt % was rejected',
         TG_OP, COALESCE(OLD.id, NEW.id);
     END;
     $fn$ LANGUAGE plpgsql`,
];

/*
 * A7.4b — the reasons already written into applications.screening_answers.
 *
 * A7.4 fixed the generator; the page kept showing the old sentence, because
 * PATCH /api/apply/queue/:id/questions persists each reason and every row
 * written before the fix carries its own frozen copy. Production had 8 such
 * questions across 6 applications, all reading
 *   Your saved answer to "are_you_hispanic_latino" is not one of this form's
 *   options.
 *
 * REGENERATED, not patched. correctedReason() rebuilds the sentence from the
 * question's own `suggestion` - the saved answer, which is what the generator
 * names - using the generator's own builder, so the two cannot diverge. It
 * returns null rather than guessing when there is no saved answer, and it is
 * idempotent, so a redeploy is a no-op.
 *
 * Only `reason` is written. The answers are the user's own data and a
 * demographic answer must never be rewritten by a migration.
 *
 * Recorded before it is applied, AND the applied count is returned - A7.2's
 * correction reported 399 rows while changing none, because runMigrations
 * swallowed a constraint violation. The record alone is not evidence.
 */
const backfillScreeningReasons = async () => {
  try {
    const { correctedReason } = require('./screeningPrefill');

    const { rows } = await query(
      `SELECT id, user_id, screening_answers
         FROM applications
        WHERE screening_answers IS NOT NULL
          AND screening_answers::text LIKE '%is not one of this form%'
        LIMIT 2000`
    );

    const changes = [];
    for (const row of rows) {
      const sa = row.screening_answers;
      const questions = Array.isArray(sa && sa.questions) ? sa.questions : null;
      if (!questions) continue;

      let touched = 0;
      const next = questions.map((q) => {
        const corrected = correctedReason(q);
        if (!corrected) return q;
        touched += 1;
        // Spread first, overwrite only `reason` - answer, options, suggestion
        // and everything else pass through untouched.
        return { ...q, reason: corrected };
      });

      if (touched) {
        changes.push({
          id: row.id,
          userId: row.user_id,
          touched,
          old: questions.filter((q) => correctedReason(q)).map((q) => q.reason),
          value: { ...sa, questions: next },
        });
      }
    }

    if (!changes.length) return { scanned: rows.length, applications: 0, questions: 0 };

    await query(
      `INSERT INTO data_corrections (correction, table_name, row_count, detail)
       VALUES ('a7.4b-screening-reason', 'applications', $1, $2)`,
      [
        changes.length,
        JSON.stringify({
          ids: changes.map((c) => c.id),
          questions: changes.reduce((n, c) => n + c.touched, 0),
          oldValues: changes.flatMap((c) => c.old).slice(0, 50),
          reason: 'reason quoted an internal profile key; regenerated from the saved answer',
        }),
      ]
    );

    let applied = 0;
    for (const c of changes) {
      const res = await query(
        `UPDATE applications
            SET screening_answers = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND user_id = $3`,
        [JSON.stringify(c.value), c.id, c.userId]
      );
      applied += res.rowCount || 0;
    }

    console.log(`A7.4b: corrected ${applied}/${changes.length} applications`);
    return {
      scanned: rows.length,
      applications: applied,
      questions: changes.reduce((n, c) => n + c.touched, 0),
    };
  } catch (err) {
    console.error('A7.4b screening-reason backfill failed:', err.message);
    return { error: err.message };
  }
};

/*
 * Parse existing flat-text resumes into the structured model.
 *
 * Idempotent by `doc IS NULL`, so it fills in rows created before the column
 * existed and never touches one someone has since edited. Heuristic and
 * imperfect on purpose - a rough parse the user can correct in the editor beats
 * blocking the whole feature on a perfect one, and nothing is destroyed:
 * original_file_text is left exactly as it was.
 */
const backfillResumeDocs = async () => {
  try {
    const { parseText, DOC_VERSION } = require('./resumeDocument');
    /*
     * Rows never parsed, plus rows parsed by an older parser - but ONLY those
     * still marked as imports. The moment the user saves from the editor the
     * row becomes doc_source='user' and is never re-parsed, so a parser
     * improvement can reach stale imports without ever overwriting real edits.
     */
    const rows = await query(
      `SELECT id, original_file_text FROM resumes
        WHERE original_file_text IS NOT NULL AND length(original_file_text) > 40
          AND (
            doc IS NULL
            OR (
              COALESCE((doc->>'version')::int, 1) < $1
              AND COALESCE(doc_source, 'import') = 'import'
            )
          )
        LIMIT 500`,
      [DOC_VERSION]
    );
    let done = 0;
    for (const row of rows.rows) {
      try {
        const doc = parseText(row.original_file_text);
        if (!doc.sections.length) continue;
        await query(
          `UPDATE resumes SET doc = $1::jsonb, doc_source = 'import',
                  doc_updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND COALESCE(doc_source, 'import') = 'import'`,
          [JSON.stringify(doc), row.id]
        );
        done += 1;
      } catch (err) {
        console.warn(`[migrate] could not parse resume ${row.id}:`, err.message);
      }
    }
    if (done) console.log(`Parsed ${done} resume document(s) to model v${DOC_VERSION}`);
  } catch (err) {
    console.error('Resume doc backfill failed:', err.message);
  }
};

const runMigrations = async () => {
  await applyBaseSchema();
  for (const statement of STATEMENTS) {
    try {
      await query(statement);
    } catch (err) {
      console.error('Migration failed:', statement.slice(0, 60), '-', err.message);
    }
  }
  await backfillResumeDocs();
  await backfillScreeningReasons();
  console.log('Migrations complete');
};

module.exports = { runMigrations, STATEMENTS };
