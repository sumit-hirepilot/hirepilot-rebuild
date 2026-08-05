const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { fixMojibake } = require('../services/apis/textSanitizer');

const router = express.Router();

router.use(verifyToken);

/*
 * A7.4 — an activity line is read by a person, so it must be a sentence.
 *
 * Two defects, one theme:
 *   - `default: return row.event_type` rendered the raw key, so a user saw
 *     `application_submitted`. Six types reached it, including
 *     `application_queued`, which A1 introduced and never mapped.
 *   - Several lines named the role but not the employer. "Retried application
 *     to UX Designer Senior" is not actionable: the user has three of those.
 *
 * `where()` is the single place a job is named, so a line cannot silently lose
 * the company again, and activityVocabulary.test.js binds this map to every
 * event the backend actually writes.
 */

// Names the job AND the employer whenever either is known, from the row or
// from the event's own metadata - background events often have only metadata.
function where(row, meta, { fallback = 'a job' } = {}) {
  const title = row.job_title || meta.job_title;
  const company = row.company_name || meta.company_name;
  if (title && company) return `${title} at ${company}`;
  if (title) return title;
  if (company) return `a role at ${company}`;
  return fallback;
}

function formatActivity(row) {
  const meta = row.metadata || {};
  row.job_title = fixMojibake(row.job_title);
  row.company_name = fixMojibake(row.company_name);

  switch (row.event_type) {
    case 'application_sent':
      return `Applied to ${where(row, meta)}`;
    case 'auto_applied':
      return `Auto-Pilot applied to ${where(row, meta)}`;
    case 'auto_apply_needs_confirmation':
      return `${row.job_title || meta.job_title || 'A job'} at ${row.company_name || meta.company_name} is a dream company match - review and confirm to apply`;
    case 'application_failed':
      return `Application to ${where(row, meta)} failed: ${meta.reason || 'unknown error'}`;
    case 'application_retried':
      return `Retried application to ${where(row, meta)}`;
    case 'status_updated':
      return `Moved an application to ${(meta.to || '').replace('_', ' ')}`;
    case 'resume_tailored':
      return `Tailored resume for ${where(row, meta)}`;
    case 'cover_letter_generated':
      return `Generated a cover letter for ${where(row, meta)}`;
    case 'agent_matches_found':
      return `Agent "${meta.agent_name || 'Search agent'}" found ${meta.count} match${meta.count === 1 ? '' : 'es'}`;
    case 'agent_created':
      return `Created search agent "${meta.agent_name || ''}"`;
    case 'contact_added':
      return `Added ${meta.name || 'a contact'}${meta.company ? ` (${meta.company})` : ''} to your network`;
    case 'job_saved':
      return `Saved ${where(row, meta)}`;
    case 'job_scanned':
      return 'Scanned new jobs';

    // A1 added application_queued and never mapped it, so it rendered raw.
    case 'application_queued':
      return `Queued ${where(row, meta)} to apply`;
    case 'application_submitted':
      return `Submitted ${where(row, meta)} - waiting on the employer's confirmation`;
    case 'job_inactive':
      return `${where(row, meta, { fallback: 'A job' })} is no longer listed`;
    case 'profile_gap':
      return `Found a gap in your profile for ${where(row, meta)}`;
    case 'profile_similar':
      return `Reused a saved answer on ${where(row, meta)}`;
    case 'profile_custom':
      return `Saved your answer for ${where(row, meta)}`;

    default:
      /*
       * Never the raw key. An unmapped event is a gap in THIS map, not
       * something to make the user decipher - activityVocabulary.test.js fails
       * when the backend writes an event this switch does not handle, so this
       * branch should be unreachable in practice.
       */
      return `Activity on ${where(row, meta)}`;
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
