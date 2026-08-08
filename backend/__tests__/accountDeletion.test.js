/*
 * L5 — the deletion path must actually delete.
 *
 * The settings page carried a "Delete my account" button whose entire
 * behaviour was flash('Account deletion is disabled in this demo
 * deployment.') — a control that looks like it works, on a product holding
 * resumes and application history.
 *
 * The real path: DELETE /api/auth/account, password re-entered (destructive
 * actions get a second factor), one transaction on ONE pooled client - SET
 * LOCAL scopes to a transaction, and the pool hands different connections to
 * different query() calls, so a multi-call version would set the flag on one
 * connection and delete on another.
 *
 * The receipts trigger needs the one legitimate exception: receipts are
 * append-only against EDITING history, but the person leaving takes their
 * records with them. DELETE passes only inside an account-deletion
 * transaction; UPDATE never passes at all.
 */

const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');

jest.mock('../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

const { query, pool } = require('../db');
const authRouter = require('../routes/auth');
const { STATEMENTS } = require('../services/migrations');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', authRouter);
  return a;
}

// The auth router's own verifyToken is real; use a real signed token instead
// of mocking the middleware, since this suite exercises auth end to end.
const jwt = require('jsonwebtoken');
const token = jwt.sign({ id: 42, email: 'leaver@example.com' }, process.env.JWT_SECRET || 'dev-secret');

function mockClient() {
  const calls = [];
  const client = {
    query: jest.fn(async (sql) => { calls.push(String(sql)); return { rows: [] }; }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);
  return { client, calls };
}

describe('DELETE /api/auth/account', () => {
  beforeEach(() => {
    query.mockReset();
    pool.connect.mockReset();
  });

  it('refuses without the password re-entered', async () => {
    const res = await request(app())
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('refuses a wrong password and deletes nothing', async () => {
    const hash = await bcrypt.hash('right-password', 4);
    query.mockResolvedValueOnce({ rows: [{ id: 42, password_hash: hash }] });
    const { client } = mockClient();

    const res = await request(app())
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'wrong' });

    expect(res.status).toBe(401);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('deletes in one transaction on one client, flag set locally', async () => {
    const hash = await bcrypt.hash('right-password', 4);
    query.mockResolvedValueOnce({ rows: [{ id: 42, password_hash: hash }] });
    const { client, calls } = mockClient();

    const res = await request(app())
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'right-password' });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    const begin = calls.findIndex((c) => /^BEGIN/i.test(c));
    const setLocal = calls.findIndex((c) => /SET LOCAL hirepilot\.account_deletion/i.test(c));
    const del = calls.findIndex((c) => /DELETE FROM users/i.test(c));
    const commit = calls.findIndex((c) => /^COMMIT/i.test(c));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(setLocal).toBeGreaterThan(begin);
    expect(del).toBeGreaterThan(setLocal);
    expect(commit).toBeGreaterThan(del);
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back and reports honestly when the delete fails', async () => {
    const hash = await bcrypt.hash('right-password', 4);
    query.mockResolvedValueOnce({ rows: [{ id: 42, password_hash: hash }] });
    const calls = [];
    const client = {
      query: jest.fn(async (sql) => {
        calls.push(String(sql));
        if (/DELETE FROM users/i.test(String(sql))) throw new Error('boom');
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    const res = await request(app())
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'right-password' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/could not.*delete|not.*deleted/i);
    expect(calls.some((c) => /^ROLLBACK/i.test(c))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('the receipts trigger gains its one legitimate exception', () => {
  it('the FINAL trigger function lets DELETE through only inside an account deletion', () => {
    const defs = STATEMENTS.filter((s) => /FUNCTION submission_receipts_are_immutable/.test(s));
    const finalDef = defs[defs.length - 1];
    expect(defs.length).toBeGreaterThanOrEqual(2); // original + the L5 replacement
    expect(finalDef).toMatch(/current_setting\('hirepilot\.account_deletion', true\)/);
    expect(finalDef).toMatch(/TG_OP = 'DELETE'/);
    // UPDATE has no escape, in any state. History stays unrewritable.
    expect(finalDef).not.toMatch(/TG_OP = 'UPDATE'[\s\S]*RETURN/);
  });
});


describe('GET /api/auth/export — the privacy page promises it', () => {
  it('returns every user-owned table as one JSON document', async () => {
    query.mockReset();
    query.mockImplementation((sql) => {
      if (/FROM users WHERE id/.test(sql)) return Promise.resolve({ rows: [{ id: 42, email: 'leaver@example.com', full_name: 'L' }] });
      if (/FROM resumes/.test(sql)) return Promise.resolve({ rows: [{ id: 1, label: 'r' }] });
      if (/FROM applications/.test(sql)) return Promise.resolve({ rows: [{ id: 2 }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app())
      .get('/api/auth/export')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body.account.email).toBe('leaver@example.com');
    expect(res.body.resumes).toHaveLength(1);
    expect(res.body.applications).toHaveLength(1);
    // Never the hash - an export is the user's data, not the system's secrets.
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash/);
    // Every query is scoped to the caller.
    for (const c of query.mock.calls) {
      expect(c[1]).toContain(42);
    }
  });
});
