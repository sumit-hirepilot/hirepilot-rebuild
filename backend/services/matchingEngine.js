const { query } = require('../db');

const extractSkills = (text) => {
  if (!text) return [];
  const skillsPattern = /(?:skills?|technologies?|required|must know|expertise in|proficient in)[:\s]+([\w\s,+#.]+)/gi;
  const matches = text.matchAll(skillsPattern);
  const skills = new Set();

  for (const match of matches) {
    const skillsList = match[1].split(/[,\s]+/).filter(s => s.length > 2);
    skillsList.forEach(s => skills.add(s.toLowerCase()));
  }

  return Array.from(skills);
};

const calculateSkillsScore = (userSkills, requiredSkills) => {
  if (!userSkills.length || !requiredSkills.length) return 0.5;

  const userSkillsLower = userSkills.map(s => s.toLowerCase());
  const matchedSkills = requiredSkills.filter(skill =>
    userSkillsLower.some(userSkill => userSkill.includes(skill) || skill.includes(userSkill))
  );

  return matchedSkills.length / requiredSkills.length;
};

const calculateExperienceScore = async (userId, jobDescription) => {
  try {
    const result = await query(
      'SELECT COALESCE(AVG(EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM start_date)), 0) as avg_years FROM user_experience WHERE user_id = $1 AND (end_date IS NULL OR end_date >= CURRENT_DATE)',
      [userId]
    );

    const userYears = result.rows[0]?.avg_years || 0;

    // Extract experience requirement from job description
    const expPattern = /(\d+)\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/i;
    const expMatch = jobDescription?.match(expPattern);
    const requiredYears = expMatch ? parseInt(expMatch[1]) : 3;

    // Score: 1.0 if meets requirement, decreases if below
    if (userYears >= requiredYears) return 1.0;
    return Math.max(0.3, userYears / requiredYears);
  } catch (err) {
    console.error('Experience score calculation error:', err);
    return 0.5;
  }
};

const calculateLocationScore = async (userId, jobLocation) => {
  try {
    const result = await query(
      'SELECT preferred_locations FROM user_preferences WHERE user_id = $1',
      [userId]
    );

    if (!result.rows.length || !result.rows[0].preferred_locations) return 0.7;

    const preferredLocs = result.rows[0].preferred_locations;

    // Check if job location matches preferred locations
    if (preferredLocs.includes('Remote') && jobLocation?.toLowerCase().includes('remote')) {
      return 1.0;
    }

    const matchFound = preferredLocs.some(loc =>
      jobLocation?.toLowerCase().includes(loc.toLowerCase())
    );

    return matchFound ? 1.0 : 0.6;
  } catch (err) {
    console.error('Location score calculation error:', err);
    return 0.7;
  }
};

const calculateSalaryScore = async (userId, salaryMin, salaryMax) => {
  try {
    if (!salaryMin && !salaryMax) return 0.7;

    const result = await query(
      'SELECT min_salary, max_salary FROM user_preferences WHERE user_id = $1',
      [userId]
    );

    if (!result.rows.length) return 0.7;

    const { min_salary: userMin, max_salary: userMax } = result.rows[0];

    if (!userMin && !userMax) return 0.7;

    const jobMin = salaryMin || 0;
    const jobMax = salaryMax || jobMin * 1.5;

    // If job salary is within user's range, perfect score
    if (jobMin >= userMin && jobMax <= userMax) {
      return 1.0;
    }

    // Partial credit if there's overlap
    const overlap = Math.max(0, Math.min(jobMax, userMax) - Math.max(jobMin, userMin));
    if (overlap > 0) {
      return Math.min(1.0, overlap / (userMax - userMin));
    }

    // Penalty if salary is below user's minimum
    return Math.max(0.4, jobMax / userMin);
  } catch (err) {
    console.error('Salary score calculation error:', err);
    return 0.7;
  }
};

const calculateJobMatch = async (userId, jobId) => {
  try {
    // Get job details
    const jobResult = await query(
      'SELECT title, description, requirements, salary_min, salary_max, location FROM jobs WHERE id = $1',
      [jobId]
    );

    if (!jobResult.rows.length) {
      throw new Error('Job not found');
    }

    const job = jobResult.rows[0];

    // Get user skills
    const skillsResult = await query(
      'SELECT skill FROM user_skills WHERE user_id = $1',
      [userId]
    );

    const userSkills = skillsResult.rows.map(r => r.skill);

    // Extract required skills from job
    const jobText = `${job.title} ${job.description} ${job.requirements}`;
    const requiredSkills = extractSkills(jobText);

    // Calculate individual scores
    const skillsScore = calculateSkillsScore(userSkills, requiredSkills);
    const experienceScore = await calculateExperienceScore(userId, jobText);
    const locationScore = await calculateLocationScore(userId, job.location);
    const salaryScore = await calculateSalaryScore(userId, job.salary_min, job.salary_max);

    // Weighted overall score
    const overallScore = (
      skillsScore * 0.40 +
      experienceScore * 0.30 +
      locationScore * 0.20 +
      salaryScore * 0.10
    );

    return {
      overall_score: Math.min(1.0, Math.max(0, overallScore)),
      skills_match_score: skillsScore,
      experience_match_score: experienceScore,
      location_match_score: locationScore,
      salary_match_score: salaryScore,
      match_details: {
        required_skills: requiredSkills,
        user_skills: userSkills,
        matched_skills: requiredSkills.filter(skill =>
          userSkills.some(userSkill => userSkill.toLowerCase().includes(skill.toLowerCase()))
        ),
      },
    };
  } catch (err) {
    console.error('Job match calculation error:', err);
    throw err;
  }
};

const calculateMatchesForUser = async (userId) => {
  try {
    // Get all active jobs
    const jobsResult = await query(
      'SELECT id FROM jobs WHERE is_active = true',
      []
    );

    const jobs = jobsResult.rows;
    let matchesCreated = 0;

    for (const job of jobs) {
      try {
        const matchScore = await calculateJobMatch(userId, job.id);

        // Only store matches with score > 0.3 to avoid noise
        if (matchScore.overall_score > 0.3) {
          await query(
            `INSERT INTO job_matches (user_id, job_id, overall_score, skills_match_score,
             experience_match_score, location_match_score, salary_match_score, match_details)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (user_id, job_id) DO UPDATE SET
            overall_score = $3, skills_match_score = $4, experience_match_score = $5,
            location_match_score = $6, salary_match_score = $7, match_details = $8,
            calculated_at = CURRENT_TIMESTAMP`,
            [
              userId,
              job.id,
              matchScore.overall_score,
              matchScore.skills_match_score,
              matchScore.experience_match_score,
              matchScore.location_match_score,
              matchScore.salary_match_score,
              JSON.stringify(matchScore.match_details),
            ]
          );

          matchesCreated++;
        }
      } catch (err) {
        console.error(`Error calculating match for job ${job.id}:`, err);
      }
    }

    return { matchesCreated };
  } catch (err) {
    console.error('Calculate matches for user error:', err);
    throw err;
  }
};

module.exports = {
  calculateJobMatch,
  calculateMatchesForUser,
};
