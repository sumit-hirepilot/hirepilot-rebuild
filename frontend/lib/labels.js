/*
 * A7.4 — no key reaches a user as a key.
 *
 * The activity feed already maps its event types to sentences. Every other
 * surface used `SOME_LABELS[key] || key`, which is a map with a hole in it:
 * the day a new status, source or category is added on the server, the raw
 * token appears on screen and nothing fails. The inbox skipped the map
 * entirely and rendered `{m.category}`.
 *
 * A fallback that leaks the input is not a fallback. This one always produces
 * something readable, so an unmapped key reads as "Phone screen" rather than
 * "phone_screen" - wrong wording at worst, never a database token.
 *
 * Explicit maps still win, because "ATS" should not become "Ats" and
 * "hackernews" should not become "Hackernews".
 */

/** snake_case / kebab-case / camelCase -> "Sentence case". */
export function humanise(key) {
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
 * The mapped label, or a readable rendering of the key itself.
 *
 * Never returns the raw key when the key contains a separator, which is the
 * shape that gives a database token away.
 */
export function labelFor(key, map = {}) {
  if (key === null || key === undefined || key === '') return '';
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  return humanise(key);
}
