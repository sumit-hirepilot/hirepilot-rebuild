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
