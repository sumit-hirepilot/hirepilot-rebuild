/*
 * A7.4 — the server writes user-facing sentences too, so it needs the same
 * rule: no key reaches a user as a key.
 *
 * Mirrors frontend/lib/labels.js. The two packages share no module, so
 * backend/__tests__/labelsParity.test.js fails if they drift - the same
 * arrangement parsedField already uses for NOT_PARSED.
 */

/** snake_case / kebab-case / camelCase -> "Sentence case". */
function humanise(key) {
  if (key === null || key === undefined) return '';
  const s = String(key).trim();
  if (!s) return '';
  const words = s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The most human name available for a stored question.
 *
 * A concept label is written for people and wins outright. Otherwise the key
 * is humanised - "are_you_hispanic_latino" must never be quoted back at
 * someone, least of all next to a demographic question.
 */
function questionLabel({ conceptLabel, matchedQuestion } = {}) {
  if (conceptLabel && String(conceptLabel).trim()) return String(conceptLabel).trim();
  const q = String(matchedQuestion || '').trim();
  if (!q) return '';
  // A real question already reads as one; only a key needs humanising.
  return /\s/.test(q) ? q : humanise(q);
}

module.exports = { humanise, questionLabel };
