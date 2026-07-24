const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'of', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that',
  'these', 'those', 'we', 'you', 'your', 'our', 'it', 'as', 'by', 'from',
  'will', 'would', 'should', 'can', 'could', 'have', 'has', 'had', 'do',
  'does', 'did', 'not', 'no', 'so', 'if', 'than', 'then', 'about', 'into',
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .match(/[a-z0-9']{2,}/g) || [];
}

function uniqueKeywords(text) {
  const tokens = tokenize(text).filter((t) => !STOPWORDS.has(t));
  return Array.from(new Set(tokens));
}

// Real keyword-overlap ATS check (no LLM configured for this app - this is
// honest word-tokenization matching, not a fabricated AI score).
function checkAts(jobDescription, resumeText) {
  const jobKeywords = uniqueKeywords(jobDescription);
  const resumeTokens = tokenize(resumeText);

  const matched = [];
  const missing = [];

  for (const kw of jobKeywords) {
    const found = resumeTokens.some((r) => r.includes(kw) || kw.includes(r));
    if (found) matched.push(kw);
    else missing.push(kw);
  }

  const score = jobKeywords.length ? Math.round((matched.length / jobKeywords.length) * 100) : 0;

  const tips = [];
  if (missing.length) {
    tips.push(`Add these keywords if genuinely true: ${missing.slice(0, 8).join(', ')}.`);
  }
  tips.push('Add quantifiable metrics (%, $, time saved) to strengthen impact.');
  tips.push('Use bullet points so an ATS parser can segment your experience.');
  if (tokenize(resumeText).length < 40) {
    tips.push('Your resume text looks short. Add more relevant detail per role.');
  }

  return { score, matched, missing, tips, totalKeywords: jobKeywords.length };
}

// --- Resume Manager ---

router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, original_file_text, label, is_default, created_at, updated_at FROM resumes WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [req.user.id]
    );
    res.json({ resumes: result.rows });
  } catch (err) {
    console.error('List resumes error:', err);
    res.status(500).json({ error: 'Failed to fetch resumes' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { text, isDefault, label } = req.body;

    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'Resume text must be at least 20 characters' });
    }

    if (isDefault) {
      await query('UPDATE resumes SET is_default = false WHERE user_id = $1', [req.user.id]);
    }

    const result = await query(
      `INSERT INTO resumes (user_id, original_file_text, label, is_default)
       VALUES ($1, $2, $3, $4) RETURNING id, original_file_text, label, is_default, created_at`,
      [req.user.id, text.trim(), label || null, !!isDefault]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add resume error:', err);
    res.status(500).json({ error: 'Failed to save resume' });
  }
});

router.put('/:id/default', async (req, res) => {
  try {
    await query('UPDATE resumes SET is_default = false WHERE user_id = $1', [req.user.id]);
    const result = await query(
      'UPDATE resumes SET is_default = true WHERE id = $1 AND user_id = $2 RETURNING id, is_default',
      [req.params.id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Resume not found' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Set default resume error:', err);
    res.status(500).json({ error: 'Failed to set default resume' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM resumes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Resume deleted' });
  } catch (err) {
    console.error('Delete resume error:', err);
    res.status(500).json({ error: 'Failed to delete resume' });
  }
});

// --- Tailor for a Job ---

router.get('/tailored', async (req, res) => {
  try {
    const result = await query(
      `SELECT tr.id, tr.tailored_summary, tr.highlighted_skills, tr.ats_score, tr.created_at,
              j.title as job_title, j.company_name
       FROM tailored_resumes tr
       JOIN jobs j ON tr.job_id = j.id
       WHERE tr.user_id = $1
       ORDER BY tr.created_at DESC`,
      [req.user.id]
    );
    res.json({ tailored: result.rows });
  } catch (err) {
    console.error('List tailored resumes error:', err);
    res.status(500).json({ error: 'Failed to fetch tailored resumes' });
  }
});

router.post('/tailor', async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });

    const [userResult, skillsResult, jobResult, defaultResumeResult] = await Promise.all([
      query('SELECT full_name, title FROM users WHERE id = $1', [req.user.id]),
      query('SELECT skill FROM user_skills WHERE user_id = $1 ORDER BY skill', [req.user.id]),
      query('SELECT title, company_name, description, requirements FROM jobs WHERE id = $1', [jobId]),
      query('SELECT id FROM resumes WHERE user_id = $1 AND is_default = true LIMIT 1', [req.user.id]),
    ]);

    if (!jobResult.rows.length) return res.status(404).json({ error: 'Job not found' });

    const user = userResult.rows[0];
    const skills = skillsResult.rows.map((r) => r.skill);
    const job = jobResult.rows[0];
    const name = user.full_name || 'Candidate';
    const userTitle = user.title || job.title;

    const skillsPhrase = skills.length ? skills.join(', ') : 'a strong, relevant background';

    const original = `${name}, ${userTitle} with experience in ${skillsPhrase}.`;
    const tailored = `${name} is a ${userTitle} with hands-on experience in ${skillsPhrase}, tailored for the ${job.title} role at ${job.company_name}.`;

    const jobText = `${job.title} ${job.description || ''} ${job.requirements || ''}`;
    const { score } = checkAts(jobText, tailored);

    const saved = await query(
      `INSERT INTO tailored_resumes (user_id, resume_id, job_id, tailored_summary, highlighted_skills, ats_score)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [req.user.id, defaultResumeResult.rows[0]?.id || null, jobId, tailored, skills, score]
    );

    await query(
      `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
       VALUES ($1, 'resume_tailored', $2, $3)`,
      [req.user.id, jobId, JSON.stringify({ job_title: job.title, company_name: job.company_name })]
    );

    res.status(201).json({
      id: saved.rows[0].id,
      original,
      tailored,
      highlightedSkills: skills,
      atsScore: score,
      jobTitle: job.title,
      companyName: job.company_name,
      createdAt: saved.rows[0].created_at,
    });
  } catch (err) {
    console.error('Tailor resume error:', err);
    res.status(500).json({ error: 'Failed to tailor resume' });
  }
});

router.delete('/tailored/:id', async (req, res) => {
  try {
    await query('DELETE FROM tailored_resumes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Tailored resume deleted' });
  } catch (err) {
    console.error('Delete tailored resume error:', err);
    res.status(500).json({ error: 'Failed to delete tailored resume' });
  }
});

// --- ATS Checker ---

router.post('/ats-check', async (req, res) => {
  try {
    const { jobDescription, resumeText } = req.body;

    if (!jobDescription || !resumeText) {
      return res.status(400).json({ error: 'jobDescription and resumeText are required' });
    }

    const result = checkAts(jobDescription, resumeText);
    res.json(result);
  } catch (err) {
    console.error('ATS check error:', err);
    res.status(500).json({ error: 'Failed to check resume' });
  }
});

module.exports = router;
