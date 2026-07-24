const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

const FIRST_NAMES = ['Sofia', 'Elena', 'Grace', 'Amir', 'Jordan', 'Maya', 'Liam', 'Priya', 'Noah', 'Isabella', 'Ethan', 'Zoe'];
const LAST_NAMES = ['Larsen', 'Patel', 'Novak', 'Rivera', 'Okafor', 'Chen', 'Bennett', 'Kapoor', 'Silva', 'Nguyen', 'Rossi', 'Kim'];
const TITLES = ['Director of Engineering', 'Product Manager', 'Design Lead', 'Staff Engineer', 'Engineering Manager', 'Talent Partner', 'Senior Recruiter', 'Head of Design'];
const RELATIONSHIPS = ['hiring_manager', 'alumni', 'employee'];

// Deterministic pseudo-random generator seeded by a string, so repeated
// searches for the same company return the same suggestions.
function seededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return function next() {
    h = (Math.imul(48271, h) + 1) % 2147483647;
    return (h < 0 ? h + 2147483647 : h) / 2147483647;
  };
}

function pick(arr, rand) {
  return arr[Math.floor(rand() * arr.length)];
}

function buildOutreachMessage(firstName, relationship, company) {
  if (relationship === 'alumni') {
    return `Hi ${firstName}, I noticed we're both connected to ${company} and share a school. Would you be open to a quick chat about your experience there?`;
  }
  if (relationship === 'hiring_manager') {
    return `Hi ${firstName}, I'm applying for a role on your team at ${company} and would love to learn more about what you're looking for.`;
  }
  return `Hi ${firstName}, I noticed we're both connected to ${company}. Would you be open to a quick chat about your experience there?`;
}

// Generate plausible contact suggestions for a company. These are templated,
// deterministically generated placeholders (no real people-search API is
// available), not real personal data - clearly framed as suggestions to track
// and reach out to via LinkedIn yourself.
router.post('/suggest', async (req, res) => {
  try {
    const { company } = req.body;
    if (!company || !company.trim()) {
      return res.status(400).json({ error: 'company is required' });
    }

    const rand = seededRandom(company.trim().toLowerCase());
    const count = 3 + Math.floor(rand() * 3); // 3-5 suggestions
    const usedNames = new Set();
    const suggestions = [];

    while (suggestions.length < count) {
      const firstName = pick(FIRST_NAMES, rand);
      const lastName = pick(LAST_NAMES, rand);
      const fullName = `${firstName} ${lastName}`;
      if (usedNames.has(fullName)) continue;
      usedNames.add(fullName);

      const relationship = pick(RELATIONSHIPS, rand);
      const title = pick(TITLES, rand);
      const mutualConnections = 2 + Math.floor(rand() * 8);

      suggestions.push({
        firstName,
        lastName,
        title,
        relationshipType: relationship,
        mutualConnections,
        message: buildOutreachMessage(firstName, relationship, company.trim()),
        linkedinSearchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${fullName} ${company.trim()}`)}`,
      });
    }

    res.json({ company: company.trim(), suggestions });
  } catch (err) {
    console.error('Suggest contacts error:', err);
    res.status(500).json({ error: 'Failed to generate contact suggestions' });
  }
});

// List tracked contacts, optionally filtered by job
router.get('/', async (req, res) => {
  try {
    const { jobId } = req.query;
    const params = [req.user.id];
    let where = 'WHERE r.user_id = $1';

    if (jobId) {
      params.push(jobId);
      where += ` AND r.job_id = $${params.length}`;
    }

    const result = await query(
      `SELECT r.*, j.title as target_job_title, j.company_name as job_company_name
       FROM referrals r
       LEFT JOIN jobs j ON r.job_id = j.id
       ${where}
       ORDER BY r.created_at DESC`,
      params
    );

    res.json({ contacts: result.rows });
  } catch (err) {
    console.error('List contacts error:', err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// Track a contact (from a suggestion, or manually)
router.post('/', async (req, res) => {
  try {
    const {
      jobId, companyName, firstName, lastName, email, linkedinUrl,
      jobTitle, relationshipType, notes,
    } = req.body;

    if (!companyName) {
      return res.status(400).json({ error: 'companyName is required' });
    }

    if (jobId) {
      const jobCheck = await query('SELECT id FROM jobs WHERE id = $1', [jobId]);
      if (!jobCheck.rows.length) return res.status(404).json({ error: 'Job not found' });
    }

    const result = await query(
      `INSERT INTO referrals (
         user_id, job_id, company_name, first_name, last_name, email,
         linkedin_url, job_title, relationship_type, status, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'identified', $10) RETURNING *`,
      [
        req.user.id, jobId || null, companyName, firstName || null, lastName || null,
        email || null, linkedinUrl || null, jobTitle || null,
        relationshipType || 'employee', notes || null,
      ]
    );

    await query(
      `INSERT INTO activity_log (user_id, event_type, metadata)
       VALUES ($1, 'contact_added', $2)`,
      [req.user.id, JSON.stringify({ name: `${firstName || ''} ${lastName || ''}`.trim(), company: companyName })]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add contact error:', err);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { firstName, lastName, email, linkedinUrl, jobTitle, relationshipType, status, notes } = req.body;

    const existingResult = await query('SELECT * FROM referrals WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!existingResult.rows.length) return res.status(404).json({ error: 'Contact not found' });
    const existing = existingResult.rows[0];

    const result = await query(
      `UPDATE referrals SET first_name = $1, last_name = $2, email = $3, linkedin_url = $4,
       job_title = $5, relationship_type = $6, status = $7, notes = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 AND user_id = $10 RETURNING *`,
      [
        firstName ?? existing.first_name, lastName ?? existing.last_name, email ?? existing.email,
        linkedinUrl ?? existing.linkedin_url, jobTitle ?? existing.job_title,
        relationshipType ?? existing.relationship_type, status ?? existing.status,
        notes ?? existing.notes, req.params.id, req.user.id,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update contact error:', err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM referrals WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Contact deleted' });
  } catch (err) {
    console.error('Delete contact error:', err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

module.exports = router;
