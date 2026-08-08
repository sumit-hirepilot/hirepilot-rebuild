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
      `SELECT a.id, a.job_id, a.status, a.tracker_stage, a.is_manual,
              a.applied_at, a.last_status_update,
              a.failure_reason, a.submitted_by,
              j.title, j.company_name, j.location, j.job_url
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE a.user_id = $1
       ORDER BY a.applied_at DESC NULLS LAST, a.created_at DESC, a.id DESC`,
      [req.user.id]
    );

    result.rows.forEach((app) => {
      app.title = fixMojibake(app.title);
      app.company_name = fixMojibake(app.company_name);
    });

    /*
     * The board's columns are conversation stages read from tracker_stage,
     * not statuses. The old columns (phone_screen, technical_interview,
     * onsite, hired) were a status vocabulary no write path can legally
     * produce - applications_applied_at_requires_submitted pins every row
     * with applied_at to status='submitted' - so those columns were empty
     * forever and every submitted row fell through the buckets and appeared
     * NOWHERE on this page. The most important rows in the product were the
     * invisible ones.
     */
    const needsYou = [];
    const kanban = {
      applied: [],
      interviewing: [],
      offer: [],
      ghosted: [],
    };
    const rejected = [];
    const failed = [];
    const pendingReview = [];

    // Legacy pipeline statuses from a pre-constraint database, read into the
    // stage they meant. Nothing can write them today.
    const LEGACY_STATUS_STAGE = {
      applied: 'applied',
      phone_screen: 'interviewing',
      technical_interview: 'interviewing',
      onsite: 'interviewing',
      offer: 'offer',
      hired: 'offer',
    };

    for (const app of result.rows) {
      const onBoard = app.status === 'submitted' || app.is_manual === true;
      if (app.status === 'rejected' || (onBoard && app.tracker_stage === 'rejected')) {
        rejected.push(app);
      } else if (app.status === 'failed') {
        failed.push(app);
      } else if (app.status === 'needs_user') {
        /*
         * Parked applications matched none of the buckets and fell through
         * entirely - they appeared nowhere on the Applications page, so a
         * blocker was invisible unless the user happened to be watching the run
         * that produced it.
         */
        needsYou.push(app);
      } else if (app.status === 'pending_review') {
        pendingReview.push(app);
      } else if (onBoard) {
        // No stage yet means sent and waiting - the applied column.
        const stage = kanban[app.tracker_stage] ? app.tracker_stage : 'applied';
        kanban[stage].push(app);
      } else if (LEGACY_STATUS_STAGE[app.status]) {
        kanban[LEGACY_STATUS_STAGE[app.status]].push(app);
      }
      // approved / submitting drafts are the queue's to show, not the board's.
    }

    res.json({
      total: result.rows.length,
      kanban,
      needsYou,
      rejected,
      failed,
      pendingReview,
      byStatus: {
        applied: kanban.applied.length,
        interviewing: kanban.interviewing.length,
        offer: kanban.offer.length,
        ghosted: kanban.ghosted.length,
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
/*
 * A1 — the standing integrity check behind health item 8.
 *
 * Aggregates only. Counts and a distinct-user tally are facts about the
 * database, not about any person, so this is safe for any authenticated
 * caller; identifying WHICH users are affected is not, and is gated on
 * ADMIN_EMAILS. With that unset the detail is omitted rather than the request
 * failing - the counts are the part the health check needs.
 *
 * Exists because there is no other way to audit all users: the rest of the API
 * is per-user by construction.
 */
router.get('/integrity', verifyToken, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'applied')                    AS applied_total,
         COUNT(*) FILTER (WHERE status = 'applied'
                            AND COALESCE(is_manual, FALSE) = TRUE)     AS applied_manual,
         COUNT(*) FILTER (WHERE status = 'applied'
                            AND COALESCE(is_manual, FALSE) = FALSE
                            AND submitted_at IS NULL
                            AND confirmation_captured_at IS NULL
                            AND employer_confirmation_id IS NULL
                            AND verified_at IS NULL)                   AS applied_false,
         COUNT(DISTINCT user_id) FILTER (WHERE status = 'applied'
                            AND COALESCE(is_manual, FALSE) = FALSE
                            AND submitted_at IS NULL
                            AND confirmation_captured_at IS NULL
                            AND employer_confirmation_id IS NULL
                            AND verified_at IS NULL)                   AS users_affected,
         COUNT(*) FILTER (WHERE status = 'submitted')                  AS submitted_total
       FROM applications`
    );
    const counts = Object.fromEntries(
      Object.entries(rows[0]).map(([k, v]) => [k, Number(v)])
    );

    /*
     * A4 — the receipt machinery, read from the catalog for the same reason.
     * runMigrations logs a failed CREATE TRIGGER and carries on, so "the deploy
     * was clean" is not evidence the table is actually append-only. The whole
     * value of a receipt is that it cannot be rewritten; that claim has to be
     * checked, not assumed.
     */
    const { rows: receiptFacts } = await query(
      `SELECT
         (SELECT COUNT(*) FROM pg_tables
           WHERE tablename = 'submission_receipts')                     AS table_present,
         (SELECT COUNT(*) FROM pg_trigger
           WHERE tgname = 'trg_submission_receipts_immutable'
             AND NOT tgisinternal)                                      AS immutable_trigger,
         (SELECT COUNT(*) FROM pg_indexes
           WHERE indexname = 'idx_submission_receipts_app_unique')      AS one_per_application`
    );
    const receipts = Object.fromEntries(
      Object.entries(receiptFacts[0]).map(([k, v]) => [k, Number(v) > 0])
    );

    // Confirm the constraint is really there, per the standing rule: a failed
    // ADD CONSTRAINT is logged and skipped by runMigrations, so a clean boot
    // proves nothing. Read the catalog instead.
    const { rows: con } = await query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'applications'::regclass
          AND conname = 'applications_applied_requires_submission'`
    );

    const admins = (process.env.ADMIN_EMAILS || '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const isAdmin = admins.includes(String(req.user.email || '').toLowerCase());

    let affected;
    if (isAdmin) {
      const { rows: who } = await query(
        `SELECT user_id, COUNT(*)::int AS rows FROM applications
          WHERE status = 'applied' AND COALESCE(is_manual, FALSE) = FALSE
            AND submitted_at IS NULL AND confirmation_captured_at IS NULL
            AND employer_confirmation_id IS NULL AND verified_at IS NULL
          GROUP BY user_id ORDER BY user_id`
      );
      affected = who;
    }

    res.json({
      counts,
      constraintPresent: con.length > 0,
      receipts,
      // Absent, not empty, when the caller is not an admin - so a reader cannot
      // mistake "not shown to you" for "nobody affected".
      ...(affected ? { affected } : { affectedDetail: 'requires ADMIN_EMAILS' }),
    });
  } catch (err) {
    console.error('Integrity check error:', err);
    res.status(500).json({ error: 'Failed to run integrity check' });
  }
});

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

    /*
     * A1 — this wrote status='applied' as a literal, with no submitted_at, no
     * confirmation and no employer response. Nothing here sends anything: the
     * extension submits, in the user's own browser, and recordEvidence is the
     * only path to 'submitted'. So every row this created was a tracker entry
     * claiming an application the employer never received - the exact defect
     * A1 exists to close, and still reachable from the Search Agent flow.
     *
     * 'approved' is the real pre-submission state in the apply pipeline
     * (approved -> submitting -> submitted). Queuing is what actually happened.
     * The activity event follows the same correction: nothing was sent.
     */
    const result = await query(
      `INSERT INTO applications (user_id, job_id, status, cover_letter, is_manual)
       VALUES ($1, $2, 'approved', $3, FALSE)
       RETURNING *`,
      [req.user.id, jobId, coverLetter || null]
    );

    // Log activity
    await query(
      `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
       VALUES ($1, 'application_queued', $2, $3)`,
      [req.user.id, jobId, JSON.stringify({ status: 'approved' })]
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

    /*
     * Retrying puts it back in the queue. It does not mark it applied.
     *
     * This wrote status='applied'. A failed application is one where nothing
     * reached the employer - that is what 'failed' means here, and the tracker
     * says so in as many words - so the row carries no submitted_at, no
     * verified_at and no confirmation. That is exactly the row
     * applications_applied_requires_submission refuses, so the statement could
     * only ever raise and the Retry button could only ever 500.
     *
     * Same defect as the approve path (D37), same cause: the constraint was
     * right and the write path had never caught up. And the same second error
     * underneath it - "retry" cannot mean "assert the employer received it",
     * because retrying is precisely the admission that they did not.
     */
    const result = await query(
      `UPDATE applications SET status = 'approved', failure_reason = NULL,
       last_status_update = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.id]
    );

    await query(
      `INSERT INTO application_history (application_id, previous_status, new_status, changed_at)
       VALUES ($1, 'failed', 'approved', CURRENT_TIMESTAMP)`,
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
    /*
     * A7.18 — approving a draft moves it to 'approved', NOT to 'applied'.
     *
     * This wrote status='applied' directly. An Auto-Pilot draft carries no
     * submitted_at, no verified_at, no confirmation and is not manual, so that
     * row is exactly what applications_applied_requires_submission refuses -
     * the UPDATE could only ever raise, and the button could only ever 500.
     * The constraint was right and the write path had never caught up: it is
     * the same rule as D28, that "applied" is a claim about the employer
     * having received something, not about the user having clicked approve.
     *
     * So approval means what it says - this one may be sent - and 'applied'
     * arrives later, with a receipt behind it.
     */
    const result = await query(
      `UPDATE applications SET status = 'approved', last_status_update = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND status = 'pending_review' RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Pending application not found' });

    await query(
      `INSERT INTO application_history (application_id, previous_status, new_status, changed_at)
       VALUES ($1, 'pending_review', 'approved', CURRENT_TIMESTAMP)`,
      [req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Approve application error:', err);
    res.status(500).json({ error: 'Failed to approve application' });
  }
});

/*
 * A7.18 — approve many at once.
 *
 * A full page of drafts was twenty clicks, one per row, and a queue that costs
 * twenty clicks to clear is a queue people stop clearing. Same transition and
 * the same rule as the single approve, applied per row: 'approved', never
 * 'applied', because nothing has been sent yet.
 *
 * Scoped by user_id AND by status in one statement, so a stale id from a page
 * the user has not reloaded cannot approve someone else's row or re-approve a
 * row that has already moved on.
 */
router.post('/approve-bulk', verifyToken, async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger);
    if (!ids.length) return res.status(400).json({ error: 'No applications supplied' });

    const result = await query(
      `UPDATE applications SET status = 'approved', last_status_update = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND id = ANY($2::int[]) AND status = 'pending_review'
        RETURNING id`,
      [req.user.id, ids]
    );

    for (const row of result.rows) {
      await query(
        `INSERT INTO application_history (application_id, previous_status, new_status, changed_at)
         VALUES ($1, 'pending_review', 'approved', CURRENT_TIMESTAMP)`,
        [row.id]
      );
    }

    /*
     * Stated, not implied: ids that did not move are reported rather than
     * quietly absent from the count, so a partial result cannot read as a
     * complete one.
     */
    const approved = result.rows.map((r) => r.id);
    res.json({
      approved,
      count: approved.length,
      unchanged: ids.filter((id) => !approved.includes(id)),
    });
  } catch (err) {
    console.error('POST /applications/approve-bulk failed:', err.message);
    res.status(500).json({ error: 'Could not approve those applications' });
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

/*
 * Move an application along the conversation - a tracker_stage write.
 *
 * This route used to write `status` directly from a pipeline vocabulary
 * (phone_screen, technical_interview, onsite, hired). Two constraints on the
 * live database refuse exactly that:
 *   - applications_applied_at_requires_submitted pins every row carrying
 *     applied_at to status='submitted', so moving any manual or auto-pilot
 *     row was a guaranteed 500 (the D38 class, parameterised so
 *     check-write-paths could not see the literal);
 *   - and a DRAFT with no applied_at could move to 'phone_screen', after
 *     which analytics counted a response for an application never sent.
 *
 * status answers "did this reach the employer"; tracker_stage answers "where
 * has the conversation got to". This route now only ever answers the second
 * question. The legacy words are still accepted and translated so an old
 * client keeps working.
 */
const STAGE_FOR = {
  applied: 'applied',
  phone_screen: 'interviewing',
  technical_interview: 'interviewing',
  onsite: 'interviewing',
  interviewing: 'interviewing',
  ghosted: 'ghosted',
  offer: 'offer',
  hired: 'offer',
  rejected: 'rejected',
};

router.put('/:id/status', verifyToken, async (req, res) => {
  try {
    const stage = STAGE_FOR[String(req.body.status || '').toLowerCase()];
    if (!stage) {
      return res.status(400).json({ error: `status must be one of ${Object.keys(STAGE_FOR).join(', ')}` });
    }

    const currentResult = await query(
      'SELECT status, tracker_stage, is_manual FROM applications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const current = currentResult.rows[0];
    const onBoard = current.status === 'submitted' || current.is_manual === true;
    if (!onBoard) {
      /*
       * A conversation stage on a row that never reached an employer would be
       * a claim about a conversation that cannot exist. Drafts move through
       * the submission pipeline (approve / retry / run), not through here.
       */
      return res.status(409).json({
        error: "This application hasn't been sent yet, so there is no employer conversation to move. Its state is managed by the submission pipeline - approve it from the queue to send it.",
      });
    }

    const previousStage = current.tracker_stage || 'applied';
    const result = await query(
      `UPDATE applications
          SET tracker_stage = $1, stage_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND user_id = $3
        RETURNING id, status, tracker_stage, stage_changed_at`,
      [stage, req.params.id, req.user.id]
    );

    await query(
      `INSERT INTO application_history (application_id, previous_status, new_status, changed_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [req.params.id, previousStage, stage]
    );

    await query(
      `INSERT INTO activity_log (user_id, event_type, metadata)
       VALUES ($1, 'status_updated', $2)`,
      [req.user.id, JSON.stringify({ application_id: req.params.id, from: previousStage, to: stage })]
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
      /*
       * Interviews and offers live in tracker_stage. The old version counted
       * statuses (phone_screen, technical_interview, onsite, offer, hired)
       * that the live constraints stop anything from writing, so every count
       * was a permanent zero - rendered on the dashboard as a fact about the
       * user when it was a fact about the schema.
       */
      `SELECT
        COUNT(*) as total_applications,
        COUNT(CASE WHEN (status = 'submitted' OR is_manual = TRUE)
                    AND (tracker_stage IS NULL OR tracker_stage = 'applied') THEN 1 END) as applied,
        COUNT(CASE WHEN (status = 'submitted' OR is_manual = TRUE)
                    AND tracker_stage = 'interviewing' THEN 1 END) as interviews,
        COUNT(CASE WHEN (status = 'submitted' OR is_manual = TRUE)
                    AND tracker_stage = 'offer' THEN 1 END) as offers,
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
