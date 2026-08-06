/*
 * A7.20 / A7.8 — ONE definition of the feed's order, rendered two ways.
 *
 * On-demand scoring has to re-sort the page after the scores exist, because
 * the rows arrived from SQL ordered by a score they did not yet have. That
 * needs a comparator in JavaScript that agrees exactly with the SQL ORDER BY -
 * and writing the order out twice is precisely how A7.17's three ranking paths
 * drifted until they disagreed.
 *
 * So the order is declared once as a list of fields, and both the SQL clause
 * and the comparator are generated from it. Changing the order changes both.
 */

const ORDER_FIELDS = {
  // A7.7: match_tier leads, then the chosen key, then a unique final key so
  // rows sharing both a score and a timestamp cannot reshuffle between loads.
  score: ['match_tier ASC', 'overall_score DESC NULLS LAST', 'posted_at DESC NULLS LAST', 'id DESC'],
  recent: ['match_tier ASC', 'posted_at DESC NULLS LAST', 'overall_score DESC NULLS LAST', 'id DESC'],
};

const parseField = (spec) => {
  const [field, ...rest] = spec.split(/\s+/);
  const tail = rest.join(' ');
  return {
    field,
    desc: /\bDESC\b/.test(tail),
    // Postgres defaults DESC to NULLS FIRST and ASC to NULLS LAST. Mirror that,
    // so an omitted NULLS clause means the same thing on both sides.
    nullsLast: /\bNULLS LAST\b/.test(tail) || (!/\bNULLS FIRST\b/.test(tail) && !/\bDESC\b/.test(tail)),
  };
};

/** The ORDER BY clause, without the keyword. */
function orderBySql(sort) {
  return (ORDER_FIELDS[sort] || ORDER_FIELDS.score).join(', ');
}

const valueOf = (row, field) => {
  const v = row[field];
  if (v === null || v === undefined || v === '') return null;
  if (field === 'posted_at') {
    const t = v instanceof Date ? v.getTime() : Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : n;
};

/**
 * A comparator matching orderBySql(sort) exactly.
 *
 * Postgres returns numerics as strings, so every value goes through valueOf
 * rather than being compared raw - "0.9" < "0.75" as strings, which would
 * invert the whole feed while looking like it worked.
 */
function orderFor(sort) {
  const fields = (ORDER_FIELDS[sort] || ORDER_FIELDS.score).map(parseField);
  return (a, b) => {
    for (const { field, desc, nullsLast } of fields) {
      const av = valueOf(a, field);
      const bv = valueOf(b, field);
      if (av === null && bv === null) continue;
      if (av === null) return nullsLast ? 1 : -1;
      if (bv === null) return nullsLast ? -1 : 1;
      if (av < bv) return desc ? 1 : -1;
      if (av > bv) return desc ? -1 : 1;
    }
    return 0;
  };
}


/*
 * A7.8 — the order that decides WHAT GETS APPLIED TO.
 *
 * Separate from the feed's order because it answers a different question. The
 * feed asks "in what order should these be read"; this asks "which of these
 * make the cut", and both callers apply a LIMIT to a ranked list.
 *
 * With many rows sharing a score - and the score is a weighted sum of four
 * coarse components, so ties are common - which jobs fall inside that LIMIT
 * was whatever the plan produced. Two identical requests could queue two
 * different sets of employers, and no one could explain the choice. A unique
 * final key makes the cut-off reproducible.
 *
 * NULLS LAST is here even though both callers filter on `>= minScore`, which
 * a NULL cannot pass. The ordering must not depend on a WHERE clause in
 * another file staying the way it is.
 */
const CANDIDATE_ORDER = ['overall_score DESC NULLS LAST', 'job_id DESC'];

/** The candidate ORDER BY, optionally qualified with a table alias. */
function candidateOrderBySql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return CANDIDATE_ORDER.map((f) => `${prefix}${f}`).join(', ');
}

module.exports = {
  ORDER_FIELDS, orderBySql, orderFor,
  CANDIDATE_ORDER, candidateOrderBySql,
};
