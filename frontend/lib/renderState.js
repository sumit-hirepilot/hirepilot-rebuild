/*
 * A2c — unknown must never render as zero.
 *
 * The same defect shipped in three different components, so it is a class, not
 * three bugs:
 *   - jobs.js       `useState(0)` for a result count, rendered as "0 results"
 *                   before the first response landed
 *   - applications  a failed request left every state at its initial value and
 *                   printed "0 total applications" (fixed in #45)
 *   - auto-apply /  a company parsed badly at ingestion rendered as the literal
 *     matches      string "name"
 *
 * All three share one mistake: the absence of an answer is stored in the same
 * representation as a real answer. `0` means both "none" and "not asked yet".
 * `''` means both "empty" and "never parsed".
 *
 * The convention here is that UNKNOWN is `null` or `undefined`, and it is never
 * coerced. A number renders only if a response returned it. A parsed field
 * renders only if it actually parsed. Otherwise the caller is told which state
 * it is in and says so.
 *
 * Deliberately plain functions, not hooks: they must be usable during SSR, in
 * tests, and inside `.map()` over rows.
 */

export const LOADING = 'loading';
export const FAILED = 'failed';
export const READY = 'ready';
export const UNKNOWN = 'unknown';

/**
 * Which of the four states a value is in.
 *
 * Order matters. `error` wins over `loading` because a retry in flight after a
 * failure should not present as a first load, and both win over a value, so a
 * stale value is never shown as current.
 */
export function stateOf({ value, loading = false, error = null } = {}) {
  if (error) return FAILED;
  if (loading) return LOADING;
  if (value === null || value === undefined) return UNKNOWN;
  return READY;
}

/**
 * Text for a count. Returns the state alongside it so a caller can style the
 * non-ready cases differently without re-deriving the condition.
 *
 * `zeroText` exists because a real zero usually deserves better words than
 * "0" - "No applications yet" rather than "0 applications". A zero that a
 * completed response actually returned is a fact and is always allowed to
 * render; the point of this module is only that an unknown never may.
 */
export function countText({
  value,
  loading = false,
  error = null,
  unit = '',
  zeroText = null,
  loadingText = null,
  errorText = null,
} = {}) {
  const state = stateOf({ value, loading, error });
  const suffix = unit ? ` ${unit}` : '';

  if (state === FAILED) return { state, text: errorText || `${unit || 'count'} unavailable`.trim() };
  if (state === LOADING) return { state, text: loadingText || `Loading${suffix}…` };
  if (state === UNKNOWN) return { state, text: errorText || `${unit || 'count'} unavailable`.trim() };

  const n = Number(value);
  if (!Number.isFinite(n)) return { state: FAILED, text: errorText || `${unit || 'count'} unavailable`.trim() };
  if (n === 0 && zeroText) return { state: READY, text: zeroText };
  return { state: READY, text: `${n.toLocaleString('en-US')}${suffix}` };
}

/*
 * Values an upstream parser emits when it did not actually parse anything.
 *
 * "name" is here because it shipped: a job ingested with the literal string
 * "name" as its company rendered as `name · Philippines` on the Auto Apply
 * panel. A field whose value is its own column name did not parse.
 */
const NOT_PARSED = new Set([
  '', '-', '--', 'n/a', 'na', 'none', 'null', 'undefined', 'unknown',
  'name', 'title', 'company', 'company_name', 'location', 'nan',
]);

/**
 * True when a parsed field carries a real value.
 *
 * Conservative on purpose: it only rejects values that cannot be a genuine
 * answer. A real company called "None" is possible in principle, and losing it
 * is a far smaller harm than presenting "name" to a user as an employer.
 */
export function isParsed(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  if (!s) return false;
  return !NOT_PARSED.has(s.toLowerCase());
}

/**
 * A parsed field, or a stated fallback. Never returns the placeholder itself.
 */
export function parsedOr(value, fallback = 'Not stated') {
  return isParsed(value) ? String(value).trim() : fallback;
}
