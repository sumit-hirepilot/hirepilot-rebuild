/*
 * A7.11 (frontend) — 4,685 jobs sorted permanently last must be visible and
 * reachable, not merely correct.
 *
 * A7.7 sorts posted_at DESC NULLS LAST. That is right - we will not invent a
 * date - but at 18.9% of the index it means a fifth of the product is behind
 * everything else with nothing on screen saying so. The server counts them;
 * these pin that the page states the number and gives one click to them.
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
  id: 1, title: 'Staff Engineer', company_name: 'Himalayas Co', source: 'himalayas',
  location: 'Remote', posted_at: null, overall_score: '0.71',
}];

function mockApi(ranking) {
  global.fetch = jest.fn((url) => {
    const saved = /\/saved\//.test(String(url));
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        jobs: saved ? [] : JOBS, total: saved ? 0 : 1,
        relatedJobs: [], relatedTotal: 0, noExactMatches: false, emptyReason: null,
        ranking, sources: [], matches: [], applications: [], facets: {},
      }),
    });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('token', 'test-token');
  window.localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }));
});

describe('A7.11 — the buried rows are stated', () => {
  it('says how many jobs the recency sort put last, and why', async () => {
    mockApi({ mode: 'ranked', sort: 'recent', minScore: 0.4, unscoredInPage: 1, undatedTotal: 4685 });
    render(<JobsPage />);

    /*
     * Scoped to the notice, not to any text on the page: the date dropdown now
     * carries a "No publication date" option too, and an unscoped match is
     * satisfied by that whether or not the notice ever renders.
     */
    const notice = await screen.findByRole('button', { name: /no publication date/i });
    expect(notice).toHaveTextContent(/4,?685/);
    // The reason matters as much as the count: this is a source limitation,
    // not a bug the user should report or a filter they set.
    expect(notice).toHaveAttribute('title', expect.stringMatching(/will not invent one/i));
  });

  it('says nothing when nothing is buried', async () => {
    // Sorting by score buries nothing by date. A permanent notice about a
    // condition that does not apply is noise that trains people to ignore it.
    mockApi({ mode: 'ranked', sort: 'score', minScore: 0.4, unscoredInPage: 0, undatedTotal: null });
    render(<JobsPage />);

    await waitFor(() => expect(screen.getAllByText(/Staff Engineer/).length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /no publication date/i })).not.toBeInTheDocument();
  });

  it('reaches them in one click', async () => {
    const user = userEvent.setup();
    mockApi({ mode: 'ranked', sort: 'recent', minScore: 0.4, unscoredInPage: 1, undatedTotal: 4685 });
    render(<JobsPage />);

    const btn = await screen.findByRole('button', { name: /no publication date/i });
    await user.click(btn);

    // Presence is not function: assert the request that actually asks for them.
    await waitFor(() => {
      const called = global.fetch.mock.calls.map((c) => String(c[0]));
      expect(called.some((u) => /datePosted=unknown/.test(u))).toBe(true);
    });
  });
});
