const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { extractSkills } = require('../services/matchingEngine');

const router = express.Router();

router.use(verifyToken);

// List resumes
router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, original_file_text, is_default, created_at, updated_at FROM resumes WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [req.user.id]
    );
    res.json({ resumes: result.rows });
  } catch (err) {
    console.error('List resumes error:', err);
    res.status(500).json({ error: 'Failed to fetch resumes' });
  }
});

// Add a resume (pasted text - no file storage backend available)
router.post('/', async (req, res) => {
  try {
    const { text, isDefault } = req.body;

    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'Resume text must be at least 20 characters' });
    }

    if (isDefault) {
      await query('UPDATE resumes SET is_default = false WHERE user_id = $1', [req.user.id]);
    }

    const result = await query(
      `INSERT INTO resumes (user_id, original_file_text, is_default)
       VALUES ($1, $2, $3) RETURNING id, original_file_text, is_default, created_at`,
      [req.user.id, text.trim(), !!isDefault]
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

// Analyze a resume against a specific job: real keyword-overlap analysis,
// not an AI rewrite (no LLM credentials are configured for this app).
router.post('/:id/analyze', async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });

    const resumeResult = await query(
      'SELECT original_file_text FROM resumes WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!resumeResult.rows.length) return res.status(404).json({ error: 'Resume not found' });

    const jobResult = await query(
      'SELECT title, description, requirements FROM jobs WHERE id = $1',
      [jobId]
    );
    if (!jobResult.rows.length) return res.status(404).json({ error: 'Job not found' });

    const job = jobResult.rows[0];
    const resumeText = resumeResult.rows[0].original_file_text.toLowerCase();

    const jobText = `${job.title} ${job.description || ''} ${job.requirements || ''}`;
    const requiredSkills = extractSkills(jobText);

    const covered = requiredSkills.filter((skill) => resumeText.includes(skill.toLowerCase()));
    const missing = requiredSkills.filter((skill) => !resumeText.includes(skill.toLowerCase()));

    const coveragePct = requiredSkills.length
      ? Math.round((covered.length / requiredSkills.length) * 100)
      : null;

    res.json({
      jobTitle: job.title,
      requiredSkills,
      coveredSkills: covered,
      missingSkills: missing,
      coveragePercent: coveragePct,
      suggestion: missing.length
        ? `Consider adding these keywords to your resume if you have experience with them: ${missing.slice(0, 8).join(', ')}.`
        : 'Your resume already covers the keywords detected in this job description.',
    });
  } catch (err) {
    console.error('Analyze resume error:', err);
    res.status(500).json({ error: 'Failed to analyze resume' });
  }
});

module.exports = router;
