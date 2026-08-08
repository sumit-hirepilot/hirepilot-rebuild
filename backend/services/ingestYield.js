/*
 * D54 — a resource target is satisfiable by doing nothing, so the work is
 * counted.
 *
 * The nofluffjobs memory fix cut the boot peak to 158MB, the best figure ever
 * recorded on this service, down from 694MB. Idle fell. Heap fell. External
 * memory fell by 147MB. Every budget metric improved.
 *
 * It had also cut that source from 3,054 jobs to 20, because it paged on a
 * parameter the API ignores and re-read the same page forty times. Less work
 * is less memory: every optimisation has a degenerate solution that scores
 * perfectly on the metric being optimised, and that metric cannot detect it.
 *
 * The only thing that disagreed was one ingest count on one log line, and it
 * was luck that I read it. So the count is checked, every cycle, against what
 * this source has produced before.
 *
 * Deliberately NOT a failure. A source genuinely shrinking - a board going
 * quiet, a company list trimmed - is normal and must not fail a cycle. What is
 * not normal is a collapse, and a collapse should be impossible to miss.
 */

/*
 * A drop this steep is not a quiet week. Chosen against the real event: 3,054
 * to 20 is a 99% drop; a board losing half its postings between cycles is
 * plausible and must stay quiet.
 */
const COLLAPSE_RATIO = Number(process.env.INGEST_COLLAPSE_RATIO) || 0.4;

/* Below this the ratio is noise - 2 jobs from 5 is not a signal. */
const MIN_BASELINE = Number(process.env.INGEST_MIN_BASELINE) || 50;

/** How many past runs form the baseline. */
const HISTORY = 5;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * Compare this run's yield against the source's recent history.
 *
 * Median, not mean, so one previous bad run cannot drag the baseline down and
 * mask the next collapse.
 *
 * @returns {{checked: boolean, collapsed: boolean, baseline: number|null, fetched: number, dropPct: number|null}}
 */
async function checkSourceYield(query, source, fetched) {
  let rows;
  try {
    const r = await query(
      `SELECT jobs_fetched FROM source_ingestion_runs
        WHERE source = $1 AND success = true AND jobs_fetched > 0
        ORDER BY started_at DESC
        LIMIT $2`,
      [source, HISTORY]
    );
    rows = r.rows || [];
  } catch (err) {
    // A history lookup that fails must not fail the cycle - it is a check on
    // the work, not the work.
    console.error(`ingest yield check failed for ${source}:`, err.message);
    return { checked: false, collapsed: false, baseline: null, fetched, dropPct: null };
  }

  const baseline = median(rows.map((x) => Number(x.jobs_fetched)).filter(Number.isFinite));

  // Nothing to compare against yet, or the numbers are too small to mean
  // anything. Reported as unchecked rather than as passing.
  if (baseline == null || baseline < MIN_BASELINE) {
    return { checked: false, collapsed: false, baseline, fetched, dropPct: null };
  }

  const dropPct = Math.round(((baseline - fetched) / baseline) * 100);
  const collapsed = fetched < baseline * COLLAPSE_RATIO;

  if (collapsed) {
    console.error(
      `[ingest] ${source} COLLAPSED: ${fetched} jobs this run against a median of ${baseline} `
      + `over the last ${rows.length} runs (${dropPct}% down). `
      + 'A source that stops producing while every resource metric improves is D54: '
      + 'check that the fetch still reaches the data before trusting the memory graph.'
    );
  }

  return { checked: true, collapsed, baseline, fetched, dropPct };
}

module.exports = { checkSourceYield, COLLAPSE_RATIO, MIN_BASELINE, HISTORY, median };
