const { Pool } = require('pg');
require('dotenv').config();

// max/connectionTimeoutMillis/idleTimeoutMillis matter more than they look:
// pg's default pool has NO connection-acquire timeout at all, so if every
// connection is busy or stuck (e.g. a burst of concurrent ingestion
// queries), a new query just hangs forever waiting for one to free up -
// no error, no timeout, nothing to catch. Since server startup awaits
// runMigrations() before app.listen(), one hung query at boot means the
// server never starts and every request gets Railway's generic
// "Application failed to respond" with no way to tell why. Bounding
// connection acquisition turns that silent hang into a clear, fast error.
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 15,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    }
  : {
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'hirepilot',
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT || 5432,
      max: 15,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    };

const pool = new Pool(poolConfig);

// connectionTimeoutMillis only bounds waiting for a free connection - once a
// query actually has one, it can still hang forever waiting on a Postgres-
// side lock (e.g. a row another transaction is mid-update on). Cap that too,
// per session, so a stuck query fails loudly instead of hanging the request
// (or, at boot, the whole server) indefinitely.
pool.on('connect', (client) => {
  client.query('SET statement_timeout = 30000').catch((err) => {
    console.error('Failed to set statement_timeout on new connection:', err.message);
  });
});

// A pool error on an idle client (a dropped connection, a Postgres-side
// reset, etc.) is usually recoverable - pg discards the bad client and
// opens a new one on next use. Crashing the whole process here turns a
// transient blip into a full outage, and if the underlying condition
// hasn't cleared by the time Railway restarts the container, it crash-
// loops indefinitely instead of recovering. Log it; let the pool self-heal.
pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client (pool will recover automatically):', err.message);
});

const query = (text, params) => {
  return pool.query(text, params);
};

module.exports = {
  query,
  pool,
};
