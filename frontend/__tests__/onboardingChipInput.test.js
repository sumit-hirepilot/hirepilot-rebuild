/*
 * E4 — the onboarding skills input merged fast-typed skills into one chip.
 *
 * A Playwright run that inserted a newline/comma-separated list into the field
 * and pressed Enter once produced a SINGLE chip carrying the whole list
 * ("Figma Design Systems User Research"). The old addChip trimmed the entire
 * draft and pushed it verbatim, and — read from a stale render closure — a
 * second Enter fired inside one React batch could overwrite the first instead
 * of appending. jest could never trip the timing race, but the collapse it
 * caused is deterministic: a draft holding several entries must become several
 * chips, not one. These tests pin that, and would have gone red on the old
 * single-value, closure-reading implementation.
 */

import '@testing-library/jest-dom';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ChipInput } from '../pages/onboarding';

// ChipInput is controlled; drive it through a parent that owns the list, the
// same contract the onboarding page gives it (onChange={setSkills}).
function Controlled({ initial = [] }) {
  const [values, setValues] = useState(initial);
  return <ChipInput values={values} onChange={setValues} placeholder="Add a skill" />;
}

// Each chip renders one remove <button>; the input is not a button, so the
// button count is the chip count regardless of what the chips say.
const chipCount = () => screen.queryAllByRole('button').length;

describe('onboarding ChipInput', () => {
  it('makes three chips from three fast-typed skills, not one merged chip', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByPlaceholderText('Add a skill');

    await user.type(input, 'Figma{Enter}Design Systems{Enter}User Research{Enter}');

    expect(chipCount()).toBe(3);
    expect(screen.getByText('Figma')).toBeInTheDocument();
    expect(screen.getByText('Design Systems')).toBeInTheDocument();
    expect(screen.getByText('User Research')).toBeInTheDocument();
    // The merged blob the bug produced must not exist.
    expect(screen.queryByText(/Figma\s*[, ]\s*Design Systems/)).not.toBeInTheDocument();
  });

  it('splits a pasted comma-separated list into separate chips', () => {
    // The deterministic reproduction: a whole list lands in the draft at once
    // (paste), then one commit. Old code -> one chip; fixed code -> three.
    render(<Controlled />);
    const input = screen.getByPlaceholderText('Add a skill');

    fireEvent.change(input, { target: { value: 'Figma, Design Systems, User Research' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(chipCount()).toBe(3);
    expect(screen.getByText('Figma')).toBeInTheDocument();
    expect(screen.getByText('Design Systems')).toBeInTheDocument();
    expect(screen.getByText('User Research')).toBeInTheDocument();
  });

  it('drops empties and duplicates instead of adding blank or repeated chips', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByPlaceholderText('Add a skill');

    // Repeated entry, and a run of separators that would otherwise add blanks.
    await user.type(input, 'Figma{Enter}Figma{Enter}');
    fireEvent.change(input, { target: { value: ' , ,, ' } });
    fireEvent.blur(input);

    expect(chipCount()).toBe(1);
    expect(screen.getByText('Figma')).toBeInTheDocument();
  });

  it('commits a single in-progress skill on blur', () => {
    render(<Controlled />);
    const input = screen.getByPlaceholderText('Add a skill');

    fireEvent.change(input, { target: { value: 'Accessibility' } });
    fireEvent.blur(input);

    expect(chipCount()).toBe(1);
    expect(screen.getByText('Accessibility')).toBeInTheDocument();
    expect(input.value).toBe(''); // draft cleared after commit
  });
});
