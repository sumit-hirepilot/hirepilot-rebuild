/*
 * A7.13 (frontend) — the screen must not contradict itself, and must say what
 * to do next.
 *
 * Reproduced on production: keywords=figma + Past 24 hours renders "No jobs
 * match these filters" in the count line while a Datadog role is displayed
 * below it under "Related jobs". Both statements are on screen at once and
 * only one of them can be true to a reader.
 *
 * The server now returns emptyReason with a real count per filter. These pin
 * that the page uses it rather than restating the generic sentence.
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

const RELATED = [{
  id: 9, title: 'Lead Designer', company_name: 'Datadog', source: 'greenhouse',
  location: 'New York, New York, USA', posted_at: new Date().toISOString(), overall_score: '0.67',
}];

function mockEmpty({ emptyReason, related = [] }) {
  global.fetch = jest.fn((url) => {
    const saved = /\/saved\//.test(String(url));
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        jobs: [], total: 0,
        noExactMatches: related.length > 0,
        relatedJobs: saved ? [] : related,
        relatedTotal: saved ? 0 : related.length,
        ranking: { mode: 'ranked', sort: 'recent', minScore: 0.4, unscoredInPage: 0 },
        emptyReason,
        sources: [], matches: [], applications: [], facets: {},
      }),
    });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('token', 'test-token');
  window.localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }));
});

describe('A7.13 — the count line does not deny what is on screen', () => {
  it('never claims nothing matches while showing a related job', async () => {
    mockEmpty({
      related: RELATED,
      emptyReason: {
        primary: 'datePosted',
        filters: [
          { key: 'datePosted', label: 'Past 24 hours', withoutIt: 11 },
          { key: 'keywords', label: 'Search: figma', withoutIt: 0 },
        ],
      },
    });
    render(<JobsPage />);

    await waitFor(() => expect(screen.getAllByText(/Lead Designer/).length).toBeGreaterThan(0));
    // The exact sentence that contradicted the card below it.
    expect(screen.queryByText('No jobs match these filters')).not.toBeInTheDocument();
  });
});

describe('A7.13 — the empty state names the filter that emptied it', () => {
  it('names the responsible filter and the count behind it', async () => {
    mockEmpty({
      emptyReason: {
        primary: 'datePosted',
        filters: [
          { key: 'datePosted', label: 'Past 24 hours', withoutIt: 11 },
          { key: 'keywords', label: 'Search: figma', withoutIt: 0 },
        ],
      },
    });
    render(<JobsPage />);

    // The label AND the number. "Try widening the date range" with no count
    // behind it is a guess presented as a finding.
    await waitFor(() => expect(screen.getByText(/Past 24 hours/i, { selector: 'p' })).toBeInTheDocument());
    expect(screen.getByText(/\b11\b/, { selector: 'p' })).toBeInTheDocument();
  });

  it('does not invent a cause when the server found none', async () => {
    mockEmpty({
      emptyReason: {
        primary: null,
        filters: [
          { key: 'datePosted', label: 'Past 24 hours', withoutIt: 0 },
          { key: 'keywords', label: 'Search: figma', withoutIt: 0 },
        ],
      },
    });
    render(<JobsPage />);

    // Honest fallback: no single filter is responsible. Naming one anyway
    // would send the user to relax the wrong thing.
    await waitFor(() => expect(screen.getByText(/no single filter/i)).toBeInTheDocument());
  });

  it('falls back to the generic sentence when the server said nothing', async () => {
    // Older response, or a path that does not diagnose. Must not crash and
    // must not claim a cause it does not have.
    mockEmpty({ emptyReason: null });
    render(<JobsPage />);

    // Scoped to the empty-state paragraph: the count line also contains "No
    // jobs", and an unscoped match would pass on either one.
    await waitFor(() => expect(
      screen.getByText(/No jobs found\. Try a different search term\./i, { selector: 'p' })
    ).toBeInTheDocument());
  });
});

describe('Item 3 — the empty state offers one action, and it undoes the cause', () => {
  it('offers to remove exactly the filter it blamed', async () => {
    const user = userEvent.setup();
    mockEmpty({
      emptyReason: {
        primary: 'datePosted',
        filters: [
          { key: 'datePosted', label: 'Past 24 hours', withoutIt: 11 },
          { key: 'keywords', label: 'Search: figma', withoutIt: 580 },
        ],
      },
    });
    render(<JobsPage />);

    const action = await screen.findByRole('button', { name: /show jobs from any date \(11\)/i });
    await user.click(action);

    // Presence is not function: the request must actually drop the filter.
    await waitFor(() => {
      const called = global.fetch.mock.calls.map((c) => String(c[0]));
      expect(called.some((u) => /datePosted=/.test(u) === false && /\/api\/jobs\?/.test(u))).toBe(true);
    });
  });

  it('never offers to delete the search term', async () => {
    /*
     * D21: dropping the keyword recovers the most results and is the least
     * useful advice - the user typed it on purpose. Naming it is fine;
     * offering a button that throws it away is not.
     */
    mockEmpty({
      emptyReason: {
        primary: 'keywords',
        filters: [{ key: 'keywords', label: 'Search: figma', withoutIt: 580 }],
      },
    });
    render(<JobsPage />);

    // Scoped to the empty-state paragraph: the count line also says "No jobs
    // match these filters", and an unscoped match is satisfied by either.
    await waitFor(() => expect(
      screen.getByText(/No jobs match\./i, { selector: 'p' })
    ).toBeInTheDocument());
    /*
     * Scoped to the shapes emptyReasonAction can produce. Matching /search/
     * loosely caught the page's own Search submit button - an assertion
     * satisfied by an unrelated control proves nothing.
     */
    expect(screen.queryByRole('button', { name: /^(Show jobs from|Drop the|Any )/i }))
      .not.toBeInTheDocument();
  });

  it('offers nothing when relaxing the filter would still return nothing', async () => {
    /*
     * withoutIt: 0 means the button would promise results that do not exist.
     * The server only sets `primary` when the recovery is above zero, so this
     * is the UI declining to trust that - a defensive case, and the first
     * version of this test used primary: null, where the null check alone
     * passes and the zero check is never reached.
     */
    mockEmpty({
      emptyReason: {
        primary: 'datePosted',
        filters: [{ key: 'datePosted', label: 'Past 24 hours', withoutIt: 0 }],
      },
    });
    render(<JobsPage />);

    await waitFor(() => expect(
      screen.getByText(/Past 24 hours is what emptied this/i, { selector: 'p' })
    ).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^(Show jobs from|Drop the|Any )/i }))
      .not.toBeInTheDocument();
  });
});
