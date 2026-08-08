/*
 * Feature 10 — the INR salary bands and the immediate-joiner filter reach the
 * query, per the A7.5 rule: a filter control that changes nothing is worse
 * than no control. Each control must produce the REQUEST, not just its own
 * state change.
 *
 * And the joiner evidence renders: a row matched by the filter shows the
 * posting's own sentence, because the filter's claim ("this employer asked
 * for immediate joiners") must carry its source.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import JobsPage from '../pages/jobs';

jest.mock('next/router', () => {
  const router = {
    push: jest.fn(() => Promise.resolve()), replace: jest.fn(() => Promise.resolve()),
    pathname: '/jobs', route: '/jobs', asPath: '/jobs', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

const JOBS = [{
  id: 1, title: 'Product Designer', company_name: 'Acme', source: 'greenhouse',
  location: 'Bengaluru', posted_at: new Date().toISOString(), overall_score: '0.71',
  joinerNote: 'We need an immediate joiner who can start within 15 days',
}];

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('token', 'test-token');
  window.localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }));
  global.fetch = jest.fn((url) => {
    const saved = /\/saved\//.test(String(url));
    const facets = /\/facets/.test(String(url));
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(facets ? {
        workArrangement: [], jobType: [], salary: [], experience: [], region: [],
        salaryInr: [
          { value: 'lt10', label: 'Under ₹10L', count: 5 },
          { value: '10-25', label: '₹10L – ₹25L', count: 7 },
          { value: '25-50', label: '₹25L – ₹50L', count: 3 },
          { value: 'gt50', label: '₹50L+', count: 1 },
        ],
        joiner: { immediate: 42 },
      } : {
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
  await waitFor(() => expect(screen.getAllByText(/Product Designer/).length).toBeGreaterThan(0));
}

function requestedWith(pattern) {
  return global.fetch.mock.calls.map((c) => String(c[0])).some((u) => pattern.test(u));
}

describe('Feature 10 — the India filters reach the query', () => {
  it('applies an INR salary band', async () => {
    const user = userEvent.setup();
    await renderJobs();

    await user.click(screen.getByRole('button', { name: /salary \(inr\)/i }));
    await user.click(screen.getByRole('checkbox', { name: /₹10L – ₹25L/i }));
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => expect(requestedWith(/salaryInr=10-25/)).toBe(true));
  });

  it('applies the immediate-joiner filter and can clear it', async () => {
    const user = userEvent.setup();
    await renderJobs();

    const chip = screen.getByRole('button', { name: /immediate joiner/i });
    await user.click(chip);
    await waitFor(() => expect(requestedWith(/joiner=immediate/)).toBe(true));

    global.fetch.mockClear();
    await user.click(screen.getByRole('button', { name: /immediate joiner/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(requestedWith(/joiner=immediate/)).toBe(false);
  });

  it('renders the posting\'s own sentence when it asked for immediate joiners', async () => {
    await renderJobs();
    expect(screen.getAllByText(/immediate joiner who can start within 15 days/i).length).toBeGreaterThan(0);
  });
});
