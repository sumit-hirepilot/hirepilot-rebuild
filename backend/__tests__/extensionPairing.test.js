/*
 * E5 — the extension pairs with a short one-time code, not the login token.
 *
 * The old flow copied the user's 7-day JWT into the extension: a password in a
 * text box. These tests pin the replacement's load-bearing properties:
 *   - the plaintext code never reaches the database — only its SHA-256 does;
 *   - a valid code exchanges for an extension-scoped token that verifies to the
 *     right user;
 *   - the code is single-use and expiry-bounded, enforced by an atomic UPDATE,
 *     so an unknown / spent / expired code yields no token;
 *   - /pair refuses an unauthenticated caller; /exchange requires no auth,
 *     because the code itself is the one-time bearer.
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

const { query } = require('../db');
const authRouter = require('../routes/auth');
const pairing = require('../services/extensionPairing');

const SECRET = process.env.JWT_SECRET || 'dev-secret';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', authRouter);
  return a;
}

const loginToken = jwt.sign({ id: 42, email: 'paired@example.com' }, SECRET);

beforeEach(() => {
  query.mockReset();
});

describe('extensionPairing service — the code is a secret, the store holds only its hash', () => {
  it('hashes case- and separator-insensitively, and never stores the code itself', () => {
    const a = pairing._hash('abcd-efgh');
    const b = pairing._hash('ABCD EFGH');
    const c = pairing._hash('ABCDEFGH');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
    expect(a).not.toContain('ABCDEFGH');
  });
});

describe('POST /api/auth/extension/pair', () => {
  it('refuses an unauthenticated caller', async () => {
    const res = await request(app()).post('/api/auth/extension/pair').send({});
    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a typeable one-time code and stores only its hash', async () => {
    let storedHash = null;
    query.mockImplementation((sql, params) => {
      if (/INSERT INTO extension_pairings/.test(sql)) {
        storedHash = params[1];
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] }); // the two housekeeping DELETEs
    });

    const res = await request(app())
      .post('/api/auth/extension/pair')
      .set('Authorization', `Bearer ${loginToken}`)
      .send({});

    expect(res.status).toBe(200);
    // Human-typeable: XXXX-XXXX from an unambiguous alphabet, no 0/O/1/I/L/U.
    expect(res.body.code).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTVWXYZ2-9]{4}$/);
    expect(res.body.ttlSeconds).toBe(600);
    // What landed in the table is the hash of the code, not the code.
    expect(storedHash).toBe(pairing._hash(res.body.code));
    expect(storedHash).not.toBe(res.body.code.replace('-', ''));
  });
});

describe('POST /api/auth/extension/exchange', () => {
  it('rejects an empty code', async () => {
    const res = await request(app()).post('/api/auth/extension/exchange').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pairing code/i);
  });

  it('exchanges a valid code for an extension-scoped token for the right user', async () => {
    let redeemHash = null;
    query.mockImplementation((sql, params) => {
      if (/UPDATE extension_pairings/.test(sql)) {
        redeemHash = params[0];
        return Promise.resolve({ rows: [{ user_id: 42 }] }); // atomic consume hit
      }
      if (/FROM users WHERE id/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 42, email: 'paired@example.com', full_name: 'P' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app())
      .post('/api/auth/extension/exchange')
      .send({ code: 'ABCD-EFGH' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    // Redeem looked up by HASH, never by the raw code.
    expect(redeemHash).toBe(pairing._hash('ABCD-EFGH'));
    // The minted token verifies to the user, and is marked as an extension token.
    const decoded = jwt.verify(res.body.token, SECRET);
    expect(decoded.id).toBe(42);
    expect(decoded.email).toBe('paired@example.com');
    expect(decoded.scope).toBe('extension');
    // It is NOT the caller's login token being handed back.
    expect(res.body.token).not.toBe(loginToken);
  });

  it('gives no token for an unknown, expired, or already-used code', async () => {
    // The atomic UPDATE matches nothing — the single answer for invalid/spent/expired.
    query.mockImplementation((sql) => {
      if (/UPDATE extension_pairings/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app())
      .post('/api/auth/extension/exchange')
      .send({ code: 'ZZZZ-ZZZZ' });

    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
    expect(res.body.error).toMatch(/invalid or has expired/i);
    // The user lookup is never reached when redeem fails.
    expect(query.mock.calls.some(([sql]) => /FROM users WHERE id/.test(sql))).toBe(false);
  });

  it('the exchanged token authenticates a protected route', async () => {
    query.mockImplementation((sql) => {
      if (/UPDATE extension_pairings/.test(sql)) return Promise.resolve({ rows: [{ user_id: 42 }] });
      if (/FROM users WHERE id/.test(sql)) return Promise.resolve({ rows: [{ id: 42, email: 'paired@example.com', full_name: 'P' }] });
      return Promise.resolve({ rows: [] });
    });

    const paired = await request(app()).post('/api/auth/extension/exchange').send({ code: 'ABCD-EFGH' });
    const token = paired.body.token;

    // Re-use it on /me, the same middleware every extension call goes through.
    query.mockImplementation((sql) => {
      if (/FROM users WHERE id/.test(sql)) return Promise.resolve({ rows: [{ id: 42, email: 'paired@example.com' }] });
      return Promise.resolve({ rows: [] });
    });
    const me = await request(app()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('paired@example.com');
  });
});
