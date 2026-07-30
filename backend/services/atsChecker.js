/*
 * Keyword-overlap ATS scoring.
 *
 * This is honest word-tokenisation matching, not an AI score and not a
 * simulation of any specific vendor's parser. It answers one narrow, real
 * question: what share of the meaningful words in this posting also appear
 * somewhere in your resume? Real ATS platforms weight far more than that, so
 * the number is a keyword-coverage signal - useful for spotting a resume that
 * is missing the posting's own vocabulary - and every surface that shows it
 * says so rather than presenting it as "your Workday score".
 *
 * Extracted from routes/resume.js so the jobs routes can score a posting
 * against the user's saved resume without duplicating the logic.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'of', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that',
  'these', 'those', 'we', 'you', 'your', 'our', 'it', 'as', 'by', 'from',
  'will', 'would', 'should', 'can', 'could', 'have', 'has', 'had', 'do',
  'does', 'did', 'not', 'no', 'so', 'if', 'than', 'then', 'about', 'into',
]);

// Words that are common in job ads but say nothing about fit, so counting them
// as "missing keywords" would pad the score down and produce useless advice
// ("add 'company' to your resume").
const BOILERPLATE = new Set([
  'company', 'team', 'role', 'work', 'working', 'job', 'position', 'candidate',
  'candidates', 'apply', 'application', 'applicants', 'opportunity', 'employer',
  'benefits', 'salary', 'compensation', 'equal', 'opportunities', 'diversity',
  'inclusive', 'inclusion', 'disability', 'veteran', 'gender', 'race', 'age',
  'please', 'join', 'looking', 'hiring', 'help', 'us', 'more', 'also', 'may',
  'must', 'well', 'other', 'all', 'any', 'new', 'per', 'via', 'etc',
  'years', 'year', 'experience', 'skills', 'ability', 'strong', 'good', 'great',
  'excellent', 'plus', 'nice', 'bonus', 'preferred', 'required', 'requirements',
  'responsibilities', 'qualifications',
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .match(/[a-z0-9']{2,}/g) || [];
}

function uniqueKeywords(text) {
  const tokens = tokenize(text)
    .filter((t) => !STOPWORDS.has(t) && !BOILERPLATE.has(t) && t.length > 2);
  return Array.from(new Set(tokens));
}

function checkAts(jobDescription, resumeText) {
  const jobKeywords = uniqueKeywords(jobDescription);
  // Stopwords are filtered on the resume side too: short connector words
  // otherwise false-positive as substrings of unrelated longer job keywords
  // ("prototyping" contains "in").
  const resumeTokens = tokenize(resumeText).filter((t) => !STOPWORDS.has(t));
  const resumeSet = new Set(resumeTokens);

  const matched = [];
  const missing = [];

  for (const kw of jobKeywords) {
    let found = resumeSet.has(kw);
    if (!found) {
      found = resumeTokens.some((r) => {
        const shorter = r.length < kw.length ? r : kw;
        // Require a real stem overlap; 3 chars is too permissive for
        // substring matching ("art" would match "articulate").
        if (shorter.length < 5) return r === kw;
        return r.includes(kw) || kw.includes(r);
      });
    }
    if (found) matched.push(kw);
    else missing.push(kw);
  }

  const score = jobKeywords.length
    ? Math.round((matched.length / jobKeywords.length) * 100)
    : 0;

  return { score, matched, missing, totalKeywords: jobKeywords.length };
}

// Actionable guidance derived from the comparison. Advice is conditional on
// what the check actually found - a resume that already covers the posting
// shouldn't be told to add keywords it has.
function buildAtsGuide(result, resumeText) {
  const { score, missing, matched, totalKeywords } = result;
  const guide = [];

  if (!totalKeywords) {
    return [{
      severity: 'info',
      title: 'Not enough text in this posting to score',
      detail: 'This listing has little or no description, so keyword coverage cannot be measured. Open the original posting to read the full requirements.',
    }];
  }

  if (score >= 70) {
    guide.push({
      severity: 'good',
      title: `Strong keyword coverage (${score}%)`,
      detail: `Your resume already uses ${matched.length} of the ${totalKeywords} meaningful terms in this posting. No keyword work needed.`,
    });
  } else if (score >= 45) {
    guide.push({
      severity: 'warn',
      title: `Moderate coverage (${score}%)`,
      detail: `You match ${matched.length} of ${totalKeywords} terms. Closing some of the gaps below would help this resume survive a keyword filter.`,
    });
  } else {
    guide.push({
      severity: 'bad',
      title: `Low coverage (${score}%)`,
      detail: `Only ${matched.length} of ${totalKeywords} terms from this posting appear in your resume. A keyword-based filter may screen it out.`,
    });
  }

  if (missing.length) {
    guide.push({
      severity: 'action',
      title: 'Terms from this posting your resume does not use',
      detail: missing.slice(0, 12).join(', '),
      note: 'Only add the ones that are genuinely true of your experience. Padding a resume with skills you do not have fails at the interview instead of the filter.',
    });
  }

  const wordCount = tokenize(resumeText).length;
  if (wordCount < 200) {
    guide.push({
      severity: 'warn',
      title: 'Resume is short',
      detail: `About ${wordCount} words. Thin resumes give a parser little to match on - add specifics per role.`,
    });
  }

  if (!/\d/.test(resumeText)) {
    guide.push({
      severity: 'action',
      title: 'No numbers found',
      detail: 'Quantified results (%, currency, time saved, team size) read as evidence rather than assertion. Add them where you have them.',
    });
  }

  guide.push({
    severity: 'info',
    title: 'What this score is and is not',
    detail: 'It measures how much of this posting\'s vocabulary appears in your resume. Real ATS platforms also weight titles, dates, formatting and recency, so treat this as a keyword-coverage check rather than a prediction of any specific system\'s output.',
  });

  return guide;
}

module.exports = { checkAts, buildAtsGuide, tokenize, uniqueKeywords, STOPWORDS };
