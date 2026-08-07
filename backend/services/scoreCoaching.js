/*
 * "What would move you from 62% to 80%" — answered from the user's own feed,
 * with the same arithmetic the score itself uses.
 *
 * THE FORMULA, after D49.
 *
 *   skillsScore = matched / max(jobRequiredSkills, 4)
 *
 * The denominator belongs to the POSTING, not to the user. So adding a real
 * skill raises the score on jobs that mention it and leaves every other job
 * exactly where it was:
 *
 *   adding a skill can RAISE the score and can never lower it
 *
 * BEFORE D49 this was not true, and the difference is the reason the formula
 * changed. With `matched / userSkills.length` the denominator grew whenever a
 * skill was added, so a genuine skill LOWERED the score on every job that did
 * not mention it. On a real 220-job feed exactly 1 of 74 missing skills would
 * have helped, and deleting six real skills raised the score. That history is
 * kept in DECISIONS.md as D49.
 *
 * WHAT THE ARITHMETIC SAYS NOW.
 *
 * Adding a candidate contributes `1 / max(jobSkills_j, 4)` on each of the `a`
 * jobs that mention it, and exactly 0 elsewhere. So:
 *
 *   netDelta = (1/N) * sum over mentioning jobs of  0.40 / denom_j
 *
 * always >= 0, and larger when the skill appears in jobs that list FEW other
 * requirements - being one of four things a posting asks for is worth more
 * than being one of nine. That is a genuinely different order from frequency,
 * and unlike the old formula the difference is real rather than claimed.
 *
 * `jobsHurt` is retained and should now always be 0. It stays because a
 * non-zero value would mean the engine and this file have drifted apart, and
 * a test asserts it.
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

/** Must match matchingEngine.JOB_SKILLS_FLOOR - see D49. */
const JOB_SKILLS_FLOOR = 4;

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
function overallWith(job, denominator, matchedCount) {
  const skills = denominator === 0 ? 0 : Math.min(1, matchedCount / denominator);
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
  /*
   * D49: the denominator is the JOB's own required-skill count (floored),
   * not the user's skill count. That is what makes adding a real skill
   * monotonic - it can raise the score and can never lower it - and it is why
   * this whole file's sign analysis changed.
   */
  const baseline = sample.map((j) => {
    const text = j.text || '';
    let matched = 0;
    for (const s of skills) if (mentions(text, s)) matched += 1;
    const denom = Math.max(extractSkills(text).length, JOB_SKILLS_FLOOR);
    return { job: j, text, matched, denom, overall: overallWith(j, denom, matched) };
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
      // The denominator does NOT move: it belongs to the posting, not to the
      // user. This is the whole difference D49 made.
      const o = overallWith(b.job, b.denom, b.matched + (hit ? 1 : 0));
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
  const meanSkills = baseline.reduce((a, b) => a + Math.min(1, b.matched / b.denom), 0) / baseline.length;
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
     * Renamed from `helpsAbove` when D49 landed. Under the old denominator
     * this WAS a threshold - a skill helped only above it. Under
     * matched/jobSkills every candidate helps, so a field called "helpsAbove"
     * would now be a name that disagrees with its data. It is just the mean.
     */
    meanSkillsScore: Number(meanSkills.toFixed(4)),
    howThisWorks: 'Your skills score is the share of what a job asks for that you already have. Adding a '
      + 'real skill can only raise it - never lower it. A skill is worth more when it appears in jobs '
      + 'that ask for few other things, so the order here is not simply the most common gap first.',
    negativeCandidates: candidates.filter((c) => c.netDelta < 0).length,
  };
}

module.exports = { coach, WEIGHTS, MAX_JOBS, MAX_CANDIDATES, MIN_FREQUENCY, overallWith, mentions };
