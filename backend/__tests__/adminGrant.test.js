/*
 * Item 4 — granting has to exist for enforcing to be safe.
 *
 * The tier gate is now genuinely checked, so without an admin path to place an
 * account on a tier that includes auto-apply, enforcing it would simply switch
 * the feature off for every tester. This is that path.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
  attachUserIfPresent: (req, _res, next) => { req.user = req.user || { id: 42 }; next(); },
}));

const { query } = require('../db');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/plans', require('../routes/plans'));
  return a;
}

const OLD = { ...process.env };
beforeEach(() => { query.mockReset(); process.env = { ...OLD }; delete process.env.ADMIN_HALT_SECRET; });

const asAdmin = (isAdmin) => query.mockImplementation((sql) => {
  if (/SELECT is_admin FROM users/.test(sql)) return Promise.resolve({ rows: [{ is_admin: isAdmin }] });
  if (/UPDATE users/.test(sql)) {
    return Promise.resolve({ rows: [{ id: 9, email: 't@x.c', plan_tier: 'power', credits_total: 4500, credits_used: 0 }] });
  }
  return Promise.resolve({ rows: [] });
});

describe('Item 4 — only an operator can grant', () => {
  it('refuses a normal signed-in user', async () => {
    asAdmin(false);
    const res = await request(app()).post('/api/plans/admin/grant').send({ email: 't@x.c', tier: 'power' });
    expect(res.status).toBe(403);
  });

  it('grants on the admin account', async () => {
    asAdmin(true);
    const res = await request(app()).post('/api/plans/admin/grant').send({ email: 't@x.c', tier: 'power' });
    expect(res.status).toBe(200);
    expect(res.body.autoApplyIncluded).toBe(true);
  });
});

describe('Item 4 — a grant cannot invent a tier or a number', () => {
  it('refuses a tier that does not exist', async () => {
    asAdmin(true);
    const res = await request(app()).post('/api/plans/admin/grant').send({ email: 't@x.c', tier: 'unlimited' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/starter|pro|power/);
  });

  it('defaults credits to the tier allowance rather than a made-up figure', async () => {
    asAdmin(true);
    await request(app()).post('/api/plans/admin/grant').send({ email: 't@x.c', tier: 'power' });
    const upd = query.mock.calls.find((c) => /UPDATE users/.test(c[0]));
    expect(upd[1]).toEqual(['t@x.c', 'power', 4500]);
  });

  it('resets the used counter and the window, so a grant is a fresh month', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'plans.js'), 'utf8');
    const block = src.slice(src.indexOf("router.post('/admin/grant'"));
    expect(block).toMatch(/credits_used = 0/);
    expect(block).toMatch(/credits_reset_at =/);
  });

  it('says plainly when there is no such account', async () => {
    query.mockImplementation((sql) => {
      if (/SELECT is_admin FROM users/.test(sql)) return Promise.resolve({ rows: [{ is_admin: true }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app()).post('/api/plans/admin/grant').send({ email: 'nobody@x.c', tier: 'power' });
    expect(res.status).toBe(404);
  });
});
