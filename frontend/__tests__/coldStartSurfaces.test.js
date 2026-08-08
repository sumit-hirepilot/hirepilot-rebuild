/*
 * L2 — what a brand-new account must see, pinned from a real cold-start walk
 * on production:
 *
 *  - the Jobs page showed a uniform defaults-only "30%" on every row under a
 *    banner claiming "matches above 40%". With blank profiles now unranked,
 *    the page must SAY why there are no percentages and what to do;
 *  - the Dashboard said "Auto-Pilot is not on your plan" while its own CTA
 *    said "Turn on in Settings" - a contradiction: Settings cannot enable
 *    what the plan excludes. The CTA must follow the reason.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('next/router', () => {
  const router = {
    push: jest.fn(() => Promise.resolve()), replace: jest.fn(() => Promise.resolve()),
    pathname: '/', route: '/', asPath: '/', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

afterEach(() => localStorage.clear());

describe('Jobs page for an unscoreable profile', () => {
  it('states why nothing is scored and what to do, and claims no floor', async () => {
    localStorage.setItem('token', 't');
    localStorage.setItem('user', JSON.stringify({ id: 4, email: 'c@s.local' }));
    global.fetch = jest.fn((url) => {
      const saved = /\/saved\//.test(String(url));
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          jobs: saved ? [] : [{ id: 1, title: 'C++ Developer', company_name: 'OpenVPN', source: 'remoteok', location: 'Remote', posted_at: new Date().toISOString(), overall_score: null }],
          total: saved ? 0 : 200,
          relatedJobs: [], relatedTotal: 0, noExactMatches: false, emptyReason: null,
          ranking: { mode: 'all', profileScoreable: false, sort: 'recent', minScore: null, unscoredInPage: 1, undatedTotal: null },
          sources: [], matches: [], applications: [], facets: {},
        }),
      });
    });

    const JobsPage = require('../pages/jobs').default;
    render(<JobsPage />);
    await waitFor(() => expect(screen.getAllByText(/C\+\+ Developer/).length).toBeGreaterThan(0));

    expect(screen.getByText(/not scored against your profile yet/i)).toBeInTheDocument();
    expect(screen.getByText(/add your skills/i)).toBeInTheDocument();
    expect(screen.queryByText(/above 40%/i)).not.toBeInTheDocument();
  });
});

describe('Dashboard when the plan excludes Auto-Pilot', () => {
  it('sends the user to plans, not to a Settings toggle that cannot help', async () => {
    localStorage.setItem('token', 't');
    localStorage.setItem('user', JSON.stringify({ id: 4, email: 'c@s.local', fullName: 'Cold Start' }));
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (/applications\/stats/.test(u)) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ total_applications: '0', applied: '0', interviews: '0', offers: '0', days_applying: '0', scanned_today: '100' }) });
      }
      if (/\/api\/profile/.test(u)) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            profile: {}, skills: [], experience: [],
            user: { id: 4, onboarding_completed_at: '2026-08-08T00:00:00Z' },
            preferences: { auto_apply_enabled: false, auto_apply_limit_per_day: 10 },
            autoApplyIncluded: false,
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ matches: [], total: 0, applications: [], activities: [] }) });
    });

    const Dashboard = require('../pages/dashboard').default;
    render(<Dashboard />);
    await screen.findByText(/not on your plan/i);

    const cta = screen.getByRole('link', { name: /see plans/i });
    expect(cta).toHaveAttribute('href', expect.stringMatching(/Plans|pricing/));
    expect(screen.queryByText(/turn on in settings/i)).not.toBeInTheDocument();
  });
});
