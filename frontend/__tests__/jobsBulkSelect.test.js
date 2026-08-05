/*
 * A7.6 — the jobs checkboxes.
 *
 * Filed as "checkboxes with no bulk action". That premise is now stale: the
 * bulk pipeline landed, and clicking two boxes on production really does show
 * "Prepare 2 applications". So this closes the original defect by driving it,
 * not by reading the JSX.
 *
 * What driving it found instead: the checkbox has no accessible name at all -
 * no id, no label, no aria-label, no title. A screen reader announces
 * "checkbox, unchecked" twenty times with nothing to distinguish them, so the
 * primary bulk control is fully functional visually and unusable otherwise.
 * Same shape as the standing rule about presence and function, one audience
 * over.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, waitFor, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import JobsPage from '../pages/jobs';

const push = jest.fn();
jest.mock('next/router', () => {
  const router = {
    push: (...a) => { push(...a); return Promise.resolve(); },
    replace: jest.fn(() => Promise.resolve()),
    pathname: '/jobs', route: '/jobs', asPath: '/jobs', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

const JOBS = [
  { id: 1, title: 'Senior Product Designer', company_name: 'Sierra', source: 'greenhouse',
    location: 'San Francisco, CA', posted_at: new Date().toISOString(), overall_score: '0.75' },
  { id: 2, title: 'UX Designer Senior', company_name: 'Valtech', source: 'ashby',
    location: 'Brazil', posted_at: null, overall_score: null },
];

beforeEach(() => {
  push.mockClear();
  window.localStorage.clear();
  window.localStorage.setItem('token', 'test-token');
  window.localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }));
  global.fetch = jest.fn((url) => {
    // One union body for every endpoint the page touches on mount, except the
    // saved list - which otherwise echoes the same rows back and makes "Saved
    // jobs (2)" out of nothing.
    const saved = /\/saved\//.test(String(url));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        jobs: saved ? [] : JOBS,
        total: saved ? 0 : JOBS.length,
        ranking: { mode: 'ranked', sort: 'score', minScore: 0.4, unscoredInPage: 1 },
        sources: [], matches: [], applications: [], facets: {},
      }),
    });
  });
});

async function renderJobs() {
  const view = render(<JobsPage />);
  await new Promise((r) => setTimeout(r, 400));
  await waitFor(() => expect(screen.getAllByText('Senior Product Designer').length).toBeGreaterThan(0));
  return view;
}

describe('A7.6 — the checkbox names the thing it selects', () => {
  it('gives every job checkbox an accessible name carrying that job', async () => {
    await renderJobs();
    // getByRole with a name is the assistive-technology view: if this finds
    // it, a screen reader can too. A checkbox with no name is invisible here
    // and indistinguishable from its 19 neighbours in real use.
    expect(screen.getByRole('checkbox', { name: /Senior Product Designer/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /UX Designer Senior/i })).toBeInTheDocument();
  });

  it('names the company too, so two roles at different companies are distinct', async () => {
    await renderJobs();
    expect(screen.getByRole('checkbox', { name: /Sierra/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Valtech/i })).toBeInTheDocument();
  });
});

describe('A7.6 — the control does the thing, driven not read', () => {
  it('selecting jobs reveals a bulk action naming the count', async () => {
    const user = userEvent.setup();
    await renderJobs();

    expect(screen.queryByText(/jobs? selected/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Senior Product Designer/i }));
    expect(await screen.findByText(/1 job selected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prepare 1 application$/i })).toBeEnabled();

    await user.click(screen.getByRole('checkbox', { name: /UX Designer Senior/i }));
    expect(await screen.findByText(/2 jobs selected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prepare 2 applications/i })).toBeEnabled();
  });

  it('clearing deselects everything, not just the last one', async () => {
    const user = userEvent.setup();
    await renderJobs();

    await user.click(screen.getByRole('checkbox', { name: /Senior Product Designer/i }));
    await user.click(screen.getByRole('checkbox', { name: /UX Designer Senior/i }));
    await user.click(screen.getByRole('button', { name: /^Clear$/ }));

    await waitFor(() => expect(screen.queryByText(/jobs? selected/i)).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: /Senior Product Designer/i })).not.toBeChecked();
  });
});
