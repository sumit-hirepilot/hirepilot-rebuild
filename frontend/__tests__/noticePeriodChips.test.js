/*
 * Notice period, asked once, as a tap.
 *
 * Nearly every Indian application form asks it, so answering it in onboarding
 * is the point: it prefills the screening question later rather than being
 * asked again per application. The answer set is short and known, so it is
 * chips - typing is the fallback, never the default.
 */

import '@testing-library/jest-dom';
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ChipSelect from '../components/ChipSelect';
import { NOTICE_PERIODS, noticePeriodForValue } from '../lib/noticePeriods';

function Harness() {
  const [value, setValue] = useState(null);
  return (
    <ChipSelect legend="What is your notice period?" options={NOTICE_PERIODS} value={value} onChange={setValue} />
  );
}

describe('notice period is a tap, and covers what employers ask', () => {
  it('offers the values Indian forms actually use', async () => {
    render(<Harness />);
    for (const label of ['Immediate', '15 days', '30 days', '60 days', '90 days']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('selects on tap and holds the selection', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sixty = screen.getByRole('button', { name: /60 days/ });

    await user.click(sixty);

    expect(sixty).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });
});

describe('the stored value is what an employer form expects', () => {
  it('stores a plain string, not an invented enum', () => {
    // application_profiles.notice_period is VARCHAR, and the extension pastes
    // this into a real form. An id like '60d' would have to be translated back
    // at every use, and one day would not be.
    for (const n of NOTICE_PERIODS) expect(typeof n.value).toBe('string');
    expect(NOTICE_PERIODS.find((n) => n.id === '60d').value).toBe('60 days');
  });

  it('recovers the chip from a stored answer, so a return visit shows it', () => {
    expect(noticePeriodForValue('60 days').id).toBe('60d');
    expect(noticePeriodForValue('  Immediate ').id).toBe('immediate');
  });

  it('returns null rather than guessing on an unrecognised answer', () => {
    expect(noticePeriodForValue('two months')).toBeNull();
    expect(noticePeriodForValue('')).toBeNull();
    expect(noticePeriodForValue(null)).toBeNull();
  });
});
