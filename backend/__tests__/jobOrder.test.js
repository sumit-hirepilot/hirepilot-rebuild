/*
 * A7.20 / A7.8 — the SQL order and the in-memory order are one definition.
 *
 * On-demand scoring re-sorts the page after scoring it, so a comparator has to
 * agree with the ORDER BY that fetched the rows. Written out twice, they drift
 * - which is exactly what A7.17 spent a goal undoing.
 */

const { ORDER_FIELDS, orderBySql, orderFor } = require('../services/jobOrder');

describe('A7.8 — one declaration, two renderings', () => {
  it('builds the SQL clause from the declared fields', () => {
    for (const sort of ['score', 'recent']) {
      expect(orderBySql(sort)).toBe(ORDER_FIELDS[sort].join(', '));
    }
  });

  it('keeps the A7.7 properties in both sorts', () => {
    for (const sort of ['score', 'recent']) {
      const sql = orderBySql(sort);
      expect(sql).toMatch(/^match_tier ASC/);          // tier leads
      expect(sql).toMatch(/posted_at DESC NULLS LAST/); // undated last, never first
      expect(sql).toMatch(/id DESC$/);                  // unique final key
    }
  });

  it('sorts by the same fields the clause names', () => {
    // Derived from ORDER_FIELDS, so adding a field to the clause without
    // teaching the comparator about it fails here.
    const fields = ORDER_FIELDS.score.map((f) => f.split(' ')[0]);
    const rows = fields.map((f, i) => ({ match_tier: 1, overall_score: 0.5, posted_at: '2026-01-01', id: 1, [f]: i }));
    expect(() => rows.sort(orderFor('score'))).not.toThrow();
  });
});

describe('A7.20 — the comparator matches Postgres, including its edges', () => {
  const row = (o) => ({ match_tier: 1, overall_score: null, posted_at: null, id: 0, ...o });

  it('compares numerics as numbers, not as the strings pg returns', () => {
    /*
     * pg hands back NUMERIC as a string, and on-demand scoring injects plain
     * JS numbers into the same page - so a page after A7.20 holds both.
     *
     * The discriminating case is a numeric TIE written two ways: '0.50' and
     * '0.5' are the same score and must fall through to the recency
     * tie-break. Compared as text they are not equal, '0.5' sorts after
     * '0.50', and the tie-break silently never runs.
     *
     * A first version of this test used 0.75 against 0.9 and passed against a
     * mutation that removed the conversion entirely - for decimals in [0,1]
     * lexical and numeric order usually agree, so that fixture proved nothing.
     */
    const sorted = [
      row({ id: 1, overall_score: '0.50', posted_at: '2020-01-01' }),
      row({ id: 2, overall_score: '0.5', posted_at: '2026-01-01' }),
      row({ id: 3, overall_score: 0.5, posted_at: '2023-01-01' }),
    ].sort(orderFor('score'));
    // Equal scores, so recency decides: 2026, 2023, 2020.
    expect(sorted.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it('puts unscored rows last under score sort', () => {
    const sorted = [row({ id: 1, overall_score: null }), row({ id: 2, overall_score: '0.1' })]
      .sort(orderFor('score'));
    expect(sorted.map((r) => r.id)).toEqual([2, 1]);
  });

  it('puts undated rows last under recency sort', () => {
    const sorted = [row({ id: 1, posted_at: null }), row({ id: 2, posted_at: '2020-01-01' })]
      .sort(orderFor('recent'));
    expect(sorted.map((r) => r.id)).toEqual([2, 1]);
  });

  it('breaks a score tie by recency, then by id', () => {
    const rows = [
      row({ id: 5, overall_score: '0.6', posted_at: '2026-01-01' }),
      row({ id: 9, overall_score: '0.6', posted_at: '2026-02-01' }),
      row({ id: 7, overall_score: '0.6', posted_at: '2026-02-01' }),
    ].sort(orderFor('score'));
    expect(rows.map((r) => r.id)).toEqual([9, 7, 5]);
  });

  it('ranks tier above everything, so a related job never outranks an exact one', () => {
    const rows = [
      row({ id: 1, match_tier: 3, overall_score: '0.99' }),
      row({ id: 2, match_tier: 1, overall_score: '0.10' }),
    ].sort(orderFor('score'));
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
  });

  it('is a total order, so repeated sorts do not reshuffle', () => {
    const rows = [row({ id: 3 }), row({ id: 1 }), row({ id: 2 })];
    const once = [...rows].sort(orderFor('recent')).map((r) => r.id);
    const twice = [...rows].sort(orderFor('recent')).sort(orderFor('recent')).map((r) => r.id);
    expect(twice).toEqual(once);
    expect(once).toEqual([3, 2, 1]);
  });
});
