const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

// Search entry points for finding real people at a company.
//
// This previously returned invented contacts: a first name, surname and job
// title each picked at random from hardcoded lists, plus a fabricated
// "N mutual connections" count, all seeded by company name so the same
// fiction reappeared consistently. It rendered as an identified hiring
// manager - "Grace Chen · Engineering Manager · 6 mutual connections" - when
// no person had been identified at all. Acting on it meant contacting nobody,
// or worse, contacting a real namesake about a role they have no part in.
//
// It now returns searches the user runs themselves against LinkedIn's real
// index. No names, no titles, no counts are asserted by HirePilot.
const SEARCH_ROLES = [
  { key: 'recruiter', label: 'Recruiters & talent partners', terms: 'recruiter OR "talent acquisition" OR "talent partner"' },
  { key: 'hiring_manager', label: 'Engineering & design leadership', terms: '"engineering manager" OR "design lead" OR "head of design" OR director' },
  { key: 'peer', label: 'People already in this kind of role', terms: null },
];

const linkedInPeopleUrl = (company, terms) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${company} ${terms || ''}`.trim())}`;

router.post('/suggest', async (req, res) => {
  try {
    const { company, roleTitle } = req.body;
    if (!company || !company.trim()) {
      return res.status(400).json({ error: 'company is required' });
    }
    const name = company.trim();

    const searches = SEARCH_ROLES.map((r) => ({
      key: r.key,
      label: r.label,
      // The peer search uses the target job title when one was passed, which
      // is the user's own real context rather than an assumption.
      url: linkedInPeopleUrl(name, r.key === 'peer' ? (roleTitle || '') : r.terms),
    }));

    res.json({
      company: name,
      // Explicit so the client cannot mistake these for identified people.
      areIdentifiedPeople: false,
      searches,
      note: 'These are searches to run, not people HirePilot has identified. Add a contact below once you find a real one.',
    });
  } catch (err) {
    console.error('Build contact searches error:', err);
    res.status(500).json({ error: 'Failed to build contact searches' });
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
