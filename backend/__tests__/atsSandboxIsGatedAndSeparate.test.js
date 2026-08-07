/*
 * The controlled submission target must be a DOOR THAT IS SHUT by default, and
 * it must never be mistaken for Greenhouse.
 *
 * A5 gates driving automation against a real employer's board, so the pipeline
 * is proved against a target of ours instead. That target is a weakening, and a
 * weakening that is always on is not a test fixture, it is a second entrance to
 * the submission path - the exact thing SUPPORTED_ATS exists to control.
 *
 * Two separate things are asserted, because they fail differently:
 *   - the flag is OFF unless set, so production is unchanged
 *   - the platform is `ats_sandbox`, NEVER `greenhouse`, so no row, screen or
 *     receipt can report a HirePilot URL as an employer's ATS
 */

const SANDBOX_URL = 'https://frontend-production-0d14b.up.railway.app/ats-sandbox/greenhouse';

function loadApply(env) {
  jest.resetModules();
  const before = process.env.ATS_SANDBOX_ENABLED;
  if (env === undefined) delete process.env.ATS_SANDBOX_ENABLED;
  else process.env.ATS_SANDBOX_ENABLED = env;

  jest.doMock('../db', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }));
  jest.doMock('../middleware/auth', () => ({
    verifyToken: (req, _res, next) => { req.user = { id: 1 }; next(); },
    attachUserIfPresent: (_req, _res, next) => next(),
  }));
  // eslint-disable-next-line global-require
  const mod = require('../routes/apply');
  if (before === undefined) delete process.env.ATS_SANDBOX_ENABLED;
  else process.env.ATS_SANDBOX_ENABLED = before;
  return mod;
}

/* The route module does not export its internals, so behaviour is read from
 * the module source's own tables - the same technique the D49 floor test uses
 * to prove two files agree. Asserting on the source here is asserting on the
 * table that DRIVES the behaviour, not on a comment about it. */
const src = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'routes', 'apply.js'), 'utf8'
);

describe('the sandbox platform is separate from greenhouse', () => {
  it('the sandbox URL pattern resolves to ats_sandbox, not greenhouse', () => {
    const line = src.split('\n').find((l) => l.includes('ats-sandbox') && l.includes('ATS_BY_URL') === false && l.trim().startsWith('['));
    expect(line).toBeTruthy();
    expect(line).toMatch(/'ats_sandbox'/);
    expect(line).not.toMatch(/'greenhouse'/);
  });

  it('the sandbox pattern cannot match a real employer host', () => {
    const m = /\[(\/[^,]+\/i), 'ats_sandbox'\]/.exec(src);
    expect(m).toBeTruthy();
    // eslint-disable-next-line no-eval
    const re = eval(m[1]);
    expect(re.test(SANDBOX_URL)).toBe(true);
    expect(re.test('https://job-boards.greenhouse.io/discord/jobs/8674411002')).toBe(false);
    expect(re.test('https://boards.greenhouse.io/justworks/jobs/7775643')).toBe(false);
  });

  it('greenhouse itself is still detected as greenhouse', () => {
    const m = /\[(\/job-boards[^,]+\/i), 'greenhouse'\]/.exec(src);
    expect(m).toBeTruthy();
    // eslint-disable-next-line no-eval
    expect(eval(m[1]).test('https://job-boards.greenhouse.io/discord/jobs/1')).toBe(true);
  });
});

describe('the sandbox is off unless switched on', () => {
  it('the set is only extended behind an explicit env flag', () => {
    expect(src).toMatch(/process\.env\.ATS_SANDBOX_ENABLED === 'true'\) SUPPORTED_ATS\.add\('ats_sandbox'\)/);
  });

  it('lever and ashby stay disabled either way', () => {
    // The flag must not have quietly become a general "enable everything".
    const setBlock = src.slice(src.indexOf('const SUPPORTED_ATS'), src.indexOf('function detectAts'));
    expect(setBlock).toMatch(/\/\/ 'lever'/);
    expect(setBlock).toMatch(/\/\/ 'ashby'/);
    expect(setBlock).not.toMatch(/add\('lever'\)/);
    expect(setBlock).not.toMatch(/add\('ashby'\)/);
  });

  it('loads with the flag absent and with it set, without throwing', () => {
    expect(() => loadApply(undefined)).not.toThrow();
    expect(() => loadApply('true')).not.toThrow();
  });
});
