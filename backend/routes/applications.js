const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Get user's applications (Kanban data)
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT a.id, a.job_id, a.status, a.applied_at, a.last_status_update,
              j.title, j.company_name, j.location, j.job_url
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE a.user_id = $1
       ORDER BY a.applied_at DESC`,
      [req.user.id]
    );

    // Organize by status for Kanban
    const kanban = {
      applied: [],
      phone_screen: [],
      technical_interview: [],
      onsite: [],
      offer: [],
      hired: [],
    };
    const rejected = [];

    for (const app of result.rows) {
      if (app.status === 'rejected') {
        rejected.push(app);
      } else if (kanban[app.status]) {
        kanban[app.status].push(app);
      }
    }

    res.json({
      total: result.rows.length,
      kanban,
      rejected,
      byStatus: {
        applied: kanban.applied.length,
        phone_screen: kanban.phone_screen.length,
        technical_interview: kanban.technical_interview.length,
        onsite: kanban.onsite.length,
        offer: kanban.offer.length,
        hired: kanban.hired.length,
        rejected: rejected.length,
      },
    });
  } catch (err) {
    console.error('Get applications error:', err);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// Create application
router.post('/', verifyToken, async (req, res) => {
  try {
    const { jobId, coverLetter } = req.body;

    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }

    // Check if job exists
    const jobResult = await query('SELECT id FROM jobs WHERE id = $1', [jobId]);
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Check if already applied
    const existingResult = await query(
      'SELECT id FROM applications WHERE user_id = $1 AND job_id = $2',
      [req.user.id, jobId]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({ error: 'Already applied to this job' });
    }

    // Create application
    const result = await query(
      `INSERT INTO applications (user_id, job_id, status, cover_letter)
       VALUES ($1, $2, 'applied', $3)
       RETURNING *`,
      [req.user.id, jobId, coverLetter || null]
    );

    // Log activity
    await query(
      `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
       VALUES ($1, 'application_sent', $2, $3)`,
      [req.user.id, jobId, JSON.stringify({ status: 'applied' })]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create application error:', err);
    res.status(500).json({ error: 'Failed to create application' });
  }
});

// Update application status
router.put('/:id/status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['applied', 'phone_screen', 'technical_interview', 'onsite', 'offer', 'rejected', 'hired'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Get current application
    const currentResult = await query(
      'SELECT status FROM applications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const previousStatus = currentResult.rows[0].status;

    // Update application
    const result = await query(
      `UPDATE applications SET status = $1, last_status_update = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [status, req.params.id, req.user.id]
    );

    // Log status change
    await query(
      `INSERT INTO application_history (application_id, previous_status, new_status, changed_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [req.params.id, previousStatus, status]
    );

    // Log activity
    await query(
      `INSERT INTO activity_log (user_id, event_type, metadata)
       VALUES ($1, 'status_updated', $2)`,
      [req.user.id, JSON.stringify({ application_id: req.params.id, from: previousStatus, to: status })]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update application status error:', err);
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// Get application stats for dashboard
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT
        COUNT(*) as total_applications,
        COUNT(CASE WHEN status = 'applied' THEN 1 END) as applied,
        COUNT(CASE WHEN status = 'phone_screen' THEN 1 END) as phone_screen,
        COUNT(CASE WHEN status IN ('technical_interview','onsite') THEN 1 END) as interviews,
        COUNT(CASE WHEN status = 'offer' THEN 1 END) as offers,
        COUNT(CASE WHEN status = 'hired' THEN 1 END) as hired,
        COUNT(DISTINCT DATE(applied_at)) as days_applying
       FROM applications
       WHERE user_id = $1`,
      [req.user.id]
    );

    // Total active jobs currently tracked in the system
    const scannedResult = await query(
      `SELECT COUNT(*) as scanned FROM jobs WHERE is_active = true`
    );

    res.json({
      ...result.rows[0],
      scanned_today: scannedResult.rows[0]?.scanned || 0,
    });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
