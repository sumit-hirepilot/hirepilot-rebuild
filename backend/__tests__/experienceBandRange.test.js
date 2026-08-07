/*
 * Wave C target user: 1-15 years, self-taught through senior.
 *
 * The UI shows NAMED BANDS - Entry, Mid, Senior, Lead - because those are the
 * words people use about themselves. What is stored is the numeric RANGE,
 * because that is what scoring compares against, and because keeping the label
 * in the database would mean re-deriving the range on every read and
 * re-labelling every row whenever the bands move.
 *
 * Asserted on the ARGUMENT that reaches the database, not on the response.
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
  a.use('/api/profile', require('../routes/profile'));
  return a;
}

const upsert = () => query.mock.calls.find((c) => /INSERT INTO user_preferences/.test(String(c[0])));
/** The two experience params are the last pair bound. */
const storedRange = () => {
  const params = upsert()[1];
  return [params[params.length - 2], params[params.length - 1]];
};

beforeEach(() => {
  query.mockReset();
  query.mockImplementation((sql) => {
    if (/FROM users/.test(sql)) return Promise.resolve({ rows: [{ plan_tier: 'power' }] });
    if (/FROM user_preferences/.test(sql)) return Promise.resolve({ rows: [{}] });
    return Promise.resolve({ rows: [{}] });
  });
});

const put = (body) => request(app()).put('/api/profile/preferences').send(body);

describe('the band is stored as years', () => {
  it('stores the range the UI sent', async () => {
    await put({ experienceMinYears: 5, experienceMaxYears: 9 });
    expect(storedRange()).toEqual([5, 9]);
  });

  it('accepts the whole target span, Entry through Lead', async () => {
    for (const [min, max] of [[0, 2], [2, 5], [5, 9], [9, 15]]) {
      query.mockClear();
      await put({ experienceMinYears: min, experienceMaxYears: max });
      expect(storedRange()).toEqual([min, max]);
    }
  });
});

describe('a range read from a request is bounded', () => {
  it('clamps absurd years rather than storing them', async () => {
    await put({ experienceMinYears: -5, experienceMaxYears: 9000 });
    const [min, max] = storedRange();
    expect(min).toBe(0);
    expect(max).toBe(50);
  });

  it('widens an inverted range instead of matching nothing', async () => {
    // max < min is a typo, and stored as-is it silently excludes every job.
    await put({ experienceMinYears: 9, experienceMaxYears: 2 });
    const [min, max] = storedRange();
    expect(max).toBeGreaterThanOrEqual(min);
  });

  it('keeps null when no band was chosen - never guesses one', async () => {
    await put({ minSalary: 10 });
    expect(storedRange()).toEqual([null, null]);
  });

  it('ignores junk rather than storing NaN', async () => {
    await put({ experienceMinYears: 'senior', experienceMaxYears: {} });
    for (const v of storedRange()) expect(Number.isNaN(v)).toBe(false);
  });
});
