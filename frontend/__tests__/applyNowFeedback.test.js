/*
 * L6 stranger run — the launch-critical find.
 *
 * A brand-new user with skills but no resume clicked "Apply Now" on a job
 * card. The server correctly refused (400 "Upload a resume before queueing
 * applications"), but the page did TWO things wrong: it rendered that error
 * in the SUCCESS banner (green, styled like a confirmation), and the banner
 * sits at the top of the page — off-screen from the card the user clicked.
 * The stranger's experience was "I clicked Apply and nothing happened."
 *
 * The fix: the banner knows whether it is an error, styles it as one, and
 * scrolls into view when it appears.
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

const JOB = { id: 1, title: 'Product Designer', company_name: 'Acme', source: 'greenhouse', location: 'Remote', posted_at: new Date().toISOString(), overall_score: '0.71' };

beforeEach(() => {
  localStorage.setItem('token', 't');
  localStorage.setItem('user', JSON.stringify({ id: 4, email: 'stranger@x.local' }));
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  global.fetch = jest.fn((url, opts = {}) => {
    const u = String(url);
    if (/\/api\/apply\/queue$/.test(u) && opts.method === 'POST') {
      return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Upload a resume before queueing applications' }) });
    }
    const saved = /\/saved\//.test(u);
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        jobs: saved ? [] : [JOB], total: saved ? 0 : 1,
        relatedJobs: [], relatedTotal: 0, noExactMatches: false, emptyReason: null,
        ranking: { mode: 'ranked', profileScoreable: true, sort: 'score', minScore: 0.4, unscoredInPage: 0, undatedTotal: null },
        sources: [], matches: [], applications: [], facets: {},
      }),
    });
  });
});
afterEach(() => localStorage.clear());

describe('Apply Now with no resume', () => {
  it('shows the refusal as an ERROR, in view, not a green success banner', async () => {
    const user = userEvent.setup();
    render(<JobsPage />);
    await waitFor(() => expect(screen.getAllByText(/Product Designer/).length).toBeGreaterThan(0));

    await user.click(screen.getAllByRole('button', { name: /apply now/i })[0]);

    const banner = await screen.findByText(/upload a resume before queueing/i);
    expect(banner).toBeInTheDocument();
    // Styled as an error, not the success class.
    const box = banner.closest('div');
    expect(box.className).toMatch(/messageError|error/i);
    // And brought into view - the banner lives above the fold of cards.
    await waitFor(() => expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled());
  });
});
