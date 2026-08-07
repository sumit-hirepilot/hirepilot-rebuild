/*
 * Experience, as the words people use about themselves.
 *
 * The target user is 1-15 years in India, self-taught through senior. They do
 * not think "7 years"; they think "senior". So the UI shows the BAND and never
 * the raw number as a label, while what gets stored and scored is the numeric
 * range - the label would have to be re-derived on every read otherwise, and
 * re-labelled everywhere the day the bands move.
 *
 * ONE declaration. Written out a second time in a component, the chips and the
 * scoring drift, which is the defect A7.17 and A7.8 were both about.
 *
 * Never used to gate. A band narrows what is shown by default; it never
 * withholds a feature, and nothing here returns a permission.
 */
export const EXPERIENCE_BANDS = [
  { id: 'entry', label: 'Entry', hint: '0-2 years', minYears: 0, maxYears: 2 },
  { id: 'mid', label: 'Mid', hint: '2-5 years', minYears: 2, maxYears: 5 },
  { id: 'senior', label: 'Senior', hint: '5-9 years', minYears: 5, maxYears: 9 },
  { id: 'lead', label: 'Lead', hint: '9-15 years', minYears: 9, maxYears: 15 },
];

/** The band a stored range came from, or null when none was ever chosen. */
export function bandForRange(minYears, maxYears) {
  if (minYears === null || minYears === undefined) return null;
  return EXPERIENCE_BANDS.find((b) => b.minYears === minYears && b.maxYears === maxYears) || null;
}

/**
 * The band a parsed resume suggests, so the chips arrive pre-answered rather
 * than as an empty question. A suggestion, never a decision: it is rendered
 * as selected and the user can change it in one tap.
 */
export function bandForYears(years) {
  const n = Number(years);
  if (!Number.isFinite(n) || n < 0) return null;
  return EXPERIENCE_BANDS.find((b) => n >= b.minYears && n <= b.maxYears)
    || EXPERIENCE_BANDS[EXPERIENCE_BANDS.length - 1];
}
