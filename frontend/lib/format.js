/*
 * A3 / H3 — formatting that cannot differ between server and client.
 *
 * `toLocaleString()` with no arguments uses the host's locale and time zone.
 * The Railway container and the visitor's browser rarely agree, so the same
 * value rendered "Aug 4, 12:12 PM" on the server and "4 Aug, 12:12" on the
 * client, and React threw the server HTML away. The number forms are the same
 * defect quietly: 23,958 in en-US is 23.958 in de-DE.
 *
 * Every formatter here pins BOTH the locale and, for dates, the time zone.
 * A date with no explicit zone is still environment-dependent even with an
 * explicit locale - the server is UTC and the reader is not.
 *
 * Use these instead of calling toLocale* directly; the lint enforces it.
 */

const LOCALE = 'en-GB';
const TIME_ZONE = 'UTC';

/** 4 Aug 2026 */
export function formatDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(LOCALE, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: TIME_ZONE,
  });
}

/** 4 Aug, 12:12 */
export function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(LOCALE, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: TIME_ZONE,
  });
}

/** 04 Aug — the compact form used in dense table cells. */
export function formatDateShort(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(LOCALE, {
    day: '2-digit', month: 'short', timeZone: TIME_ZONE,
  });
}

/** 23,958 — always grouped the same way, on both sides of the wire. */
export function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US');
}

/*
 * A7.3 — one relative-time formatter, and ONE string for "no date".
 *
 * There were four copies of timeAgo (dashboard, jobs, agents/[id],
 * NotificationBell) and two different strings for the same state: "date
 * unavailable" and "Publication date unavailable". Two strings for one state
 * is two states to a reader.
 *
 * posted_at is deliberately left null by the aggregator when a source has no
 * trustworthy date - it must never fall back to "now", which would fabricate
 * freshness. So this says so plainly rather than computing a misleading
 * "Xh ago" from a missing value.
 */
export const NO_DATE = 'Publication date unavailable';

/*
 * A7.14 - the arithmetic and the vocabulary are different decisions, and
 * merging them put A7.3's publication wording on things that are not
 * publications. The source panel called timeAgo(lastFetched) and a source that
 * had never been fetched reported "Publication date unavailable", which says
 * nothing about a fetch. Same defect A7.3 fixed, one level up: one string
 * reused for two states is two states a reader cannot tell apart.
 *
 * relativeTime does the arithmetic and returns null when the value cannot be
 * read as a past instant. Each caller supplies its own word for null.
 */
export function relativeTime(value) {
  if (!value) return null;
  const then = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(then.getTime())) return null;

  const mins = Math.floor((Date.now() - then.getTime()) / 60000);
  if (mins < 0) return null;             // a future date is not a past instant
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const NEVER_FETCHED = 'never fetched';

/** When a source last pulled. Nothing to do with when a job was published. */
export function fetchedAgo(value) {
  return relativeTime(value) ?? NEVER_FETCHED;
}

export function timeAgo(value) {
  return relativeTime(value) ?? NO_DATE;
}
