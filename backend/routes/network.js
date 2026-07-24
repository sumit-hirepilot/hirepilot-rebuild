const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

// List contacts, optionally filtered by job
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

// Add a contact
router.post('/', async (req, res) => {
  try {
    const {
      jobId, companyName, firstName, lastName, email, linkedinUrl,
      jobTitle, relationshipType, notes,
    } = req.body;

    if (!jobId || !companyName) {
      return res.status(400).json({ error: 'jobId and companyName are required' });
    }

    const jobCheck = await query('SELECT id FROM jobs WHERE id = $1', [jobId]);
    if (!jobCheck.rows.length) return res.status(404).json({ error: 'Job not found' });

    const result = await query(
      `INSERT INTO referrals (
         user_id, job_id, company_name, first_name, last_name, email,
         linkedin_url, job_title, relationship_type, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        req.user.id, jobId, companyName, firstName || null, lastName || null,
        email || null, linkedinUrl || null, jobTitle || null,
        relationshipType || 'employee', notes || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add contact error:', err);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { firstName, lastName, email, linkedinUrl, jobTitle, relationshipType, notes } = req.body;

    const result = await query(
      `UPDATE referrals SET first_name = $1, last_name = $2, email = $3, linkedin_url = $4,
       job_title = $5, relationship_type = $6, notes = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND user_id = $9 RETURNING *`,
      [firstName || null, lastName || null, email || null, linkedinUrl || null, jobTitle || null, relationshipType, notes || null, req.params.id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Contact not found' });

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
