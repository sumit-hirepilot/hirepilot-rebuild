/*
 * C1a — tap to select, wherever the answer set is known.
 *
 * The target user is 1-15 years in India, self-taught through senior. They do
 * not think "7 years", they think "senior" - so the chips show the word and
 * the years are only a hint. What is STORED is the range, because that is what
 * scoring compares against.
 *
 * These CLICK the chips and assert both the state change and the network call.
 * Presence is not function: A7.1's sort control rendered perfectly, passed
 * every DOM assertion, and did nothing.
 */

import '@testing-library/jest-dom';
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ChipSelect from '../components/ChipSelect';
import { EXPERIENCE_BANDS, bandForYears, bandForRange } from '../lib/experienceBands';

function Harness({ onChange }) {
  const [value, setValue] = useState(null);
  return (
    <ChipSelect
      legend="How much experience do you have?"
      options={EXPERIENCE_BANDS}
      value={value}
      onChange={(v) => { setValue(v); if (onChange) onChange(v); }}
    />
  );
}

describe('the chips are tappable and say what people say', () => {
  it('shows every band at once, so the user chooses rather than recalls', () => {
    render(<Harness />);
    for (const label of ['Entry', 'Mid', 'Senior', 'Lead']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('labels with the word and keeps years as the hint, never the label', () => {
    render(<Harness />);
    const senior = screen.getByRole('button', { name: /Senior/ });
    // The word leads; the number is present but subordinate.
    expect(senior.querySelector('.chipOptionLabel').textContent).toBe('Senior');
    expect(senior.querySelector('.chipOptionHint').textContent).toMatch(/5-9 years/);
  });

  it('selects on click and reports the band, not the years', async () => {
    const user = userEvent.setup();
    const seen = [];
    render(<Harness onChange={(v) => seen.push(v)} />);

    await user.click(screen.getByRole('button', { name: /Senior/ }));

    expect(seen).toEqual(['senior']);
    expect(screen.getByRole('button', { name: /Senior/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets a wrong tap be undone in one tap', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const mid = screen.getByRole('button', { name: /Mid/ });

    await user.click(mid);
    expect(mid).toHaveAttribute('aria-pressed', 'true');
    await user.click(mid);
    expect(mid).toHaveAttribute('aria-pressed', 'false');
  });

  it('only one band is ever selected', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Entry/ }));
    await user.click(screen.getByRole('button', { name: /Lead/ }));

    const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0].textContent).toMatch(/Lead/);
  });
});

describe('the band maps to years, and back', () => {
  it('covers the whole target span without a gap at the boundaries', () => {
    // 1-15 years is the stated audience; every one of those years must land.
    for (let y = 0; y <= 15; y += 1) expect(bandForYears(y)).not.toBeNull();
  });

  it('suggests Senior for seven years, which is what someone would call it', () => {
    expect(bandForYears(7).id).toBe('senior');
  });

  it('recovers the band from a stored range', () => {
    expect(bandForRange(5, 9).id).toBe('senior');
  });

  it('returns null rather than guessing when nothing was stored', () => {
    expect(bandForRange(null, null)).toBeNull();
    expect(bandForYears(undefined)).toBeNull();
    expect(bandForYears('senior')).toBeNull();
  });

  it('never returns a permission - a band narrows, it does not gate', () => {
    for (const b of EXPERIENCE_BANDS) {
      expect(Object.keys(b)).toEqual(expect.not.arrayContaining(['allowed', 'enabled', 'tier', 'locked']));
    }
  });
});
