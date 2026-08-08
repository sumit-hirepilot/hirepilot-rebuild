const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, pool } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user already exists
    const existingUser = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const result = await query(
      'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id, email, full_name',
      [email, hashedPassword, fullName || null]
    );

    const user = result.rows[0];

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
      },
      token,
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const result = await query('SELECT id, email, full_name, password_hash FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
      },
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
/*
 * L5 — deletion that deletes.
 *
 * The settings page carried a button whose whole behaviour was a "disabled
 * in this demo" flash, on a product holding resumes and application history.
 * This is the real path: password re-entered (a destructive action gets a
 * second factor), then ONE transaction on ONE pooled client - SET LOCAL
 * scopes to the transaction, and separate query() calls can land on
 * different pool connections, which would set the flag on one connection
 * and delete on another.
 *
 * The transaction-local flag is what lets the receipts trigger permit the
 * cascade: receipts are append-only against EDITING history, but the person
 * leaving takes their records with them. Every user table cascades from
 * users; jobs.added_by_user_id SET NULLs, which is right - a job posting is
 * shared world-state, not personal data.
 */
router.delete('/account', verifyToken, async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    if (!password) {
      return res.status(400).json({ error: 'Type your password to confirm - deleting your account cannot be undone.' });
    }

    const u = await query('SELECT id, password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!u.rows.length) return res.status(404).json({ error: 'Account not found' });

    const ok = await bcrypt.compare(password, u.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'That password is not right. Nothing was deleted.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL hirepilot.account_deletion = 'on'`);
      await client.query('DELETE FROM users WHERE id = $1', [req.user.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Account deletion failed:', err.message);
      return res.status(500).json({
        error: 'Your account could not be deleted just now - nothing was removed. Try again, or email us and we will do it by hand.',
      });
    } finally {
      client.release();
    }

    res.json({ deleted: true, message: 'Your account and everything in it are gone.' });
  } catch (err) {
    console.error('Account deletion error:', err.message);
    res.status(500).json({ error: 'Your account could not be deleted just now - nothing was removed. Try again shortly.' });
  }
});

/*
 * L5 — the export the privacy page has promised since it was written
 * ("export or delete your data at any time from Settings"). One JSON
 * document, every user-owned table, every query scoped to the caller, and
 * never the password hash - an export is the user's data, not the system's
 * secrets.
 */
router.get('/export', verifyToken, async (req, res) => {
  try {
    const uid = req.user.id;
    const one = async (sql) => (await query(sql, [uid])).rows;

    const [account, resumes, skills, experience, applications, tailored,
      coverLetters, screeningAnswers, contacts, outreach, inbox, agents, receipts] = await Promise.all([
      one('SELECT id, email, full_name, location, profile_summary, proxy_email, created_at FROM users WHERE id = $1'),
      one('SELECT id, label, original_file_text, is_default, created_at, updated_at FROM resumes WHERE user_id = $1'),
      one('SELECT skill FROM user_skills WHERE user_id = $1'),
      one('SELECT company_name, job_title, start_date, end_date, currently_working FROM user_experience WHERE user_id = $1'),
      one('SELECT * FROM applications WHERE user_id = $1'),
      one('SELECT id, job_id, tailored_summary, final_text, created_at FROM tailored_resumes WHERE user_id = $1'),
      one('SELECT id, job_id, content, created_at FROM cover_letters WHERE user_id = $1'),
      one('SELECT question, answer, created_at FROM screening_answers WHERE user_id = $1'),
      one('SELECT * FROM referrals WHERE user_id = $1'),
      one('SELECT * FROM outreach_contacts WHERE user_id = $1'),
      one('SELECT from_email, from_name, subject, body_text, category, received_at FROM inbox_messages WHERE user_id = $1'),
      one('SELECT * FROM search_agents WHERE user_id = $1'),
      one('SELECT * FROM submission_receipts WHERE user_id = $1'),
    ]);

    res.setHeader('Content-Disposition', 'attachment; filename="hirepilot-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      account: account[0] || null,
      resumes, skills, experience, applications,
      tailoredResumes: tailored, coverLetters, screeningAnswers,
      contacts, outreach, inboxMessages: inbox, savedSearches: agents,
      submissionReceipts: receipts,
    });
  } catch (err) {
    console.error('Export failed:', err.message);
    res.status(500).json({ error: 'Could not build your export just now. Try again shortly.' });
  }
});

router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, full_name, location, profile_summary, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
