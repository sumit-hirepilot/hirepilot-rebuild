/*
 * A7.2 — a field that failed to parse must never reach the database.
 *
 * A2c stopped users SEEING `name` as a company. This stops it being stored.
 * The two halves are both needed: the render guard protects surfaces that route
 * through it, and there is no guarantee every future surface will.
 *
 * Himalayas wrote `company_name = 'name'` on roughly a fifth of its ~4,900
 * rows. The current parser is correct - the live API returns a real
 * companyName - so those are legacy rows from an older shape. A guard here
 * means the next source that regresses is caught at ingestion rather than
 * discovered on a job card months later.
 *
 * The list is duplicated from frontend/lib/renderState.js by necessity - the
 * two packages have no shared module - and
 * backend/__tests__/parsedFieldParity.test.js fails if they drift.
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
function isParsed(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  if (!s) return false;
  return !NOT_PARSED.has(s.toLowerCase());
}

module.exports = { isParsed, NOT_PARSED };
