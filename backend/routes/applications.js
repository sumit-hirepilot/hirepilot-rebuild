const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { runAutoApplyForUser } = require('../services/autoApplyEngine');
const { calculateMatchesForUser } = require('../services/matchingEngine');
const { fixMojibake } = require('../services/apis/textSanitizer');

const router = express.Router();

// Get user's applications (Kanban data)
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT a.id, a.job_id, a.status, a.applied_at, a.last_status_update,
              a.failure_reason, a.submitted_by,
              j.title, j.company_name, j.location, j.job_url
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE a.user_id = $1
       ORDER BY a.applied_at DESC`,
      [req.user.id]
    );

    result.rows.forEach((app) => {
      app.title = fixMojibake(app.title);
      app.company_name = fixMojibake(app.company_name);
    });

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
    const failed = [];
    const pendingReview = [];

    for (const app of result.rows) {
      if (app.status === 'rejected') {
        rejected.push(app);
      } else if (app.status === 'failed') {
        failed.push(app);
      } else if (app.status === 'pending_review') {
        pendingReview.push(app);
      } else if (kanban[app.status]) {
        kanban[app.status].push(app);
      }
    }

    res.json({
      total: result.rows.length,
      kanban,
      rejected,
      failed,
      pendingReview,
      byStatus: {
        applied: kanban.applied.length,
        phone_screen: kanban.phone_screen.length,
        technical_interview: kanban.technical_interview.length,
        onsite: kanban.onsite.length,
        offer: kanban.offer.length,
        hired: kanban.hired.length,
        rejected: rejected.length,
        failed: failed.length,
        pending_review: pendingReview.length,
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
    const jobResult = await query('SELECT id, is_active, title, company_name FROM jobs WHERE id = $1', [jobId]);
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const job = jobResult.rows[0];

    // Check if already applied
    const existingResult = await query(
      'SELECT id FROM applications WHERE user_id = $1 AND job_id = $2',
      [req.user.id, jobId]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({ error: 'Already applied to this job' });
    }

    // Job may have gone inactive (delisted upstream) since the user last saw
    // it - record this as a real failed application rather than a generic
    // error, so the user can see why and retry once/if it reactivates.
    if (!job.is_active) {
      const failedResult = await query(
        `INSERT INTO applications (user_id, job_id, status, cover_letter, failure_reason)
         VALUES ($1, $2, 'failed', $3, $4)
         RETURNING *`,
        [req.user.id, jobId, coverLetter || null, 'This job posting is no longer active.']
      );

      await query(
        `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
         VALUES ($1, 'application_failed', $2, $3)`,
        [req.user.id, jobId, JSON.stringify({ reason: 'job_inactive' })]
      );

      return res.status(201).json(failedResult.rows[0]);
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

// Retry a failed application
router.post('/:id/retry', verifyToken, async (req, res) => {
  try {
    const appResult = await query(
      `SELECT a.*, j.is_active FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE a.id = $1 AND a.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (!appResult.rows.length) return res.status(404).json({ error: 'Application not found' });
    const app = appResult.rows[0];

    if (app.status !== 'failed') {
      return res.status(400).json({ error: 'Only failed applications can be retried' });
    }

    if (!app.is_active) {
      return res.status(200).json({
        ...app,
        message: 'This job posting is still inactive - retry will succeed once it becomes active again.',
      });
    }

    const result = await query(
      `UPDATE applications SET status = 'applied', failure_reason = NULL,
       last_status_update = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.id]
    );

    await query(
      `INSERT INTO application_history (application_id, previous_status, new_status, changed_at)
       VALUES ($1, 'failed', 'applied', CURRENT_TIMESTAMP)`,
      [req.params.id]
    );

    await query(
      `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
       VALUES ($1, 'application_retried', $2, $3)`,
      [req.user.id, app.job_id, JSON.stringify({ application_id: req.params.id })]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Retry application error:', err);
    res.status(500).json({ error: 'Failed to retry application' });
  }
});

// Approve a pending-review Auto-Pilot application: marks it as actually
// applied. This is the honest equivalent of "review before submit" - it
// only ever confirms HirePilot's own internal tracked record, since this
// app has never driven real form submission on an external ATS.
router.post('/:id/approve', verifyToken, async (req, res) => {
  try {
    const result = await query(
      `UPDATE applications SET status = 'applied', last_status_update = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND status = 'pending_review' RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Pending application not found' });

    await query(
      `INSERT INTO application_history (application_id, previous_status, new_status, changed_at)
       VALUES ($1, 'pending_review', 'applied', CURRENT_TIMESTAMP)`,
      [req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Approve application error:', err);
    res.status(500).json({ error: 'Failed to approve application' });
  }
});

// Discard a pending-review Auto-Pilot application without applying.
router.delete('/:id/discard', verifyToken, async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM applications WHERE id = $1 AND user_id = $2 AND status = 'pending_review' RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Pending application not found' });
    res.json({ message: 'Discarded' });
  } catch (err) {
    console.error('Discard application error:', err);
    res.status(500).json({ error: 'Failed to discard application' });
  }
});

// Manually trigger Full Auto Apply for the current user (normally runs on
// the 6-hour scheduler cycle) - lets the user see it work immediately after
// turning it on, rather than waiting for the next cron cycle.
router.post('/run-auto-pilot', verifyToken, async (req, res) => {
  try {
    await calculateMatchesForUser(req.user.id);
    const result = await runAutoApplyForUser(req.user);
    res.json({
      message: `Auto-Pilot run complete: ${result.applied} application${result.applied === 1 ? '' : 's'} sent${result.pendingReview ? `, ${result.pendingReview} pending your review` : ''}, ${result.flagged} flagged for review, ${result.skipped} skipped.`,
      ...result,
    });
  } catch (err) {
    console.error('Run auto-pilot error:', err);
    res.status(500).json({ error: 'Failed to run Auto-Pilot' });
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
