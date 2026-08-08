require('dotenv').config();
const express = require('express');
const { corsMiddleware, warnIfNoAllowlist } = require('./middleware/cors');
const { pool } = require('./db');
const authRoutes = require('./routes/auth');
const jobsRoutes = require('./routes/jobs');
const matchesRoutes = require('./routes/matches');
const applicationsRoutes = require('./routes/applications');
const profileRoutes = require('./routes/profile');
const resumeRoutes = require('./routes/resume');
const agentsRoutes = require('./routes/agents');
const networkRoutes = require('./routes/network');
const activityRoutes = require('./routes/activity');
const notificationsRoutes = require('./routes/notifications');
const analyticsRoutes = require('./routes/analytics');
const applyRoutes = require('./routes/apply');
const inboxRoutes = require('./routes/inbox');
const trackerRoutes = require('./routes/tracker');
const plansRoutes = require('./routes/plans');
const { startScheduler } = require('./services/scheduler');
const { runMigrations } = require('./services/migrations');
// `memLog`, not `mem`: the health handler below already binds `mem` to a
// process.memoryUsage() snapshot, and two different meanings for one name in
// one file is how the wrong one gets called.
const { mem: memLog, peak: memPeak } = require('./services/memlog');

const app = express();
const { installCrashLogging, startWatchdog } = require('./services/watchdog');

const PORT = process.env.PORT || 3000;

app.use(corsMiddleware);
/*
 * Q5 — the inbound-mail webhook gets its own parsers BEFORE the global ones,
 * with a larger bound: a real provider payload (full text part plus headers)
 * routinely exceeds express.json's 100kb default, and a 413 here makes the
 * provider retry for days and then disable the webhook. 2 MB matches the
 * multipart field bound in routes/inbox.js; the stored fields are still
 * sliced to their own limits on the way in. The global parsers skip a body
 * these have already consumed.
 */
app.use('/api/inbox/inbound', express.json({ limit: '2mb' }));
app.use('/api/inbox/inbound', express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'HirePilot API Server' });
});

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    /*
     * GOAL 1e — RSS on demand, because the load test needs a reading per step
     * and the watchdog only samples every five minutes. The ceiling is 1 GB
     * (Railway trial plan limit), so this is the number that decides whether
     * the process survives a given level of concurrency.
     */
    const mem = process.memoryUsage();
    res.json({
      status: 'ok',
      timestamp: result.rows[0],
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      // High-water mark since boot. rssMb alone cannot show a spike that has
      // already fallen back, which is exactly the shape of the boot peak.
      peakRssMb: memPeak(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Auth routes
app.use('/api/auth', authRoutes);

// Jobs routes
app.use('/api/jobs', jobsRoutes);

// Matches routes
app.use('/api/matches', matchesRoutes);

// Applications routes
app.use('/api/applications', applicationsRoutes);

// Profile routes (skills, experience, preferences)
app.use('/api/profile', profileRoutes);

// Resume routes
app.use('/api/resume', resumeRoutes);

// Search agents routes
app.use('/api/agents', agentsRoutes);

// Network / referrals routes
app.use('/api/network', networkRoutes);

// Activity feed routes
app.use('/api/activity', activityRoutes);

// Notification center routes
app.use('/api/notifications', notificationsRoutes);

// Analytics routes
app.use('/api/analytics', analyticsRoutes);

// Application queue, Application Profile, and the submission-evidence ingest
// the browser extension posts back to.
app.use('/api/apply', applyRoutes);

// Recruiter mail routed to a per-user proxy address and categorised (PRD 3.4).
app.use('/api/inbox', inboxRoutes);

// Kanban pipeline of applications that actually reached an employer (PRD 3.5).
app.use('/api/tracker', trackerRoutes);

// Tiers, allowances, and the credit counter (PRD 6).
app.use('/api/plans', plansRoutes);

// The controlled submission target that stands in for an employer's ATS
// while A5 is unresolved. See routes/atsSandbox.js for what it does and
// does not prove.
app.use('/api/ats-sandbox', require('./routes/atsSandbox'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
});

// Start listening FIRST, independent of the database. Previously this
// awaited runMigrations() before ever calling app.listen() - fine when the
// DB is healthy, but if it's unreachable, ~35 sequential migration
// statements each waiting out the full connection/statement timeout adds
// up to several minutes before the server binds to its port at all. That's
// longer than a typical platform deploy health-check window, so the
// container gets killed and restarted before startup ever finishes,
// looping indefinitely with zero live server the whole time - including no
// way to hit /api/health and see what's actually wrong. Listening
// immediately means the app (and its real-time diagnostics) stays
// reachable even during a database outage; only DB-backed routes fail,
// each already handling that per-request via their own try/catch.
function startServer() {
  /*
   * Say why, before dying. Two outages ended with the process simply gone and
   * a 502 from the edge as the only evidence - uncaughtException and an
   * unhandled rejection both terminate Node by default, and neither left a
   * line behind. The second outage then recurred on code that did NOT contain
   * the change I had blamed, so the cause is still unknown and the next one
   * has to describe itself.
   */
  /*
   * The sink writes the reason to the database, so it survives the container.
   * Railway's log retention on a crash-looping service is exactly the case
   * where stderr is least likely to still be readable, and that is the case
   * this instrumentation exists for. Deliberately best-effort: if the database
   * is the thing that died, the stderr line is still there and the process
   * still exits on time - see persistCrash's timeout.
   */
  /*
   * Where a crash reason goes so it outlives the container. The same sink
   * carries the memory trajectory: an OOM kill leaves NO crash record - the
   * process never runs another instruction - so the only way to see one
   * coming is a series of samples written while it is still alive.
   */
  const crashSink = (r) => pool.query(
    `INSERT INTO crash_reports (event, message, stack, rss_mb, uptime_seconds)
     VALUES ($1, $2, $3, $4, $5)`,
    [r.event, r.message || null, r.stack || null, r.rssMb ?? null, r.uptimeSeconds ?? null]
  );

  installCrashLogging({ sink: crashSink });

  app.listen(PORT, () => {
    console.log(`HirePilot API Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  /*
   * End the process when it stops being able to serve, so the platform
   * restarts it. There is a Docker HEALTHCHECK already and it has never
   * helped: Railway does not act on Docker health status, so a wedged
   * container sits there marked unhealthy until a human redeploys it. Both
   * recoveries so far have been me.
   *
   * The probe is a real query, not a ping. During the second outage
   * /api/health answered 200 while /api/jobs was failing, so "is Node alive"
   * is precisely the question that does not distinguish serving from wedged.
   */
  startWatchdog(() => pool.query('SELECT 1'), { sink: crashSink });

  // Said at boot, because an empty allowlist is invisible to every check
  // that does not use a browser.
  warnIfNoAllowlist();
  memLog('boot:before migrations');
  runMigrations()
    .then(() => {
      if (process.env.NODE_ENV !== 'test') {
        startScheduler();
      }
    })
    .catch((err) => {
      console.error('Migrations failed to complete:', err.message);
    });
}

/*
 * Start only when run as the entry point, so the app itself can be required by
 * a test without binding a port, installing crash handlers or starting the
 * watchdog's timers. `npm start` and the container's `node index.js` both still
 * take this branch.
 *
 * The CORS allowlist is the reason this matters: mounting the middleware on a
 * hand-built express app in a test proves the middleware works, not that THIS
 * app uses it — the exact gap D-series keeps finding, where a guard is correct
 * and simply not wired to anything. Exporting the real app lets the test send a
 * real request to a real route through the real middleware stack.
 */
if (require.main === module) {
  startServer();
}

module.exports = app;
