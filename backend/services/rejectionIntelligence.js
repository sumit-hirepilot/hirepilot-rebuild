/*
 * Feature 11 — rejection intelligence (D3).
 *
 * Patterns across a user's SENT applications: conversion by source, by
 * seniority band, by current match-score band. The moat thesis is "tell the
 * user why it isn't working" - and the first honest version of that is
 * conversion arithmetic over outcomes the tracker actually recorded, never a
 * model's guess.
 *
 * Two rules carry the feature:
 *
 * 1. THE FLOOR. No claim under 15 applications. Conversion percentages over
 *    a handful of rows read as insight and are noise; the product says "not
 *    enough data yet, here is how far off you are" instead. The same floor
 *    applies per group: a set can be sufficient overall while one source has
 *    two rows, and a rate printed over two rows is a fabricated pattern.
 *    Withheld rates are null - never 0, which is a real measurement.
 *
 * 2. OUTCOMES ARE WHAT WAS RECORDED. interviewing/offer = the employer
 *    responded; rejected (stage, or the legacy status) = a no; ghosted = its
 *    own state, not silently a rejection; anything else is pending and stays
 *    out of every rate's numerator AND is visible as pending, because a
 *    pipeline that is mostly pending must not read as one that is mostly
 *    failing.
 *
 * Score bands use TODAY's score. Score-at-apply was never instrumented
 * (D1 - "build this first, it cannot be backfilled" - was not built first),
 * and back-dating today's number would fabricate history. The payload says
 * so in `definitions`.
 */

// Shared band definition (services/experienceBands) so a fourth copy of the
// experience regexes cannot drift (the A7 lesson: same question, two answers).
const { classifyExperience } = require('./experienceBands');

const MIN_CLAIM = 15;

const SCORE_BANDS = [
  { key: 'strong', label: 'Strong match (75%+)', min: 0.75 },
  { key: 'good', label: 'Good match (60–74%)', min: 0.6 },
  { key: 'fair', label: 'Worth a try (45–59%)', min: 0.45 },
  { key: 'low', label: 'Long shot (under 45%)', min: 0 },
];

function scoreBandKey(score) {
  if (score === null || score === undefined || score === '') return 'unscored';
  const n = Number(score);
  if (!Number.isFinite(n)) return 'unscored';
  for (const b of SCORE_BANDS) if (n >= b.min) return b.key;
  return 'low';
}

function outcomeOf(row) {
  if (row.status === 'rejected' || row.tracker_stage === 'rejected') return 'rejection';
  if (row.tracker_stage === 'interviewing' || row.tracker_stage === 'offer') return 'response';
  if (row.tracker_stage === 'ghosted') return 'ghosted';
  return 'pending';
}

function groupStats(rows) {
  const g = { applications: rows.length, responses: 0, rejections: 0, ghosted: 0, pending: 0 };
  for (const r of rows) {
    const o = outcomeOf(r);
    if (o === 'response') g.responses += 1;
    else if (o === 'rejection') g.rejections += 1;
    else if (o === 'ghosted') g.ghosted += 1;
    else g.pending += 1;
  }
  g.sufficient = g.applications >= MIN_CLAIM;
  // Withheld is null; a measured zero is 0. The floor is what separates them.
  g.responseRate = g.sufficient ? Math.round((g.responses / g.applications) * 100) : null;
  return g;
}

function grouped(rows, keyFn, labelFn = (k) => k) {
  const buckets = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  return [...buckets.entries()]
    .map(([key, rs]) => ({ key, label: labelFn(key), ...groupStats(rs) }))
    .sort((a, b) => b.applications - a.applications);
}

const SENIORITY_LABELS = { entry: 'Entry level', mid: 'Mid level', senior: 'Senior', staff: 'Staff+' };

function analyze(rows) {
  const sentTotal = rows.length;
  const base = {
    sentTotal,
    needed: MIN_CLAIM,
    sufficient: sentTotal >= MIN_CLAIM,
    definitions: {
      responseRate: 'Applications where the employer responded (interview or offer), as a share of everything you sent - pending ones included, so early pipelines read low rather than wrong.',
      ghosted: 'No reply and you marked it gone quiet. Counted separately - silence is not a recorded rejection.',
      scoreBand: "The job's match score on today's calculation. Score at the moment you applied was not recorded, so this is current, not historical.",
    },
  };

  if (!base.sufficient) {
    // No rates under the floor, in any grouping. Absence, stated.
    return { ...base, bySource: null, bySeniority: null, byScoreBand: null };
  }

  const scoreBandLabel = (k) => (k === 'unscored' ? 'Not scored' : SCORE_BANDS.find((b) => b.key === k).label);
  const byScoreBand = grouped(rows, (r) => scoreBandKey(r.overall_score), scoreBandLabel);
  // Every band renders, including empty ones - a missing row and a zero row
  // read differently, and the UI should not have to guess which it is.
  for (const b of [...SCORE_BANDS.map((x) => x.key), 'unscored']) {
    if (!byScoreBand.some((g) => g.key === b)) {
      byScoreBand.push({ key: b, label: scoreBandLabel(b), ...groupStats([]) });
    }
  }

  return {
    ...base,
    bySource: grouped(rows, (r) => r.source || 'unknown'),
    bySeniority: grouped(rows, (r) => classifyExperience(r.title), (k) => SENIORITY_LABELS[k] || k),
    byScoreBand,
  };
}

module.exports = { analyze, MIN_CLAIM, outcomeOf, scoreBandKey };
