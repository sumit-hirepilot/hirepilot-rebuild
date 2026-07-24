const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { fixMojibake } = require('../services/apis/textSanitizer');

const router = express.Router();

router.use(verifyToken);

function formatActivity(row) {
  const meta = row.metadata || {};
  row.job_title = fixMojibake(row.job_title);
  row.company_name = fixMojibake(row.company_name);

  switch (row.event_type) {
    case 'application_sent':
      return `Applied to ${row.job_title || 'a job'}${row.company_name ? ` at ${row.company_name}` : ''}`;
    case 'auto_applied':
      return `Auto-Pilot applied to ${row.job_title || meta.job_title || 'a job'}${(row.company_name || meta.company_name) ? ` at ${row.company_name || meta.company_name}` : ''}`;
    case 'auto_apply_needs_confirmation':
      return `${row.job_title || meta.job_title || 'A job'} at ${row.company_name || meta.company_name} is a dream company match - review and confirm to apply`;
    case 'application_failed':
      return `Application to ${row.job_title || meta.job_title || 'a job'} failed: ${meta.reason || 'unknown error'}`;
    case 'application_retried':
      return `Retried application to ${row.job_title || meta.job_title || 'a job'}`;
    case 'status_updated':
      return `Moved an application to ${(meta.to || '').replace('_', ' ')}`;
    case 'resume_tailored':
      return `Tailored resume for ${meta.job_title || row.job_title || 'a job'}${meta.company_name ? ` at ${meta.company_name}` : ''}`;
    case 'cover_letter_generated':
      return `Generated a cover letter for ${meta.job_title || row.job_title || 'a job'}${meta.company_name ? ` at ${meta.company_name}` : ''}`;
    case 'agent_matches_found':
      return `Agent "${meta.agent_name || 'Search agent'}" found ${meta.count} match${meta.count === 1 ? '' : 'es'}`;
    case 'agent_created':
      return `Created search agent "${meta.agent_name || ''}"`;
    case 'contact_added':
      return `Added ${meta.name || 'a contact'}${meta.company ? ` (${meta.company})` : ''} to your network`;
    case 'job_saved':
      return `Saved ${row.job_title || meta.job_title || 'a job'}${meta.company_name ? ` at ${meta.company_name}` : ''}`;
    case 'job_scanned':
      return `Scanned new jobs`;
    default:
      return row.event_type;
  }
}

router.get('/', async (req, res) => {
  try {
    const { limit = 8 } = req.query;
    const result = await query(
      `SELECT al.event_type, al.metadata, al.created_at, j.title as job_title, j.company_name
       FROM activity_log al
       LEFT JOIN jobs j ON al.job_id = j.id
       WHERE al.user_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2`,
      [req.user.id, limit]
    );

    const activity = result.rows.map((row) => ({
      text: formatActivity(row),
      type: row.event_type,
      createdAt: row.created_at,
    }));

    res.json({ activity });
  } catch (err) {
    console.error('Get activity error:', err);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

module.exports = router;
module.exports.formatActivity = formatActivity;
