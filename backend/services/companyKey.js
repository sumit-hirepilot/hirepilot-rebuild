/*
 * Feature 8 — turning a company name into a key, and refusing when it cannot.
 *
 * A saved resume version is keyed on the company, so the key has to fold the
 * variants a job board actually produces - "Discord", "discord", "Discord ",
 * "Discord, Inc." - onto one entry. Otherwise a user saves a version for
 * Discord and then never sees it again because the next posting spelled it
 * with a comma.
 *
 * The harder half is REFUSING. A company name is not always known:
 *
 *   - a pasted JD has no verified employer, and 4a stores that absence rather
 *     than guessing one out of the text
 *   - a linked job whose page never stated a company is stored NULL, flagged
 *     `companyStated: false`
 *   - aggregators have written literal junk into the field: 'name', 'n/a',
 *     'company', '-' - the A7.2 work exists because himalayas put "name" on a
 *     fifth of its rows and a card rendered "name - Philippines" as an employer
 *
 * Keying on any of those would file a resume under a company that does not
 * exist, and then offer it back as "the version you saved for name". So this
 * returns a reason instead, and the reason is rendered - a refusal the UI
 * swallows is the boundary defect this project has now hit twice.
 */

/* Values that are present but mean nothing. Same list the ingest guard uses. */
const NOT_A_NAME = new Set([
  '', '-', '--', 'n/a', 'na', 'none', 'null', 'undefined', 'unknown',
  'name', 'title', 'company', 'company_name', 'employer', 'nan', 'tbd',
  'confidential', 'private',
]);

/* Legal suffixes are dropped so "Acme" and "Acme, Inc." are one company. */
const SUFFIX = /[,.]?\s+(inc|inc\.|llc|ltd|ltd\.|limited|corp|corp\.|corporation|gmbh|pvt|pvt\.|private limited|plc|co|co\.|sa|bv|ab|oy)\.?$/i;

/**
 * @returns {{ok: true, key: string, name: string} | {ok: false, reason: string, detail: string}}
 */
function companyKeyFor(rawName) {
  const name = String(rawName ?? '').trim().replace(/\s+/g, ' ');

  if (!name) {
    return {
      ok: false,
      reason: 'company_unknown',
      detail: 'This job has no company recorded, so there is nothing to save the version against. '
        + 'Pasted job descriptions and links whose page never named an employer are stored without one rather than guessed.',
    };
  }

  if (NOT_A_NAME.has(name.toLowerCase())) {
    return {
      ok: false,
      reason: 'company_not_a_name',
      detail: `"${name}" is a placeholder rather than an employer, so it is not something a resume version can be filed under.`,
    };
  }

  let key = name.toLowerCase();
  // Applied repeatedly: "Acme Pvt Ltd." is two suffixes, not one.
  for (let i = 0; i < 3; i += 1) {
    const next = key.replace(SUFFIX, '');
    if (next === key) break;
    key = next;
  }
  key = key.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

  if (!key) {
    return {
      ok: false,
      reason: 'company_not_a_name',
      detail: `"${name}" has no letters or digits in it, so it cannot identify an employer.`,
    };
  }

  // Bounded: the column is 120 and an unbounded key would be a write that
  // cannot satisfy the constraint that exists.
  return { ok: true, key: key.slice(0, 120), name: name.slice(0, 255) };
}

module.exports = { companyKeyFor, NOT_A_NAME };
