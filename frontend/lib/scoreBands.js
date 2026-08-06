/*
 * Wave C — a number alone does not tell someone what to do.
 *
 * "78%" is a measurement; "Strong match · 78%" is a judgement plus its
 * evidence. The first-time user this is built for - one to fifteen years in,
 * self-taught through senior - should not have to learn what a good score
 * looks like by scrolling until the numbers change.
 *
 * The number stays, always. The word is added in front of it, never instead of
 * it: replacing the figure would be the same product being less honest.
 *
 * ONE definition, used by every surface. Two lists of bands drift, and the day
 * they do the Dashboard and the Jobs page disagree about the same job.
 */

export const BANDS = [
  { min: 0.75, label: 'Strong match', tone: 'strong' },
  { min: 0.60, label: 'Good match', tone: 'good' },
  { min: 0.45, label: 'Worth a try', tone: 'fair' },
  { min: 0, label: 'Long shot', tone: 'low' },
];

/**
 * The band for a 0..1 score, or null when there is no score.
 *
 * Null is not "Long shot". An unscored job is one we could not judge, and
 * calling that a long shot would be inventing a judgement - the same defect as
 * rendering a missing count as 0.
 */
export function bandFor(score) {
  if (score === null || score === undefined || score === '') return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  return BANDS.find((b) => n >= b.min) || BANDS[BANDS.length - 1];
}

/** "Strong match · 78%", or null when there is nothing to say. */
export function scoreLabel(score) {
  const band = bandFor(score);
  if (!band) return null;
  return `${band.label} · ${Math.round(Number(score) * 100)}%`;
}
