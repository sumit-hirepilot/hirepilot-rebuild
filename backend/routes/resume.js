const express = require('express');
const multer = require('multer');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { extractTextFromFile } = require('../services/fileTextExtractor');
const { parseResume } = require('../services/resumeParser');
const { generateCoverLetterContent } = require('../services/coverLetterGenerator');
const { fixMojibake } = require('../services/apis/textSanitizer');
const { buildTailoredText, diffTailoring, applyAcceptedChanges } = require('../services/resumeTailorEngine');
const PDFDocument = require('pdfkit');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

router.use(verifyToken);

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'of', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that',
  'these', 'those', 'we', 'you', 'your', 'our', 'it', 'as', 'by', 'from',
  'will', 'would', 'should', 'can', 'could', 'have', 'has', 'had', 'do',
  'does', 'did', 'not', 'no', 'so', 'if', 'than', 'then', 'about', 'into',
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .match(/[a-z0-9']{2,}/g) || [];
}

function uniqueKeywords(text) {
  const tokens = tokenize(text).filter((t) => !STOPWORDS.has(t));
  return Array.from(new Set(tokens));
}

// Real keyword-overlap ATS check (no LLM configured for this app - this is
// honest word-tokenization matching, not a fabricated AI score).
function checkAts(jobDescription, resumeText) {
  const jobKeywords = uniqueKeywords(jobDescription);
  // Filter stopwords from the resume side too - otherwise short connector
  // words (e.g. "in") false-positive match as substrings of unrelated,
  // longer job keywords (e.g. "prototyping" contains "in").
  const resumeTokens = tokenize(resumeText).filter((t) => !STOPWORDS.has(t));

  const matched = [];
  const missing = [];

  for (const kw of jobKeywords) {
    const found = resumeTokens.some((r) => {
      const shorter = r.length < kw.length ? r : kw;
      if (shorter.length < 3) return r === kw;
      return r.includes(kw) || kw.includes(r);
    });
    if (found) matched.push(kw);
    else missing.push(kw);
  }

  const score = jobKeywords.length ? Math.round((matched.length / jobKeywords.length) * 100) : 0;

  const tips = [];
  if (missing.length) {
    tips.push(`Add these keywords if genuinely true: ${missing.slice(0, 8).join(', ')}.`);
  }
  tips.push('Add quantifiable metrics (%, $, time saved) to strengthen impact.');
  tips.push('Use bullet points so an ATS parser can segment your experience.');
  if (tokenize(resumeText).length < 40) {
    tips.push('Your resume text looks short. Add more relevant detail per role.');
  }

  return { score, matched, missing, tips, totalKeywords: jobKeywords.length };
}

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
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let text;
    try {
      text = await extractTextFromFile(req.file.buffer, req.file.mimetype, req.file.originalname);
    } catch (err) {
      return res.status(422).json({ error: err.message });
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

    res.json({ message: 'Profile updated from resume', skillsAdded: skills.length, experienceAdded: experience.length });
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
      `SELECT tr.id, tr.tailored_summary, tr.highlighted_skills, tr.ats_score, tr.created_at,
              tr.confirmed_at, tr.diff_json, tr.original_snapshot, tr.final_text,
              j.title as job_title, j.company_name
       FROM tailored_resumes tr
       JOIN jobs j ON tr.job_id = j.id
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
router.post('/tailor', async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });

    const [jobResult, resumeResult] = await Promise.all([
      query('SELECT title, company_name, description, requirements FROM jobs WHERE id = $1', [jobId]),
      query(
        `SELECT id, original_file_text FROM resumes WHERE user_id = $1
         ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
        [req.user.id]
      ),
    ]);

    if (!jobResult.rows.length) return res.status(404).json({ error: 'Job not found' });
    if (!resumeResult.rows.length || !resumeResult.rows[0].original_file_text?.trim()) {
      return res.status(400).json({ error: 'Save or upload a resume first (Resume Manager tab) before tailoring for a job.' });
    }

    const job = jobResult.rows[0];
    job.title = fixMojibake(job.title);
    job.company_name = fixMojibake(job.company_name);
    const resume = resumeResult.rows[0];
    const originalText = resume.original_file_text;

    const jobText = `${job.title} ${job.description || ''} ${job.requirements || ''}`;
    const { tailoredText, addedSkills, matchedSkills } = buildTailoredText(originalText, jobText);
    const diff = diffTailoring(originalText, tailoredText);
    const { score } = checkAts(jobText, tailoredText);

    const saved = await query(
      `INSERT INTO tailored_resumes
       (user_id, resume_id, job_id, tailored_summary, highlighted_skills, ats_score, original_snapshot, diff_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at`,
      [req.user.id, resume.id, jobId, tailoredText, matchedSkills, score, originalText, JSON.stringify(diff)]
    );

    await query(
      `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
       VALUES ($1, 'resume_tailored', $2, $3)`,
      [req.user.id, jobId, JSON.stringify({ job_title: job.title, company_name: job.company_name })]
    );

    res.status(201).json({
      id: saved.rows[0].id,
      originalText,
      tailoredText,
      diff,
      addedSkills,
      matchedSkills,
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
router.get('/tailored/:id/pdf', async (req, res) => {
  try {
    const result = await query(
      `SELECT tr.final_text, tr.tailored_summary, j.title as job_title, j.company_name
       FROM tailored_resumes tr JOIN jobs j ON tr.job_id = j.id
       WHERE tr.id = $1 AND tr.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tailored resume not found' });
    const row = result.rows[0];
    const text = row.final_text || row.tailored_summary || '';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="tailored-resume-${req.params.id}.pdf"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);
    doc.fontSize(11).font('Helvetica');
    text.split('\n').forEach((line) => {
      if (/^[A-Z][A-Z\s&/]{3,}$/.test(line.trim()) && line.trim().length > 3) {
        doc.moveDown(0.5).font('Helvetica-Bold').fontSize(12).text(line.trim());
        doc.font('Helvetica').fontSize(11);
      } else {
        doc.text(line);
      }
    });
    doc.end();
  } catch (err) {
    console.error('Generate tailored PDF error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

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
    res.json(result);
  } catch (err) {
    console.error('ATS check error:', err);
    res.status(500).json({ error: 'Failed to check resume' });
  }
});

module.exports = router;
