require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

const app = express();
const { installCrashLogging, startWatchdog } = require('./services/watchdog');

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'HirePilot API Server' });
});

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', timestamp: result.rows[0] });
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

startServer();
