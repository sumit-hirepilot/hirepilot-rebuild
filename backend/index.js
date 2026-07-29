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
const { startScheduler } = require('./services/scheduler');
const { runMigrations } = require('./services/migrations');

const app = express();
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
  app.listen(PORT, () => {
    console.log(`HirePilot API Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });

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
