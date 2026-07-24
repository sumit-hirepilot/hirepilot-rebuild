require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const authRoutes = require('./routes/auth');

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

// Jobs routes (placeholder)
app.get('/api/jobs', (req, res) => {
  res.json({ message: 'Get jobs endpoint' });
});

app.get('/api/matches', (req, res) => {
  res.json({ message: 'Get matches endpoint' });
});

// Applications routes (placeholder)
app.get('/api/applications', (req, res) => {
  res.json({ message: 'Get applications endpoint' });
});

app.post('/api/applications', (req, res) => {
  res.json({ message: 'Create application endpoint' });
});

app.put('/api/applications/:id/status', (req, res) => {
  res.json({ message: 'Update application status endpoint' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
});

app.listen(PORT, () => {
  console.log(`HirePilot API Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
