/*
 * Every value read from a request is bounded before it is used.
 *
 * ?limit=100&page=250 is OFFSET 24,900 over a CTE ranking the whole index.
 * Three of those took production down for eight minutes and it needed a
 * redeploy. That was one instance of a class - minScore, free text, and limits
 * on five other endpoints were all read the same way - so the bound lives in
 * one module and these test the module every endpoint now uses.
 */

const {
  boundInt, boundFloat, boundText, boundList, boundEnum, boundPaging, clampReport,
} = require('../services/requestBounds');

describe('numbers cannot escape their range', () => {
  it('clamps above the ceiling and says so', () => {
    const r = boundInt(100000, { def: 20, min: 1, max: 100 });
    expect(r.value).toBe(100);
    expect(r.clamped).toBe(true);
    expect(r.requested).toBe(100000);
  });

  it('falls back to the default for anything unparseable', () => {
    for (const junk of ['abc', '', null, undefined, NaN, Infinity, {}, []]) {
      expect(boundInt(junk, { def: 20, min: 1, max: 100 }).value).toBe(20);
    }
  });

  it('takes the first value when a parameter is repeated', () => {
    // ?limit=5&limit=99999 arrives as an array; the tail must not win.
    expect(boundInt(['5', '99999'], { def: 20, min: 1, max: 100 }).value).toBe(5);
  });

  it('keeps a score inside 0..1', () => {
    expect(boundFloat(-3, { def: 0.3 }).value).toBe(0);
    expect(boundFloat(50, { def: 0.3 }).value).toBe(1);
    expect(boundFloat(0.42, { def: 0.3 }).value).toBeCloseTo(0.42);
  });

  it('leaves an ordinary value completely alone', () => {
    const r = boundInt(20, { def: 20, min: 1, max: 100 });
    expect(r.value).toBe(20);
    expect(r.clamped).toBe(false);
  });
});

describe('text and lists cannot grow without limit', () => {
  it('truncates rather than dropping the search', () => {
    const r = boundText('x'.repeat(5000));
    expect(r.value).toHaveLength(200);
    expect(r.clamped).toBe(true);
  });

  it('caps how many values one repeated parameter may supply', () => {
    // ?region=a repeated 1,000 times builds a 1,000-branch predicate from a URL.
    const r = boundList(Array.from({ length: 1000 }, (_, i) => `r${i}`));
    expect(r.value.length).toBeLessThanOrEqual(25);
    expect(r.clamped).toBe(true);
  });

  it('caps each value inside the list too', () => {
    expect(boundList(['y'.repeat(500)]).value[0]).toHaveLength(80);
  });

  it('never hands back the caller\'s string for an enum', () => {
    expect(boundEnum('; DROP TABLE jobs', ['score', 'recent'], 'score').value).toBe('score');
    expect(boundEnum('recent', ['score', 'recent'], 'score').value).toBe('recent');
  });
});

describe('paging bounds the OFFSET, which is the product', () => {
  it('caps the offset however the page and limit are split', () => {
    for (const [page, limit] of [[250, 100], [100000, 1], [7, 100000]]) {
      expect(boundPaging(page, limit).offset).toBeLessThanOrEqual(5000);
    }
  });

  it('reports the page it actually served, not the one asked for', () => {
    const r = boundPaging(250, 100);
    expect(r.requestedPage).toBe(250);
    expect(r.page).toBe(r.maxPage);
    expect(r.clamped).toBe(true);
  });

  it('leaves an ordinary request untouched', () => {
    const r = boundPaging(3, 20);
    expect(r).toMatchObject({ page: 3, limit: 20, offset: 40, clamped: false, limitClamped: false });
  });
});

describe('the clamp is stated, or it is silent truncation', () => {
  it('names only what was actually clamped', () => {
    const report = clampReport({
      limit: boundInt(100000, { def: 20, min: 1, max: 100 }),
      page: boundInt(2, { def: 1, min: 1, max: 50 }),
    });
    expect(Object.keys(report)).toEqual(['limit']);
    expect(report.limit).toEqual({ requested: 100000, applied: 100 });
  });

  it('is null when nothing was clamped, so a normal response carries no noise', () => {
    expect(clampReport({ limit: boundInt(20, { def: 20, min: 1, max: 100 }) })).toBeNull();
  });
});
