/*
 * A2c — the shared rule: unknown never renders as zero.
 *
 * These test the primitive rather than each page, because the defect shipped
 * three times in three components and the third instance was found by luck at
 * 375px on production. A rule the pages share can be pinned once.
 */

import { stateOf, countText, isParsed, parsedOr, LOADING, FAILED, READY, UNKNOWN } from '../lib/renderState';

describe('A2c — the four states are distinguishable', () => {
  it('treats a missing value as unknown, not as zero', () => {
    // The whole bug in one assertion: useState(0) made these identical.
    expect(stateOf({ value: null })).toBe(UNKNOWN);
    expect(stateOf({ value: undefined })).toBe(UNKNOWN);
    expect(stateOf({ value: 0 })).toBe(READY);
  });

  it('reports a failure ahead of a load in flight', () => {
    // A retry after a failure must not present as a first load.
    expect(stateOf({ loading: true, error: new Error('x') })).toBe(FAILED);
    expect(stateOf({ loading: true })).toBe(LOADING);
  });

  it('reports loading ahead of any value, so a stale number is never current', () => {
    expect(stateOf({ value: 42, loading: true })).toBe(LOADING);
  });
});

describe('A2c — countText renders a number only when a response returned one', () => {
  it('does not print 0 for a count that has not loaded', () => {
    const { state, text } = countText({ value: null, unit: 'results' });
    expect(state).toBe(UNKNOWN);
    expect(text).not.toMatch(/\b0\b/);
    expect(text).toMatch(/unavailable/i);
  });

  it('does not print 0 while loading', () => {
    const { text } = countText({ value: null, loading: true, unit: 'results' });
    expect(text).not.toMatch(/\b0\b/);
    expect(text).toMatch(/loading/i);
  });

  it('does not print 0 after a failure', () => {
    const { state, text } = countText({ value: null, error: new Error('500'), unit: 'results' });
    expect(state).toBe(FAILED);
    expect(text).not.toMatch(/\b0\b/);
  });

  it('does print a real zero a completed response returned', () => {
    // A zero that was actually measured is a fact and must survive. Suppressing
    // it would be the mirror of the bug.
    const { state, text } = countText({ value: 0, unit: 'results' });
    expect(state).toBe(READY);
    expect(text).toBe('0 results');
  });

  it('prefers better words for a real zero when given them', () => {
    const { text } = countText({ value: 0, zeroText: 'No applications yet' });
    expect(text).toBe('No applications yet');
  });

  it('formats a real count and never a non-finite one', () => {
    expect(countText({ value: 23949, unit: 'results' }).text).toBe('23,949 results');
    expect(countText({ value: NaN, unit: 'results' }).state).toBe(FAILED);
  });
});

describe('A2c — a parsed field renders only if it parsed', () => {
  it('rejects a value that is its own column name', () => {
    // Shipped: a job ingested with company_name = "name" rendered on the Auto
    // Apply panel as `name · Philippines`.
    expect(isParsed('name')).toBe(false);
    expect(parsedOr('name', 'Company not stated')).toBe('Company not stated');
  });

  it('rejects blanks and parser placeholders', () => {
    for (const v of ['', '   ', null, undefined, 'null', 'undefined', 'N/A', '-', 'none']) {
      expect(isParsed(v)).toBe(false);
    }
  });

  it('keeps real values, including ones that merely look odd', () => {
    for (const v of ['Vercel', 'name.com', 'X', '37signals', 'Nameless Co']) {
      expect(isParsed(v)).toBe(true);
    }
    expect(parsedOr('  Twilio  ')).toBe('Twilio');
  });
});
