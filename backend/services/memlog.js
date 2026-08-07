/*
 * RSS at named points, so a memory spike can be located instead of guessed at.
 *
 * The early-boot peak (687 MB RSS / 458 MB heap at ~22s uptime, against a
 * 500 MB budget and a 1 GB container ceiling) cost two wrong hypotheses before
 * anything was measured: concurrent source fetches, which GOAL 1d had already
 * made sequential, and the search-agent scan, which cannot have been it because
 * the environment has zero active agents.
 *
 * `/api/health` samples the process from outside and can only ever say WHEN.
 * This says WHERE, and it costs one `process.memoryUsage()` call - microseconds,
 * no allocation of consequence - at points that are already logging anyway.
 *
 * Deliberately permanent. The next spike deserves a measurement rather than a
 * third guess, and a diagnostic that has to be added back under pressure is one
 * nobody has.
 */

const MB = (n) => Math.round(n / 1024 / 1024);

let peakRss = 0;

/**
 * @param {string} label  where we are, in words that will mean something in a log
 * @param {object} [extra] counts worth having beside the number
 */
function mem(label, extra) {
  const u = process.memoryUsage();
  const rss = MB(u.rss);
  if (rss > peakRss) peakRss = rss;

  const parts = [
    `[mem] ${label}`,
    `rss=${rss}MB`,
    `heap=${MB(u.heapUsed)}/${MB(u.heapTotal)}MB`,
    `ext=${MB(u.external)}MB`,
    `peak=${peakRss}MB`,
  ];
  if (extra) {
    for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${v}`);
  }
  console.log(parts.join(' '));
  return rss;
}

/** The high-water mark this process has reached, for /api/health to report. */
const peak = () => peakRss;

module.exports = { mem, peak };
