const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { formatActivity } = require('./activity');

const router = express.Router();

router.use(verifyToken);

// Events worth surfacing as a notification (vs. purely historical activity-log noise)
const NOTIFIABLE_EVENTS = [
  'agent_matches_found', 'auto_applied', 'auto_apply_needs_confirmation',
  'application_failed', 'status_updated', 'application_sent',
];

router.get('/', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const result = await query(
      `SELECT al.id, al.event_type, al.metadata, al.created_at, al.is_read,
              j.title as job_title, j.company_name
       FROM activity_log al
       LEFT JOIN jobs j ON al.job_id = j.id
       WHERE al.user_id = $1 AND al.event_type = ANY($2)
       ORDER BY al.created_at DESC
       LIMIT $3`,
      [req.user.id, NOTIFIABLE_EVENTS, limit]
    );

    const unreadResult = await query(
      `SELECT COUNT(*) as count FROM activity_log
       WHERE user_id = $1 AND event_type = ANY($2) AND is_read = false`,
      [req.user.id, NOTIFIABLE_EVENTS]
    );

    const notifications = result.rows.map((row) => ({
      id: row.id,
      text: formatActivity(row),
      type: row.event_type,
      isRead: row.is_read,
      createdAt: row.created_at,
    }));

    res.json({ notifications, unreadCount: parseInt(unreadResult.rows[0].count, 10) });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.put('/:id/read', async (req, res) => {
  try {
    await query('UPDATE activity_log SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Marked as read' });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

router.put('/read-all', async (req, res) => {
  try {
    await query('UPDATE activity_log SET is_read = true WHERE user_id = $1 AND is_read = false', [req.user.id]);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error('Mark all notifications read error:', err);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

module.exports = router;
