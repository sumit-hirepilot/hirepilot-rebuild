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


/*
 * A7.12 — a row that is not a job must never be stored, and never rendered
 * with an Apply button.
 *
 * Observed on production: a candidate's own bio - "Hi! I am Max. I am a Design
 * Leader with 13+ years..." - indexed as a job, with a working Apply Now and
 * Auto-Pilot on. Its job_url was linkedin.com/in/<person>. Four sibling rows
 * resolved to greenhouse, the one enabled adapter, so they were genuinely
 * reachable by automated apply. Applying to a person's profile is a real
 * submission to a real target and cannot be taken back.
 *
 * Cause: the HN adapter parses "Company | Title | Location". A comment with no
 * pipes made segments[0] the ENTIRE first line, so company_name became a
 * paragraph and title its first 120 characters. HN's paired "Who wants to be
 * hired" thread reads exactly like that, but so did 16 of 200 hiring posts -
 * this was never bio-specific.
 *
 * Three independent signals, because any one alone is escapable.
 */

// A real employer name is short. A paragraph in the company field means the
// parse failed, whatever the text says.
const MAX_COMPANY_CHARS = 80;

// First-person self-description: a person, not an employer.
const SELF_DESCRIPTION = /\b(i am|i'm|my name is|about me|seeking (a )?(new )?(role|work|position|opportunit)|looking for (a )?(new )?(role|work|position)|available for (hire|work)|open to (work|opportunit))/i;

// A URL that identifies a PERSON, not a posting.
const PERSON_URL = /(linkedin\.com\/in\/|github\.com\/[^/]+\/?$|twitter\.com\/|x\.com\/|read\.cv\/|about\.me\/)/i;

/**
 * Why this row is not a job, or null if it looks like one.
 *
 * Returns the REASON rather than a boolean so the aggregator can report what
 * it withheld - a silent skip is how the parse failure survived this long.
 */
function notAJobReason({ title, company_name: company, job_url: jobUrl, apply_url: applyUrl, description } = {}) {
  const t = String(title || '').trim();
  const c = String(company || '').trim();

  if (!isParsed(t) || !isParsed(c)) return 'title or company did not parse';
  if (c.length > MAX_COMPANY_CHARS) return 'company is a sentence, not an employer';
  if (SELF_DESCRIPTION.test(c)) return 'company reads as a person describing themselves';
  if (SELF_DESCRIPTION.test(t)) return 'title reads as a person describing themselves';

  // The parser fell back to slicing one string into both fields.
  if (t && c && (c.startsWith(t.slice(0, 40)) || t.startsWith(c.slice(0, 40)))) {
    return 'title and company are the same text';
  }

  const url = String(applyUrl || jobUrl || '');
  if (PERSON_URL.test(url)) return 'destination is a personal profile, not a posting';

  // Only consulted when the fields above are clean, so a job description that
  // merely quotes someone is not caught by it.
  if (!c && SELF_DESCRIPTION.test(String(description || '').slice(0, 200))) {
    return 'description reads as a person seeking work';
  }
  return null;
}

module.exports = { isParsed, NOT_PARSED, notAJobReason };
