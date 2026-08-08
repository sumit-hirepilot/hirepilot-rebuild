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

/*
 * Expanded 2026-08-08. The original ~50-word list covered a language that
 * needs a few hundred filtered: a real Greenhouse JD produced 253 "meaningful
 * terms" including why, how, gets, done, what, who and we'd, the denominator
 * deflated every score, and the guide advised adding the word "why" to a
 * resume. Function words, wh-words, auxiliaries, common verbs of motion and
 * quantity words all say nothing about fit.
 */
const STOPWORDS = new Set([
  // articles, conjunctions, prepositions
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'in', 'on', 'at', 'to', 'of',
  'for', 'with', 'without', 'within', 'as', 'by', 'from', 'about', 'into',
  'onto', 'over', 'under', 'above', 'below', 'between', 'among', 'through',
  'throughout', 'during', 'before', 'after', 'up', 'down', 'out', 'off',
  'against', 'toward', 'towards', 'across', 'around', 'along', 'behind',
  'beyond', 'near', 'since', 'until', 'unless', 'because', 'while', 'though',
  'although', 'whether', 'despite', 'upon',
  // be/have/do and modals
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'have', 'has',
  'had', 'having', 'do', 'does', 'did', 'done', 'doing', 'will', 'would',
  'should', 'shall', 'can', 'could', 'may', 'might', 'must',
  // pronouns and determiners
  'we', 'you', 'your', 'yours', 'our', 'ours', 'it', 'its', 'this', 'that',
  'these', 'those', 'they', 'them', 'their', 'theirs', 'he', 'she', 'his',
  'her', 'hers', 'him', 'us', 'me', 'my', 'mine', 'i', 'who', 'whom',
  'whose', 'which', 'what', 'whatever', 'whoever', 'itself', 'himself',
  'herself', 'themselves', 'yourself', 'yourselves', 'ourselves', 'someone',
  'anyone', 'everyone', 'nobody', 'something', 'anything', 'everything',
  'nothing', 'each', 'every', 'either', 'neither', 'both', 'few', 'several',
  'some', 'any', 'all', 'most', 'more', 'much', 'many', 'less', 'least',
  'own', 'same', 'such', 'another', 'others',
  // wh-adverbs, negation, degree, time and place adverbs
  'why', 'how', 'where', 'when', 'whenever', 'wherever', 'not', 'no', 'so',
  'if', 'than', 'then', 'too', 'very', 'just', 'also', 'only', 'even',
  'still', 'yet', 'already', 'again', 'further', 'once', 'twice', 'here',
  'there', 'now', 'soon', 'later', 'often', 'sometimes', 'usually', 'always',
  'never', 'ever', 'rather', 'quite', 'almost', 'enough', 'perhaps', 'else',
  'instead', 'meanwhile', 'moreover', 'however', 'therefore', 'otherwise',
  'anywhere', 'everywhere', 'together', 'apart', 'away', 'back', 'forward',
  // common verbs that carry no domain signal in a posting
  'get', 'gets', 'got', 'getting', 'make', 'makes', 'making', 'made', 'take',
  'takes', 'taking', 'took', 'taken', 'come', 'comes', 'coming', 'came',
  'go', 'goes', 'going', 'went', 'gone', 'move', 'moves', 'moving', 'moved',
  'put', 'puts', 'putting', 'keep', 'keeps', 'keeping', 'kept', 'let',
  'lets', 'see', 'sees', 'seeing', 'seen', 'saw', 'say', 'says', 'said',
  'know', 'knows', 'knowing', 'knew', 'known', 'think', 'thinks', 'thinking',
  'thought', 'find', 'finds', 'finding', 'found', 'give', 'gives', 'giving',
  'gave', 'given', 'become', 'becomes', 'becoming', 'became', 'begin',
  'begins', 'beginning', 'began', 'begun', 'start', 'starts', 'starting',
  'started', 'end', 'ends', 'ending', 'ended', 'want', 'wants', 'wanting',
  'wanted', 'need', 'needs', 'needing', 'needed', 'like', 'likes', 'liked',
  'look', 'looks', 'seem', 'seems', 'seemed', 'feel', 'feels', 'felt',
  'try', 'tries', 'trying', 'tried', 'use', 'uses', 'using', 'used',
  'call', 'calls', 'called', 'ask', 'asks', 'asked', 'tell', 'tells', 'told',
  'push', 'pushes', 'pushing', 'pushed', 'bring', 'brings', 'bringing',
  'brought', 'believe', 'believes', 'believed', 'love', 'loves', 'loved',
  'mean', 'means', 'meant', 'happen', 'happens', 'happened', 'show', 'shows',
  'showing', 'shown', 'showed', 'visit', 'visits', 'visiting', 'built',
  // number and time words
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'first', 'second', 'third', 'last', 'next', 'day', 'days', 'week',
  'weeks', 'month', 'months', 'today', 'tomorrow', 'yesterday', 'time',
  'times', 'moment', 'moments', 'hour', 'hours', 'date', 'dates',
  // generic nouns that survive everything above
  'thing', 'things', 'way', 'ways', 'lot', 'lots', 'bit', 'bits', 'kind',
  'kinds', 'sort', 'sorts', 'part', 'parts', 'place', 'places', 'point',
  'points', 'chance', 'chances', 'case', 'cases', 'side', 'sides', 'fact',
  'facts', 'area', 'areas', 'number', 'numbers', 'amount', 'amounts',
]);

// Words that are common in job ads but say nothing about fit, so counting them
// as "missing keywords" would pad the score down and produce useless advice
// ("add 'company' to your resume").
const BOILERPLATE = new Set([
  'company', 'team', 'role', 'work', 'working', 'job', 'position', 'candidate',
  'candidates', 'apply', 'application', 'applicants', 'opportunity', 'employer',
  'benefits', 'salary', 'compensation', 'equal', 'opportunities', 'diversity',
  'inclusive', 'inclusion', 'disability', 'veteran', 'gender', 'race', 'age',
  'please', 'join', 'joins', 'joining', 'looking', 'hiring', 'help', 'us',
  'more', 'also', 'may', 'must', 'well', 'other', 'all', 'any', 'new', 'per',
  'via', 'etc',
  'years', 'year', 'experience', 'skills', 'ability', 'strong', 'good', 'great',
  'excellent', 'plus', 'nice', 'bonus', 'preferred', 'required', 'requirements',
  'responsibilities', 'qualifications',
  // recruiting-prose filler that says nothing a resume could usefully echo
  'best', 'better', 'top', 'world', 'class', 'mission', 'value', 'values',
  'culture', 'environment', 'environments', 'passionate', 'passion',
  'exciting', 'excited', 'amazing', 'incredible', 'unique', 'rare', 'true',
  'real', 'deep', 'deeply', 'fast', 'high', 'low', 'big', 'small', 'right',
  'people', 'person', 'everyone', 'career', 'careers', 'future', 'grow',
  'growth', 'growing', 'success', 'successful', 'succeed', 'impact',
  'impactful', 'important', 'committed', 'commitment', 'ambitious',
  'satisfied', 'unmatched', 'personal', 'ideal', 'perfect', 'proud',
  'overview', 'description', 'about', 'chance', 'opportunity', 'alongside',
  'ownership', 'drive', 'driven', 'share', 'shares', 'shared', 'example',
  'examples',
  // URL debris - tokenising a link yields its scheme and TLD as "words"
  'http', 'https', 'www', 'com', 'org', 'net', 'html',
]);

function tokenize(text) {
  return ((text || '')
    .toLowerCase()
    .match(/[a-z0-9']{2,}/g) || [])
    /*
     * Contractions and possessives resolve to their base word: "we'd" is
     * "we" (a stopword), "harvey's" is "harvey" (the same claim as the bare
     * name in a resume). Without this, "job's" counted as a missing keyword
     * distinct from "job".
     */
    .map((t) => t.replace(/'(s|d|ll|re|ve|m)$/, '').replace(/^'+|'+$/g, ''))
    .filter((t) => t.length >= 2);
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
