const { query } = require('../db');
const { calculateMatchesForUser } = require('./matchingEngine');
const { generateCoverLetterContent } = require('./coverLetterGenerator');

const normalize = (s) => (s || '').trim().toLowerCase();

// Runs Full Auto Apply for a single user: applies to top-scoring, unapplied
// job matches on their behalf, respecting their daily limit, minimum match
// score, blacklisted companies (skipped entirely), and dream companies
// (flagged for manual confirmation instead of auto-submitted).
const runAutoApplyForUser = async (user) => {
  const prefsResult = await query('SELECT * FROM user_preferences WHERE user_id = $1', [user.id]);
  const prefs = prefsResult.rows[0];
  if (!prefs || !prefs.auto_apply_enabled) {
    return { applied: 0, flagged: 0, skipped: 0 };
  }

  const dailyLimit = prefs.auto_apply_limit_per_day || 5;
  const minScore = prefs.auto_apply_min_score != null ? Number(prefs.auto_apply_min_score) : 0.75;
  const blacklist = (prefs.blacklist_companies || []).map(normalize);
  const dreamCompanies = (prefs.dream_companies || []).map(normalize);

  const sentTodayResult = await query(
    `SELECT COUNT(*) as count FROM applications
     WHERE user_id = $1 AND submitted_by = 'auto_pilot' AND applied_at >= CURRENT_DATE`,
    [user.id]
  );
  const sentToday = parseInt(sentTodayResult.rows[0].count, 10);
  let remainingSlots = dailyLimit - sentToday;
  if (remainingSlots <= 0) {
    return { applied: 0, flagged: 0, skipped: 0 };
  }

  const candidatesResult = await query(
    `SELECT jm.job_id, jm.overall_score, j.title, j.company_name
     FROM job_matches jm
     JOIN jobs j ON jm.job_id = j.id
     WHERE jm.user_id = $1 AND jm.overall_score >= $2 AND j.is_active = true
       AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.user_id = jm.user_id AND a.job_id = jm.job_id)
     ORDER BY jm.overall_score DESC
     LIMIT 50`,
    [user.id, minScore]
  );

  const [userResult, skillsResult] = await Promise.all([
    query('SELECT full_name, title FROM users WHERE id = $1', [user.id]),
    query('SELECT skill FROM user_skills WHERE user_id = $1 ORDER BY skill LIMIT 5', [user.id]),
  ]);
  const profile = userResult.rows[0] || {};
  const skills = skillsResult.rows.map((r) => r.skill);

  let applied = 0;
  let flagged = 0;
  let skipped = 0;

  for (const candidate of candidatesResult.rows) {
    if (remainingSlots <= 0) break;
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

    const content = generateCoverLetterContent({
      name: profile.full_name,
      userTitle: profile.title,
      skills,
      jobTitle: candidate.title,
      companyName: candidate.company_name,
    });

    const coverLetter = await query(
      `INSERT INTO cover_letters (user_id, job_id, content) VALUES ($1, $2, $3) RETURNING id`,
      [user.id, candidate.job_id, content]
    );

    await query(
      `INSERT INTO applications (user_id, job_id, status, submitted_by, cover_letter_id, cover_letter)
       VALUES ($1, $2, 'applied', 'auto_pilot', $3, $4)
       ON CONFLICT (user_id, job_id) DO NOTHING`,
      [user.id, candidate.job_id, coverLetter.rows[0].id, content]
    );

    await query(
      `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
       VALUES ($1, 'auto_applied', $2, $3)`,
      [user.id, candidate.job_id, JSON.stringify({ job_title: candidate.title, company_name: candidate.company_name, score: candidate.overall_score })]
    );

    applied++;
    remainingSlots--;
  }

  return { applied, flagged, skipped };
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
  let usersProcessed = 0;

  for (const user of usersResult.rows) {
    try {
      await calculateMatchesForUser(user.id);
      const result = await runAutoApplyForUser(user);
      totalApplied += result.applied;
      totalFlagged += result.flagged;
      usersProcessed++;
    } catch (err) {
      console.error(`Auto-apply error for user ${user.id}:`, err.message);
    }
  }

  return { usersProcessed, totalApplied, totalFlagged };
};

module.exports = { runAutoApplyForUser, runAutoApplyForAllUsers };
