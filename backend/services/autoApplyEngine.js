const { query } = require('../db');
const { candidateOrderBySql } = require('./jobOrder');
const { calculateMatchesForUser } = require('./matchingEngine');
const { generateCoverLetterContent } = require('./coverLetterGenerator');
const { buildTailoredText, diffTailoring } = require('./resumeTailorEngine');
const { fixMojibake } = require('./apis/textSanitizer');

const normalize = (s) => (s || '').trim().toLowerCase();
const mentionsCoverLetter = (text) => /cover letter/i.test(text || '');

// Runs Full Auto Apply for a single user: applies to top-scoring, unapplied
// job matches on their behalf, respecting their daily limit, minimum match
// score, blacklisted companies (skipped entirely), and dream companies
// (flagged for manual confirmation instead of auto-submitted). Also honors
// resume tailoring mode, conditional cover letters, and the review-before-
// submit queue - all real user_preferences, not just for manual applies.
const runAutoApplyForUser = async (user) => {
  const prefsResult = await query('SELECT * FROM user_preferences WHERE user_id = $1', [user.id]);
  const prefs = prefsResult.rows[0];
  if (!prefs || !prefs.auto_apply_enabled) {
    return { applied: 0, flagged: 0, skipped: 0, pendingReview: 0 };
  }

  const dailyLimit = prefs.auto_apply_limit_per_day || 5;
  const minScore = prefs.auto_apply_min_score != null ? Number(prefs.auto_apply_min_score) : 0.75;
  const blacklist = (prefs.blacklist_companies || []).map(normalize);
  const dreamCompanies = (prefs.dream_companies || []).map(normalize);
  const resumeTailorMode = prefs.resume_tailor_mode || 'honest';
  const autoTailorResume = prefs.auto_tailor_resume !== false;
  const coverLetterMode = prefs.cover_letter_mode || 'always';
  const reviewBeforeSubmit = !!prefs.review_before_submit;

  const sentTodayResult = await query(
    `SELECT COUNT(*) as count FROM applications
     WHERE user_id = $1 AND submitted_by = 'auto_pilot' AND applied_at >= CURRENT_DATE`,
    [user.id]
  );
  const sentToday = parseInt(sentTodayResult.rows[0].count, 10);
  let remainingSlots = dailyLimit - sentToday;
  if (remainingSlots <= 0) {
    return { applied: 0, flagged: 0, skipped: 0, pendingReview: 0 };
  }

  const candidatesResult = await query(
    `SELECT jm.job_id, jm.overall_score, j.title, j.company_name, j.description, j.requirements
     FROM job_matches jm
     JOIN jobs j ON jm.job_id = j.id
     WHERE jm.user_id = $1 AND jm.overall_score >= $2 AND j.is_active = true
       AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.user_id = jm.user_id AND a.job_id = jm.job_id)
     -- A7.8: Auto-Pilot cuts this list at 50. Without a unique final key,
     -- which 50 employers it considers is not reproducible between runs.
     ORDER BY ${candidateOrderBySql('jm')}
     LIMIT 50`,
    [user.id, minScore]
  );

  const [userResult, skillsResult, resumeResult] = await Promise.all([
    query('SELECT full_name, title FROM users WHERE id = $1', [user.id]),
    query('SELECT skill FROM user_skills WHERE user_id = $1 ORDER BY skill, id LIMIT 5', [user.id]),
    query(
      `SELECT id, original_file_text FROM resumes WHERE user_id = $1
       ORDER BY is_default DESC, updated_at DESC, id DESC LIMIT 1`,
      [user.id]
    ),
  ]);
  const profile = userResult.rows[0] || {};
  const skills = skillsResult.rows.map((r) => r.skill);
  const defaultResume = resumeResult.rows[0];

  let applied = 0;
  let flagged = 0;
  let skipped = 0;
  let pendingReview = 0;

  for (const candidate of candidatesResult.rows) {
    if (remainingSlots <= 0) break;
    candidate.title = fixMojibake(candidate.title);
    candidate.company_name = fixMojibake(candidate.company_name);
    const companyKey = normalize(candidate.company_name);

    if (blacklist.includes(companyKey)) {
      skipped++;
      continue;
    }

    if (dreamCompanies.includes(companyKey)) {
      await query(
        `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
         VALUES ($1, 'auto_apply_needs_confirmation', $2, $3)`,
        [user.id, candidate.job_id, JSON.stringify({ job_title: candidate.title, company_name: candidate.company_name })]
      );
      flagged++;
      continue;
    }

    const jobText = `${candidate.title} ${candidate.description || ''} ${candidate.requirements || ''}`;

    // Cover letter: 'always' (default), 'when_requested' (only if the
    // posting itself mentions one), or 'off'.
    let coverLetterId = null;
    let coverLetterText = null;
    const shouldGenerateCoverLetter = coverLetterMode === 'always'
      || (coverLetterMode === 'when_requested' && mentionsCoverLetter(jobText));
    if (shouldGenerateCoverLetter) {
      coverLetterText = generateCoverLetterContent({
        name: profile.full_name,
        userTitle: profile.title,
        skills,
        jobTitle: candidate.title,
        companyName: candidate.company_name,
      });
      const saved = await query(
        `INSERT INTO cover_letters (user_id, job_id, content) VALUES ($1, $2, $3) RETURNING id`,
        [user.id, candidate.job_id, coverLetterText]
      );
      coverLetterId = saved.rows[0].id;
    }

    // Resume tailoring: auto-confirmed (no per-run human review of the
    // diff - that's what "review before submit" is for) using whichever
    // keyword-injection mode the user has selected.
    let tailoredResumeId = null;
    if (autoTailorResume && defaultResume?.original_file_text?.trim()) {
      const { tailoredText } = buildTailoredText(defaultResume.original_file_text, jobText, resumeTailorMode);
      const diff = diffTailoring(defaultResume.original_file_text, tailoredText);
      const saved = await query(
        `INSERT INTO tailored_resumes
         (user_id, resume_id, job_id, tailored_summary, original_snapshot, diff_json, final_text, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP) RETURNING id`,
        [user.id, defaultResume.id, candidate.job_id, tailoredText, defaultResume.original_file_text, JSON.stringify(diff), tailoredText]
      );
      tailoredResumeId = saved.rows[0].id;
    }

    const applicationStatus = reviewBeforeSubmit ? 'pending_review' : 'applied';

    const inserted = await query(
      `INSERT INTO applications (user_id, job_id, status, submitted_by, cover_letter_id, cover_letter, tailored_resume_id)
       VALUES ($1, $2, $3, 'auto_pilot', $4, $5, $6)
       ON CONFLICT (user_id, job_id) DO NOTHING RETURNING id`,
      [user.id, candidate.job_id, applicationStatus, coverLetterId, coverLetterText, tailoredResumeId]
    );

    if (!inserted.rows.length) continue; // race with a manual apply - don't double count

    await query(
      `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
       VALUES ($1, $2, $3, $4)`,
      [
        user.id,
        reviewBeforeSubmit ? 'auto_apply_pending_review' : 'auto_applied',
        candidate.job_id,
        JSON.stringify({ job_title: candidate.title, company_name: candidate.company_name, score: candidate.overall_score }),
      ]
    );

    if (reviewBeforeSubmit) pendingReview++; else applied++;
    remainingSlots--;
  }

  return { applied, flagged, skipped, pendingReview };
};

const runAutoApplyForAllUsers = async () => {
  const usersResult = await query(
    `SELECT u.id FROM users u
     JOIN user_preferences up ON up.user_id = u.id
     WHERE up.auto_apply_enabled = true`,
    []
  );

  let totalApplied = 0;
  let totalFlagged = 0;
  let totalPendingReview = 0;
  let usersProcessed = 0;

  for (const user of usersResult.rows) {
    try {
      await calculateMatchesForUser(user.id);
      const result = await runAutoApplyForUser(user);
      totalApplied += result.applied;
      totalFlagged += result.flagged;
      totalPendingReview += result.pendingReview;
      usersProcessed++;
    } catch (err) {
      console.error(`Auto-apply error for user ${user.id}:`, err.message);
    }
  }

  return { usersProcessed, totalApplied, totalFlagged, totalPendingReview };
};

module.exports = { runAutoApplyForUser, runAutoApplyForAllUsers };
