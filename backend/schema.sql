-- HirePilot Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  title VARCHAR(255),
  profile_summary TEXT,
  location VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  onboarding_completed_at TIMESTAMP
);

-- Skills (user skills for matching)
CREATE TABLE IF NOT EXISTS user_skills (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill VARCHAR(255) NOT NULL,
  proficiency_level VARCHAR(50), -- beginner, intermediate, expert
  years_of_experience DECIMAL(3, 1),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, skill)
);

-- Experience (user work experience)
CREATE TABLE IF NOT EXISTS user_experience (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name VARCHAR(255),
  job_title VARCHAR(255),
  start_date DATE,
  end_date DATE,
  description TEXT,
  currently_working BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  min_salary INTEGER,
  max_salary INTEGER,
  job_types VARCHAR(255)[], -- array of job types
  work_arrangements VARCHAR(255)[], -- remote, hybrid, on-site
  preferred_locations VARCHAR(255)[],
  default_roles VARCHAR(255)[] DEFAULT '{}',
  excluded_keywords VARCHAR(255)[], -- keywords to exclude
  include_relocation BOOLEAN DEFAULT FALSE,
  auto_apply_enabled BOOLEAN DEFAULT FALSE,
  auto_apply_limit_per_day INTEGER DEFAULT 5,
  auto_apply_min_score DECIMAL(3,2) DEFAULT 0.75,
  blacklist_companies VARCHAR(255)[] DEFAULT '{}',
  dream_companies VARCHAR(255)[] DEFAULT '{}',
  resume_tailor_mode VARCHAR(20) DEFAULT 'honest', -- off, honest, aggressive
  auto_tailor_resume BOOLEAN DEFAULT TRUE,
  cover_letter_mode VARCHAR(20) DEFAULT 'always', -- always, when_requested, off
  review_before_submit BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Resumes
CREATE TABLE IF NOT EXISTS resumes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_file_url VARCHAR(1024),
  original_file_text TEXT,
  file_data BYTEA,
  original_filename VARCHAR(255),
  original_mimetype VARCHAR(100),
  label VARCHAR(255),
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tailored resume history (per job)
CREATE TABLE IF NOT EXISTS tailored_resumes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id INTEGER REFERENCES resumes(id) ON DELETE SET NULL,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tailored_summary TEXT,
  highlighted_skills VARCHAR(255)[],
  ats_score INTEGER,
  original_snapshot TEXT,
  diff_json JSONB,
  final_text TEXT,
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tailored_resumes_user_id ON tailored_resumes(user_id);

-- Cover letters (per job)
CREATE TABLE IF NOT EXISTS cover_letters (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cover_letters_user_id ON cover_letters(user_id);

-- Screening question answers
CREATE TABLE IF NOT EXISTS screening_answers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Saved jobs (bookmarks)
CREATE TABLE IF NOT EXISTS saved_jobs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_jobs_user_id ON saved_jobs(user_id);

-- Jobs (aggregated from external sources)
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  source VARCHAR(50) NOT NULL, -- 'remoteok', 'weworkremotely', 'remotive'
  external_id VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  company_url VARCHAR(1024),
  job_url VARCHAR(1024) NOT NULL UNIQUE,
  description TEXT,
  requirements TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  currency VARCHAR(10),
  job_type VARCHAR(50), -- full-time, part-time, contract, etc
  work_arrangement VARCHAR(50), -- remote, hybrid, on-site
  location VARCHAR(255),
  country VARCHAR(100),
  timezone VARCHAR(50),
  posted_at TIMESTAMP, -- Original publish date from the source; null if the source has no trustworthy date field. Refreshed on every re-fetch so a corrected source mapping self-heals existing rows.
  fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- When we last fetched this job
  is_active BOOLEAN DEFAULT TRUE,
  is_featured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, external_id)
);

-- Per-source job aggregation ingestion metrics (latency, success/failure)
CREATE TABLE IF NOT EXISTS source_ingestion_runs (
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
);
CREATE INDEX IF NOT EXISTS idx_source_ingestion_runs_source ON source_ingestion_runs(source, created_at DESC);

-- Job matches (job-user match scores)
CREATE TABLE IF NOT EXISTS job_matches (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  overall_score DECIMAL(3, 2), -- 0.00 to 1.00
  skills_match_score DECIMAL(3, 2),
  experience_match_score DECIMAL(3, 2),
  location_match_score DECIMAL(3, 2),
  salary_match_score DECIMAL(3, 2),
  match_details JSONB, -- detailed matching information
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, job_id),
  CONSTRAINT score_range CHECK (overall_score >= 0 AND overall_score <= 1)
);

-- Applications (track user's job applications)
CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'applied', -- applied, phone_screen, technical_interview, onsite, offer, rejected, hired, failed
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resume_version_used VARCHAR(255), -- which resume version was used
  cover_letter TEXT,
  cover_letter_id INTEGER REFERENCES cover_letters(id) ON DELETE SET NULL,
  notes TEXT,
  failure_reason TEXT,
  submitted_by VARCHAR(20) DEFAULT 'user', -- user, auto_pilot
  last_status_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, job_id)
);

-- Kanban status history (track movement through pipeline)
CREATE TABLE IF NOT EXISTS application_history (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  previous_status VARCHAR(50),
  new_status VARCHAR(50) NOT NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  change_reason TEXT
);

-- Referrals (hiring managers and alumni at companies)
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  company_name VARCHAR(255),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  email VARCHAR(255),
  linkedin_url VARCHAR(1024),
  job_title VARCHAR(255),
  relationship_type VARCHAR(50), -- alumni, hiring_manager, employee
  status VARCHAR(50) DEFAULT 'identified', -- identified, connected, messaged, referred
  confidence_score DECIMAL(3, 2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Search agents (standing searches)
CREATE TABLE IF NOT EXISTS search_agents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255),
  description TEXT,
  query_keywords VARCHAR(255)[], -- array of keywords to search for
  include_keywords VARCHAR(255)[],
  exclude_keywords VARCHAR(255)[],
  job_types VARCHAR(255)[], -- filter by job type
  work_arrangements VARCHAR(255)[],
  preferred_locations VARCHAR(255)[],
  min_salary INTEGER,
  max_salary INTEGER,
  min_match_score DECIMAL(3,2) DEFAULT 0.75,
  remote_ok BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  auto_apply BOOLEAN DEFAULT FALSE,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agent matches (results from standing searches)
CREATE TABLE IF NOT EXISTS agent_matches (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL REFERENCES search_agents(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  matched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_notified BOOLEAN DEFAULT FALSE,
  notified_at TIMESTAMP,
  UNIQUE(agent_id, job_id)
);

-- Activity log (for dashboard stats)
CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100), -- job_scanned, match_found, application_sent, status_updated, etc
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  metadata JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_jobs_source_external_id ON jobs(source, external_id);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_job_matches_user_id ON job_matches(user_id);
CREATE INDEX IF NOT EXISTS idx_job_matches_job_id ON job_matches(job_id);
CREATE INDEX IF NOT EXISTS idx_job_matches_overall_score ON job_matches(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_search_agents_user_id ON search_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_search_agents_is_active ON search_agents(is_active);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);
