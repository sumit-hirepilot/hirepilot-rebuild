/*
 * Tracker (PRD 3.5).
 *
 * A Kanban board of applications that actually reached an employer, plus manual
 * entries for ones applied to off-platform.
 *
 * The board reads `tracker_stage`, never `status`. They answer different
 * questions: status is "did this reach the employer, and can we prove it",
 * stage is "where has the conversation got to". Driving the board off status
 * would mean a recruiter's reply overwrites the submission record, which is the
 * one thing in this system that has to stay trustworthy.
 *
 * Per the PRD, in-progress states never appear here - an application still being
 * filled belongs on the Dashboard, not on a board of things that were sent.
 */

const express = require('express');
const { query } = require('../db');
const { boundText, clampReport } = require('../services/requestBounds');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const STAGES = ['applied', 'ghosted', 'interviewing', 'rejected', 'offer'];

// Nothing reaches the board without evidence it was submitted, except rows the
// user entered by hand and vouched for themselves.
const ON_BOARD = `(a.status = 'submitted' OR a.is_manual = TRUE)`;
// Same predicate without the table alias, for statements with no join.
const ON_BOARD_UNQUALIFIED = `(status = 'submitted' OR is_manual = TRUE)`;

router.get('/', verifyToken, async (req, res) => {
  try {
    // Bounded - an unbounded search string becomes an unbounded LIKE pattern.
    const searchBound = boundText(req.query.search);
    const search = searchBound.value;
    const params = [req.user.id];
    let extra = '';
    if (search) {
      params.push(`%${search}%`);
      extra = ` AND (j.company_name ILIKE $${params.length} OR j.title ILIKE $${params.length})`;
    }

    const r = await query(
      `SELECT a.id, a.status, a.tracker_stage, a.stage_changed_at, a.is_manual,
              a.submitted_at, a.verified_at, a.employer_confirmation_id,
              a.target_form_url, a.submission_channel, a.created_at,
              j.title, j.company_name, j.location, j.job_url
         FROM applications a
         LEFT JOIN jobs j ON j.id = a.job_id
        WHERE a.user_id = $1 AND ${ON_BOARD}${extra}
        ORDER BY COALESCE(a.stage_changed_at, a.submitted_at, a.created_at) DESC NULLS LAST, a.id DESC`,
      params
    );

    /*
     * A submitted application with no stage yet belongs in `applied` - it has
     * been sent and nothing has come back. Defaulting in the read rather than
     * backfilling the column keeps "no reply yet" distinguishable from "someone
     * moved this to Applied", which matters for the ghosting rule below.
     */
    const columns = Object.fromEntries(STAGES.map((s) => [s, []]));
    for (const row of r.rows) {
      const stage = STAGES.includes(row.tracker_stage) ? row.tracker_stage : 'applied';
      columns[stage].push({ ...row, tracker_stage: stage });
    }

    res.json({
      columns,
      counts: Object.fromEntries(STAGES.map((s) => [s, columns[s].length])),
      total: r.rows.length,
    });
  } catch (err) {
    console.error('GET /tracker failed:', err.message);
    res.status(500).json({ error: 'Could not load tracker' });
  }
});

// Move a card. The only writer of tracker_stage besides the inbox router.
router.patch('/:id/stage', verifyToken, async (req, res) => {
  try {
    const stage = String(req.body.stage || '').toLowerCase();
    if (!STAGES.includes(stage)) {
      return res.status(400).json({ error: `stage must be one of ${STAGES.join(', ')}` });
    }
    const r = await query(
      `UPDATE applications
          SET tracker_stage = $1, stage_changed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND user_id = $3 AND ${ON_BOARD_UNQUALIFIED}
        RETURNING id, tracker_stage`,
      [stage, Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) {
      return res.status(404).json({ error: 'Not on the board - only submitted or manual applications appear here' });
    }
    res.json({ ok: true, ...r.rows[0] });
  } catch (err) {
    console.error('PATCH /tracker/:id/stage failed:', err.message);
    res.status(500).json({ error: 'Could not move that card' });
  }
});

/*
 * Manual entry, for applications made outside HirePilot.
 *
 * Marked is_manual so it is never confused with a verified submission. The
 * evidence gate still means something: these carry the user's word, not the
 * employer's confirmation, and the board shows which is which.
 */
router.post('/manual', verifyToken, async (req, res) => {
  try {
    const { company, title, location, url, stage = 'applied', appliedAt } = req.body || {};
    if (!company || !title) return res.status(400).json({ error: 'Company and title are required' });
    if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Unknown stage' });

    // Reuse an existing job row when the same posting is already known, so the
    // jobs table does not accumulate a duplicate per manual entry.
    let jobId;
    const existing = await query(
      `SELECT id FROM jobs WHERE lower(company_name) = lower($1) AND lower(title) = lower($2) LIMIT 1`,
      [company, title]
    );
    if (existing.rows.length) {
      jobId = existing.rows[0].id;
    } else {
      const j = await query(
        `INSERT INTO jobs (title, company_name, location, job_url, source, posted_at)
         VALUES ($1,$2,$3,$4,'manual', CURRENT_TIMESTAMP) RETURNING id`,
        [String(title).slice(0, 300), String(company).slice(0, 255),
          location ? String(location).slice(0, 255) : null, url ? String(url).slice(0, 600) : null]
      );
      jobId = j.rows[0].id;
    }

    const a = await query(
      `INSERT INTO applications
         (user_id, job_id, status, submitted_by, is_manual, tracker_stage,
          stage_changed_at, submitted_at, applied_at, target_form_url)
       VALUES ($1,$2,'submitted','manual',TRUE,$3,CURRENT_TIMESTAMP,$4,$4,$5)
       RETURNING id`,
      [req.user.id, jobId, stage, appliedAt ? new Date(appliedAt) : new Date(), url || null]
    );
    res.status(201).json({ ok: true, id: a.rows[0].id });
  } catch (err) {
    console.error('POST /tracker/manual failed:', err.message);
    res.status(500).json({ error: 'Could not add that application' });
  }
});

/*
 * Mark long-silent applications as ghosted.
 *
 * Only touches rows still sitting in `applied` with no stage ever set by hand -
 * a card someone deliberately placed in Applied last week is their judgement,
 * not a stale record, and sweeping it would overwrite a person's own read of
 * their pipeline.
 */
router.post('/sweep-ghosted', verifyToken, async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.body.days) || 30, 7), 180);
    const r = await query(
      `UPDATE applications
          SET tracker_stage = 'ghosted', stage_changed_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND status = 'submitted'
          AND tracker_stage IS NULL
          AND COALESCE(submitted_at, created_at) < NOW() - ($2 || ' days')::INTERVAL
        RETURNING id`,
      [req.user.id, days]
    );
    res.json({ ok: true, moved: r.rows.length, days });
  } catch (err) {
    console.error('POST /tracker/sweep-ghosted failed:', err.message);
    res.status(500).json({ error: 'Could not sweep' });
  }
});

router.get('/export.csv', verifyToken, async (req, res) => {
  try {
    const r = await query(
      `SELECT j.company_name, j.title, j.location, a.tracker_stage, a.status,
              a.submitted_at, a.employer_confirmation_id, a.target_form_url, a.is_manual
         FROM applications a LEFT JOIN jobs j ON j.id = a.job_id
        WHERE a.user_id = $1 AND ${ON_BOARD}
        ORDER BY a.submitted_at DESC NULLS LAST, a.id DESC`,
      [req.user.id]
    );
    // Quote every field and double embedded quotes: company names contain
    // commas often enough that an unquoted export silently shifts columns.
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Company', 'Title', 'Location', 'Stage', 'Status', 'Submitted', 'Confirmation', 'URL', 'Manual entry'];
    const lines = [header.map(esc).join(',')];
    for (const row of r.rows) {
      lines.push([
        row.company_name, row.title, row.location, row.tracker_stage || 'applied',
        row.status, row.submitted_at ? new Date(row.submitted_at).toISOString() : '',
        row.employer_confirmation_id, row.target_form_url, row.is_manual ? 'yes' : 'no',
      ].map(esc).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="hirepilot-tracker.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('GET /tracker/export.csv failed:', err.message);
    res.status(500).json({ error: 'Could not export' });
  }
});

/*
 * CSV import. Rows land as manual entries, because that is what they are - a
 * spreadsheet is the user's own record, not the employer's confirmation.
 */
router.post('/import', verifyToken, async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 500) : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows supplied' });

    let imported = 0;
    const skipped = [];
    for (const row of rows) {
      const company = row.company || row.Company;
      const title = row.title || row.Title;
      if (!company || !title) { skipped.push(row); continue; }

      const stage = STAGES.includes(String(row.stage || '').toLowerCase())
        ? String(row.stage).toLowerCase() : 'applied';

      const existing = await query(
        `SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id
          WHERE a.user_id = $1 AND lower(j.company_name) = lower($2) AND lower(j.title) = lower($3)
          LIMIT 1`,
        [req.user.id, company, title]
      );
      if (existing.rows.length) { skipped.push({ ...row, reason: 'already tracked' }); continue; }

      const j = await query(
        `INSERT INTO jobs (title, company_name, location, job_url, source, posted_at)
         VALUES ($1,$2,$3,$4,'manual',CURRENT_TIMESTAMP) RETURNING id`,
        [String(title).slice(0, 300), String(company).slice(0, 255),
          (row.location || '').slice(0, 255) || null, (row.url || '').slice(0, 600) || null]
      );
      await query(
        `INSERT INTO applications
           (user_id, job_id, status, submitted_by, is_manual, tracker_stage,
            stage_changed_at, submitted_at, applied_at)
         VALUES ($1,$2,'submitted','import',TRUE,$3,CURRENT_TIMESTAMP,$4,$4)`,
        [req.user.id, j.rows[0].id, stage, row.appliedAt ? new Date(row.appliedAt) : new Date()]
      );
      imported += 1;
    }
    res.json({ ok: true, imported, skipped: skipped.length, skippedRows: skipped.slice(0, 20) });
  } catch (err) {
    console.error('POST /tracker/import failed:', err.message);
    res.status(500).json({ error: 'Could not import' });
  }
});

module.exports = router;
