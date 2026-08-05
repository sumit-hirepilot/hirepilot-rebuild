/*
 * A7.5 — a filter control that changes nothing is worse than no control.
 *
 * Found on production while verifying A7.9. Selecting "Past 7 days" left the
 * result count at 4,569 and every row still reading "Publication date
 * unavailable" - impossible for a 7-day window. Selecting "Senior" did nothing
 * either. Both dropdowns called their setState and stopped: no reload, no URL
 * change. The control's visible position claimed a filter the list was not
 * built from, which is the A7.1 class.
 *
 * The multi-select facets were fine, because each of them separately
 * remembered to call setPage, syncUrl and loadJobs. That is the actual defect:
 * four controls got it right by repetition and two got it wrong the same way.
 * These drive each control and assert the request, so a new filter wired the
 * short way fails here rather than on production.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import JobsPage from '../pages/jobs';

jest.mock('next/router', () => {
  const router = {
    // router.push is awaited with .finally() in syncUrl, so the mock has to
    // return a promise or every filter change throws inside the component.
    push: jest.fn(() => Promise.resolve()), replace: jest.fn(() => Promise.resolve()),
    pathname: '/jobs', route: '/jobs', asPath: '/jobs', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

const JOBS = [{
  id: 1, title: 'Staff Engineer', company_name: 'Acme', source: 'greenhouse',
  location: 'Remote', posted_at: new Date().toISOString(), overall_score: '0.71',
}];

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('token', 'test-token');
  window.localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }));
  global.fetch = jest.fn((url) => {
    const saved = /\/saved\//.test(String(url));
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        jobs: saved ? [] : JOBS, total: saved ? 0 : 200,
        relatedJobs: [], relatedTotal: 0, noExactMatches: false, emptyReason: null,
        ranking: { mode: 'ranked', sort: 'score', minScore: 0.4, unscoredInPage: 0, undatedTotal: null },
        sources: [], matches: [], applications: [], facets: {},
      }),
    });
  });
});

async function renderJobs() {
  render(<JobsPage />);
  await waitFor(() => expect(screen.getAllByText(/Staff Engineer/).length).toBeGreaterThan(0));
}

/** Did any request after this point carry the parameter? */
function requestedWith(pattern) {
  return global.fetch.mock.calls.map((c) => String(c[0])).some((u) => pattern.test(u));
}

describe('A7.5 — every filter control reaches the query', () => {
  it('applies the date window when it is chosen', async () => {
    const user = userEvent.setup();
    await renderJobs();

    await user.selectOptions(screen.getByRole('combobox', { name: /date posted/i }), '7d');

    await waitFor(() => expect(requestedWith(/datePosted=7d/)).toBe(true));
  });

  it('applies the experience level when it is chosen', async () => {
    const user = userEvent.setup();
    await renderJobs();

    await user.selectOptions(screen.getByRole('combobox', { name: /experience/i }), 'senior');

    await waitFor(() => expect(requestedWith(/experience=senior/)).toBe(true));
  });

  it('resets the page state, so the next page is 2 and not 4', async () => {
    /*
     * setPage(1) does not show up in the filter's own request - that request
     * passes page: 1 explicitly, so asserting on it passes whether or not the
     * state was reset. The observable consequence is what comes NEXT: filter
     * while on page 3 without resetting, and "Next" asks for page 4 of a
     * result set the user has seen none of.
     */
    const user = userEvent.setup();
    await renderJobs();

    await user.click(screen.getByRole('button', { name: '3' }));
    await waitFor(() => expect(requestedWith(/page=3/)).toBe(true));

    await user.selectOptions(screen.getByRole('combobox', { name: /date posted/i }), '7d');
    await waitFor(() => expect(requestedWith(/datePosted=7d/)).toBe(true));

    global.fetch.mockClear();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(requestedWith(/page=2/)).toBe(true));
    expect(requestedWith(/page=4/)).toBe(false);
  });
});
