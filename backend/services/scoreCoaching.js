/*
 * "What would move you from 62% to 80%" — answered from the user's own feed,
 * with the same arithmetic the score itself uses.
 *
 * THE FORMULA MATTERS, and it is not the one people assume.
 *
 *   skillsScore = matchedSkills.length / userSkills.length
 *
 * That is the fraction of the USER'S skills the job mentions — not the
 * fraction of the job's requirements the user meets. The consequence is sharp
 * and counterintuitive:
 *
 *   adding a skill RAISES the score on jobs that mention it
 *   and LOWERS it on every job that does not, because the denominator grows
 *
 * So the obvious coaching — "here are the most common skills you are missing"
 * — can make a user's average score WORSE.
 *
 * WHAT THE ARITHMETIC ACTUALLY SAYS, worked out rather than assumed.
 *
 * For a candidate skill appearing in `a` of `N` jobs, with the user holding
 * `n` skills and `M` = the total number of (job, user-skill) matches across
 * the feed, the change in summed skills score is:
 *
 *   sum_mentions (n - m_j)/(n(n+1))  -  sum_not_mentions m_j/(n(n+1))
 *     = (n*a - M) / (n(n+1))            <- the m_j terms cancel
 *
 * That depends only on `a`. So **ranking by net delta is provably identical
 * to ranking by frequency** — the first cut of this file claimed otherwise,
 * and proving the test red is what exposed it. The claim was wrong and is
 * removed rather than defended.
 *
 * What the delta adds is the part frequency cannot express: the SIGN. From
 * `n*a > M`, a missing skill raises the mean only if
 *
 *   a / N  >  the user's current mean skills score
 *
 * i.e. it must appear in a larger share of the feed than the share of the
 * user's own skills that jobs already mention. Below that line the most
 * common gap in the feed still makes the average worse, and a list ranked by
 * frequency would recommend it with no way to say so. `helpsAbove` reports
 * that threshold, and jobsHelped/jobsHurt report the split.
 *
 * WHAT IT WILL NOT DO
 *
 * - It never invents a skill. Every candidate is extracted from the text of
 *   jobs THIS user has actually been scored against, with the job ids kept as
 *   evidence, so any claim can be traced back to postings they can open.
 * - It never suggests putting something on a resume. It reports what the
 *   score would do; whether the person has the skill is theirs to say, and
 *   the resume guards refuse untraceable additions anyway.
 * - It needs no outcome data. Cold start is the normal case: a user with zero
 *   applications gets the same quality of answer as one with two hundred.
 */

const { extractSkills } = require('./resumeParser');

/** The real weights. Imported as literals here only because matchingEngine
 *  inlines them; if they ever move to a constant, this must read that. */
const WEIGHTS = { skills: 0.40, experience: 0.30, location: 0.20, salary: 0.10 };

/** Bounded: a feed can be 25,000 rows and this runs per request. */
const MAX_JOBS = 400;
const MAX_CANDIDATES = 12;
const MIN_FREQUENCY = 3;

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The same word-boundary test calculateSkillsScore uses. */
function mentions(jobText, skill) {
  return new RegExp(`(?<![a-zA-Z0-9])${escapeRegExp(skill)}(?![a-zA-Z0-9])`, 'i').test(jobText);
}

/**
 * Recompute overall score with a hypothetical extra skill.
 *
 * Only the skills component can move — experience, location and salary do not
 * depend on the skill set — so the other three are taken as scored and the
 * weights are applied unchanged. That keeps this arithmetic identical to the
 * engine's rather than a parallel approximation of it.
 */
function overallWith(job, userSkillCount, matchedCount) {
  const skills = userSkillCount === 0 ? 0 : matchedCount / userSkillCount;
  return (
    skills * WEIGHTS.skills
    + Number(job.experience_match_score || 0) * WEIGHTS.experience
    + Number(job.location_match_score || 0) * WEIGHTS.location
    + Number(job.salary_match_score || 0) * WEIGHTS.salary
  );
}

/**
 * @param {Array} jobs   scored rows: { job_id, title, company_name, text, and the four sub-scores }
 * @param {Array} userSkills  the skills the user has recorded
 */
function coach(jobs, userSkills) {
  const skills = (userSkills || []).filter(Boolean);
  const n = skills.length;
  const sample = (jobs || []).slice(0, MAX_JOBS);

  if (!sample.length) {
    return {
      ready: false,
      reason: 'no_scored_jobs',
      detail: 'There are no scored jobs to learn from yet. Finish your profile and the feed will score against it.',
    };
  }
  if (!n) {
    return {
      ready: false,
      reason: 'no_skills_recorded',
      detail: 'Add the skills you already have first. Until then every job scores 0 on skills, '
        + 'and there is nothing to compare a change against.',
    };
  }

  /*
   * Per job: how many of the user's skills it mentions. Computed once and
   * reused for every candidate, because the alternative is
   * jobs x candidates x skills regex tests.
   */
  const baseline = sample.map((j) => {
    const text = j.text || '';
    let matched = 0;
    for (const s of skills) if (mentions(text, s)) matched += 1;
    return { job: j, text, matched, overall: overallWith(j, n, matched) };
  });

  const meanBefore = baseline.reduce((a, b) => a + b.overall, 0) / baseline.length;

  /*
   * Candidates come only from the text of jobs this user was scored against.
   * Nothing is suggested that is not literally written in a posting they can
   * open.
   */
  const have = new Set(skills.map((s) => s.toLowerCase()));
  const freq = new Map();
  for (const b of baseline) {
    for (const s of extractSkills(b.text)) {
      if (have.has(s.toLowerCase())) continue;
      if (!freq.has(s)) freq.set(s, []);
      freq.get(s).push(b);
    }
  }

  const candidates = [];
  for (const [skill, appearsIn] of freq) {
    if (appearsIn.length < MIN_FREQUENCY) continue;

    const appears = new Set(appearsIn.map((b) => b.job.job_id));
    let after = 0;
    let helped = 0;
    let hurt = 0;

    for (const b of baseline) {
      const hit = appears.has(b.job.job_id);
      const o = overallWith(b.job, n + 1, b.matched + (hit ? 1 : 0));
      after += o;
      if (o > b.overall + 1e-9) helped += 1;
      else if (o < b.overall - 1e-9) hurt += 1;
    }

    const meanAfter = after / baseline.length;
    candidates.push({
      skill,
      appearsInJobs: appearsIn.length,
      shareOfFeed: Number((appearsIn.length / baseline.length).toFixed(4)),
      meanScoreBefore: Number(meanBefore.toFixed(4)),
      meanScoreAfter: Number(meanAfter.toFixed(4)),
      // The number that decides the ranking, and it is frequently negative.
      netDelta: Number((meanAfter - meanBefore).toFixed(4)),
      jobsHelped: helped,
      jobsHurt: hurt,
      /*
       * Evidence, so every claim is checkable against postings the user has
       * seen. Without these the number is an assertion.
       */
      evidence: appearsIn.slice(0, 3).map((b) => ({
        jobId: b.job.job_id,
        title: b.job.title,
        company: b.job.company_name || null,
      })),
    });
  }

  /*
   * Sorted by netDelta. That happens to coincide exactly with frequency order
   * (see the header), so this is not a different ORDER - it is the same order
   * carrying a number that says whether acting on it helps at all.
   */
  candidates.sort((a, b) => b.netDelta - a.netDelta || b.appearsInJobs - a.appearsInJobs);

  /*
   * Which of the four is actually costing the most. Reported as points of the
   * final score, because "your location score is 0.7" means nothing next to
   * "location is costing you 6 points".
   */
  const mean = (f) => baseline.reduce((a, b) => a + Number(b.job[f] || 0), 0) / baseline.length;
  const meanSkills = baseline.reduce((a, b) => a + (n ? b.matched / n : 0), 0) / baseline.length;
  const components = [
    { id: 'skills', label: 'Skills overlap', score: meanSkills, weight: WEIGHTS.skills },
    { id: 'experience', label: 'Experience fit', score: mean('experience_match_score'), weight: WEIGHTS.experience },
    { id: 'location', label: 'Location fit', score: mean('location_match_score'), weight: WEIGHTS.location },
    { id: 'salary', label: 'Salary alignment', score: mean('salary_match_score'), weight: WEIGHTS.salary },
  ].map((c) => ({
    ...c,
    score: Number(c.score.toFixed(4)),
    // What perfecting this one component would add to the mean score.
    pointsAvailable: Number(((1 - c.score) * c.weight).toFixed(4)),
  }));

  const binding = [...components].sort((a, b) => b.pointsAvailable - a.pointsAvailable)[0];

  return {
    ready: true,
    jobsConsidered: baseline.length,
    skillsRecorded: n,
    meanScore: Number(meanBefore.toFixed(4)),
    components,
    biggestGap: binding.id,
    candidates: candidates.slice(0, MAX_CANDIDATES),
    /*
     * Stated rather than left for the reader to deduce: with this formula a
     * skill that is rare in the feed lowers the mean, and a user is entitled
     * to know that before acting on a list.
     */
    /*
     * The threshold, stated as a number the user can check against the list.
     * A candidate helps only if it appears in a greater SHARE of the feed
     * than this.
     */
    helpsAbove: Number(meanSkills.toFixed(4)),
    howThisWorks: 'Your skills score is the share of YOUR listed skills that a job mentions, so adding a '
      + 'skill raises the score on jobs that mention it and lowers it on every job that does not. A '
      + 'missing skill only raises your average if it appears in more of your feed than your current '
      + 'skills score - anything below that line makes the average worse, however common it is.',
    negativeCandidates: candidates.filter((c) => c.netDelta < 0).length,
  };
}

module.exports = { coach, WEIGHTS, MAX_JOBS, MAX_CANDIDATES, MIN_FREQUENCY, overallWith, mentions };
