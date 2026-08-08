/*
 * L1 — a feature that cannot function without a credential must not present
 * as working, and must light up the moment the credential appears, with no
 * code change. That means ONE definition of "what is connected", driven by
 * the actual environment, readable by any surface.
 *
 * Only capabilities whose CODE is complete belong here. Payments stays a
 * labelled stub on /pricing instead: its integration does not exist, so an
 * env-driven flag would light up a feature with nothing behind it.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));

const { capabilities } = require('../services/capabilities');

describe('the capability definition is env-driven', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env.INBOUND_MAIL_SECRET = OLD.INBOUND_MAIL_SECRET;
    process.env.ATS_SANDBOX_ENABLED = OLD.ATS_SANDBOX_ENABLED;
    if (OLD.INBOUND_MAIL_SECRET === undefined) delete process.env.INBOUND_MAIL_SECRET;
    if (OLD.ATS_SANDBOX_ENABLED === undefined) delete process.env.ATS_SANDBOX_ENABLED;
  });

  it('inboundMail follows INBOUND_MAIL_SECRET in both directions', () => {
    delete process.env.INBOUND_MAIL_SECRET;
    expect(capabilities().inboundMail).toBe(false);
    process.env.INBOUND_MAIL_SECRET = 's';
    expect(capabilities().inboundMail).toBe(true);
  });

  it('atsSandbox follows ATS_SANDBOX_ENABLED', () => {
    delete process.env.ATS_SANDBOX_ENABLED;
    expect(capabilities().atsSandbox).toBe(false);
    process.env.ATS_SANDBOX_ENABLED = 'true';
    expect(capabilities().atsSandbox).toBe(true);
  });

  it('never exposes a secret value, only booleans', () => {
    process.env.INBOUND_MAIL_SECRET = 'super-secret-value';
    const caps = capabilities();
    expect(JSON.stringify(caps)).not.toContain('super-secret-value');
    for (const v of Object.values(caps)) expect(typeof v).toBe('boolean');
  });
});

describe('GET /api/capabilities', () => {
  it('serves the definition without auth - login-adjacent surfaces need it too', async () => {
    process.env.INBOUND_MAIL_SECRET = 's';
    const app = require('../index');
    const res = await request(app).get('/api/capabilities');
    expect(res.status).toBe(200);
    expect(res.body.inboundMail).toBe(true);
    delete process.env.INBOUND_MAIL_SECRET;
    const res2 = await request(app).get('/api/capabilities');
    expect(res2.body.inboundMail).toBe(false);
  });
});

describe('the inbox payload and the capabilities endpoint cannot disagree', () => {
  it('routes/inbox derives inboundConfigured from the shared definition', () => {
    const src = require('fs').readFileSync(require.resolve('../routes/inbox'), 'utf8');
    expect(src).toMatch(/require\('\.\.\/services\/capabilities'\)/);
    // The route no longer reads the env var directly for the flag.
    expect(src).not.toMatch(/inboundConfigured: Boolean\(process\.env/);
  });
});
