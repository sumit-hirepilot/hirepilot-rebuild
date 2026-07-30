const fs = require('fs');
const path = require('path');
const { query } = require('../db');

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

  `ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_applied_at_requires_submitted`,
  `ALTER TABLE applications ADD CONSTRAINT applications_applied_at_requires_submitted
     CHECK (applied_at IS NULL OR status = 'submitted')`,

  `CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(user_id, status)`,
];

const runMigrations = async () => {
  await applyBaseSchema();
  for (const statement of STATEMENTS) {
    try {
      await query(statement);
    } catch (err) {
      console.error('Migration failed:', statement.slice(0, 60), '-', err.message);
    }
  }
  console.log('Migrations complete');
};

module.exports = { runMigrations };
