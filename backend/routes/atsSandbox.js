/*
 * The controlled submission target — an employer's ATS, and nothing else,
 * replaced.
 *
 * A5 defers to counsel the question of driving automation against a real
 * employer's Greenhouse form. Proving the pipeline still matters, so this
 * substitutes ONE component: the employer's form and its confirmation page.
 * Everything upstream and downstream is the shipped product - the queue, the
 * tailored resume, the screening answers, the evidence endpoint, the receipt
 * trigger, the tracker.
 *
 * WHAT THIS PROVES
 *   that the runner fills the fields the adapter resolves, attaches the exact
 *   resume bytes, submits, reads a confirmation, and that the confirmation
 *   drives applications -> submitted with a frozen receipt.
 *
 * WHAT IT CANNOT PROVE, and this is the delta, recorded in SUBMISSION_AUDIT.md
 *   that Greenhouse's LIVE markup still matches the adapter's selectors. This
 *   page is built to the selectors, so it can never catch selector drift. Only
 *   a real board can, and that is exactly the run A5 gates.
 *
 * It records what it RECEIVED, byte for byte, rather than what it was told was
 * sent: a target that echoes the sender's own claims proves nothing. The file
 * is hashed and its length recorded, so "the resume attached" is checkable
 * against the resume that exists.
 */

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { query } = require('../db');

const router = express.Router();

// Same ceiling as the resume upload it will be fed from.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

/*
 * Confirmation ids look like Greenhouse's so nothing downstream is being
 * tested against a shape it will never see in production.
 */
const makeConfirmationId = () => `GH-SANDBOX-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

/*
 * Fields the real Greenhouse form carries, so a missing one is visible as
 * missing rather than as an absent key nobody looks for.
 */
const IDENTITY = ['first_name', 'last_name', 'email', 'phone'];

const unwrap = (k) => {
  // Legacy board names its fields job_application[first_name].
  const m = /^job_application\[([^\]]+)\]$/.exec(k);
  return m ? m[1] : k;
};

/**
 * POST /api/ats-sandbox/submit
 *
 * Deliberately UNAUTHENTICATED, exactly like the employer form it stands in
 * for: the runner posts as the candidate's browser, carrying no HirePilot
 * credentials. Bounded by multer's file limit and by the column widths below.
 */
router.post('/submit', upload.any(), async (req, res) => {
  try {
    const body = req.body || {};

    const fields = {};
    const answers = {};
    for (const [rawKey, value] of Object.entries(body)) {
      const key = unwrap(rawKey);
      if (IDENTITY.includes(key) || key === 'cover_letter') fields[key] = String(value ?? '').slice(0, 4000);
      else answers[key] = String(value ?? '').slice(0, 4000);
    }

    const file = (req.files || [])[0] || null;
    const fileInfo = file
      ? {
        field: file.fieldname,
        filename: file.originalname,
        mimetype: file.mimetype,
        bytes: file.size,
        sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
      }
      : null;

    const confirmationId = makeConfirmationId();

    /*
     * The sentence the runner will read back. Written to match the product's
     * own SUCCESS_SIGNALS, because the point is to exercise that matcher, not
     * to invent a phrasing it has never met.
     */
    const confirmationText = `Thank you for applying. Your application has been received. Confirmation number ${confirmationId}.`;

    const saved = await query(
      `INSERT INTO ats_sandbox_submissions
         (confirmation_id, fields, answers, file_info, received_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       RETURNING id, received_at`,
      [confirmationId, JSON.stringify(fields), JSON.stringify(answers), fileInfo ? JSON.stringify(fileInfo) : null]
    );

    /*
     * Answers with HTML in them are echoed as text, never as markup. This page
     * is driven by a browser automation that reads the response back, and a
     * target that reflects its input as HTML would be teaching the pipeline to
     * trust attacker-controlled content.
     */
    if ((req.get('accept') || '').includes('application/json')) {
      return res.status(201).json({
        ok: true,
        confirmationId,
        confirmationText,
        captureId: saved.rows[0].id,
        received: { fields, answers, file: fileInfo },
      });
    }

    res.status(201).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Application received</title></head>
<body>
  <main>
    <h1>Thank you for applying.</h1>
    <p>Your application has been received. Confirmation number <strong>${confirmationId}</strong>.</p>
    <p data-hp-sandbox="1">This is HirePilot's controlled test target, not a real employer.</p>
  </main>
</body></html>`);
  } catch (err) {
    console.error('ats-sandbox submit failed:', err.message);
    res.status(500).json({ error: 'Sandbox capture failed' });
  }
});

/**
 * GET /api/ats-sandbox/capture/:confirmationId
 * What the target actually received. The verification reads THIS, not the
 * runner's own account of what it sent.
 */
router.get('/capture/:confirmationId', async (req, res) => {
  const id = String(req.params.confirmationId || '').slice(0, 64);
  const r = await query(
    `SELECT id, confirmation_id, fields, answers, file_info, received_at
       FROM ats_sandbox_submissions WHERE confirmation_id = $1`,
    [id]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'No such capture' });
  res.json(r.rows[0]);
});

module.exports = router;
