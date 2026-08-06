/*
 * Item A — "Active" must mean running.
 *
 * Found by walking the signup path as a new user. Enforcing the tier gate in
 * the engine, without teaching the preference path or the dashboard about it,
 * produced the worst possible state: the preference stored `true`, the
 * dashboard said "Auto-Pilot Active", and the engine silently refused because
 * the plan does not include it.
 *
 * That is A14's defect reintroduced from the other end - a control reporting a
 * state the system is not in - and I introduced it in item 4.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import DashboardPage from '../pages/dashboard';

jest.mock('next/router', () => {
  const r = {
    push: jest.fn(() => Promise.resolve()), replace: jest.fn(() => Promise.resolve()),
    pathname: '/dashboard', route: '/dashboard', asPath: '/dashboard', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => r, default: r };
});

function mockApi({ autoApplyIncluded, autoApplyEnabled }) {
  global.fetch = jest.fn((url) => {
    const u = String(url);
    const body = /\/api\/profile/.test(u)
      ? {
        user: { onboarding_completed_at: '2026-01-01', full_name: 'Asha' },
        preferences: { auto_apply_enabled: autoApplyEnabled },
        autoApplyIncluded,
      }
      : { matches: [], activity: [], stats: {}, counts: {} };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('token', 't');
  window.localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }));
});

describe('Item A — the status never claims a capability the plan refuses', () => {
  it('does not say Active when the plan does not include Auto-Pilot', async () => {
    // The stored preference is ON and the engine will still refuse.
    mockApi({ autoApplyIncluded: false, autoApplyEnabled: true });
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText(/not on your plan/i)).toBeInTheDocument());
    expect(screen.queryByText('Auto-Pilot Active')).not.toBeInTheDocument();
  });

  it('says Active when the plan includes it and it is on', async () => {
    // The instrument must be able to report the positive too, or the negative
    // above proves nothing.
    mockApi({ autoApplyIncluded: true, autoApplyEnabled: true });
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('Auto-Pilot Active')).toBeInTheDocument());
  });

  it('says Paused when the plan includes it and it is off', async () => {
    mockApi({ autoApplyIncluded: true, autoApplyEnabled: false });
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('Auto-Pilot Paused')).toBeInTheDocument());
  });
});
