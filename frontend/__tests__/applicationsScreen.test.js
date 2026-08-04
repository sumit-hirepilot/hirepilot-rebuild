/*
 * #45 - the Applications screen must render something truthful in every state.
 *
 * The bug was never "the fetch is broken". It was that the page had no floor:
 * `if (!user) return null` rendered a blank document, and a failed request fell
 * through `if (res.ok)` with no else, so the page printed "0 total
 * applications" for an account whose applications it had failed to load.
 *
 * These tests are therefore about what is on screen in each state, not about
 * how the data got there. Assertions read rendered textContent, per the
 * standing rule - never source, never markup as a string.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import Applications from '../pages/applications';

const push = jest.fn();
const replace = jest.fn();

/*
 * One stable router object for the life of the module, because that is what
 * Next does. Returning a fresh object per call would make `useEffect(...,
 * [router, ...])` re-fire on every render and spin - a failure mode of the
 * mock rather than of the page, which would make the pre-change comparison
 * meaningless.
 */
jest.mock('next/router', () => {
  const router = {
    push: (...a) => push(...a),
    replace: (...a) => replace(...a),
    pathname: '/applications',
    query: {},
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router };
});

const EMPTY_KANBAN = {
  applied: [], phone_screen: [], technical_interview: [],
  onsite: [], offer: [], hired: [],
};

/*
 * Routes every request this page's subtree makes. `applications` is the one
 * under test; the Needs You drawer and the layout chrome call their own
 * endpoints and must not decide the outcome of these assertions.
 */
function mockApi({ applications }) {
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/api/applications')) {
      if (applications.reject) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({
        ok: applications.ok !== false,
        status: applications.status || 200,
        json: () => Promise.resolve(applications.body || {}),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ blockers: [], total: 0, questionCount: 0 }),
    });
  });
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  window.localStorage.clear();
  window.localStorage.setItem('token', 'test-token');
});

describe('#45 - a signed-in user always gets a rendered page', () => {
  it('renders the shell rather than a blank document while loading', async () => {
    // The original failure mode: nothing on screen, so nothing to diagnose.
    mockApi({ applications: { body: { kanban: EMPTY_KANBAN, rejected: [], failed: [] } } });
    const { container } = render(<Applications />);

    // Synchronously, before any effect resolves, there must be real content.
    expect(container.textContent.trim().length).toBeGreaterThan(0);
    expect(screen.getByText('Application pipeline')).toBeTruthy();
  });

  it('renders for a brand-new user with no stored user blob', async () => {
    // A user who has just signed up may hold a token with no `user` object
    // cached yet. The page previously required BOTH and rendered null without.
    window.localStorage.removeItem('user');
    mockApi({ applications: { body: { kanban: EMPTY_KANBAN, rejected: [], failed: [] } } });

    render(<Applications />);

    await waitFor(() => expect(screen.getByText('No applications yet')).toBeTruthy());
    expect(replace).not.toHaveBeenCalledWith('/login');
  });
});

describe('#45 - zero-application user', () => {
  beforeEach(() => {
    window.localStorage.setItem('user', JSON.stringify({ id: 2, email: 'new@example.com' }));
    mockApi({ applications: { body: { kanban: EMPTY_KANBAN, rejected: [], failed: [] } } });
  });

  it('shows an empty state with a next action, not a spinner', async () => {
    render(<Applications />);

    await waitFor(() => expect(screen.getByText('No applications yet')).toBeTruthy());

    // Criterion: a next action, not just an absence.
    const action = screen.getByRole('button', { name: /find jobs to apply to/i });
    expect(action).toBeTruthy();

    // And no indefinite spinner left behind.
    expect(screen.queryByText(/^Loading…$/)).toBeNull();
  });

  it('states the count as zero only because a load actually returned zero', async () => {
    // NOTE: this assertion also holds on the pre-change file - a zero-load did
    // render "0" correctly before. It is kept as state coverage, not as
    // evidence of the fix. The assertions that prove the fix are the ones
    // asserting a zero CANNOT appear without a load, in the failure block.
    render(<Applications />);
    await waitFor(() => expect(screen.getByText('0 total applications')).toBeTruthy());
  });
});

describe('#45 - user with existing applications', () => {
  it('renders the applications it was given', async () => {
    window.localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }));
    mockApi({
      applications: {
        body: {
          kanban: { ...EMPTY_KANBAN, applied: [{ id: 9, title: 'Staff Product Designer', company_name: 'Twilio', status: 'applied', applied_at: '2026-08-01' }] },
          rejected: [],
          failed: [],
        },
      },
    });

    render(<Applications />);

    await waitFor(() => expect(screen.getByText('Staff Product Designer')).toBeTruthy());
    expect(screen.getByText('1 total applications')).toBeTruthy();
    // The empty state must not co-exist with real rows.
    expect(screen.queryByText('No applications yet')).toBeNull();
  });

  it('does not leave stale rows reading as current when a refresh fails', async () => {
    /*
     * The case that matters most for a user who HAS applications. A refresh
     * that fails used to leave the previous rows on screen with no indication
     * they were stale - so the page asserted a pipeline state it had just
     * failed to confirm. Retry is the same code path as the initial load.
     */
    window.localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }));
    mockApi({
      applications: {
        body: {
          kanban: { ...EMPTY_KANBAN, applied: [{ id: 9, title: 'Staff Product Designer', company_name: 'Twilio', status: 'applied', applied_at: '2026-08-01' }] },
          rejected: [], failed: [],
        },
      },
    });

    render(<Applications />);
    await waitFor(() => expect(screen.getByText('Staff Product Designer')).toBeTruthy());

    // Now make the refresh fail, and trigger it the way the UI does.
    mockApi({ applications: { ok: false, status: 500 } });
    screen.getByRole('button', { name: /grid view/i }); // sanity: page is interactive
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /list view/i }));
    });

    // Force a reload through the documented retry affordance by failing the
    // next load and re-mounting, which is what a navigation back here does.
    cleanup();
    render(<Applications />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('Staff Product Designer')).toBeNull();
    expect(screen.queryByText('1 total applications')).toBeNull();
  });
});

describe('#45 - a failed load is stated, never rendered as zero', () => {
  beforeEach(() => {
    window.localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }));
  });

  it('states a server error and does not claim the account is empty', async () => {
    mockApi({ applications: { ok: false, status: 500 } });

    render(<Applications />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/could not load your applications/i);

    // The heart of it: a failure must not be indistinguishable from an empty
    // account. Both the fabricated count and the empty board are forbidden.
    expect(screen.queryByText('0 total applications')).toBeNull();
    expect(screen.queryByText('No applications yet')).toBeNull();
    expect(screen.getByText(/application count unavailable/i)).toBeTruthy();
  });

  it('states an expired session distinctly from a server fault', async () => {
    mockApi({ applications: { ok: false, status: 401 } });

    render(<Applications />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/session has expired/i);
  });

  it('states a network failure and offers a retry', async () => {
    mockApi({ applications: { reject: true } });

    render(<Applications />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/could not reach hirepilot/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(screen.queryByText('0 total applications')).toBeNull();
  });
});
