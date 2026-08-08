/*
 * CORS is an allowlist, and it is enforced by the app that actually ships.
 *
 * `app.use(cors())` with no argument answers every request with
 * `Access-Control-Allow-Origin: *`. That is not a scoping mistake on one route
 * - it is the whole surface, including every authenticated one, so any page on
 * any domain could read this API's responses from a visitor's browser.
 *
 * This is defence in depth rather than a fix for a live CSRF hole: auth here is
 * a Bearer token the browser does not attach on its own, so a drive-by page
 * cannot borrow a session the way it could with cookies. It still must not be
 * `*`. A token pasted into a malicious page, an XSS anywhere with a token in
 * reach, or the day something moves to a cookie, all end differently depending
 * on whether this header names one origin or every origin.
 *
 * These tests go through `require('../index')` - the real app, real route
 * table, real middleware order - rather than a hand-built express app carrying
 * a copy of the middleware. The difference is the one D-series keeps paying
 * for: a correct guard that nothing is wired to passes every test written
 * against the guard itself. The question here is not "does the allowlist
 * work", it is "does the served API refuse an unknown origin".
 *
 * Both directions are asserted throughout. A policy that denies everything is
 * as broken as one that allows everything, and denies-everything passes every
 * negative test on its own.
 */

const request = require('supertest');

jest.mock('../db', () => {
  const query = jest.fn().mockResolvedValue({ rows: [{ now: '2026-08-08T00:00:00.000Z' }] });
  return { query, pool: { query } };
});
jest.mock('../services/watchdog', () => ({
  installCrashLogging: jest.fn(),
  startWatchdog: jest.fn(),
}));
jest.mock('../services/migrations', () => ({ runMigrations: jest.fn().mockResolvedValue() }));
jest.mock('../services/scheduler', () => ({ startScheduler: jest.fn() }));

const APP_ORIGIN = 'https://frontend-production-0d14b.up.railway.app';
const ATTACKER = 'https://evil.example.com';

const OLD_ENV = { ...process.env };

let app;
beforeAll(() => {
  process.env.FRONTEND_URL = APP_ORIGIN;
  app = require('../index');
});

beforeEach(() => {
  process.env = { ...OLD_ENV, FRONTEND_URL: APP_ORIGIN };
});

afterAll(() => {
  process.env = { ...OLD_ENV };
});

const allowHeader = (res) => res.headers['access-control-allow-origin'];

/* ------------------------------------------------------------------ *
 * The headline claim: an unknown origin gets no allow header.
 * ------------------------------------------------------------------ */
describe('an origin that is not on the list is not granted access', () => {
  it('sends no allow header to an unknown origin', async () => {
    const res = await request(app).get('/').set('Origin', ATTACKER);
    expect(allowHeader(res)).toBeUndefined();
  });

  it('never answers any origin with the wildcard', async () => {
    // The specific regression: `*` satisfies "an allow header is present" for
    // every caller at once, so asserting only on the allowed origin above
    // would stay green on exactly the code being replaced.
    for (const origin of [APP_ORIGIN, ATTACKER, 'null']) {
      const res = await request(app).get('/').set('Origin', origin);
      expect(allowHeader(res)).not.toBe('*');
    }
  });

  it('refuses the unknown origin on an AUTHENTICATED route too', async () => {
    /*
     * The route table is the point. `cors()` was mounted before every router,
     * so the wildcard covered the authenticated surface as well - which is the
     * half that actually matters. 401 here is the auth middleware doing its
     * job; the assertion is that the refusal carries no allow header with it.
     */
    const res = await request(app).get('/api/profile').set('Origin', ATTACKER);
    expect(allowHeader(res)).toBeUndefined();
  });

  it('refuses a preflight from an unknown origin', async () => {
    const res = await request(app)
      .options('/api/profile')
      .set('Origin', ATTACKER)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(allowHeader(res)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * The counterpart: the app's own frontend still works.
 * ------------------------------------------------------------------ */
describe('the configured frontend origin is granted access', () => {
  it('names the frontend origin exactly, on a normal request', async () => {
    const res = await request(app).get('/').set('Origin', APP_ORIGIN);
    expect(allowHeader(res)).toBe(APP_ORIGIN);
  });

  it('answers its preflight, and lets the Bearer header through', async () => {
    // Every authenticated call from the frontend is a preflight first, because
    // Authorization is not a CORS-safelisted header. If this one is wrong the
    // product is down, not merely less safe.
    const res = await request(app)
      .options('/api/profile')
      .set('Origin', APP_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');

    expect(allowHeader(res)).toBe(APP_ORIGIN);
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain('authorization');
  });

  it('serves a caller that sends no Origin at all', async () => {
    /*
     * curl, the platform health check, and the extension's service worker all
     * send no Origin. Refusing those would break the container health probe
     * before it broke anything else. Browsers always send Origin on a
     * cross-origin request, so allowing the absent case gives a page nothing.
     */
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  it('varies on Origin, so a cache cannot hand one origin another\'s response', async () => {
    // Without this a shared cache can store the allowed response and replay it,
    // header and all, to the origin that was just refused.
    const res = await request(app).get('/').set('Origin', APP_ORIGIN);
    expect(String(res.headers.vary)).toMatch(/Origin/i);
  });
});

/* ------------------------------------------------------------------ *
 * Matching is exact. Substring and prefix matching are the standard way
 * an allowlist is bypassed.
 * ------------------------------------------------------------------ */
describe('a lookalike origin does not pass as the real one', () => {
  const lookalikes = [
    // Registrable-suffix attack: passes `startsWith`, and the attacker owns it.
    `${APP_ORIGIN}.evil.example.com`,
    // Passes `endsWith` and `includes`.
    'https://evil-frontend-production-0d14b.up.railway.app',
    'https://evil.example.com/frontend-production-0d14b.up.railway.app',
    // Same host, wrong scheme - downgrades the connection.
    APP_ORIGIN.replace('https://', 'http://'),
    // Same host, explicit off-port.
    `${APP_ORIGIN}:8443`,
  ];

  it.each(lookalikes)('refuses %s', async (origin) => {
    const res = await request(app).get('/').set('Origin', origin);
    expect(allowHeader(res)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * Configuration: the env var is what drives it.
 * ------------------------------------------------------------------ */
describe('FRONTEND_URL drives the list', () => {
  it('accepts more than one origin, because two deploys are live', async () => {
    // The old Railway service and the migration target both point at this API
    // during the cutover, so the list has to hold both at once.
    const OTHER = 'https://hirepilot-production-e70d.up.railway.app';
    process.env.FRONTEND_URL = `${APP_ORIGIN},${OTHER}`;

    for (const origin of [APP_ORIGIN, OTHER]) {
      const res = await request(app).get('/').set('Origin', origin);
      expect(allowHeader(res)).toBe(origin);
    }
  });

  it('tolerates a trailing slash and surrounding whitespace in the value', async () => {
    // What gets pasted into a Railway variable box. An entry that silently
    // never matches would be found in production, by the frontend being down.
    process.env.FRONTEND_URL = `  ${APP_ORIGIN}/  `;
    const res = await request(app).get('/').set('Origin', APP_ORIGIN);
    expect(allowHeader(res)).toBe(APP_ORIGIN);
  });

  it('grants nothing when FRONTEND_URL is unset in production', async () => {
    /*
     * Fail closed. An unset variable must not read as "allow anything" - that
     * is the bug being fixed, reintroduced through a missing deploy step.
     */
    process.env.NODE_ENV = 'production';
    delete process.env.FRONTEND_URL;

    const res = await request(app).get('/').set('Origin', APP_ORIGIN);
    expect(allowHeader(res)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * Development convenience must not become a production hole.
 * ------------------------------------------------------------------ */
describe('localhost is a development allowance only', () => {
  it('allows the local frontend while developing', async () => {
    process.env.NODE_ENV = 'development';
    for (const origin of ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000']) {
      const res = await request(app).get('/').set('Origin', origin);
      expect(allowHeader(res)).toBe(origin);
    }
  });

  it('does NOT allow localhost in production', async () => {
    /*
     * The one that would quietly undo the fix. A page served from a developer's
     * machine - or any local process on a visitor's own machine - must not be
     * able to read production responses.
     */
    process.env.NODE_ENV = 'production';
    const res = await request(app).get('/').set('Origin', 'http://localhost:3000');
    expect(allowHeader(res)).toBeUndefined();
  });
});
