/*
 * The enforcement layer.
 *
 * Nothing an LLM produces is written to a resume on trust. Every candidate edit
 * is diffed against the current text and checked for provenance, and anything
 * that fails is rejected before it can be stored, previewed as pending, or
 * shown to the user as a suggestion.
 *
 * Two rules, both structural rather than prompted:
 *
 *   1. NO DELETIONS. The diff must contain no removed parts. A model asked to
 *      "make this more concise" will cheerfully drop a job. The deterministic
 *      engine already guarantees this by only ever inserting; the LLM path has
 *      to be held to the same standard by checking, not by asking nicely.
 *
 *   2. NO NEW FACTS. Every content word in an addition must already appear in
 *      the user's own material - their resume text, their saved skills, their
 *      employers and titles. A model has no way of knowing whether someone
 *      really shipped a design system, and a resume is a document people are
 *      interviewed against.
 *
 * Numbers get the strictest treatment. "Increased conversion by 40%" is the
 * single most damaging thing a resume generator can invent, and it is also the
 * most likely: metrics make bullets sound good and models know it. Any digit
 * that is not already in the user's material is an automatic rejection.
 */

const { diffWordsWithSpace } = require('diff');

// Words that carry no claim. Everything else must be traceable.
const STOPWORDS = new Set(`
a an the and or but if then than that this these those of in on at to for with
by from as is are was were be been being do does did doing have has had having
will would shall should can could may might must not no nor so such very more
most much many few other another each every both either neither its their our
my your his her them they he she it we you i us me who whom whose which what
when where why how all any some own same too also into over under across
through during before after above below up down out off again further once
here there while about against between within without upon per via
`.trim().split(/\s+/));

/*
 * Verbs and framing words a rewrite legitimately introduces. Allowing these is
 * what makes rephrasing possible at all - blocking every unseen word would mean
 * the LLM could only reorder existing text, which is not an editor.
 *
 * Deliberately contains no verb that asserts an outcome. "Increased",
 * "reduced", "grew", "improved", "saved", "drove", "achieved", "launched" and
 * their kin are absent on purpose: those are claims, and a claim needs a
 * source. "Led" and "owned" are absent for the same reason.
 */
const SAFE_CONNECTIVES = new Set(`
work worked working build built building design designed designing create
created creating develop developed developing support supported supporting
maintain maintained maintaining collaborate collaborated collaborating
partner partnered partnering contribute contributed contributing help helped
helping use used using including include includes across within alongside
team teams role roles project projects product products experience years year
responsible responsibility focus focused focusing including various multiple
`.trim().split(/\s+/));

const normalise = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s%.+#-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/*
 * Punctuation is not part of a word.
 *
 * normalise keeps `.`, `%`, `+`, `#` and `-` because they carry meaning inside
 * a token - "12%", "c++", "c#", "node.js", "front-end". It also left them
 * hanging off the END of ordinary words, so the corpus held "teams.",
 * "valtech." and "12%." while an addition offered "redesign." or "12%". Those
 * never matched, and the guard rejected the user's own figures as invented and
 * their own words as untraceable.
 *
 * Trailing/leading punctuation is stripped, and a trailing "." is dropped
 * unless the token still needs it ("node.js" keeps its dot because the dot is
 * interior). "12%." becomes "12%", which is what the resume actually says.
 */
const trimToken = (t) => String(t || '')
  .replace(/^[.+#-]+/, '')
  .replace(/[.,;:!?]+$/, '');

// Singular/plural and simple tense, so "designs" matches "design".
function stem(word) {
  return word
    .replace(/(ies)$/, 'y')
    .replace(/(sses|shes|ches|xes)$/, '')
    .replace(/([^s])s$/, '$1')
    .replace(/(ed|ing)$/, '');
}

/**
 * Everything the user has actually told us, as a lookup.
 *
 * @param {object} sources
 * @param {string} sources.resumeText   current resume, flat
 * @param {string[]} sources.skills     user_skills
 * @param {object[]} sources.experience user_experience rows
 * @param {object} sources.profile      application_profiles row
 */
function buildCorpus({ resumeText = '', skills = [], experience = [], profile = {} } = {}) {
  const parts = [resumeText];
  for (const s of skills) parts.push(String(s || ''));
  for (const e of experience) {
    parts.push(e.company_name || '', e.job_title || '', e.description || '');
    // Dates are facts too - a model must not move someone's employment.
    parts.push(String(e.start_date || ''), String(e.end_date || ''));
  }
  for (const k of ['current_title', 'current_company', 'years_experience', 'current_location']) {
    parts.push(String(profile?.[k] ?? ''));
  }

  const text = normalise(parts.join(' \n '));
  const words = new Set();
  const numbers = new Set();
  for (const raw of text.split(/\s+/)) {
    const tok = trimToken(raw);
    if (!tok) continue;
    if (/\d/.test(tok)) numbers.add(trimToken(tok.replace(/[^\d%.+-]/g, '')));
    words.add(stem(tok));
  }
  return { text, words, numbers };
}

function traceable(token, corpus) {
  const t = stem(token);
  if (!t) return true;
  if (STOPWORDS.has(token) || STOPWORDS.has(t)) return true;
  if (corpus.words.has(t)) return true;
  if (SAFE_CONNECTIVES.has(token) || SAFE_CONNECTIVES.has(t)) return true;
  return false;
}

/**
 * Check a candidate rewrite against the current text.
 *
 * @returns {{ok: boolean, violations: object[], additions: object[], diff: object[]}}
 */
function verify(currentText, candidateText, corpus) {
  const diff = diffWordsWithSpace(String(currentText || ''), String(candidateText || ''))
    .map((part, index) => ({
      index, value: part.value, added: !!part.added, removed: !!part.removed,
    }));

  const violations = [];

  /*
   * There was a no_deletion rule here and nothing could ever reach it.
   *
   * verifyAdditions is the only caller and it passes an empty currentText, so
   * the diff never contains a removal - the rule had a green test and zero
   * live executions, which is the same class of defect as an unwired guard:
   * coverage that reads like protection and protects nothing. "Tailoring may
   * only add" is still enforced, in the place it can actually be observed -
   * tailorNeverInvents asserts the engine's output still contains every line
   * of the input. Deleting from one's OWN resume in the editor is the user's
   * business and was never this rule's job.
   *
   * Every content word in an addition must trace to the user's material.
   */
  const additions = [];
  for (const part of diff) {
    if (!part.added) continue;
    const shown = part.value.replace(/\s+/g, ' ').trim();
    if (!shown) continue;
    additions.push({ index: part.index, text: shown });

    for (const raw of normalise(shown).split(/\s+/)) {
      const tok = trimToken(raw);
      if (!tok) continue;

      // Numbers are the strictest case - an invented metric is the most
      // damaging and most likely fabrication.
      if (/\d/.test(tok)) {
        /*
         * Dead branches — this was `if (num && !corpus.numbers.has(num))`.
         *
         * The `num &&` could never be false. Reaching here means /\d/ matched,
         * the replace keeps every digit, and trimToken strips only leading
         * [.+#-] and trailing [.,;:!?] - so at least one digit always survives.
         * Checked over every token the live path can produce from a 3-character
         * alphabet of digits, punctuation and letters: 2835 digit-bearing
         * tokens, zero empty results.
         *
         * Unreachable would be untidy on its own. The direction is the point:
         * had it ever been false it would have SKIPPED the invented-number
         * check entirely, which is the one rule here that exists because an
         * invented metric is the most damaging thing a resume generator can
         * produce. A guard clause that can only ever fail open is not worth
         * the doubt it creates.
         */
        const num = trimToken(tok.replace(/[^\d%.+-]/g, ''));
        if (!corpus.numbers.has(num)) {
          violations.push({
            rule: 'invented_number',
            text: shown.slice(0, 160),
            token: tok,
            why: `"${tok}" does not appear anywhere in your resume or profile. Figures have to come from you.`,
          });
        }
        continue;
      }

      if (!traceable(tok, corpus)) {
        violations.push({
          rule: 'untraceable_claim',
          text: shown.slice(0, 160),
          token: tok,
          why: `"${tok}" is not in your resume, skills or work history, so this would be a new claim.`,
        });
      }
    }
  }

  // One violation per rule+token is enough to explain the rejection; repeating
  // the same word ten times just makes the reason harder to read.
  const seen = new Set();
  const unique = violations.filter((v) => {
    const key = `${v.rule}:${v.token || v.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ok: unique.length === 0, violations: unique, additions, diff };
}

/**
 * Verify a batch of proposed bullet/skill additions rather than a whole
 * rewritten document. Returns each one marked accepted or rejected, so a single
 * bad suggestion does not discard the good ones alongside it.
 */
function verifyAdditions(items, corpus) {
  return (items || []).map((item) => {
    const text = typeof item === 'string' ? item : item.text;
    // An addition is checked against empty current text: everything in it is
    // new by definition, so every content word must trace.
    const res = verify('', text, corpus);
    return {
      text,
      ok: res.ok,
      violations: res.violations,
      ...(typeof item === 'object' ? { target: item.target, kind: item.kind } : {}),
    };
  });
}

/*
 * `verify` is deliberately NOT exported. It was, and nothing called it: a guard
 * that exists and is not invoked is indistinguishable from no guard, and an
 * exported one invites a caller to believe the path is covered. It remains the
 * engine inside verifyAdditions, which IS wired, at every resume write.
 */
/*
 * The third honesty guard: tailoring may only ADD.
 *
 * "Nothing already in your resume can be removed" is a promise the product has
 * always made and, until now, never enforced at runtime. There WAS a
 * `no_deletion` rule here and it was retired as unreachable - verifyAdditions
 * passes an empty currentText, so no diff it sees can ever contain a removal.
 * The promise then rested entirely on `tailorNeverInvents`, a test. A test
 * proves the engine behaved on the day it ran; it does not stop a future path
 * from writing a resume with a line missing.
 *
 * So it is a guard now, checked on the real output, on both tailoring paths.
 * Compared on NORMALISED lines because the engine legitimately reflows
 * whitespace when it inserts a skills line - comparing raw text would fail on
 * a change that removed nothing.
 *
 * Returns the missing lines rather than a boolean: a refusal that cannot say
 * what went missing is a refusal nobody can act on.
 */
function findRemovedLines(originalText, proposedText) {
  const lines = (t) => String(t || '')
    .split('\n')
    .map((l) => normalise(l))
    .filter((l) => l.length > 0);

  const proposed = new Set(lines(proposedText));
  return lines(originalText).filter((l) => !proposed.has(l));
}

module.exports = {
  buildCorpus, verifyAdditions, findRemovedLines, normalise, trimToken, stem, STOPWORDS, SAFE_CONNECTIVES,
};
