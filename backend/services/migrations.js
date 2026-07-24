const { query } = require('../db');

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
];

const runMigrations = async () => {
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
