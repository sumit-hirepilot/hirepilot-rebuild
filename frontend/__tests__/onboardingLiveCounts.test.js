/*
 * C1a — live feedback after every answer, and every number a real query.
 *
 * onboarding.js had no live counts at all: no countText, no renderState, none
 * of the copy the spec requires. The spec's central promise is that "1,240
 * Product Designer jobs in our index" IS 1,240 - so these assert on the
 * REQUEST that produced the number and on the number rendered, not on the
 * presence of a component. Presence is not function: A7.1's sort control
 * rendered perfectly, passed every DOM assertion, and did nothing.
 *
 * Constraint 1 applies inside onboarding. A count that is loading, one that
 * failed, and a real zero are three different things, and none of them may
 * render as an encouraging figure.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import LiveIndexCount from '../components/LiveIndexCount';

const calls = () => global.fetch.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  localStorage.setItem('token', 't');
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve({ total: 1240, jobs: [] }),
  }));
});

describe('the number comes from a real query', () => {
  it('asks the feed endpoint with the answer, and renders what it returned', async () => {
    render(<LiveIndexCount params={{ search: 'Product Designer' }} unit="jobs in our index" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    // The argument that carries the value.
    expect(calls()[0]).toMatch(/\/api\/jobs\?/);
    expect(calls()[0]).toMatch(/search=Product\+Designer|search=Product%20Designer/);

    expect(await screen.findByText(/1,?240 jobs in our index/)).toBeInTheDocument();
  });

  it('asks nothing at all until there is an answer', () => {
    render(<LiveIndexCount params={{ search: '' }} unit="jobs" />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('narrows by every answer given, not just the last', async () => {
    render(<LiveIndexCount params={{ search: 'Designer', location: 'Bengaluru' }} unit="of those" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(calls()[0]).toMatch(/search=Designer/);
    expect(calls()[0]).toMatch(/location=Bengaluru/);
  });
});

describe('a count that is not a real number never reads like one', () => {
  it('says so when the search fails, and shows no figure', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    render(<LiveIndexCount params={{ search: 'Designer' }} unit="jobs in our index" />);

    const el = await screen.findByRole('status');
    await waitFor(() => expect(el).toHaveAttribute('data-state', 'failed'));
    expect(el.textContent).not.toMatch(/\d/);
  });

  it('does not read a 500 body as a real zero', async () => {
    // An error page is still JSON. Parsing it without checking the status is
    // how a failure becomes an encouraging "0 jobs".
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ total: 0 }) }));
    render(<LiveIndexCount params={{ search: 'Designer' }} unit="jobs" />);

    const el = await screen.findByRole('status');
    await waitFor(() => expect(el).toHaveAttribute('data-state', 'failed'));
  });

  it('states a real zero and offers to widen, rather than encouraging', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ total: 0 }) }));
    render(<LiveIndexCount params={{ search: 'Underwater Basket Weaver' }} unit="jobs in our index" zeroText="No jobs match that title yet" />);

    expect(await screen.findByText(/No jobs match that title yet/)).toBeInTheDocument();
    expect(screen.getByText(/try a broader title/i)).toBeInTheDocument();
  });
});

describe('typing does not fire a query per keystroke', () => {
  it('debounces, and the last answer wins', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LiveIndexCount params={{ search: 'D' }} unit="jobs" />);
    rerender(<LiveIndexCount params={{ search: 'De' }} unit="jobs" />);
    rerender(<LiveIndexCount params={{ search: 'Des' }} unit="jobs" />);
    rerender(<LiveIndexCount params={{ search: 'Designer' }} unit="jobs" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    // Four renders, one surviving query - and it is the final answer.
    expect(global.fetch.mock.calls.length).toBeLessThan(4);
    expect(calls()[calls().length - 1]).toMatch(/search=Designer/);
    await user.click(document.body);
  });
});

/*
 * Found on screen at 375px, not by a test: with the Location field empty, the
 * page rendered "253 of those are near you" - the same count as the line
 * above, wearing words claiming a narrowing nobody had asked for. The number
 * was correct and the sentence was false, which is exactly the shape
 * Constraint 1 exists to catch.
 */
describe('a count never claims a narrowing that was not asked for', () => {
  it('asks nothing when only the empty field of the pair is its own', () => {
    // The component is given both params but the location is blank - the page
    // must not render this instance at all, and the component must not query
    // on a blank of its own.
    render(<LiveIndexCount params={{ location: '' }} unit="near you" />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('the onboarding page hides the location count until a location exists', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'pages', 'onboarding.js'), 'utf8'
    );
    // Guarded on the location itself, not merely on some answer existing.
    expect(src).toMatch(/basics\.location\.trim\(\)\s*&&/);
  });
});
