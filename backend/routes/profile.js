const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

// Get full profile: user info + skills + experience + preferences
router.get('/', async (req, res) => {
  try {
    const userResult = await query(
      'SELECT id, email, full_name, title, location, profile_summary, created_at, onboarding_completed_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [skillsResult, experienceResult, preferencesResult] = await Promise.all([
      query('SELECT id, skill, proficiency_level, years_of_experience FROM user_skills WHERE user_id = $1 ORDER BY skill', [req.user.id]),
      query('SELECT id, company_name, job_title, start_date, end_date, description, currently_working FROM user_experience WHERE user_id = $1 ORDER BY start_date DESC NULLS LAST', [req.user.id]),
      query('SELECT * FROM user_preferences WHERE user_id = $1', [req.user.id]),
    ]);

    res.json({
      user: userResult.rows[0],
      skills: skillsResult.rows,
      experience: experienceResult.rows,
      preferences: preferencesResult.rows[0] || null,
    });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update basic profile info
router.put('/', async (req, res) => {
  try {
    const { fullName, title, location, profileSummary } = req.body;

    const result = await query(
      `UPDATE users SET full_name = $1, title = $2, location = $3, profile_summary = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING id, email, full_name, title, location, profile_summary`,
      [fullName || null, title || null, location || null, profileSummary || null, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change password
router.put('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newHash, req.user.id]);

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

router.post('/complete-onboarding', async (req, res) => {
  try {
    await query(
      'UPDATE users SET onboarding_completed_at = COALESCE(onboarding_completed_at, CURRENT_TIMESTAMP) WHERE id = $1',
      [req.user.id]
    );
    res.json({ message: 'Onboarding complete' });
  } catch (err) {
    console.error('Complete onboarding error:', err);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

// --- Skills ---

router.post('/skills', async (req, res) => {
  try {
    const { skill, proficiencyLevel, yearsOfExperience } = req.body;
    if (!skill) return res.status(400).json({ error: 'Skill name is required' });

    const result = await query(
      `INSERT INTO user_skills (user_id, skill, proficiency_level, years_of_experience)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, skill) DO UPDATE SET proficiency_level = $3, years_of_experience = $4
       RETURNING id, skill, proficiency_level, years_of_experience`,
      [req.user.id, skill.trim(), proficiencyLevel || null, yearsOfExperience || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add skill error:', err);
    res.status(500).json({ error: 'Failed to add skill' });
  }
});

router.delete('/skills/:id', async (req, res) => {
  try {
    await query('DELETE FROM user_skills WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Skill removed' });
  } catch (err) {
    console.error('Delete skill error:', err);
    res.status(500).json({ error: 'Failed to remove skill' });
  }
});

// --- Experience ---

router.post('/experience', async (req, res) => {
  try {
    const { companyName, jobTitle, startDate, endDate, description, currentlyWorking } = req.body;

    if (!companyName || !jobTitle) {
      return res.status(400).json({ error: 'Company name and job title are required' });
    }

    const result = await query(
      `INSERT INTO user_experience (user_id, company_name, job_title, start_date, end_date, description, currently_working)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.id, companyName, jobTitle, startDate || null, currentlyWorking ? null : (endDate || null), description || null, !!currentlyWorking]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add experience error:', err);
    res.status(500).json({ error: 'Failed to add experience' });
  }
});

router.put('/experience/:id', async (req, res) => {
  try {
    const { companyName, jobTitle, startDate, endDate, description, currentlyWorking } = req.body;

    const result = await query(
      `UPDATE user_experience SET company_name = $1, job_title = $2, start_date = $3, end_date = $4,
       description = $5, currently_working = $6
       WHERE id = $7 AND user_id = $8 RETURNING *`,
      [companyName, jobTitle, startDate || null, currentlyWorking ? null : (endDate || null), description || null, !!currentlyWorking, req.params.id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Experience entry not found' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update experience error:', err);
    res.status(500).json({ error: 'Failed to update experience' });
  }
});

router.delete('/experience/:id', async (req, res) => {
  try {
    await query('DELETE FROM user_experience WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Experience removed' });
  } catch (err) {
    console.error('Delete experience error:', err);
    res.status(500).json({ error: 'Failed to remove experience' });
  }
});

// --- Preferences ---

router.put('/preferences', async (req, res) => {
  try {
    const existingResult = await query('SELECT * FROM user_preferences WHERE user_id = $1', [req.user.id]);
    const existing = existingResult.rows[0] || {};
    const body = req.body;

    const pick = (key, fallback) => (body[key] !== undefined ? body[key] : (existing[key] !== undefined ? existing[key] : fallback));

    const minSalary = pick('minSalary', null);
    const maxSalary = pick('maxSalary', null);
    const jobTypes = pick('jobTypes', existing.job_types || []);
    const workArrangements = pick('workArrangements', existing.work_arrangements || []);
    const preferredLocations = pick('preferredLocations', existing.preferred_locations || []);
    const defaultRoles = pick('defaultRoles', existing.default_roles || []);
    const excludedKeywords = pick('excludedKeywords', existing.excluded_keywords || []);
    const includeRelocation = pick('includeRelocation', existing.include_relocation || false);
    const autoApplyEnabled = pick('autoApplyEnabled', existing.auto_apply_enabled || false);
    const autoApplyLimitPerDay = pick('autoApplyLimitPerDay', existing.auto_apply_limit_per_day || 5);
    const autoApplyMinScore = pick('autoApplyMinScore', existing.auto_apply_min_score || 0.75);
    const blacklistCompanies = pick('blacklistCompanies', existing.blacklist_companies || []);
    const dreamCompanies = pick('dreamCompanies', existing.dream_companies || []);
    const resumeTailorMode = pick('resumeTailorMode', existing.resume_tailor_mode || 'honest');
    const autoTailorResume = pick('autoTailorResume', existing.auto_tailor_resume ?? true);
    const coverLetterMode = pick('coverLetterMode', existing.cover_letter_mode || 'always');
    const reviewBeforeSubmit = pick('reviewBeforeSubmit', existing.review_before_submit || false);
    // PRD 3.9 / 4. Added because the Settings panels write these and, without
    // them, every toggle on those tabs would appear to save and change nothing.
    const autoApprove = pick('autoApprove', existing.auto_approve ?? true);
    const resumeOptimization = pick('resumeOptimization', existing.resume_optimization || 'honest');
    const autoCoverLetter = pick('autoCoverLetter', existing.auto_cover_letter ?? true);
    const portfolioPublic = pick('portfolioPublic', existing.portfolio_public || false);
    const notifyRecommendations = pick('notifyRecommendations', existing.notify_recommendations ?? true);
    const notifyProduct = pick('notifyProduct', existing.notify_product || false);
    const timezone = pick('timezone', existing.timezone || null);

    const result = await query(
      `INSERT INTO user_preferences (
         user_id, min_salary, max_salary, job_types, work_arrangements, preferred_locations,
         default_roles, excluded_keywords, include_relocation, auto_apply_enabled,
         auto_apply_limit_per_day, auto_apply_min_score, blacklist_companies, dream_companies,
         resume_tailor_mode, auto_tailor_resume, cover_letter_mode, review_before_submit,
         auto_approve, resume_optimization, auto_cover_letter, portfolio_public,
         notify_recommendations, notify_product, timezone
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                 $19, $20, $21, $22, $23, $24, $25)
       ON CONFLICT (user_id) DO UPDATE SET
         min_salary = $2, max_salary = $3, job_types = $4, work_arrangements = $5,
         preferred_locations = $6, default_roles = $7, excluded_keywords = $8, include_relocation = $9,
         auto_apply_enabled = $10, auto_apply_limit_per_day = $11, auto_apply_min_score = $12,
         blacklist_companies = $13, dream_companies = $14, resume_tailor_mode = $15,
         auto_tailor_resume = $16, cover_letter_mode = $17, review_before_submit = $18,
         auto_approve = $19, resume_optimization = $20, auto_cover_letter = $21,
         portfolio_public = $22, notify_recommendations = $23, notify_product = $24,
         timezone = $25,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        req.user.id, minSalary, maxSalary, jobTypes, workArrangements, preferredLocations,
        defaultRoles, excludedKeywords, !!includeRelocation, !!autoApplyEnabled,
        autoApplyLimitPerDay, autoApplyMinScore, blacklistCompanies, dreamCompanies,
        resumeTailorMode, !!autoTailorResume, coverLetterMode, !!reviewBeforeSubmit,
        !!autoApprove, resumeOptimization, !!autoCoverLetter, !!portfolioPublic,
        !!notifyRecommendations, !!notifyProduct, timezone,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update preferences error:', err);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

module.exports = router;
