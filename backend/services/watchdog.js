/*
 * The process names its own death, and ends itself when it is no longer
 * serving.
 *
 * Two outages, both recovered by a human. The second time /api/health returned
 * 200 while /api/jobs returned 502, then everything returned 502 for minutes
 * and stayed there - and it happened again later on code that did NOT contain
 * the change I had blamed for it. So the cause is still unknown, and the only
 * honest response is to make the next one describe itself instead of being
 * inferred from the outside.
 *
 * There IS a Docker HEALTHCHECK, and it has never helped: Railway does not act
 * on Docker health status. A container marked unhealthy sits there marked
 * unhealthy. What the platform does react to is a process that EXITS - so when
 * this one knows it cannot serve, it says why and exits, and the platform
 * restarts it. That is the whole mechanism, and it is deliberately not a second
 * door into anything: it can only end this process, never start work.
 *
 * Nothing here masks a fault. Every path logs a reason first, because an
 * automatic restart that hides why it restarted just converts a visible outage
 * into an invisible one.
 */

/*
 * Tunable by env so the behaviour can actually be EXERCISED - against a dead
 * database, with short intervals, and watched. A watchdog nobody can trigger
 * on demand is a watchdog nobody has seen work.
 */
const num = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const DEFAULTS = {
  intervalMs: num('WATCHDOG_INTERVAL_MS', 30000),   // how often to ask whether we are still serving
  timeoutMs: num('WATCHDOG_TIMEOUT_MS', 8000),      // a probe that hangs this long is a failure
  failuresBeforeExit: num('WATCHDOG_FAILURES', 3),
  memoryLogEveryMs: num('WATCHDOG_MEMORY_MS', 300000),
};

/** ISO-stamped, single-line, greppable. Railway's log view is all we get. */
function log(level, event, detail = {}) {
  const line = { at: new Date().toISOString(), level, event, ...detail };
  const out = level === 'error' ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
}

/**
 * Say why the process is ending, on every path that ends it.
 *
 * `uncaughtException` and an unhandled rejection both terminate Node by
 * default, and both did so silently here - the process vanished and the only
 * evidence was a 502 from the edge. exitCode is preserved so a crash still
 * reads as a crash to the platform.
 */
/*
 * Write the reason where it outlives the container.
 *
 * Best effort and time-boxed: a crash handler that hangs trying to report a
 * crash turns a restart into a wedge, which is the failure it exists to
 * describe. If the database is the thing that died, the log line is still on
 * stderr - this is a second copy, never the only one.
 */
async function persistCrash(record, { sink, timeoutMs = 2000 } = {}) {
  if (!sink) return false;
  try {
    await Promise.race([
      sink(record),
      new Promise((_, reject) => setTimeout(() => reject(new Error('crash sink timed out')), timeoutMs)),
    ]);
    return true;
  } catch (err) {
    log('error', 'crashSinkFailed', { why: err && err.message });
    return false;
  }
}

function installCrashLogging({ exit = (code) => process.exit(code), sink } = {}) {
  const record = (event, err) => ({
    event,
    message: err && err.message,
    stack: err && err.stack,
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    uptimeSeconds: Math.round(process.uptime()),
  });

  const die = async (event, err, code) => {
    const r = record(event, err);
    log('error', event, r);
    // Awaited BEFORE exiting, or the process is gone before the row lands.
    await persistCrash(r, { sink });
    exit(code);
  };

  // Returns the promise: without it nothing can await the write, including
  // the test that proves the reason is stored before the process goes.
  process.on('uncaughtException', (err) => die('uncaughtException', err, 1));

  process.on('unhandledRejection', (reason) => (
    die('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)), 1)
  ));

  // Not crashes - but "why did it stop" is unanswerable without them, and an
  // OOM kill arrives as SIGTERM with nothing else to go on.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    /*
     * An OOM kill arrives as SIGTERM with nothing else to go on, so this is
     * recorded too - it is the shape a memory-driven outage takes.
     */
    process.on(signal, () => die(`signal:${signal}`, new Error(`received ${signal}`), 0));
  }

  process.on('exit', (code) => {
    log(code === 0 ? 'info' : 'error', 'exit', {
      code, rssMb: Math.round(process.memoryUsage().rss / 1048576),
    });
  });
}

/**
 * Ask a real question of a real dependency, on a timer, and end the process if
 * the answer stops coming.
 *
 * The probe must exercise a DATA path. A static liveness endpoint answers
 * "is Node running", which was 200 during an outage where every useful request
 * was failing - the exact reason this takes a probe rather than a ping.
 */
function startWatchdog(probe, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const exit = cfg.exit || ((code) => process.exit(code));
  let consecutiveFailures = 0;

  const withTimeout = () => new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, why: `probe did not answer in ${cfg.timeoutMs}ms` });
    }, cfg.timeoutMs);
    if (timer.unref) timer.unref();

    Promise.resolve()
      .then(probe)
      .then(() => { if (!settled) { settled = true; clearTimeout(timer); resolve({ ok: true }); } })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, why: err && err.message });
      });
  });

  const tick = async () => {
    const result = await withTimeout();
    if (result.ok) {
      if (consecutiveFailures) log('info', 'watchdog.recovered', { after: consecutiveFailures });
      consecutiveFailures = 0;
      return;
    }

    consecutiveFailures += 1;
    log('error', 'watchdog.probeFailed', {
      why: result.why,
      consecutiveFailures,
      failuresBeforeExit: cfg.failuresBeforeExit,
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    });

    if (consecutiveFailures >= cfg.failuresBeforeExit) {
      log('error', 'watchdog.exiting', {
        why: 'no longer serving; exiting so the platform restarts this instance',
        consecutiveFailures,
      });
      exit(1);
    }
  };

  const timer = setInterval(tick, cfg.intervalMs);
  if (timer.unref) timer.unref();

  /*
   * A slow memory climb is the one failure shape that leaves no other trace -
   * and an OOM kill leaves no crash record at all, because the process never
   * runs another instruction. So the TRAJECTORY is persisted, not just the
   * final value: without it the only evidence is one RSS figure taken at the
   * moment something else happened to notice.
   */
  const mem = setInterval(() => {
    const u = process.memoryUsage();
    const sample = {
      event: 'memory',
      rssMb: Math.round(u.rss / 1048576),
      heapUsedMb: Math.round(u.heapUsed / 1048576),
      uptimeSeconds: Math.round(process.uptime()),
    };
    log('info', 'memory', sample);
    if (cfg.sink) {
      persistCrash(
        { ...sample, message: `heapUsed ${sample.heapUsedMb}MB`, stack: null },
        { sink: cfg.sink }
      ).catch(() => {});
    }
  }, cfg.memoryLogEveryMs);
  if (mem.unref) mem.unref();

  return { tick, stop: () => { clearInterval(timer); clearInterval(mem); } };
}

module.exports = { installCrashLogging, startWatchdog, persistCrash, log, DEFAULTS };
