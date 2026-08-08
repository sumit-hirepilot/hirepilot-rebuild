const express = require('express');
const multer = require('multer');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { checkAts, buildAtsGuide } = require('../services/atsChecker');
const { extractTextFromFile } = require('../services/fileTextExtractor');
const { parseResume } = require('../services/resumeParser');
const { calculateMatchesForUser } = require('../services/matchingEngine');
const { generateCoverLetterContent } = require('../services/coverLetterGenerator');
const { fixMojibake } = require('../services/apis/textSanitizer');
const { buildTailoredText, diffTailoring, applyAcceptedChanges } = require('../services/resumeTailorEngine');
const docModel = require('../services/resumeDocument');
const { renderHtml, templateList, FONTS, DEFAULT_STYLE } = require('../services/resumeTemplate');
const { buildCorpus, verifyAdditions, findRemovedLines } = require('../services/resumeGuard');
const { companyKeyFor } = require('../services/companyKey');
const { parseScreeningPaste, MAX_PASTE, MAX_PAIRS } = require('../services/screeningPaste');
const { boundPaging } = require('../services/requestBounds');
const { parsePastedJobText, MIN_JOB_TEXT } = require('../services/pastedJobText');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

router.use(verifyToken);

// --- Resume Manager ---

router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, original_file_text, label, is_default, created_at, updated_at FROM resumes WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [req.user.id]
    );
    res.json({ resumes: result.rows });
  } catch (err) {
    console.error('List resumes error:', err);
    res.status(500).json({ error: 'Failed to fetch resumes' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { text, isDefault, label } = req.body;

    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'Resume text must be at least 20 characters' });
    }

    if (isDefault) {
      await query('UPDATE resumes SET is_default = false WHERE user_id = $1', [req.user.id]);
    }

    const result = await query(
      `INSERT INTO resumes (user_id, original_file_text, label, is_default)
       VALUES ($1, $2, $3, $4) RETURNING id, original_file_text, label, is_default, created_at`,
      [req.user.id, text.trim(), label || null, !!isDefault]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add resume error:', err);
    res.status(500).json({ error: 'Failed to save resume' });
  }
});

router.put('/:id/default', async (req, res) => {
  try {
    await query('UPDATE resumes SET is_default = false WHERE user_id = $1', [req.user.id]);
    const result = await query(
      'UPDATE resumes SET is_default = true WHERE id = $1 AND user_id = $2 RETURNING id, is_default',
      [req.params.id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Resume not found' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Set default resume error:', err);
    res.status(500).json({ error: 'Failed to set default resume' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM resumes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Resume deleted' });
  } catch (err) {
    console.error('Delete resume error:', err);
    res.status(500).json({ error: 'Failed to delete resume' });
  }
});

// Download the exact original uploaded file, byte-for-byte, unmodified.
// Resumes uploaded before file storage was added (or saved via paste-text)
// have no file_data - fall back to a plain-text download of the saved text.
router.get('/:id/original', async (req, res) => {
  try {
    const result = await query(
      'SELECT file_data, original_filename, original_mimetype, original_file_text FROM resumes WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Resume not found' });
    const resume = result.rows[0];

    if (resume.file_data) {
      res.setHeader('Content-Type', resume.original_mimetype || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${resume.original_filename || 'resume'}"`);
      return res.send(resume.file_data);
    }

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="resume.txt"');
    res.send(resume.original_file_text || '');
  } catch (err) {
    console.error('Download original resume error:', err);
    res.status(500).json({ error: 'Failed to download resume' });
  }
});

// Upload a resume file (.txt, .docx, .pdf), extract text and parse
// skills/experience for the user to review before saving to their profile.
/*
 * L3 — upload failures fail in sentences.
 *
 * multer's LIMIT_FILE_SIZE used to fall through to the global error handler
 * as a bare 500 ("Internal Server Error / File too large"), and a corrupt
 * file surfaced the parser's own words ("Invalid PDF structure."). A
 * stranger can act on neither. The limit becomes a 413 with the number and
 * the alternative; the parse failure names what to DO, and the parser's
 * diagnosis goes to the log where it is useful.
 */
const uploadSingle = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'That file is over the 8 MB limit. Export a smaller PDF, or paste your resume text below instead.',
      });
    }
    if (err) {
      console.error('Resume upload rejected:', err.message);
      return res.status(400).json({
        error: 'That upload did not come through. Try again, or paste your resume text below instead.',
      });
    }
    return next();
  });
};

router.post('/upload', uploadSingle, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let text;
    try {
      text = await extractTextFromFile(req.file.buffer, req.file.mimetype, req.file.originalname);
    } catch (err) {
      console.error('Resume text extraction failed:', err.message);
      return res.status(422).json({
        error: "We couldn't read that file - it may be damaged, password-protected, or a scanned image. "
          + 'Try re-exporting it as a PDF, or paste your resume text below instead.',
      });
    }

    text = (text || '').trim();
    if (text.length < 20) {
      return res.status(422).json({ error: 'Could not extract readable text from this file. Try a different file or paste your resume text directly.' });
    }

    const parsed = parseResume(text);

    if (req.body.saveAsDefault === 'true') {
      await query('UPDATE resumes SET is_default = false WHERE user_id = $1', [req.user.id]);
    }

    const saved = await query(
      `INSERT INTO resumes (user_id, original_file_text, label, is_default, file_data, original_filename, original_mimetype)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
      [
        req.user.id, text, req.file.originalname, req.body.saveAsDefault === 'true',
        req.file.buffer, req.file.originalname, req.file.mimetype,
      ]
    );

    res.status(201).json({
      resumeId: saved.rows[0].id,
      text,
      parsed,
    });
  } catch (err) {
    console.error('Upload resume error:', err);
    res.status(500).json({ error: 'Failed to process resume file' });
  }
});

// Apply parsed skills/experience to the user's profile (Profile Auto Creation).
// Only adds entries the user has confirmed - never runs silently.
router.post('/apply-parsed', async (req, res) => {
  try {
    const { skills = [], experience = [] } = req.body;

    /*
     * Nothing to apply is not an update, and must not be reported as one.
     *
     * This endpoint reads the skills and experience out of the REQUEST, not
     * out of the stored resume - the client posts back what the user
     * confirmed. Called with neither (say, with just a resumeId, which it
     * ignores) it used to insert nothing, score nothing, and answer 200
     * "Profile updated from resume" with skillsAdded: 0. The caller is then
     * told the profile was built from the resume while the profile is empty,
     * and the next screen shows no skills with no explanation.
     *
     * 400 with the reason, so a wrong call says so instead of looking like a
     * parser that found nothing.
     */
    if (!skills.length && !experience.length) {
      return res.status(400).json({
        error: 'Nothing to apply',
        detail: 'Send the skills and experience to add. This endpoint applies what the user confirmed from the parse; it does not re-read a stored resume, so a resumeId on its own applies nothing.',
      });
    }

    for (const skill of skills) {
      if (!skill || typeof skill !== 'string') continue;
      await query(
        `INSERT INTO user_skills (user_id, skill) VALUES ($1, $2)
         ON CONFLICT (user_id, skill) DO NOTHING`,
        [req.user.id, skill.trim()]
      );
    }

    for (const exp of experience) {
      if (!exp.jobTitle && !exp.companyName) continue;
      const startDate = exp.startDateRaw ? parseFuzzyDate(exp.startDateRaw) : null;
      const endDate = exp.endDateRaw ? parseFuzzyDate(exp.endDateRaw) : null;
      await query(
        `INSERT INTO user_experience (user_id, company_name, job_title, start_date, end_date, currently_working)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.user.id, exp.companyName || null, exp.jobTitle || null, startDate, endDate, !!exp.currentlyWorking]
      );
    }

    await query('UPDATE users SET onboarding_completed_at = COALESCE(onboarding_completed_at, CURRENT_TIMESTAMP) WHERE id = $1', [req.user.id]);

    /*
     * Score straight away rather than leaving it to the next feed read.
     * Applying a parsed resume is the moment a user's profile becomes
     * scoreable, and it is the last step of the Resume page - which never
     * recalculated, so that page produced a profile and a stale feed. A full
     * recalculation measured 1.6s against 23k live jobs, which is affordable
     * inside this request; the read path still covers every other route in.
     *
     * A scoring failure must not fail the profile update - the skills really
     * were saved - so it is reported rather than thrown.
     */
    let scored = false;
    try {
      await calculateMatchesForUser(req.user.id);
      scored = true;
    } catch (err) {
      console.error('Scoring after apply-parsed failed:', err.message);
    }

    res.json({
      message: 'Profile updated from resume',
      skillsAdded: skills.length,
      experienceAdded: experience.length,
      scored,
    });
  } catch (err) {
    console.error('Apply parsed resume error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

function parseFuzzyDate(raw) {
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  const parsed = new Date(`1 ${raw}`);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

// --- Tailor for a Job ---

router.get('/tailored', async (req, res) => {
  try {
    const result = await query(
      /*
       * LEFT JOIN, because a resume tailored from a PASTED job description has
       * no row in `jobs` and never will.
       *
       * This was an inner join. Feature 3 wrote the row, the CHECK constraint
       * accepted it, the endpoint returned 201 - and the user could never see
       * it, because this query silently dropped every job-less row. Work the
       * product performs and then hides is the same defect class as a computed
       * value nothing reads.
       *
       * Found by reading the row back from production after writing it, rather
       * than trusting the 201.
       *
       * `source` is returned so the UI can say what it was tailored against
       * instead of showing a blank company as though one were missing.
       */
      `SELECT tr.id, tr.tailored_summary, tr.highlighted_skills, tr.ats_score, tr.created_at,
              tr.confirmed_at, tr.diff_json, tr.original_snapshot, tr.final_text,
              tr.source,
              j.title as job_title, j.company_name
       FROM tailored_resumes tr
       LEFT JOIN jobs j ON tr.job_id = j.id
       WHERE tr.user_id = $1
       ORDER BY tr.created_at DESC`,
      [req.user.id]
    );
    res.json({ tailored: result.rows.map((r) => ({ ...r, job_title: fixMojibake(r.job_title), company_name: fixMojibake(r.company_name) })) });
  } catch (err) {
    console.error('List tailored resumes error:', err);
    res.status(500).json({ error: 'Failed to fetch tailored resumes' });
  }
});

// Generates a draft tailored resume: takes the user's actual saved resume
// text and adds any job-relevant keywords it's missing (see
// resumeTailorEngine.js) - never rewrites or removes existing content. A
// new tailored_resumes row is created per job every time (never reused
// across jobs), left unconfirmed until the user reviews the diff and
// accepts/rejects each addition via POST /tailored/:id/confirm.
/*
 * Feature 3 — one route, two ways in.
 *
 * `jobId` tailors against a job this product indexed. `jobText` tailors
 * against one the user pasted, which is the common case in India: the role
 * arrives by WhatsApp, by email, or on a board nothing here can fetch.
 *
 * The two paths converge IMMEDIATELY, before anything is generated, so there
 * is exactly one guarded pipeline rather than two that must be kept in step.
 * A7.17 and the approve-endpoint defect were both "two paths for one
 * operation, one of them guarded" - this is written so that shape cannot
 * recur here.
 *
 * The paste is untrusted: bounded and stripped by parsePastedJobText, read
 * only for the skill tokens in it, never obeyed. See that file for why the
 * defence is architectural rather than a filter.
 */
router.post('/tailor', async (req, res) => {
  try {
    const { jobId } = req.body;
    const hasPaste = typeof req.body.jobText === 'string' && req.body.jobText.trim().length > 0;

    if (!jobId && !hasPaste) {
      return res.status(400).json({ error: 'Give a jobId, or paste the job description.' });
    }
    if (jobId && hasPaste) {
      // Refuse rather than pick one: silently ignoring half of what was sent is
      // how a user ends up tailoring against something they did not choose.
      return res.status(400).json({ error: 'Send either jobId or jobText, not both.' });
    }

    let pasted = null;
    if (hasPaste) {
      pasted = parsePastedJobText(req.body.jobText);
      if (pasted.tooShort) {
        return res.status(400).json({
          error: `That is too short to read as a job description (${pasted.text.length} characters after cleaning, ${MIN_JOB_TEXT} needed).`,
        });
      }
      if (pasted.instructionLike) {
        /*
         * Logged, never acted on. The honesty guard below protects the resume
         * identically whether or not this is true, and behaviour that depends
         * on spotting a phrase is behaviour someone can phrase around.
         */
        console.warn('[tailor] pasted JD contains instruction-like text', {
          userId: req.user.id, length: pasted.text.length,
        });
      }
    }

    const [jobResult, resumeResult, prefsResult] = await Promise.all([
      jobId
        ? query('SELECT title, company_name, description, requirements FROM jobs WHERE id = $1', [jobId])
        : Promise.resolve({ rows: [] }),
      query(
        `SELECT id, original_file_text FROM resumes WHERE user_id = $1
         ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
        [req.user.id]
      ),
      query('SELECT resume_tailor_mode FROM user_preferences WHERE user_id = $1', [req.user.id]),
    ]);

    if (jobId && !jobResult.rows.length) return res.status(404).json({ error: 'Job not found' });
    if (!resumeResult.rows.length || !resumeResult.rows[0].original_file_text?.trim()) {
      return res.status(400).json({ error: 'Save or upload a resume first (Resume Manager tab) before tailoring for a job.' });
    }

    /*
     * A pasted JD has no company and no title we can vouch for. They are left
     * null rather than guessed from the text: a company name scraped out of a
     * paste and shown as fact is a fabricated record, and the tracker already
     * refuses to invent one.
     */
    const job = jobResult.rows[0] || { title: null, company_name: null, description: null, requirements: null };
    job.title = fixMojibake(job.title);
    job.company_name = fixMojibake(job.company_name);
    const resume = resumeResult.rows[0];
    const originalText = resume.original_file_text;
    const tailorMode = prefsResult.rows[0]?.resume_tailor_mode || 'honest';

    const jobText = pasted
      ? pasted.text
      : `${job.title} ${job.description || ''} ${job.requirements || ''}`;
    const proposed = buildTailoredText(originalText, jobText, tailorMode);

    /*
     * Item A — the guard, on THIS path too.
     *
     * The document editor already does this: verifyAdditions splits proposed
     * skills into ones traceable to the user's own material and ones that are
     * not, and an untraceable skill becomes a QUESTION rather than a silent
     * addition. This route called buildTailoredText and wrote the result
     * straight out.
     *
     * Found by walking a fresh account: a resume with no marketing anywhere in
     * it came back reading "Additional relevant skills for this role:
     * Marketing", pulled from the job description. That is a fabricated claim
     * about a person, attached to an application in their name, and it cannot
     * be unsent. Constraint 2.
     *
     * Same shape as A7.17: two paths for one operation, one of them guarded.
     */
    const corpus = await corpusFor(req.user.id, originalText);
    const checked = verifyAdditions(
      (proposed.addedSkills || []).map((t) => ({ text: t, kind: 'skill' })),
      corpus
    );
    const allowedSkills = checked.filter((c) => c.ok).map((c) => c.text);
    const needsConfirmation = checked.filter((c) => !c.ok).map((c) => ({
      text: c.text,
      why: c.why || 'This is not in your resume, skills or work history yet.',
    }));

    /*
     * Rebuilt from the ALLOWED set only. Filtering the finished text would
     * leave the sentence that introduces the skills behind, and a heading
     * promising skills that are not there is its own small lie.
     */
    const rebuilt = allowedSkills.length
      ? buildTailoredText(originalText, allowedSkills.join(' '), tailorMode)
      : { tailoredText: originalText, addedSkills: [], matchedSkills: proposed.matchedSkills };

    const tailoredText = rebuilt.tailoredText;

    /*
     * Third honesty guard, on the real output, before a single row is written.
     *
     * "Nothing already in your resume can be removed" rested on a test until
     * now. A test proves the engine behaved when it ran; it cannot stop a
     * future path writing a resume with a line missing. Refusing is correct
     * here - a resume quietly short a line is worse than no tailoring, because
     * it goes out under the user's name and cannot be unsent.
     */
    const removed = findRemovedLines(originalText, tailoredText);
    if (removed.length) {
      console.error('[tailor] refused: tailoring dropped lines', {
        userId: req.user.id, count: removed.length,
      });
      return res.status(422).json({
        error: 'Tailoring was refused because it would have removed something already in your resume.',
        removedLines: removed.slice(0, 5),
      });
    }

    const addedSkills = allowedSkills;
    const matchedSkills = proposed.matchedSkills;
    const diff = diffTailoring(originalText, tailoredText);
    const { score } = checkAts(jobText, tailoredText);

    const saved = await query(
      `INSERT INTO tailored_resumes
       (user_id, resume_id, job_id, tailored_summary, highlighted_skills, ats_score, original_snapshot, diff_json, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`,
      [req.user.id, resume.id, jobId || null, tailoredText, matchedSkills, score, originalText, JSON.stringify(diff),
        pasted ? 'pasted_jd' : 'indexed_job']
    );

    await query(
      `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
       VALUES ($1, 'resume_tailored', $2, $3)`,
      [req.user.id, jobId || null, JSON.stringify({
        job_title: job.title,
        company_name: job.company_name,
        // Recorded as what it is. A pasted JD has no verified employer behind
        // it, and the tracker must never show one as though it had.
        source: pasted ? 'pasted_jd' : 'indexed_job',
      })]
    );

    res.status(201).json({
      id: saved.rows[0].id,
      originalText,
      tailoredText,
      diff,
      addedSkills,
      matchedSkills,
      // Stated, never silently dropped: a skill the user genuinely has but has
      // not listed is theirs to confirm, and confirming it is what makes it
      // traceable. A skill they do not have must never appear at all.
      needsConfirmation,
      atsScore: score,
      jobTitle: job.title,
      companyName: job.company_name,
      resumeId: resume.id,
      createdAt: saved.rows[0].created_at,
    });
  } catch (err) {
    console.error('Tailor resume error:', err);
    res.status(500).json({ error: 'Failed to tailor resume' });
  }
});

router.delete('/tailored/:id', async (req, res) => {
  try {
    await query('DELETE FROM tailored_resumes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Tailored resume deleted' });
  } catch (err) {
    console.error('Delete tailored resume error:', err);
    res.status(500).json({ error: 'Failed to delete tailored resume' });
  }
});

// User reviews the diff and accepts/rejects each addition individually;
// this reconstructs and locks in the final approved text. Every application
// that uses this tailored version uses this exact approved text, and it's
// never reused for a different job (each /tailor call creates its own row).
router.post('/tailored/:id/confirm', async (req, res) => {
  try {
    const { acceptedIndices } = req.body; // array of diff part indices to accept; omit/[] = accept none, omit param entirely = accept all
    const result = await query(
      'SELECT diff_json, tailored_summary FROM tailored_resumes WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tailored resume not found' });
    const row = result.rows[0];

    let finalText;
    if (!row.diff_json) {
      finalText = row.tailored_summary;
    } else {
      const diff = row.diff_json;
      const accepted = Array.isArray(acceptedIndices)
        ? acceptedIndices
        : diff.filter((p) => p.added).map((p) => p.index); // default: accept all additions
      finalText = applyAcceptedChanges(diff, accepted);
    }

    const updated = await query(
      `UPDATE tailored_resumes SET final_text = $1, confirmed_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3 RETURNING id, final_text, confirmed_at`,
      [finalText, req.params.id, req.user.id]
    );

    res.json(updated.rows[0]);
  } catch (err) {
    console.error('Confirm tailored resume error:', err);
    res.status(500).json({ error: 'Failed to confirm tailored resume' });
  }
});

// Downloads the tailored resume as a clean, ATS-optimized PDF. This is a
// freshly generated document, not a pixel-edit of the original upload -
// reliably preserving an arbitrary uploaded PDF's exact internal layout
// while changing its text isn't something open PDF tooling can do safely,
// so a clean readable format is used instead. The original file is always
// available unmodified via GET /:id/original.
// --- Cover Letters ---
// Templated generation from the user's profile/skills/experience - no LLM
// is configured for this app, so this is honest mail-merge style text
// generation, not a fabricated "AI wrote this" claim.

router.get('/cover-letters', async (req, res) => {
  try {
    const result = await query(
      `SELECT cl.id, cl.content, cl.created_at, j.title as job_title, j.company_name
       FROM cover_letters cl JOIN jobs j ON cl.job_id = j.id
       WHERE cl.user_id = $1 ORDER BY cl.created_at DESC`,
      [req.user.id]
    );
    res.json({ coverLetters: result.rows.map((r) => ({ ...r, job_title: fixMojibake(r.job_title), company_name: fixMojibake(r.company_name) })) });
  } catch (err) {
    console.error('List cover letters error:', err);
    res.status(500).json({ error: 'Failed to fetch cover letters' });
  }
});

router.post('/cover-letter', async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });

    const [userResult, skillsResult, jobResult] = await Promise.all([
      query('SELECT full_name, title FROM users WHERE id = $1', [req.user.id]),
      query('SELECT skill FROM user_skills WHERE user_id = $1 ORDER BY skill LIMIT 5', [req.user.id]),
      query('SELECT title, company_name, description FROM jobs WHERE id = $1', [jobId]),
    ]);

    if (!jobResult.rows.length) return res.status(404).json({ error: 'Job not found' });

    const user = userResult.rows[0];
    const skills = skillsResult.rows.map((r) => r.skill);
    const job = jobResult.rows[0];
    job.title = fixMojibake(job.title);
    job.company_name = fixMojibake(job.company_name);

    const content = generateCoverLetterContent({
      name: user.full_name,
      userTitle: user.title,
      skills,
      jobTitle: job.title,
      companyName: job.company_name,
    });

    const saved = await query(
      `INSERT INTO cover_letters (user_id, job_id, content) VALUES ($1, $2, $3) RETURNING id, created_at`,
      [req.user.id, jobId, content]
    );

    await query(
      `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
       VALUES ($1, 'cover_letter_generated', $2, $3)`,
      [req.user.id, jobId, JSON.stringify({ job_title: job.title, company_name: job.company_name })]
    );

    res.status(201).json({
      id: saved.rows[0].id,
      content,
      jobTitle: job.title,
      companyName: job.company_name,
      createdAt: saved.rows[0].created_at,
    });
  } catch (err) {
    console.error('Generate cover letter error:', err);
    res.status(500).json({ error: 'Failed to generate cover letter' });
  }
});

router.delete('/cover-letters/:id', async (req, res) => {
  try {
    await query('DELETE FROM cover_letters WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Cover letter deleted' });
  } catch (err) {
    console.error('Delete cover letter error:', err);
    res.status(500).json({ error: 'Failed to delete cover letter' });
  }
});

// --- Screening question answers ---
// Templated based on question keywords + profile data. Honest heuristic,
// not true language understanding - always shown as an editable draft.

function generateScreeningAnswer(question, { name, title, skills, yearsExp, jobTitle, companyName }) {
  const q = question.toLowerCase();

  if (/why (do you want|are you interested)|why.*join|why.*company/.test(q)) {
    return `I'm drawn to ${companyName || 'this company'} because of the opportunity to apply my experience as a ${title || 'professional'} to meaningful, high-impact work. The ${jobTitle || 'role'} aligns closely with what I'm looking for in my next step, and I'm excited about the chance to contribute from day one.`;
  }

  if (/years? of experience|how (long|many years)/.test(q)) {
    return `I have ${yearsExp || 'several'} years of relevant experience${skills.length ? `, with hands-on work in ${skills.slice(0, 3).join(', ')}` : ''}.`;
  }

  if (/salary|compensation|pay range/.test(q)) {
    return `I'm flexible and open to discussing compensation based on the full scope of the role - I'd appreciate learning more about the budgeted range so we can find a good fit for both sides.`;
  }

  if (/relocat/.test(q)) {
    return `I'm open to discussing relocation depending on the specifics of the role and support offered.`;
  }

  if (/strength|skill/.test(q)) {
    return `My core strengths include ${skills.length ? skills.slice(0, 4).join(', ') : 'adaptability, collaboration, and a strong ownership mindset'}, which I've applied directly in my work as a ${title || 'professional'}.`;
  }

  if (/why should we hire you|why you/.test(q)) {
    return `I bring a proven track record as a ${title || 'professional'}${skills.length ? `, with direct experience in ${skills.slice(0, 3).join(', ')}` : ''}. I'm confident I can make an immediate, measurable contribution to your team.`;
  }

  return `Based on my background as a ${title || 'professional'}${skills.length ? ` with experience in ${skills.slice(0, 3).join(', ')}` : ''}, I believe I'm well-suited to answer this positively - happy to elaborate further in an interview.`;
}

router.get('/screening-answers', async (req, res) => {
  try {
    const result = await query(
      `SELECT sa.id, sa.question, sa.answer, sa.created_at, j.title as job_title, j.company_name
       FROM screening_answers sa LEFT JOIN jobs j ON sa.job_id = j.id
       WHERE sa.user_id = $1 ORDER BY sa.created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ answers: result.rows.map((r) => ({ ...r, job_title: fixMojibake(r.job_title), company_name: fixMojibake(r.company_name) })) });
  } catch (err) {
    console.error('List screening answers error:', err);
    res.status(500).json({ error: 'Failed to fetch screening answers' });
  }
});

router.post('/screening-answer', async (req, res) => {
  try {
    const { question, jobId } = req.body;
    if (!question || !question.trim()) return res.status(400).json({ error: 'question is required' });

    const [userResult, skillsResult, expResult, jobResult] = await Promise.all([
      query('SELECT full_name, title FROM users WHERE id = $1', [req.user.id]),
      query('SELECT skill FROM user_skills WHERE user_id = $1', [req.user.id]),
      query(
        `SELECT job_title, company_name,
                EXTRACT(YEAR FROM AGE(COALESCE(end_date, CURRENT_DATE), start_date)) as years
         FROM user_experience WHERE user_id = $1 AND start_date IS NOT NULL
         ORDER BY start_date ASC`,
        [req.user.id]
      ),
      jobId ? query('SELECT title, company_name FROM jobs WHERE id = $1', [jobId]) : Promise.resolve({ rows: [] }),
    ]);

    const totalYears = expResult.rows.reduce((sum, r) => sum + (parseFloat(r.years) || 0), 0);

    const answer = generateScreeningAnswer(question, {
      name: userResult.rows[0]?.full_name,
      title: userResult.rows[0]?.title,
      skills: skillsResult.rows.map((r) => r.skill),
      yearsExp: totalYears > 0 ? Math.round(totalYears) : null,
      jobTitle: fixMojibake(jobResult.rows[0]?.title),
      companyName: fixMojibake(jobResult.rows[0]?.company_name),
    });

    const saved = await query(
      `INSERT INTO screening_answers (user_id, job_id, question, answer) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [req.user.id, jobId || null, question.trim(), answer]
    );

    res.status(201).json({ id: saved.rows[0].id, question: question.trim(), answer, createdAt: saved.rows[0].created_at });
  } catch (err) {
    console.error('Generate screening answer error:', err);
    res.status(500).json({ error: 'Failed to generate answer' });
  }
});

// --- ATS Checker ---

router.post('/ats-check', async (req, res) => {
  try {
    const { jobDescription, resumeText } = req.body;

    if (!jobDescription || !resumeText) {
      return res.status(400).json({ error: 'jobDescription and resumeText are required' });
    }

    const result = checkAts(jobDescription, resumeText);
    // `tips` used to be a flat string list; the guide is structured (severity,
    // title, detail) so the UI can rank and style advice. Both are returned so
    // the existing ATS Checker tab keeps working.
    const guide = buildAtsGuide(result, resumeText);
    res.json({ ...result, guide, tips: guide.map((g) => g.detail) });
  } catch (err) {
    console.error('ATS check error:', err);
    res.status(500).json({ error: 'Failed to check resume' });
  }
});

/* ------------------------------------------------------------------ *
 * Structured document: the editor's API
 * ------------------------------------------------------------------ */

// Loads a resume's structured doc, parsing it on demand for rows the backfill
// has not reached. Keeps flat text as the derived view on every write.
async function loadDoc(userId, resumeId) {
  const r = await query(
    `SELECT id, doc, style, original_file_text, label, version_name, is_default, template
       FROM resumes WHERE id = $1 AND user_id = $2`,
    [resumeId, userId]
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  if (!row.doc) {
    row.doc = docModel.parseText(row.original_file_text || '');
    await query(
      `UPDATE resumes SET doc = $1::jsonb, doc_source = 'import',
              doc_updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [JSON.stringify(row.doc), row.id]
    );
  }
  return row;
}

/*
 * The text a node actually asserts. Bullets and skills carry `text`; an entry
 * asserts a role at an organisation, which is the most damaging thing on a
 * resume to get wrong, so it is checked as a claim like any other.
 */
function nodeText(n) {
  if (!n || !n.node) return '';
  if (n.kind === 'entry') return [n.node.role, n.node.org].filter(Boolean).join(' ').trim();
  return String(n.node.text || '').trim();
}

async function saveDoc(userId, resumeId, doc) {
  // Flat text is regenerated here and nowhere else, so it cannot fall out of
  // step with the structure. Pending nodes are excluded: a suggestion nobody
  // accepted must not reach the text the extension pastes into a real form.
  const text = docModel.toText(doc, { includePending: false });
  await query(
    // doc_source = 'user' takes this row out of the re-parse pool for good: from
    // here on the document is the user's, not the importer's.
    `UPDATE resumes SET doc = $1::jsonb, original_file_text = $2, doc_source = 'user',
            doc_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND user_id = $4`,
    [JSON.stringify(doc), text, resumeId, userId]
  );
  return text;
}

// Everything the user has actually told us, for the enforcement layer.
async function corpusFor(userId, resumeText) {
  const [skills, experience, profile] = await Promise.all([
    query('SELECT skill FROM user_skills WHERE user_id = $1', [userId]),
    query('SELECT company_name, job_title, start_date, end_date FROM user_experience WHERE user_id = $1', [userId]),
    query('SELECT * FROM application_profiles WHERE user_id = $1', [userId]),
  ]);
  return buildCorpus({
    resumeText,
    skills: skills.rows.map((r) => r.skill),
    experience: experience.rows,
    profile: profile.rows[0] || {},
  });
}

router.get('/:id/document', async (req, res) => {
  try {
    const row = await loadDoc(req.user.id, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Resume not found' });
    const style = { ...DEFAULT_STYLE, ...(row.style || {}) };
    res.json({
      resumeId: row.id,
      versionName: row.version_name || row.label || 'Default',
      isDefault: row.is_default,
      doc: row.doc,
      style,
      html: renderHtml(row.doc, style),
      pendingCount: docModel.countPending(row.doc),
      templates: templateList(),
      fonts: FONTS,
    });
  } catch (err) {
    console.error('GET /resume/:id/document failed:', err.message);
    res.status(500).json({ error: 'Could not load that resume' });
  }
});

// Full document write from the editor. Used for direct edits and reordering.
router.put('/:id/document', async (req, res) => {
  try {
    const row = await loadDoc(req.user.id, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Resume not found' });

    const next = req.body.doc;
    if (!next || !Array.isArray(next.sections)) return res.status(400).json({ error: 'A document with sections is required' });

    /*
     * The widest bypass of all: this endpoint took req.body.doc and saved it
     * whole, with no guard anywhere on the path. Every honesty rule the
     * tailoring routes enforce could be walked straight round by writing the
     * document directly - which is what the editor does on every keystroke.
     *
     * Checked per node rather than per document, and only where the text
     * actually CHANGED, so re-saving an untouched resume can never re-litigate
     * content the user already has.
     *
     * Untraceable content is marked pending, not refused. saveDoc regenerates
     * the flat text with pending nodes excluded, so anything unverified cannot
     * reach an employer - while the user's own editor never blocks their
     * typing. Refusing the write outright would make the editor unusable; the
     * criterion is that nothing unverified is SENT, not that nothing is typed.
     */
    const corpus = await corpusFor(req.user.id, docModel.toText(row.doc, { includePending: true }));
    const before = new Map(docModel.walk(row.doc).map((n) => [n.node.id, nodeText(n)]));
    const flagged = [];
    for (const n of docModel.walk(next)) {
      const t = nodeText(n);
      if (!t) continue;
      if (before.get(n.node.id) === t) continue;      // unchanged: already the user's
      if (n.node.status === 'pending') continue;      // already held back
      const [checked] = verifyAdditions([{ text: t, kind: n.kind }], corpus);
      if (checked.ok) continue;
      n.node.status = 'pending';
      flagged.push({
        id: n.node.id,
        text: t.slice(0, 160),
        why: (checked.violations[0] || {}).why || 'This is not in your resume, skills or work history yet.',
      });
    }

    /*
     * The header is a claim too, and it is not a node.
     *
     * docModel.walk only reaches bullets, skills and entries, so the loop above
     * never sees doc.meta - which is where the job title sits. "Director of
     * Engineering" typed into meta.title would have been written out unchecked
     * and appeared at the top of every export. There is no pending flag on
     * meta, so an untraceable header is reverted to what it was rather than
     * held: the alternative is publishing it.
     */
    const prevMeta = (row.doc && row.doc.meta) || {};
    next.meta = next.meta || {};
    for (const field of ['name', 'title', 'location']) {
      const value = String(next.meta[field] || '').trim();
      if (!value || value === String(prevMeta[field] || '').trim()) continue;
      const [checked] = verifyAdditions([{ text: value, kind: 'meta' }], corpus);
      if (checked.ok) continue;
      next.meta[field] = prevMeta[field] || '';
      flagged.push({
        id: `meta.${field}`,
        text: value.slice(0, 160),
        why: (checked.violations[0] || {}).why || 'This is not in your resume, skills or work history yet.',
      });
    }

    const style = req.body.style ? { ...(row.style || {}), ...req.body.style } : row.style;
    if (req.body.style) {
      await query('UPDATE resumes SET style = $1::jsonb WHERE id = $2 AND user_id = $3',
        [JSON.stringify(style), row.id, req.user.id]);
    }
    await saveDoc(req.user.id, row.id, next);

    res.json({
      ok: true,
      html: renderHtml(next, { ...DEFAULT_STYLE, ...(style || {}) }),
      pendingCount: docModel.countPending(next),
      heldForConfirmation: flagged,
    });
  } catch (err) {
    console.error('PUT /resume/:id/document failed:', err.message);
    res.status(500).json({ error: 'Could not save that document' });
  }
});

router.post('/:id/sections/reorder', async (req, res) => {
  try {
    const row = await loadDoc(req.user.id, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Resume not found' });
    const order = Array.isArray(req.body.order) ? req.body.order : [];
    docModel.reorderSections(row.doc, order);
    await saveDoc(req.user.id, row.id, row.doc);
    res.json({ ok: true, doc: row.doc, html: renderHtml(row.doc, { ...DEFAULT_STYLE, ...(row.style || {}) }) });
  } catch (err) {
    console.error('POST reorder failed:', err.message);
    res.status(500).json({ error: 'Could not reorder sections' });
  }
});

/*
 * Accept or reject a pending node.
 *
 * Accepting clears the pending flag, which is what promotes it into the derived
 * flat text. Rejecting removes the node outright - a rejected suggestion should
 * leave nothing behind, not sit around greyed out waiting to be re-accepted by
 * accident.
 */
router.post('/:id/nodes/:nodeId/:action', async (req, res) => {
  try {
    const action = req.params.action;
    if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'Unknown action' });

    const row = await loadDoc(req.user.id, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Resume not found' });

    if (action === 'accept') {
      const hit = docModel.findNode(row.doc, req.params.nodeId);
      if (!hit) return res.status(404).json({ error: 'No such change' });
      delete hit.node.status;
      hit.node.origin = 'user';
    } else if (!docModel.removeNode(row.doc, req.params.nodeId)) {
      return res.status(404).json({ error: 'No such change' });
    }

    await saveDoc(req.user.id, row.id, row.doc);
    res.json({
      ok: true,
      doc: row.doc,
      html: renderHtml(row.doc, { ...DEFAULT_STYLE, ...(row.style || {}) }),
      pendingCount: docModel.countPending(row.doc),
    });
  } catch (err) {
    console.error('POST node action failed:', err.message);
    res.status(500).json({ error: 'Could not apply that' });
  }
});

// Accept or reject everything pending at once.
router.post('/:id/nodes/:action-all', async (req, res) => {
  try {
    const action = req.params.action;
    if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'Unknown action' });
    const row = await loadDoc(req.user.id, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Resume not found' });

    const pending = docModel.walk(row.doc).filter((n) => n.node.status === 'pending');
    if (action === 'accept') {
      for (const p of pending) { delete p.node.status; p.node.origin = 'user'; }
    } else {
      for (const p of pending) docModel.removeNode(row.doc, p.node.id);
    }
    await saveDoc(req.user.id, row.id, row.doc);
    res.json({ ok: true, affected: pending.length, doc: row.doc, pendingCount: docModel.countPending(row.doc) });
  } catch (err) {
    console.error('POST bulk node action failed:', err.message);
    res.status(500).json({ error: 'Could not apply that' });
  }
});

/*
 * Tailor a resume against a job description, into the live document.
 *
 * Additions land as pending nodes so the preview shows them highlighted rather
 * than silently changing the resume. The deterministic engine decides what to
 * add; the guard checks it anyway, because the guard is what will also police
 * the LLM path and a rule enforced in only one place is a rule waiting to be
 * bypassed.
 */
router.post('/:id/tailor-live', async (req, res) => {
  try {
    const row = await loadDoc(req.user.id, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Resume not found' });

    const jobId = Number(req.body.jobId);
    let jobText = String(req.body.jobText || '');
    let job = null;
    if (jobId) {
      const j = await query('SELECT id, title, company_name, description, requirements FROM jobs WHERE id = $1', [jobId]);
      job = j.rows[0] || null;
      if (job) jobText = `${job.title}\n${job.description || ''}\n${job.requirements || ''}`;
    }
    if (!jobText.trim()) return res.status(400).json({ error: 'A job description is required' });

    const currentText = docModel.toText(row.doc);
    const mode = ['off', 'honest', 'aggressive'].includes(req.body.mode) ? req.body.mode : 'honest';
    const { addedSkills, matchedSkills } = buildTailoredText(currentText, jobText, mode);

    const corpus = await corpusFor(req.user.id, currentText);

    /*
     * The tension this resolves.
     *
     * The deterministic engine exists to add job keywords the resume lacks.
     * The guard forbids any claim not traceable to the user's own material.
     * Those are in direct conflict: a skill the JD wants and the resume lacks
     * is, by definition, untraceable - so run naively, tailoring proposes
     * nothing at all.
     *
     * Both are right, and the missing step is consent. A skill the user
     * genuinely has but never listed is theirs to confirm; one they do not have
     * must never appear. So an untraceable skill becomes a QUESTION rather than
     * a silent addition or a silent drop - the same ask-once-reuse-forever
     * shape the screening questions already use. Confirming it writes the skill
     * to their profile, which makes it traceable, and only then can it land.
     */
    const checked = verifyAdditions(addedSkills.map((t) => ({ text: t, kind: 'skill' })), corpus);
    const allowed = checked.filter((c) => c.ok);
    const blocked = checked.filter((c) => !c.ok);

    let skills = row.doc.sections.find((s) => s.type === 'skills');
    if (!skills && allowed.length) {
      skills = { id: docModel.nid('sec'), type: 'skills', title: 'Skills', items: [] };
      row.doc.sections.push(skills);
    }
    if (skills && allowed.length) {
      const group = skills.items[0] || (skills.items[0] = { id: docModel.nid('grp'), name: null, skills: [] });
      for (const a of allowed) {
        if (group.skills.some((s) => s.text.toLowerCase() === a.text.toLowerCase())) continue;
        group.skills.push({ id: docModel.nid('skl'), text: a.text, origin: 'tailored', status: 'pending' });
      }
    }

    await saveDoc(req.user.id, row.id, row.doc);
    const style = { ...DEFAULT_STYLE, ...(row.style || {}) };

    res.json({
      ok: true,
      doc: row.doc,
      html: renderHtml(row.doc, style),
      pendingCount: docModel.countPending(row.doc),
      proposed: allowed.map((a) => a.text),
      matchedSkills,
      /*
       * Blocked suggestions are reported, not hidden. If the guard refused
       * something, the user should know it was considered and why - silently
       * dropping it looks like the tailoring simply found nothing.
       */
      /*
       * Not "blocked" as in discarded - these are asked about. Reported so the
       * user sees what the job wants that their resume does not claim, and can
       * confirm anything that is genuinely theirs.
       */
      needsConfirmation: blocked.map((b) => ({
        skill: b.text,
        askedBecause: `${job ? job.title : 'This job'} asks for it and your resume does not mention it.`,
        why: b.violations[0]?.why,
      })),
      job: job ? { id: job.id, title: job.title, company: job.company_name } : null,
    });
  } catch (err) {
    console.error('POST tailor-live failed:', err.message);
    res.status(500).json({ error: 'Could not tailor that resume' });
  }
});

/*
 * Editor instructions.
 *
 * Deterministic today, and the UI says so. Every operation is expressed as an
 * addition or a formatting change, then passed through the guard exactly as an
 * LLM's output will be - so wiring a model later swaps the proposal step
 * without touching the enforcement step.
 */
const INSTRUCTIONS = [
  {
    id: 'add_skill',
    match: /^(?:add|include)\s+(.+?)\s+(?:to\s+)?(?:my\s+)?skills?$/i,
    describe: 'Add a skill',
  },
  {
    id: 'shorten_bullets',
    match: /^(?:shorten|tighten|make).*(?:bullets?|concise)/i,
    describe: 'Flag bullets that run long',
  },
];

router.post('/:id/instruct', async (req, res) => {
  try {
    const row = await loadDoc(req.user.id, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Resume not found' });
    const text = String(req.body.instruction || '').trim();
    if (!text) return res.status(400).json({ error: 'An instruction is required' });

    const currentText = docModel.toText(row.doc);
    const corpus = await corpusFor(req.user.id, currentText);

    const addSkill = text.match(INSTRUCTIONS[0].match);
    if (addSkill) {
      const skill = addSkill[1].replace(/^["']|["']$/g, '').trim();
      const [checked] = verifyAdditions([{ text: skill, kind: 'skill' }], corpus);
      if (!checked.ok) {
        return res.json({
          ok: false,
          reply: `I can't add "${skill}". ${checked.violations[0]?.why} Add it to your profile first if it is genuinely yours.`,
        });
      }
      let skills = row.doc.sections.find((s) => s.type === 'skills');
      if (!skills) {
        skills = { id: docModel.nid('sec'), type: 'skills', title: 'Skills', items: [] };
        row.doc.sections.push(skills);
      }
      const group = skills.items[0] || (skills.items[0] = { id: docModel.nid('grp'), name: null, skills: [] });
      group.skills.push({ id: docModel.nid('skl'), text: skill, origin: 'suggested', status: 'pending' });
      await saveDoc(req.user.id, row.id, row.doc);
      return res.json({
        ok: true,
        reply: `Added "${skill}" as a suggestion. Accept it in the preview to keep it.`,
        doc: row.doc,
        html: renderHtml(row.doc, { ...DEFAULT_STYLE, ...(row.style || {}) }),
        pendingCount: docModel.countPending(row.doc),
      });
    }

    if (INSTRUCTIONS[1].match.test(text)) {
      const long = docModel.walk(row.doc)
        .filter((n) => n.kind === 'bullet' && (n.node.text || '').length > 170)
        .map((n) => ({ id: n.node.id, text: n.node.text }));
      return res.json({
        ok: true,
        reply: long.length
          ? `${long.length} bullet${long.length === 1 ? '' : 's'} run past two lines. I have highlighted them — rewriting them needs the AI editor, which is not wired up yet, so edit them directly for now.`
          : 'No bullets are running long.',
        highlight: long.map((l) => l.id),
      });
    }

    return res.json({
      ok: false,
      reply: 'I only handle specific instructions for now — "add X to skills", or "shorten my bullets". '
        + 'Conversational editing needs an AI model, which is not connected yet.',
      supported: INSTRUCTIONS.map((i) => i.describe),
    });
  } catch (err) {
    console.error('POST instruct failed:', err.message);
    res.status(500).json({ error: 'Could not process that instruction' });
  }
});

/*
 * Confirm a skill the job asked for and the resume did not claim.
 *
 * Writes it to user_skills FIRST. That is the whole point: after this the skill
 * is part of the user's own material, so the guard will let it into the resume
 * on its own terms rather than being waved through as a special case. There is
 * no path here that adds a skill to a resume without it becoming true of the
 * user's profile at the same time.
 */
router.post('/:id/confirm-skill', async (req, res) => {
  try {
    const row = await loadDoc(req.user.id, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Resume not found' });
    const skill = String(req.body.skill || '').trim();
    if (!skill) return res.status(400).json({ error: 'A skill is required' });
    if (req.body.have === false) {
      return res.json({ ok: true, added: false, reply: `Left "${skill}" off. It will not be suggested again for this resume.` });
    }

    await query(
      'INSERT INTO user_skills (user_id, skill) VALUES ($1, $2) ON CONFLICT (user_id, skill) DO NOTHING',
      [req.user.id, skill.slice(0, 120)]
    );

    // Re-check against the now-updated corpus rather than trusting the write.
    const corpus = await corpusFor(req.user.id, docModel.toText(row.doc));
    const [verified] = verifyAdditions([{ text: skill, kind: 'skill' }], corpus);
    if (!verified.ok) {
      return res.status(409).json({ ok: false, error: verified.violations[0]?.why || 'Still not traceable' });
    }

    let skills = row.doc.sections.find((s) => s.type === 'skills');
    if (!skills) {
      skills = { id: docModel.nid('sec'), type: 'skills', title: 'Skills', items: [] };
      row.doc.sections.push(skills);
    }
    const group = skills.items[0] || (skills.items[0] = { id: docModel.nid('grp'), name: null, skills: [] });
    if (!group.skills.some((s) => s.text.toLowerCase() === skill.toLowerCase())) {
      group.skills.push({ id: docModel.nid('skl'), text: skill, origin: 'tailored', status: 'pending' });
    }
    await saveDoc(req.user.id, row.id, row.doc);

    res.json({
      ok: true, added: true,
      doc: row.doc,
      html: renderHtml(row.doc, { ...DEFAULT_STYLE, ...(row.style || {}) }),
      pendingCount: docModel.countPending(row.doc),
      reply: `Added "${skill}" to your profile and proposed it on this resume. Accept it in the preview to keep it.`,
    });
  } catch (err) {
    console.error('POST confirm-skill failed:', err.message);
    res.status(500).json({ error: 'Could not confirm that skill' });
  }
});

// Edit rules the user has set. Shown back to them so a forgotten rule is not
// quietly shaping the resume.
router.get('/edit-rules', async (req, res) => {
  const r = await query('SELECT * FROM resume_edit_rules WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ rules: r.rows });
});

router.post('/edit-rules', async (req, res) => {
  const rule = String(req.body.rule || '').trim();
  if (!rule) return res.status(400).json({ error: 'A rule is required' });
  const r = await query(
    'INSERT INTO resume_edit_rules (user_id, rule) VALUES ($1, $2) RETURNING *',
    [req.user.id, rule.slice(0, 400)]
  );
  res.status(201).json({ rule: r.rows[0] });
});

router.delete('/edit-rules/:id', async (req, res) => {
  await query('DELETE FROM resume_edit_rules WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// Version management: duplicate a resume as a named variant.
router.post('/:id/duplicate', async (req, res) => {
  try {
    const row = await loadDoc(req.user.id, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Resume not found' });
    const name = String(req.body.name || 'New version').slice(0, 120);
    const r = await query(
      `INSERT INTO resumes (user_id, original_file_text, label, version_name, template, doc, style, is_default)
       SELECT user_id, original_file_text, label, $2, template, doc, style, FALSE
         FROM resumes WHERE id = $1 AND user_id = $3
       RETURNING id, version_name`,
      [row.id, name, req.user.id]
    );
    res.status(201).json({ ok: true, resume: r.rows[0] });
  } catch (err) {
    console.error('POST duplicate failed:', err.message);
    res.status(500).json({ error: 'Could not duplicate that resume' });
  }
});

/* ------------------------------------------------------------------ *
 * Feature 8 — saved resume versions per company
 *
 * A user tailors for one role at a company and wants that version back when
 * the next role there opens. Stored as a REFERENCE to the tailored_resumes row
 * rather than a copy of the text: duplicating resume bodies per company is how
 * a 500MB volume fills.
 *
 * Every refusal carries a machine-readable `reason` AND a sentence, because a
 * failure the UI cannot render is a failure the user is never told about -
 * which this codebase has now shipped twice.
 * ------------------------------------------------------------------ */

router.get('/company-versions', async (req, res) => {
  try {
    /*
     * Through services/requestBounds, not clamped inline. The ceiling lives in
     * one place precisely so a new endpoint cannot quietly pick its own - an
     * unbounded parameter took production down for eight minutes, and the fix
     * was the class, not the instance.
     */
    const bounded = boundPaging(req.query.page, req.query.limit, { defLimit: 50 });
    const { limit, page, offset } = bounded;
    const r = await query(
      `SELECT v.id, v.company_key, v.company_name, v.label, v.created_at, v.updated_at,
              v.tailored_resume_id,
              t.ats_score, t.job_id, t.source, t.confirmed_at,
              j.title AS job_title
         FROM company_resume_versions v
         JOIN tailored_resumes t ON t.id = v.tailored_resume_id
         LEFT JOIN jobs j ON j.id = t.job_id
        WHERE v.user_id = $1
        ORDER BY v.updated_at DESC, v.id DESC
        LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    res.json({
      page,
      limit,
      /*
       * States the clamp. A silently shortened page is indistinguishable from
       * a user who genuinely has that few saved versions, and a client would
       * page forever into rows it will never be given.
       */
      paging: {
        page, limit, maxPage: bounded.maxPage,
        requestedPage: bounded.requestedPage,
        clamped: bounded.clamped,
        limitClamped: bounded.limitClamped,
      },
      versions: r.rows.map((v) => ({
        id: v.id,
        companyName: v.company_name,
        companyKey: v.company_key,
        label: v.label,
        tailoredResumeId: v.tailored_resume_id,
        atsScore: v.ats_score,
        jobId: v.job_id,
        // Null rather than guessed: a pasted JD has no verified posting behind
        // it and the tracker refuses to invent one here too.
        jobTitle: v.job_title,
        jobTitleKnown: v.job_title != null,
        source: v.source,
        confirmed: v.confirmed_at != null,
        createdAt: v.created_at,
        updatedAt: v.updated_at,
      })),
    });
  } catch (err) {
    console.error('List company versions error:', err);
    res.status(500).json({ error: 'Could not load your saved versions' });
  }
});

router.post('/company-versions', async (req, res) => {
  try {
    const tailoredResumeId = parseInt(req.body.tailoredResumeId, 10);
    if (!Number.isInteger(tailoredResumeId) || tailoredResumeId < 1) {
      return res.status(400).json({
        error: 'Which version?',
        reason: 'missing_tailored_resume',
        detail: 'Send the id of the tailored resume you want to save.',
      });
    }
    const label = req.body.label == null ? null : String(req.body.label).trim().slice(0, 120) || null;

    const owned = await query(
      `SELECT t.id, t.job_id, t.source, j.company_name
         FROM tailored_resumes t
         LEFT JOIN jobs j ON j.id = t.job_id
        WHERE t.id = $1 AND t.user_id = $2`,
      [tailoredResumeId, req.user.id]
    );
    if (!owned.rows.length) {
      return res.status(404).json({
        error: 'No such tailored resume',
        reason: 'not_found',
        detail: 'That version does not exist, or it belongs to another account.',
      });
    }

    const row = owned.rows[0];
    const key = companyKeyFor(row.company_name);
    if (!key.ok) {
      /*
       * 422, not 400: the request is well formed and the user did nothing
       * wrong - the company simply is not known, and inventing one to make the
       * save succeed is the fabrication this product refuses everywhere else.
       */
      return res.status(422).json({
        error: 'This version cannot be saved against a company',
        reason: key.reason,
        detail: key.detail,
      });
    }

    const saved = await query(
      `INSERT INTO company_resume_versions
         (user_id, company_key, company_name, tailored_resume_id, label)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, company_key) DO UPDATE
         SET tailored_resume_id = EXCLUDED.tailored_resume_id,
             company_name = EXCLUDED.company_name,
             label = EXCLUDED.label,
             updated_at = CURRENT_TIMESTAMP
       RETURNING id, company_name, label, created_at, updated_at,
                 (xmax <> 0) AS replaced`,
      [req.user.id, key.key, key.name, tailoredResumeId, label]
    );

    const v = saved.rows[0];
    res.status(201).json({
      id: v.id,
      companyName: v.company_name,
      label: v.label,
      // Said plainly, because the user had one and now does not. A silent
      // overwrite of their own earlier work is the thing to avoid.
      replaced: v.replaced === true,
      createdAt: v.created_at,
      updatedAt: v.updated_at,
    });
  } catch (err) {
    console.error('Save company version error:', err);
    res.status(500).json({ error: 'Could not save that version' });
  }
});

router.delete('/company-versions/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(404).json({ error: 'No such saved version' });
  }
  try {
    const r = await query(
      'DELETE FROM company_resume_versions WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No such saved version' });
    res.json({ deleted: r.rows[0].id });
  } catch (err) {
    console.error('Delete company version error:', err);
    res.status(500).json({ error: 'Could not delete that version' });
  }
});

/* ------------------------------------------------------------------ *
 * Feature 9 — paste a block of answers instead of typing them one by one
 *
 * Two endpoints on purpose: PARSE shows what was understood, SAVE writes what
 * the user confirmed. A single endpoint that parsed and wrote would be asking
 * someone to trust a parser they have not seen the output of, on their own
 * answers, which then go out under their name.
 * ------------------------------------------------------------------ */

router.post('/screening-answers/parse', async (req, res) => {
  try {
    const parsed = parseScreeningPaste(req.body.text);

    if (!parsed.pairs.length && !parsed.refused.length) {
      return res.status(422).json({
        error: 'Nothing recognisable in that paste',
        reason: 'no_pairs',
        detail: 'Expected question and answer pairs - "Q: … / A: …", a question on one '
          + 'line with the answer on the next, or "Question? Answer" on one line.',
        ...parsed,
      });
    }

    res.json(parsed);
  } catch (err) {
    console.error('Parse screening paste error:', err);
    res.status(500).json({ error: 'Could not read that paste' });
  }
});

router.post('/screening-answers/bulk', async (req, res) => {
  try {
    const incoming = Array.isArray(req.body.pairs) ? req.body.pairs.slice(0, MAX_PAIRS) : [];
    if (!incoming.length) {
      return res.status(400).json({
        error: 'Nothing to save',
        reason: 'no_pairs',
        detail: 'Send the question and answer pairs you confirmed from the preview.',
      });
    }

    /*
     * Re-checked SERVER-SIDE, not trusted from the client.
     *
     * The preview already separated the demographic questions, but the client
     * is free to post whatever it likes. The rule is that this product never
     * holds an answer to a demographic question, and a rule enforced only in
     * the preview is a rule enforced nowhere.
     */
    const recheck = parseScreeningPaste(
      incoming.map((p) => `Q: ${String(p.question || '')}\nA: ${String(p.answer || '')}`).join('\n\n')
    );

    const saved = [];
    for (const pair of recheck.pairs) {
      // eslint-disable-next-line no-await-in-loop
      const r = await query(
        `INSERT INTO screening_answers (user_id, job_id, question, answer)
         VALUES ($1, NULL, $2, $3) RETURNING id`,
        [req.user.id, pair.question, pair.answer]
      );
      saved.push({ id: r.rows[0].id, question: pair.question });
    }

    res.status(201).json({
      saved: saved.length,
      answers: saved,
      // Named, with the reason, so a client that posted them learns why they
      // did not land rather than seeing a count that quietly disagrees.
      refused: recheck.refused,
    });
  } catch (err) {
    console.error('Bulk screening answers error:', err);
    res.status(500).json({ error: 'Could not save those answers' });
  }
});

module.exports = router;
