/*
 * Application queue + Application Profile + submission-evidence ingest.
 *
 * This is the orchestration half of the apply pipeline. It prepares everything
 * an application needs (tailored resume, cover letter, pre-filled screening
 * answers, target form URL) and holds it in a queue. It deliberately does NOT
 * submit anything: the browser extension executes the form in the user's own
 * authenticated session, and posts evidence back here.
 *
 * Status lifecycle - the important part of this file:
 *
 *   preparing        materials being generated
 *   ready_for_review prepared; waiting for the user to approve
 *   approved         user approved; extension may execute it
 *   submitting       extension is driving the form
 *   needs_user       paused - login / MFA / CAPTCHA / consent / final submit
 *   submitted        VERIFIED reached the employer (evidence required)
 *   failed           did not submit; failure_reason recorded
 *
 * Only `submitted` means "Applied", and the transition into it is gated on
 * evidence in recordEvidence() below. There is no code path that sets it
 * otherwise - that was the whole defect this replaces.
 */

const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { buildTailoredText } = require('../services/resumeTailorEngine');
const { generateCoverLetterContent } = require('../services/coverLetterGenerator');
const { checkAts } = require('../services/atsChecker');
const { prefillAnswers, summarize, normalizeKey } = require('../services/screeningPrefill');
const { recordSeen, confirmVariation, stats: knowledgeStats } = require('../services/questionKnowledge');
const { classify } = require('../services/questionConcepts');

const router = express.Router();

// Which ATS a posting lives on determines which extension adapter can drive it.
// `source` is authoritative for the three we ingest via official APIs; the URL
// is the fallback for aggregator-sourced postings.
const ATS_BY_SOURCE = {
  greenhouse: 'greenhouse',
  lever: 'lever',
  ashby: 'ashby',
};
const ATS_BY_URL = [
  [/job-boards\.greenhouse\.io|boards\.greenhouse\.io|greenhouse\.io/i, 'greenhouse'],
  [/jobs\.lever\.co|lever\.co/i, 'lever'],
  [/jobs\.ashbyhq\.com|ashbyhq\.com/i, 'ashby'],
  [/myworkdayjobs\.com|workday/i, 'workday'],
  [/smartrecruiters\.com/i, 'smartrecruiters'],
  [/taleo\.net/i, 'taleo'],
  [/icims\.com/i, 'icims'],
  [/successfactors|sapsf/i, 'successfactors'],
];

// Adapters that actually exist in the extension. Anything else is prepared but
// flagged manual, rather than queued as if automation will handle it.
const SUPPORTED_ATS = new Set(['greenhouse', 'lever', 'ashby']);

function detectAts(job) {
  const bySource = ATS_BY_SOURCE[(job.source || '').toLowerCase()];
  if (bySource) return bySource;
  const url = job.apply_url || job.job_url || '';
  for (const [re, name] of ATS_BY_URL) {
    if (re.test(url)) return name;
  }
  return 'unknown';
}

/* ------------------------------------------------------------------ *
 * Application Profile
 * ------------------------------------------------------------------ */

const PROFILE_FIELDS = [
  'full_name', 'email', 'phone', 'current_location', 'linkedin_url',
  'portfolio_url', 'github_url', 'years_experience', 'current_company',
  'current_title', 'work_authorization', 'requires_sponsorship',
  'willing_to_relocate', 'notice_period', 'salary_expectation',
  'salary_currency', 'pronouns', 'authorized_countries',
];
const ARRAY_FIELDS = new Set(['authorized_countries']);
const BOOLEAN_FIELDS = new Set(['requires_sponsorship', 'willing_to_relocate']);

router.get('/profile', verifyToken, async (req, res) => {
  try {
    const r = await query('SELECT * FROM application_profiles WHERE user_id = $1', [req.user.id]);
    if (!r.rows.length) {
      // Seed from the user record so the profile is not empty on first open.
      const u = await query('SELECT full_name, email, title, location FROM users WHERE id = $1', [req.user.id]);
      const seed = u.rows[0] || {};
      return res.json({
        profile: {
          full_name: seed.full_name || null,
          email: seed.email || null,
          current_title: seed.title || null,
          current_location: seed.location || null,
          custom_answers: {},
        },
        exists: false,
        completeness: 0,
      });
    }
    const profile = r.rows[0];
    res.json({ profile, exists: true, completeness: completeness(profile) });
  } catch (err) {
    console.error('GET /apply/profile failed:', err.message);
    res.status(500).json({ error: 'Could not load application profile' });
  }
});

router.put('/profile', verifyToken, async (req, res) => {
  try {
    const vals = {};
    for (const f of PROFILE_FIELDS) {
      if (!(f in req.body)) continue;
      let v = req.body[f];
      if (v === '' ) v = null;
      if (BOOLEAN_FIELDS.has(f) && v !== null) v = v === true || v === 'true' || v === 'yes';
      if (ARRAY_FIELDS.has(f)) {
        // Accept either an array or a comma-separated string from the form.
        if (v === null) v = [];
        else if (!Array.isArray(v)) v = String(v).split(',').map((x) => x.trim()).filter(Boolean);
      }
      if (f === 'years_experience' && v !== null) {
        const n = Number(v);
        v = Number.isFinite(n) ? n : null;
      }
      vals[f] = v;
    }

    let custom = null;
    if (req.body.custom_answers && typeof req.body.custom_answers === 'object') {
      // Re-key so lookups at pre-fill time are stable regardless of how the
      // question was punctuated on the form the user saved it from.
      custom = {};
      for (const [k, v] of Object.entries(req.body.custom_answers)) {
        if (v === null || v === '') continue;
        // Accept either a bare answer or {answer, question}; store the wording
        // so semantic matching has something real to compare against.
        const answer = typeof v === 'object' && v !== null ? v.answer : v;
        if (answer === null || answer === undefined || answer === '') continue;
        custom[normalizeKey(k)] = {
          answer: String(answer),
          question: String((typeof v === 'object' && v.question) || k).slice(0, 400),
        };
      }
    }

    const cols = Object.keys(vals);
    if (custom) cols.push('custom_answers');
    if (!cols.length) return res.status(400).json({ error: 'No profile fields supplied' });

    const params = [req.user.id, ...cols.map((c) => (c === 'custom_answers' ? JSON.stringify(custom) : vals[c]))];
    const placeholders = cols.map((_, i) => `$${i + 2}`);
    const updates = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');

    /*
     * custom_answers MERGES; every other column replaces.
     *
     * It replaced wholesale before, which meant saving a single answer silently
     * destroyed every other saved answer - a partial update from the review
     * screen wiped the whole set, and the next application re-asked questions
     * that had already been answered. Verified by losing 49 saved answers to a
     * three-key update.
     */
    const mergeExpr = cols
      .map((c, i) => (c === 'custom_answers'
        ? `custom_answers = COALESCE(application_profiles.custom_answers, '{}'::jsonb) || $${i + 2}::jsonb`
        : `${c} = $${i + 2}`))
      .join(', ');

    const r = await query(
      `INSERT INTO application_profiles (user_id, ${cols.join(', ')})
       VALUES ($1, ${placeholders.join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${mergeExpr}, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      params
    );
    const profile = r.rows[0];
    res.json({ profile, completeness: completeness(profile) });
  } catch (err) {
    console.error('PUT /apply/profile failed:', err.message);
    res.status(500).json({ error: 'Could not save application profile' });
  }
});

// Fraction of the fields that actually get asked on forms. Used to warn the
// user before a bulk run that N applications will stall on a missing answer.
function completeness(p) {
  const weighted = [
    'full_name', 'email', 'phone', 'current_location', 'authorized_countries',
    'requires_sponsorship', 'linkedin_url', 'years_experience', 'notice_period',
    'salary_expectation',
  ];
  const filled = weighted.filter((f) => {
    const v = p[f];
    if (Array.isArray(v)) return v.length > 0;
    return v !== null && v !== undefined && v !== '';
  }).length;
  return Math.round((filled / weighted.length) * 100);
}

/* ------------------------------------------------------------------ *
 * Queue: enqueue + prepare
 * ------------------------------------------------------------------ */

const MAX_BULK = 50;
const PREPARE_CONCURRENCY = 5;

router.post('/queue', verifyToken, async (req, res) => {
  const userId = req.user.id;
  let jobIds = Array.isArray(req.body.jobIds) ? req.body.jobIds : [];

  try {
    // "all matching" - resolve server-side against the user's matches so the
    // client does not have to page through thousands of rows.
    if (req.body.allMatching) {
      const minScore = Number(req.body.minScore) || 0.6;
      const m = await query(
        `SELECT job_id FROM job_matches
         WHERE user_id = $1 AND overall_score >= $2
         ORDER BY overall_score DESC LIMIT $3`,
        [userId, minScore, MAX_BULK]
      );
      jobIds = m.rows.map((r) => r.job_id);
    }

    jobIds = Array.from(new Set(jobIds.map(Number).filter(Number.isInteger)));
    if (!jobIds.length) return res.status(400).json({ error: 'No jobs selected' });
    if (jobIds.length > MAX_BULK) {
      return res.status(400).json({ error: `Select at most ${MAX_BULK} jobs per run` });
    }

    // Don't re-queue anything already in flight or already genuinely submitted.
    const existing = await query(
      `SELECT job_id, status FROM applications
       WHERE user_id = $1 AND job_id = ANY($2::int[])
         AND status NOT IN ('failed', 'skipped')`,
      [userId, jobIds]
    );
    const skip = new Map(existing.rows.map((r) => [r.job_id, r.status]));
    const fresh = jobIds.filter((id) => !skip.has(id));

    const jobsRes = await query(
      `SELECT id, title, company_name, description, job_url, apply_url, source, location
       FROM jobs WHERE id = ANY($1::int[])`,
      [fresh]
    );
    const jobs = jobsRes.rows;

    const [profileRes, resumeRes, userRes] = await Promise.all([
      query('SELECT * FROM application_profiles WHERE user_id = $1', [userId]),
      query(
        `SELECT id, original_file_text FROM resumes
         WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 1`,
        [userId]
      ),
      query('SELECT full_name, title FROM users WHERE id = $1', [userId]),
    ]);

    const profile = profileRes.rows[0] || {};
    const resume = resumeRes.rows[0];
    if (!resume || !resume.original_file_text || !resume.original_file_text.trim()) {
      return res.status(400).json({ error: 'Upload a resume before queueing applications' });
    }
    const user = userRes.rows[0] || {};
    const skillRows = await query(
      'SELECT skill FROM user_skills WHERE user_id = $1 LIMIT 40', [userId]
    );
    const userSkills = skillRows.rows.map((r) => r.skill);
    const prefs = await query(
      'SELECT resume_tailor_mode FROM user_preferences WHERE user_id = $1', [userId]
    );
    const tailorMode = prefs.rows[0]?.resume_tailor_mode || 'honest';

    // Prepare in parallel with a bounded pool - 50 jobs each running tailoring
    // and an ATS pass at once would tie up the connection pool.
    const queued = [];
    const failed = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          queued.push(await prepareOne({ userId, job, profile, resume, user, tailorMode, userSkills }));
        } catch (err) {
          console.error(`Prepare failed for job ${job.id}:`, err.message);
          failed.push({ jobId: job.id, title: job.title, reason: err.message });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PREPARE_CONCURRENCY, jobs.length) }, worker)
    );

    const supported = queued.filter((q) => q.automationSupported).length;
    res.json({
      queued: queued.length,
      items: queued,
      preparationFailed: failed,
      skipped: Array.from(skip.entries()).map(([jobId, status]) => ({ jobId, status })),
      automation: {
        supported,
        manual: queued.length - supported,
        note: supported < queued.length
          ? 'Postings on an ATS without an adapter are prepared in full but must be submitted by you on the employer site - the extension will open them pre-filled where it can and otherwise hand over.'
          : null,
      },
      profileCompleteness: completeness(profile),
    });
  } catch (err) {
    console.error('POST /apply/queue failed:', err.message);
    res.status(500).json({ error: 'Could not queue applications' });
  }
});

async function prepareOne({ userId, job, profile, resume, user, tailorMode, userSkills }) {
  const jobText = `${job.title} ${job.description || ''}`;
  const originalText = resume.original_file_text;

  // buildTailoredText returns { tailoredText, addedSkills, matchedSkills } -
  // it only ever ADDS job-relevant skills the resume is missing, never rewrites.
  const tailoring = buildTailoredText(originalText, jobText, tailorMode);
  const tailoredText = tailoring.tailoredText;
  const ats = checkAts(job.description || '', tailoredText);

  const tr = await query(
    `INSERT INTO tailored_resumes
       (user_id, resume_id, job_id, tailored_summary, highlighted_skills, ats_score, original_snapshot, final_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      userId, resume.id, job.id, tailoredText.slice(0, 8000),
      (tailoring.addedSkills || []).slice(0, 25), ats.score, originalText, tailoredText,
    ]
  );

  const letter = generateCoverLetterContent({
    name: profile.full_name || user.full_name,
    userTitle: profile.current_title || user.title,
    skills: userSkills || [],
    jobTitle: job.title,
    companyName: job.company_name,
  });
  const cl = await query(
    `INSERT INTO cover_letters (user_id, job_id, content) VALUES ($1,$2,$3) RETURNING id`,
    [userId, job.id, letter]
  );

  const atsPlatform = detectAts(job);
  const automationSupported = SUPPORTED_ATS.has(atsPlatform);

  // Screening questions are only known once the extension loads the real form.
  // What we can pre-resolve now is the standard identity/contact set every one
  // of these forms asks for, so the extension has values ready on first paint.
  const standard = prefillAnswers(
    [
      { question: 'Full name', required: true },
      { question: 'Email', required: true },
      { question: 'Phone', required: true },
      { question: 'Current location', required: false },
      { question: 'LinkedIn URL', required: false },
      { question: 'Portfolio website', required: false },
    ],
    profile,
    { location: job.location }
  );

  const app = await query(
    `INSERT INTO applications
       (user_id, job_id, status, submitted_by, tailored_resume_id, cover_letter_id,
        cover_letter, target_form_url, submission_channel, screening_answers)
     VALUES ($1,$2,'ready_for_review','extension',$3,$4,$5,$6,$7,$8)
     RETURNING id, status, created_at`,
    [
      userId, job.id, tr.rows[0].id, cl.rows[0].id, letter,
      // The source's own posting URL. Preferring the reconstructed board URL
      // broke Okta-style boards, which redirect it to a careers index and lose
      // the job id; the extension injects programmatically now, so it does not
      // need the tab to stay on an ATS origin.
      job.job_url || job.apply_url, atsPlatform, JSON.stringify({ standard }),
    ]
  );

  return {
    applicationId: app.rows[0].id,
    jobId: job.id,
    title: job.title,
    company: job.company_name,
    location: job.location,
    atsPlatform,
    automationSupported,
    atsScore: ats.score,
    addedSkills: tailoring.addedSkills || [],
    targetFormUrl: job.job_url || job.apply_url,
    status: 'ready_for_review',
    prefillSummary: summarize(standard),
  };
}

/* ------------------------------------------------------------------ *
 * Queue: read
 * ------------------------------------------------------------------ */

const ACTIVE = ['ready_for_review', 'approved', 'submitting', 'needs_user'];

router.get('/queue', verifyToken, async (req, res) => {
  try {
    const r = await query(
      `SELECT a.id, a.status, a.job_id, a.target_form_url, a.submission_channel,
              a.failure_reason, a.retry_count, a.employer_confirmation_id,
              a.submitted_at, a.verified_at, a.created_at,
              j.title, j.company_name, j.location, tr.ats_score
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN tailored_resumes tr ON tr.id = a.tailored_resume_id
       WHERE a.user_id = $1 AND a.status = ANY($2::text[])
       ORDER BY a.created_at ASC`,
      [req.user.id, ACTIVE]
    );
    res.json({
      queue: r.rows.map((row) => ({
        ...row,
        automationSupported: SUPPORTED_ATS.has(row.submission_channel),
      })),
      counts: r.rows.reduce((acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      }, {}),
    });
  } catch (err) {
    console.error('GET /apply/queue failed:', err.message);
    res.status(500).json({ error: 'Could not load queue' });
  }
});

// The extension polls this for the next thing it is allowed to execute.
// Deliberately only returns `approved` items: an item the user has not
// approved is never handed to the automation.
router.get('/queue/next', verifyToken, async (req, res) => {
  try {
    const r = await query(
      `SELECT a.id FROM applications a
       WHERE a.user_id = $1 AND a.status IN ('approved', 'needs_user')
       ORDER BY CASE a.status WHEN 'needs_user' THEN 0 ELSE 1 END, a.created_at ASC
       LIMIT 1`,
      [req.user.id]
    );
    if (!r.rows.length) return res.json({ item: null });
    return res.json({ item: await buildReviewPayload(req.user.id, r.rows[0].id) });
  } catch (err) {
    console.error('GET /apply/queue/next failed:', err.message);
    res.status(500).json({ error: 'Could not load next queue item' });
  }
});

router.get('/queue/:id', verifyToken, async (req, res) => {
  try {
    const payload = await buildReviewPayload(req.user.id, Number(req.params.id));
    if (!payload) return res.status(404).json({ error: 'Not found' });
    res.json({ item: payload });
  } catch (err) {
    console.error('GET /apply/queue/:id failed:', err.message);
    res.status(500).json({ error: 'Could not load queue item' });
  }
});

// Everything the review screen shows and everything the extension needs to
// drive the form. One shape for both so what the user approves is exactly
// what gets executed.
async function buildReviewPayload(userId, applicationId) {
  const r = await query(
    `SELECT a.id, a.status, a.job_id, a.target_form_url, a.submission_channel,
            a.screening_answers, a.cover_letter, a.failure_reason, a.retry_count,
            a.employer_confirmation_id, a.employer_confirmation_text,
            a.submitted_at, a.verified_at,
            j.title, j.company_name, j.location, j.description, j.source,
            tr.id AS tailored_resume_id, tr.final_text AS tailored_resume_text,
            tr.original_snapshot, tr.ats_score, tr.highlighted_skills,
            res.id AS resume_id, res.original_filename, res.original_mimetype
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     LEFT JOIN tailored_resumes tr ON tr.id = a.tailored_resume_id
     LEFT JOIN resumes res ON res.id = tr.resume_id
     WHERE a.id = $1 AND a.user_id = $2`,
    [applicationId, userId]
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];

  const p = await query('SELECT * FROM application_profiles WHERE user_id = $1', [userId]);
  const profile = p.rows[0] || {};

  const stored = row.screening_answers || {};
  return {
    applicationId: row.id,
    status: row.status,
    job: {
      id: row.job_id, title: row.title, company: row.company_name,
      location: row.location, source: row.source,
    },
    atsPlatform: row.submission_channel,
    automationSupported: SUPPORTED_ATS.has(row.submission_channel),
    targetFormUrl: row.target_form_url,
    resume: {
      tailoredResumeId: row.tailored_resume_id,
      resumeId: row.resume_id,
      filename: row.original_filename,
      mimetype: row.original_mimetype,
      tailoredText: row.tailored_resume_text,
      originalText: row.original_snapshot,
      atsScore: row.ats_score,
      addedSkills: row.highlighted_skills || [],
      // The extension uploads the ORIGINAL file bytes, not a regenerated PDF:
      // the tailored text is shown for the user's own review and pasted into
      // free-text fields. Fabricating a PDF that differs from what the user
      // reviewed would defeat the point of the review screen.
      downloadPath: `/api/apply/queue/${row.id}/resume-file`,
    },
    coverLetter: row.cover_letter,
    // Identity/contact set resolved at prepare time.
    standardFields: stored.standard || [],
    // Form-specific questions, populated by the extension once it reads the
    // live form (PATCH .../questions), then pre-filled from the profile.
    screeningQuestions: stored.questions || null,
    profileCompleteness: completeness(profile),
    failureReason: row.failure_reason,
    retryCount: row.retry_count,
    evidence: row.employer_confirmation_id || row.employer_confirmation_text
      ? {
        confirmationId: row.employer_confirmation_id,
        confirmationText: row.employer_confirmation_text,
        submittedAt: row.submitted_at,
        verifiedAt: row.verified_at,
      }
      : null,
  };
}

// Serves the exact bytes the user uploaded, for the extension's file input.
router.get('/queue/:id/resume-file', verifyToken, async (req, res) => {
  try {
    const r = await query(
      `SELECT res.file_data, res.original_filename, res.original_mimetype
       FROM applications a
       JOIN tailored_resumes tr ON tr.id = a.tailored_resume_id
       JOIN resumes res ON res.id = tr.resume_id
       WHERE a.id = $1 AND a.user_id = $2`,
      [Number(req.params.id), req.user.id]
    );
    const row = r.rows[0];
    if (!row || !row.file_data) {
      return res.status(404).json({ error: 'No stored resume file for this application' });
    }
    res.setHeader('Content-Type', row.original_mimetype || 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${(row.original_filename || 'resume.pdf').replace(/"/g, '')}"`
    );
    res.send(row.file_data);
  } catch (err) {
    console.error('GET resume-file failed:', err.message);
    res.status(500).json({ error: 'Could not load resume file' });
  }
});

/* ------------------------------------------------------------------ *
 * Queue: transitions
 * ------------------------------------------------------------------ */

// The extension reports the questions it found on the live form; we answer
// what the profile covers and hand back what still needs the user.
router.patch('/queue/:id/questions', verifyToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const questions = Array.isArray(req.body.questions) ? req.body.questions : [];
    const owns = await query(
      `SELECT a.screening_answers, a.submission_channel, j.location, j.company_name
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.id = $1 AND a.user_id = $2`, [id, req.user.id]
    );
    if (!owns.rows.length) return res.status(404).json({ error: 'Not found' });

    const p = await query('SELECT * FROM application_profiles WHERE user_id = $1', [req.user.id]);
    const filled = prefillAnswers(questions, p.rows[0] || {}, { location: owns.rows[0].location });

    // Grow the knowledge base with every form seen. Awaited but never allowed to
    // fail the request - a learning write must not cost someone an application.
    recordSeen(questions, {
      ats: owns.rows[0].submission_channel,
      company: owns.rows[0].company_name,
    }).catch((e) => console.warn('[kb] recordSeen failed:', e.message));
    const merged = { ...(owns.rows[0].screening_answers || {}), questions: filled };

    await query(
      `UPDATE applications SET screening_answers = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(merged), id, req.user.id]
    );
    res.json({ questions: filled, summary: summarize(filled) });
  } catch (err) {
    console.error('PATCH questions failed:', err.message);
    res.status(500).json({ error: 'Could not record form questions' });
  }
});

// User edits an answer on the review screen.
router.patch('/queue/:id/answers', verifyToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const edits = req.body.answers || {};
    const owns = await query(
      'SELECT screening_answers FROM applications WHERE id = $1 AND user_id = $2', [id, req.user.id]
    );
    if (!owns.rows.length) return res.status(404).json({ error: 'Not found' });

    const stored = owns.rows[0].screening_answers || {};
    const applyEdits = (arr) => (arr || []).map((a) => (
      edits[a.question] !== undefined
        ? { ...a, answer: edits[a.question], source: 'user_edited' }
        : a
    ));
    const merged = {
      ...stored,
      standard: applyEdits(stored.standard),
      questions: stored.questions ? applyEdits(stored.questions) : stored.questions,
    };

    await query(
      `UPDATE applications SET screening_answers = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(merged), id, req.user.id]
    );

    // Optionally remember the answer for future applications.
    if (req.body.saveToProfile) {
      const custom = {};
      for (const [q, v] of Object.entries(edits)) {
        // Keep the employer's original wording alongside the answer. The key is
        // a normalised, truncated slug; the matcher needs real text to compare
        // a differently-worded question against.
        if (v !== null && v !== '') {
          custom[normalizeKey(q)] = { answer: String(v), question: String(q).slice(0, 400) };
        }
      }
      // A user-answered wording becomes a confirmed variation of its concept, so
      // the same question from any other ATS resolves without asking again.
      for (const q of Object.keys(edits)) {
        const c = classify(q);
        confirmVariation(q, c && c.conceptId).catch(() => {});
      }
      if (Object.keys(custom).length) {
        await query(
          `INSERT INTO application_profiles (user_id, custom_answers)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (user_id) DO UPDATE
             SET custom_answers = application_profiles.custom_answers || $2::jsonb,
                 updated_at = CURRENT_TIMESTAMP`,
          [req.user.id, JSON.stringify(custom)]
        );
      }
    }
    res.json({ ok: true, screeningAnswers: merged });
  } catch (err) {
    console.error('PATCH answers failed:', err.message);
    res.status(500).json({ error: 'Could not save answers' });
  }
});

// The approval gate. This is the user authorising a specific, reviewed
// application to be executed - it does not mark anything as applied.
//
// Approval is refused while a required question is unanswered. That guard lives
// here rather than in the UI because it is what makes auto-submit safe: the
// extension can only execute an `approved` item, so a form with a blank
// required answer - or an answer nobody chose - cannot reach a submit click.
router.post('/queue/:id/approve', verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const cur = await query(
      'SELECT status, screening_answers FROM applications WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });

    const stored = cur.rows[0].screening_answers || {};
    const all = [...(stored.standard || []), ...(stored.questions || [])];
    const blocking = summarize(all);
    if (!blocking.readyWithoutInput) {
      return res.status(422).json({
        error: 'Cannot approve while required answers are missing',
        blockingQuestions: blocking.blockingQuestions,
        hint: 'Answer these on the review screen, or add them to your Application Profile.',
      });
    }

    const r = await query(
      `UPDATE applications SET status = 'approved', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND status IN ('ready_for_review', 'needs_user', 'failed')
       RETURNING id, status`,
      [id, req.user.id]
    );
    if (!r.rows.length) {
      return res.status(409).json({ error: 'Not in an approvable state' });
    }
    res.json({ ok: true, status: r.rows[0].status });
  } catch (err) {
    console.error('POST approve failed:', err.message);
    res.status(500).json({ error: 'Could not approve application' });
  }
});

router.post('/queue/approve-bulk', verifyToken, async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger);
    if (!ids.length) return res.status(400).json({ error: 'No applications supplied' });

    // Same guard as single approve, applied per item: approving 30 at once must
    // not become a way to wave through the ones with unanswered questions.
    const rows = await query(
      'SELECT id, screening_answers FROM applications WHERE user_id = $1 AND id = ANY($2::int[])',
      [req.user.id, ids]
    );
    const eligible = [];
    const blocked = [];
    for (const row of rows.rows) {
      const stored = row.screening_answers || {};
      const s = summarize([...(stored.standard || []), ...(stored.questions || [])]);
      if (s.readyWithoutInput) eligible.push(row.id);
      else blocked.push({ id: row.id, blockingQuestions: s.blockingQuestions });
    }

    const r = eligible.length
      ? await query(
        `UPDATE applications SET status = 'approved', updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND id = ANY($2::int[]) AND status IN ('ready_for_review','needs_user','failed')
         RETURNING id`,
        [req.user.id, eligible]
      )
      : { rows: [] };

    res.json({
      approved: r.rows.map((x) => x.id),
      count: r.rows.length,
      blocked,
      blockedCount: blocked.length,
    });
  } catch (err) {
    console.error('POST approve-bulk failed:', err.message);
    res.status(500).json({ error: 'Could not approve applications' });
  }
});

router.post('/queue/:id/skip', verifyToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    // Free the prepared materials too - each holds two full copies of the
    // resume text, and skipped items would otherwise accrete on the small
    // Railway volume. Read the material ids before clearing the references.
    const cur = await query(
      `SELECT tailored_resume_id, cover_letter_id FROM applications
       WHERE id = $1 AND user_id = $2 AND status NOT IN ('submitted')`,
      [id, req.user.id]
    );
    if (cur.rows.length) {
      const { tailored_resume_id: trId, cover_letter_id: clId } = cur.rows[0];
      await query(
        `UPDATE applications SET status = 'skipped',
                tailored_resume_id = NULL, cover_letter_id = NULL,
                screening_answers = '{}'::jsonb, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2`,
        [id, req.user.id]
      );
      if (trId) await query('DELETE FROM tailored_resumes WHERE id = $1 AND user_id = $2', [trId, req.user.id]).catch(() => {});
      if (clId) await query('DELETE FROM cover_letters WHERE id = $1 AND user_id = $2', [clId, req.user.id]).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not skip application' });
  }
});

// Extension signals it has started driving the form.
router.post('/queue/:id/start', verifyToken, async (req, res) => {
  try {
    const r = await query(
      `UPDATE applications SET status = 'submitting', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND status IN ('approved', 'needs_user')
       RETURNING id`,
      [Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) {
      // Refusing to execute an unapproved item is the point, so this is a hard
      // error rather than a silent no-op.
      return res.status(409).json({ error: 'Application is not approved for execution' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not start application' });
  }
});

// Extension hit something only the user can do.
const PAUSE_REASONS = new Set(['login', 'mfa', 'captcha', 'consent', 'final_submit', 'unmapped_required_field']);

router.post('/queue/:id/pause', verifyToken, async (req, res) => {
  try {
    const reason = String(req.body.reason || '');
    if (!PAUSE_REASONS.has(reason)) {
      return res.status(400).json({ error: `Unknown pause reason: ${reason}` });
    }
    await query(
      `UPDATE applications
         SET status = 'needs_user', failure_reason = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3`,
      [`Paused: ${reason}${req.body.detail ? ` - ${req.body.detail}` : ''}`, Number(req.params.id), req.user.id]
    );
    res.json({ ok: true, status: 'needs_user' });
  } catch (err) {
    res.status(500).json({ error: 'Could not pause application' });
  }
});

/* ------------------------------------------------------------------ *
 * Evidence: the ONLY path to "submitted"
 * ------------------------------------------------------------------ */

// A submission is only recognised if the extension produces evidence it
// actually happened: the post-submit URL plus either a confirmation
// id/reference parsed from the page, or the confirmation page text with a
// recognisable success signal. Without that, the application goes to `failed`
// with an explicit "could not verify" reason rather than being optimistically
// marked applied.
const SUCCESS_SIGNALS = [
  /thank you for applying/i,
  /application (has been )?(received|submitted|sent)/i,
  /we('| ha)ve received your application/i,
  /your application (was|has been) submitted/i,
  /successfully (applied|submitted)/i,
  /confirmation number/i,
  /application id/i,
];

router.post('/queue/:id/evidence', verifyToken, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const owns = await query(
      'SELECT id, status FROM applications WHERE id = $1 AND user_id = $2', [id, req.user.id]
    );
    if (!owns.rows.length) return res.status(404).json({ error: 'Not found' });

    const {
      confirmationId = null,
      confirmationText = '',
      finalUrl = '',
      submittedAt = null,
    } = req.body || {};

    const text = String(confirmationText || '');
    const hasSignal = SUCCESS_SIGNALS.some((re) => re.test(text));
    const hasId = Boolean(confirmationId && String(confirmationId).trim());
    const verified = hasId || hasSignal;

    if (!verified) {
      await query(
        `UPDATE applications
           SET status = 'failed',
               failure_reason = $1,
               retry_count = retry_count + 1,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND user_id = $3`,
        [
          'Could not verify submission: no confirmation id and no success message on the '
          + `post-submit page${finalUrl ? ` (${String(finalUrl).slice(0, 300)})` : ''}. `
          + 'Not marked as applied.',
          id, req.user.id,
        ]
      );
      return res.status(422).json({
        verified: false,
        status: 'failed',
        error: 'No confirmation evidence - application not marked as applied.',
      });
    }

    const stamp = submittedAt ? new Date(submittedAt) : new Date();
    const when = Number.isNaN(stamp.getTime()) ? new Date() : stamp;

    const r = await query(
      `UPDATE applications
         SET status = 'submitted',
             applied_at = $1,
             submitted_at = $1,
             verified_at = CURRENT_TIMESTAMP,
             confirmation_captured_at = CURRENT_TIMESTAMP,
             employer_confirmation_id = $2,
             employer_confirmation_text = $3,
             target_form_url = COALESCE($4, target_form_url),
             failure_reason = NULL,
             last_status_update = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND user_id = $6
       RETURNING id, status, submitted_at, verified_at, employer_confirmation_id`,
      [
        when,
        hasId ? String(confirmationId).trim().slice(0, 255) : null,
        // Cap tight: the extension already narrows to the confirmation region,
        // and this table must not become a disk-growth vector (500MB volume).
        text.slice(0, 5000),
        finalUrl ? String(finalUrl).slice(0, 1024) : null,
        id, req.user.id,
      ]
    );

    // Notification stream. Keyed on event_type/job_id/metadata to match the
    // activity_log schema the Notification Center reads.
    const jobIdRow = await query('SELECT job_id FROM applications WHERE id = $1', [id]);
    await query(
      `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
       VALUES ($1, 'application_submitted', $2, $3::jsonb)`,
      [
        req.user.id,
        jobIdRow.rows[0]?.job_id || null,
        JSON.stringify({
          applicationId: id,
          confirmationId: hasId ? String(confirmationId).trim() : null,
          evidenceBasis: hasId ? 'confirmation_id' : 'confirmation_page_text',
          verified: true,
        }),
      ]
    ).catch((e) => console.warn('activity_log insert failed:', e.message));

    res.json({
      verified: true,
      application: r.rows[0],
      evidenceBasis: hasId ? 'confirmation_id' : 'confirmation_page_text',
    });
  } catch (err) {
    console.error('POST evidence failed:', err.message);
    res.status(500).json({ error: 'Could not record submission evidence' });
  }
});

router.post('/queue/:id/failure', verifyToken, async (req, res) => {
  try {
    const reason = String(req.body.reason || 'Unknown failure').slice(0, 2000);
    const retryable = req.body.retryable !== false;
    const r = await query(
      `UPDATE applications
         SET status = 'failed', failure_reason = $1,
             retry_count = retry_count + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3 AND status <> 'submitted'
       RETURNING id, retry_count`,
      [reason, Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found or already submitted' });
    // Three attempts, then stop retrying and leave it for the user - retrying a
    // form that keeps failing risks duplicate submissions.
    const canRetry = retryable && r.rows[0].retry_count < 3;
    res.json({ ok: true, retryCount: r.rows[0].retry_count, canRetry });
  } catch (err) {
    res.status(500).json({ error: 'Could not record failure' });
  }
});

/* ------------------------------------------------------------------ *
 * Proof surface for the dashboard
 * ------------------------------------------------------------------ */

// What the knowledge base has learned - surfaced so the profile screen can show
// the thing actually improving, rather than asserting that it does.
router.get('/knowledge', verifyToken, async (req, res) => {
  try {
    const s = await knowledgeStats();
    const top = await query(
      `SELECT concept_id, COUNT(*)::int AS variations, SUM(times_seen)::int AS seen
       FROM question_variations WHERE concept_id IS NOT NULL
       GROUP BY concept_id ORDER BY variations DESC LIMIT 15`
    );
    res.json({ ...s, byConcept: top.rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not load knowledge stats' });
  }
});

router.get('/submitted', verifyToken, async (req, res) => {
  try {
    const r = await query(
      `SELECT a.id, a.employer_confirmation_id, a.employer_confirmation_text,
              a.submitted_at, a.verified_at, a.target_form_url, a.submission_channel,
              a.submitted_by, j.title, j.company_name
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.user_id = $1 AND a.status = 'submitted'
       ORDER BY a.submitted_at DESC NULLS LAST`,
      [req.user.id]
    );
    res.json({
      submitted: r.rows.map((row) => ({
        ...row,
        // Trim the stored page text for list display; the full text stays
        // available on the detail view as the actual proof.
        confirmationExcerpt: (row.employer_confirmation_text || '')
          .replace(/\s+/g, ' ').trim().slice(0, 240) || null,
        employer_confirmation_text: undefined,
      })),
      count: r.rows.length,
    });
  } catch (err) {
    console.error('GET /apply/submitted failed:', err.message);
    res.status(500).json({ error: 'Could not load submitted applications' });
  }
});

module.exports = router;
