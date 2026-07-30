/*
 * The learning half of question matching.
 *
 * Records every wording the extension meets against the canonical concept it
 * classified to, and resolves an answer for a question by three routes, tried
 * strongest first:
 *
 *   1. exact  - this exact question has been answered before
 *   2. concept - a different wording of the same canonical concept has been
 *                answered (this is what makes the profile transferable across
 *                ATS platforms)
 *   3. fuzzy  - token similarity, for questions no concept covers
 *
 * Each route returns a confidence, and anything under ASK_THRESHOLD is handed to
 * the user instead of filled. The point is to ask less over time WITHOUT ever
 * answering something we are not sure of - a confidently wrong answer on a real
 * application is far worse than one more question.
 */

const { query } = require('../db');
const { classify } = require('./questionConcepts');
const { findSimilar } = require('./questionMatcher');

// Below this, ask rather than fill. Concept matches clear it comfortably;
// weak fuzzy matches do not.
const ASK_THRESHOLD = 0.7;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/**
 * Records questions seen on a live form. Fire-and-forget: a knowledge-base
 * write must never break an application.
 */
async function recordSeen(questions, { ats, company } = {}) {
  if (!Array.isArray(questions) || !questions.length) return;
  for (const q of questions) {
    const text = q && q.question;
    if (!text) continue;
    const norm = normalize(text);
    if (!norm) continue;
    const concept = classify(text);
    try {
      await query(
        `INSERT INTO question_variations
           (concept_id, question_text, normalized_text, ats, company, field_type, options_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (normalized_text) DO UPDATE
           SET times_seen = question_variations.times_seen + 1,
               last_seen = CURRENT_TIMESTAMP,
               -- Backfill the concept if it was unclassified when first seen and
               -- the patterns have since been extended to cover it.
               concept_id = COALESCE(question_variations.concept_id, EXCLUDED.concept_id)`,
        [
          concept ? concept.conceptId : null,
          String(text).slice(0, 2000),
          norm,
          ats || null,
          company ? String(company).slice(0, 255) : null,
          q.type || null,
          Array.isArray(q.options) ? q.options.length : null,
        ]
      );
    } catch (err) {
      console.warn('[kb] could not record question:', err.message);
    }
  }
}

/**
 * Marks a wording as user-confirmed once they answer it, so it becomes a
 * trusted variation of its concept rather than merely observed.
 */
async function confirmVariation(questionText, conceptId) {
  const norm = normalize(questionText);
  if (!norm) return;
  try {
    await query(
      `UPDATE question_variations
         SET confirmed_by_user = TRUE,
             concept_id = COALESCE($2, concept_id)
       WHERE normalized_text = $1`,
      [norm, conceptId || null]
    );
  } catch (err) {
    console.warn('[kb] could not confirm variation:', err.message);
  }
}

/**
 * Resolve an answer for a question from what the user has already told us.
 *
 * @param {string} question
 * @param {object} custom  application_profiles.custom_answers
 * @returns {{answer, confidence, via, matchedQuestion?, conceptId?}|null}
 */
function resolve(question, custom) {
  if (!custom || typeof custom !== 'object') return null;

  const readAnswer = (raw) => (typeof raw === 'string' ? raw : raw && raw.answer);
  const readQuestion = (key, raw) => (
    (typeof raw === 'object' && raw && raw.question) ? raw.question : key.replace(/_/g, ' ')
  );

  // 1. Exact wording, already answered.
  const exactKey = normalize(question).replace(/\s+/g, '_').slice(0, 120);
  for (const [k, raw] of Object.entries(custom)) {
    if (k !== exactKey) continue;
    const a = readAnswer(raw);
    if (a) return { answer: String(a), confidence: 1, via: 'exact' };
  }

  // 2. Same canonical concept, different wording. This is the route that makes
  //    an answer given on Greenhouse work on Lever, Ashby or a company page.
  const concept = classify(question);
  if (concept) {
    for (const [k, raw] of Object.entries(custom)) {
      const a = readAnswer(raw);
      if (!a) continue;
      const savedConcept = classify(readQuestion(k, raw));
      if (!savedConcept || savedConcept.conceptId !== concept.conceptId) continue;
      // Both sides classified to the same concept; confidence is the weaker of
      // the two classifications, since a shaky read on either end is a shaky
      // match overall.
      const confidence = Number(Math.min(concept.confidence, savedConcept.confidence).toFixed(3));
      return {
        answer: String(a),
        confidence,
        via: 'concept',
        conceptId: concept.conceptId,
        conceptLabel: concept.label,
        matchedQuestion: readQuestion(k, raw),
      };
    }
  }

  /*
   * 3. Fuzzy - ONLY when no concept covers the question.
   *
   * This guard is the difference between correct and dangerous. Without it,
   * "What are your salary expectations?" classifies to expected_salary, finds no
   * saved answer for that concept, falls through to token similarity, and
   * happily returns the CURRENT salary - the two questions share almost every
   * word. Caught in testing returning "INR 37.5 LPA" at 0.85 confidence.
   *
   * If a question belongs to a known concept, only that concept may answer it.
   * A concept with no saved answer means ask, never approximate from a sibling.
   */
  if (concept) return null;

  const similar = findSimilar(question, custom);
  if (similar) {
    // Fuzzy matches are scaled down: they carry no concept-level guarantee that
    // two similar-sounding questions actually mean the same thing.
    const confidence = Number((similar.score * 0.85).toFixed(3));
    return {
      answer: similar.answer,
      confidence,
      via: 'fuzzy',
      matchedQuestion: similar.matchedQuestion,
    };
  }

  return null;
}

// Stats for the profile screen: how much the knowledge base has learned.
async function stats() {
  try {
    const r = await query(
      `SELECT COUNT(*)::int AS variations,
              COUNT(DISTINCT concept_id)::int AS concepts,
              COUNT(*) FILTER (WHERE concept_id IS NULL)::int AS unclassified,
              COUNT(*) FILTER (WHERE confirmed_by_user)::int AS confirmed
       FROM question_variations`
    );
    return r.rows[0];
  } catch {
    return { variations: 0, concepts: 0, unclassified: 0, confirmed: 0 };
  }
}

module.exports = { recordSeen, confirmVariation, resolve, stats, normalize, ASK_THRESHOLD };
