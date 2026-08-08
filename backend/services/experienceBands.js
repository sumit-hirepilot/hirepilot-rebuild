/*
 * ONE definition of an experience band, shared by the jobs filter, the
 * facet, the per-job label, and rejection intelligence.
 *
 * There were two once (filter vs facet) and the chip lied about 16k jobs;
 * a third copy in the card label was retired the same week. Feature 11
 * needed the definition from a SERVICE - requiring routes/jobs.js from a
 * service inverts the dependency direction and drags express middleware
 * into every unit test - so the definition moved here and jobs.js reads it.
 *
 * The bands match on the TITLE and overlap by construction: "Senior Staff
 * Engineer" is both. SQL bands stay overlapping (the facet says "about");
 * classifyExperience commits to one, staff before senior, because a Senior
 * Staff Engineer is a staff role.
 */

const EXPERIENCE_TERMS = {
  senior: 'senior|sr\\.?|lead|head of',
  staff: 'staff|principal|distinguished',
  entry: 'junior|jr\\.?|entry|intern|graduate',
};

function classifyExperience(title) {
  const t = (title || '').toLowerCase();
  if (new RegExp(`(${EXPERIENCE_TERMS.staff})`).test(t)) return 'staff';
  if (new RegExp(`(${EXPERIENCE_TERMS.senior})`).test(t)) return 'senior';
  if (new RegExp(`(${EXPERIENCE_TERMS.entry})`).test(t)) return 'entry';
  return 'mid';
}

module.exports = { EXPERIENCE_TERMS, classifyExperience };
