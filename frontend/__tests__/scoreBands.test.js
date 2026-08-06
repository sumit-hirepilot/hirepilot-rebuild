/*
 * Wave C — the score reads as a judgement, and one definition drives it.
 */

import { BANDS, bandFor, scoreLabel } from '../lib/scoreBands';

describe('score bands — one definition', () => {
  it.each([
    [0.92, 'Strong match'], [0.75, 'Strong match'],
    [0.74, 'Good match'], [0.60, 'Good match'],
    [0.59, 'Worth a try'], [0.45, 'Worth a try'],
    [0.44, 'Long shot'], [0, 'Long shot'],
  ])('%s reads as %s', (score, label) => {
    expect(bandFor(score).label).toBe(label);
  });

  it('covers every score with no gap between bands', () => {
    // A gap would return null for a real score, which reads as "unscored" and
    // is a different claim entirely.
    for (let n = 0; n <= 100; n += 1) expect(bandFor(n / 100)).not.toBeNull();
  });

  it('is ordered high to low, so the first match is the right one', () => {
    const mins = BANDS.map((b) => b.min);
    expect([...mins].sort((a, b) => b - a)).toEqual(mins);
  });

  it('keeps the number alongside the word', () => {
    // The word is added in front of the figure, never instead of it.
    expect(scoreLabel(0.78)).toBe('Strong match · 78%');
    expect(scoreLabel(0.5)).toBe('Worth a try · 50%');
  });

  it('says nothing when there is no score', () => {
    // Unscored is not "Long shot". Calling it that invents a judgement, the
    // same defect as rendering a missing count as 0.
    for (const empty of [null, undefined, '', 'abc']) {
      expect(bandFor(empty)).toBeNull();
      expect(scoreLabel(empty)).toBeNull();
    }
  });
});
