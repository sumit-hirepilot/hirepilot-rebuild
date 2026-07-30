/*
 * Matches an employer's question against answers the user has already given,
 * even when the wording differs.
 *
 * Exact-key lookup is not enough. Every ATS phrases the same question its own
 * way - "Are you subject to a non-compete?", "Are you currently bound by any
 * agreements with a current or former employer...", "Do you have any
 * contractual obligations that would restrict your employment?" are one
 * question and should consume one saved answer. Without this the profile grows
 * a near-duplicate entry per employer and the user is asked the same thing
 * forever, which is exactly what the profile is supposed to stop.
 *
 * Deliberately NOT an embedding model: there is no LLM in this stack, and
 * token-overlap works well here because screening questions carry distinctive
 * vocabulary (non-compete, sponsorship, authorized, relocate, notice). A
 * threshold plus a required-anchor check keeps it from matching two questions
 * that merely share filler words.
 */

// Words that appear in nearly every question and carry no signal. Matching on
// these is how "Are you willing to relocate?" would wrongly match "Are you
// willing to travel?".
const NOISE = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'in', 'on', 'at', 'to', 'of',
  'for', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'this', 'that', 'these', 'those', 'we', 'you', 'your', 'yours', 'our', 'us',
  'it', 'its', 'as', 'by', 'from', 'will', 'would', 'should', 'can', 'could',
  'have', 'has', 'had', 'do', 'does', 'did', 'not', 'no', 'so', 'than', 'then',
  'about', 'into', 'any', 'all', 'please', 'select', 'choose', 'provide',
  'currently', 'current', 'now', 'future', 'may', 'must', 'other', 'others',
  'including', 'include', 'includes', 'limited', 'such', 'etc', 'e', 'g',
  'position', 'role', 'job', 'company', 'employer', 'application', 'applying',
  'candidate', 'below', 'above', 'following', 'question', 'answer', 'what',
  'which', 'who', 'when', 'where', 'how', 'why', 'per', 'via',
]);

/*
 * Concepts that must be shared for two questions to be the same question.
 *
 * The overlap score alone is too permissive on short questions - "Are you
 * willing to relocate?" and "Are you willing to travel?" share most of their
 * non-noise tokens. If either question contains an anchor, the other must
 * contain an anchor from the same group.
 */
const ANCHOR_GROUPS = [
  ['noncompete', 'non-compete', 'noncompetition', 'nonsolicitation', 'non-solicitation', 'restrictive', 'restrict', 'agreements', 'agreement', 'obligations', 'nda'],
  ['sponsorship', 'sponsor', 'visa', 'h1b', 'h-1b'],
  ['authorized', 'authorised', 'authorization', 'authorisation', 'eligible', 'legally'],
  ['relocate', 'relocation', 'relocating'],
  ['travel'],
  ['salary', 'compensation', 'pay', 'ctc', 'wage', 'rate'],
  ['notice', 'start', 'available', 'availability', 'join', 'joining'],
  ['veteran'],
  ['disability', 'disabled'],
  ['gender'],
  ['race', 'ethnicity', 'ethnic', 'hispanic', 'latino'],
  ['linkedin'],
  ['github'],
  ['portfolio', 'website', 'dribbble', 'behance'],
  ['phone', 'mobile', 'telephone'],
  ['email'],
  ['education', 'degree', 'university', 'school', 'college', 'graduation'],
  ['experience', 'years'],
  ['background', 'check'],
  ['drug', 'screening'],
  ['clearance', 'security'],
  ['referral', 'referred', 'hear', 'source'],
  ['remote', 'hybrid', 'onsite', 'office', 'person'],
  ['pronouns'],
  ['citizenship', 'citizen', 'nationality'],
  ['criminal', 'convicted', 'felony'],
];

/*
 * Light suffix stemming. Without it "relocating" and "relocate" are unrelated
 * tokens and the same question phrased two ways scores zero. Deliberately crude
 * - a real stemmer is overkill for a controlled vocabulary, and over-stemming
 * would collapse distinct concepts.
 */
function stem(t) {
  if (t.length <= 4) return t;
  return t
    .replace(/(ations|ation|ating|ate|ing|ed|es|s)$/, '')
    .replace(/(ment|ility|ance|ence)$/, '')
    || t;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    // Keep intra-word hyphens so "non-compete" survives as a signal.
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 1 && !NOISE.has(t))
    .map(stem)
    .filter(Boolean);
}

// Groups are stemmed once at load so anchor lookup compares like with like.
const STEMMED_GROUPS = ANCHOR_GROUPS.map((g) => g.map((w) => tokenize(w)[0] || w));

function anchorsFor(tokens) {
  const set = new Set();
  STEMMED_GROUPS.forEach((group, i) => {
    if (group.some((g) => tokens.includes(g))) set.add(i);
  });
  return set;
}

/*
 * Containment, not Dice.
 *
 * Dice divides by the combined size, so a 3-token question ("subject to a
 * non-compete") scored ~0.12 against the same question written in 40 tokens by
 * another ATS - the wording that matters was fully contained, but the length
 * gap buried it. Dividing by the SMALLER set asks the right question: is the
 * shorter question essentially a subset of the longer one?
 */
function similarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

// Containment runs higher than Dice, so the bar is higher too.
const THRESHOLD = 0.6;
// A shared anchor is strong evidence on its own - "When can you start?" and
// "What is your notice period?" share a concept but almost no words.
const ANCHORED_THRESHOLD = 0.25;

/**
 * @param {string} question - the employer's wording
 * @param {object} saved    - custom_answers: { key: string | {answer, question} }
 * @returns {{answer: string, matchedQuestion: string, score: number}|null}
 */
function findSimilar(question, saved) {
  if (!saved || typeof saved !== 'object') return null;
  const qTokens = tokenize(question);
  if (!qTokens.length) return null;
  const qAnchors = anchorsFor(qTokens);

  let best = null;
  for (const [key, raw] of Object.entries(saved)) {
    // Answers are stored either as a bare string (original format) or as
    // { answer, question } once the real wording is known. The stored key is a
    // normalised, truncated slug, so it is a poor comparison target - prefer
    // the original question text when we kept it.
    const answer = typeof raw === 'string' ? raw : raw && raw.answer;
    if (answer === undefined || answer === null || answer === '') continue;
    const savedText = (typeof raw === 'object' && raw.question) ? raw.question : key.replace(/_/g, ' ');

    const sTokens = tokenize(savedText);
    if (!sTokens.length) continue;

    const sAnchors = anchorsFor(sTokens);
    // If both sides declare a concept, they must share one. If neither does,
    // fall back to pure overlap.
    if (qAnchors.size && sAnchors.size) {
      let shares = false;
      for (const i of qAnchors) if (sAnchors.has(i)) { shares = true; break; }
      if (!shares) continue;
    }

    const score = similarity(qTokens, sTokens);
    // Both naming the same concept lowers the wording bar; with no anchors at
    // all the tokens have to carry it alone.
    const sharesAnchor = qAnchors.size > 0 && sAnchors.size > 0;
    const bar = sharesAnchor ? ANCHORED_THRESHOLD : THRESHOLD;
    if (score >= bar && (!best || score > best.score)) {
      best = { answer: String(answer), matchedQuestion: savedText, score: Number(score.toFixed(3)) };
    }
  }
  return best;
}

module.exports = { findSimilar, tokenize, similarity, THRESHOLD };
