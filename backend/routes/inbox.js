/*
 * Inbox (PRD 3.4).
 *
 * Recruiter mail arrives at a per-user proxy address, gets categorised, and is
 * matched back to the application it belongs to. Two things it is careful about:
 *
 * 1. Categorisation is by explicit signal, not by guessing. A message that does
 *    not clearly say what it is stays `other` rather than being filed as a
 *    rejection - telling someone they were rejected when they were not is a
 *    worse failure than an uncategorised message.
 *
 * 2. Bodies are truncated on the way in. The database volume is small enough
 *    that a stream of full HTML emails would fill it, and it has been filled
 *    once already. The provider keeps the original.
 */

const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const MAX_BODY = 8000;
const PROXY_DOMAIN = process.env.INBOUND_MAIL_DOMAIN || 'hirepilot-mail.com';

/*
 * Ordered: the first match wins, and the order encodes which signal is more
 * decisive when a message carries several. An interview invitation that also
 * says "thank you for applying" is an interview, not an acknowledgement.
 */
const CATEGORIES = [
  ['offer', /\boffer\b|we(?:'| a)re (?:delighted|pleased) to offer|offer letter|compensation package/i],
  ['interview', /interview|schedule a (?:call|chat|time)|meet the team|book a slot|calendly|available for a call/i],
  ['assessment', /assessment|take[- ]home|coding (?:challenge|test)|hackerrank|codility|work sample/i],
  ['rejection', /unfortunately|we (?:have )?decided (?:not|to move forward with other)|no longer (?:being )?consider|not (?:be )?(?:moving|proceeding) forward|other candidates/i],
  ['verification', /verify your (?:email|address|account)|confirmation code|one[- ]time (?:code|password)|\botp\b|activate your account/i],
  ['reminder', /reminder|don'?t forget|complete your application|incomplete application|action required/i],
  ['applied', /thank you for applying|application (?:has been )?received|we(?:'| ha)ve received your application|successfully submitted/i],
];

function categorise(subject, body) {
  const text = `${subject || ''}\n${body || ''}`;
  for (const [name, re] of CATEGORIES) {
    if (re.test(text)) return name;
  }
  return 'other';
}

/*
 * Pull a one-time code so autofill can use it without the user copying it.
 *
 * Requires the code to sit near words that actually mean "this is your code".
 * A bare 6-digit run matches a salary, a year range, a ticket number and a
 * street address, and feeding one of those into a verification field burns the
 * real code's attempt.
 */
function extractOtp(subject, body) {
  const text = `${subject || ''}\n${body || ''}`;
  const near = text.match(
    /(?:code|otp|passcode|pin)(?:\s+is)?[\s:]*\b(\d{4,8})\b|\b(\d{4,8})\b(?=[^\n]{0,40}(?:is your|verification|one[- ]time))/i
  );
  return near ? (near[1] || near[2]) : null;
}

// The address recruiter mail is forwarded to. Created on first request so an
// existing account gets one without a backfill.
async function ensureProxyEmail(userId) {
  const r = await query('SELECT proxy_email FROM users WHERE id = $1', [userId]);
  if (r.rows[0]?.proxy_email) return r.rows[0].proxy_email;

  // Random rather than derived from the name: a guessable proxy address is an
  // open relay into someone's job search.
  const handle = `hp-${crypto.randomBytes(5).toString('hex')}`;
  const address = `${handle}@${PROXY_DOMAIN}`;
  await query('UPDATE users SET proxy_email = $1 WHERE id = $2 AND proxy_email IS NULL', [address, userId]);
  const after = await query('SELECT proxy_email FROM users WHERE id = $1', [userId]);
  return after.rows[0]?.proxy_email || address;
}

router.get('/', verifyToken, async (req, res) => {
  try {
    const { category, search, limit = 50 } = req.query;
    const params = [req.user.id];
    let where = 'WHERE m.user_id = $1';

    if (category && category !== 'all') {
      params.push(category);
      where += ` AND m.category = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (m.subject ILIKE $${params.length} OR m.from_name ILIKE $${params.length} OR m.company_name ILIKE $${params.length})`;
    }
    params.push(Math.min(Number(limit) || 50, 200));

    const r = await query(
      `SELECT m.id, m.from_email, m.from_name, m.subject, m.category, m.otp_code,
              m.company_name, m.is_read, m.received_at, m.application_id,
              LEFT(m.body_text, 400) AS preview,
              j.title AS job_title
         FROM inbox_messages m
         LEFT JOIN applications a ON a.id = m.application_id
         LEFT JOIN jobs j ON j.id = a.job_id
         ${where}
        ORDER BY m.received_at DESC
        LIMIT $${params.length}`,
      params
    );

    const counts = await query(
      `SELECT category, COUNT(*)::int AS n FROM inbox_messages WHERE user_id = $1 GROUP BY category`,
      [req.user.id]
    );

    res.json({
      messages: r.rows,
      counts: Object.fromEntries(counts.rows.map((c) => [c.category, c.n])),
      proxyEmail: await ensureProxyEmail(req.user.id),
    });
  } catch (err) {
    console.error('GET /inbox failed:', err.message);
    res.status(500).json({ error: 'Could not load inbox' });
  }
});

router.get('/:id', verifyToken, async (req, res) => {
  try {
    const r = await query(
      `SELECT m.*, j.title AS job_title, j.company_name AS job_company
         FROM inbox_messages m
         LEFT JOIN applications a ON a.id = m.application_id
         LEFT JOIN jobs j ON j.id = a.job_id
        WHERE m.id = $1 AND m.user_id = $2`,
      [Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    await query('UPDATE inbox_messages SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [Number(req.params.id), req.user.id]);
    res.json({ message: { ...r.rows[0], is_read: true } });
  } catch (err) {
    console.error('GET /inbox/:id failed:', err.message);
    res.status(500).json({ error: 'Could not load message' });
  }
});

/*
 * Inbound webhook from the mail provider.
 *
 * Unauthenticated by nature - the provider posts here - so it is gated on a
 * shared secret and identifies the user ONLY by the proxy address the mail was
 * sent to. Trusting a user id in the payload would let anyone who found this
 * URL write messages into any account's inbox.
 */
router.post('/inbound', async (req, res) => {
  try {
    const secret = process.env.INBOUND_MAIL_SECRET;
    if (!secret) return res.status(503).json({ error: 'Inbound mail is not configured' });
    const supplied = req.get('x-hirepilot-signature') || req.query.token;
    if (supplied !== secret) return res.status(401).json({ error: 'Bad signature' });

    const b = req.body || {};
    const to = String(b.to || b.recipient || b.To || '').toLowerCase();
    const match = to.match(/[a-z0-9._%+-]+@[a-z0-9.-]+/);
    if (!match) return res.status(400).json({ error: 'No recipient' });

    const u = await query('SELECT id FROM users WHERE lower(proxy_email) = $1', [match[0]]);
    if (!u.rows.length) return res.status(404).json({ error: 'Unknown recipient' });
    const userId = u.rows[0].id;

    const subject = String(b.subject || b.Subject || '').slice(0, 500);
    const body = String(b['body-plain'] || b.text || b.TextBody || b.body || '').slice(0, MAX_BODY);
    const fromEmail = String(b.from || b.sender || b.From || '').slice(0, 320);
    const fromName = (fromEmail.match(/^"?([^"<]+?)"?\s*</) || [])[1] || null;

    // Match to an application by the sending domain, so a reply lands on the
    // right row rather than floating loose in the inbox.
    const domain = (fromEmail.match(/@([a-z0-9.-]+)/i) || [])[1] || '';
    const org = domain.split('.').slice(-2)[0] || '';
    let applicationId = null;
    if (org) {
      const a = await query(
        `SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id
          WHERE a.user_id = $1 AND lower(j.company_name) LIKE $2
          ORDER BY a.created_at DESC LIMIT 1`,
        [userId, `%${org.toLowerCase()}%`]
      );
      applicationId = a.rows[0]?.id || null;
    }

    const category = categorise(subject, body);
    const inserted = await query(
      `INSERT INTO inbox_messages
         (user_id, application_id, message_id, from_email, from_name, subject,
          body_text, category, otp_code, company_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id, message_id) WHERE message_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        userId, applicationId, String(b['Message-Id'] || b.messageId || '').slice(0, 500) || null,
        fromEmail, fromName, subject, body, category, extractOtp(subject, body), org || null,
      ]
    );

    /*
     * A recruiter reply moves the tracker stage, but never the application
     * status. status records whether we actually submitted; stage records where
     * the conversation got to. Letting a mail rewrite status would destroy the
     * evidence trail that makes "Applied" mean anything.
     */
    if (applicationId && ['interview', 'rejection', 'offer'].includes(category)) {
      const stage = category === 'rejection' ? 'rejected' : category === 'offer' ? 'offer' : 'interviewing';
      await query(
        `UPDATE applications SET tracker_stage = $1, stage_changed_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND user_id = $3 AND status = 'submitted'`,
        [stage, applicationId, userId]
      );
    }

    res.json({ ok: true, id: inserted.rows[0]?.id || null, category });
  } catch (err) {
    console.error('POST /inbox/inbound failed:', err.message);
    res.status(500).json({ error: 'Could not accept message' });
  }
});

// The most recent usable code, for autofill during a verification step.
router.get('/otp/latest', verifyToken, async (req, res) => {
  try {
    const r = await query(
      `SELECT otp_code, from_email, received_at FROM inbox_messages
        WHERE user_id = $1 AND otp_code IS NOT NULL
          AND received_at > NOW() - INTERVAL '15 minutes'
        ORDER BY received_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({ otp: r.rows[0] || null });
  } catch (err) {
    console.error('GET /inbox/otp/latest failed:', err.message);
    res.status(500).json({ error: 'Could not read code' });
  }
});

module.exports = router;
module.exports.categorise = categorise;
module.exports.extractOtp = extractOtp;
