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
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT FALSE`,
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
];

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
  console.log('Migrations complete');
};

module.exports = { runMigrations };
