/*
 * Moving a card on the Progress board must move the CONVERSATION
 * (tracker_stage), never the evidence (status).
 *
 * The board called PUT /api/applications/:id/status with words like
 * phone_screen. On the live database that write is refused by
 * applications_applied_at_requires_submitted for every manual and auto-pilot
 * row - the user drags a card, the server 500s, the card snaps back. The
 * stage endpoint the Tracker already uses is the one writer with the right
 * vocabulary, so the board now speaks it too.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Applications from '../pages/applications';

jest.mock('next/router', () => {
  const router = {
    push: jest.fn(() => Promise.resolve()), replace: jest.fn(() => Promise.resolve()),
    pathname: '/applications', route: '/applications', asPath: '/applications', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

const BOARD = {
  total: 1,
  kanban: {
    applied: [{
      id: 31, job_id: 9, status: 'submitted', tracker_stage: null, is_manual: false,
      applied_at: '2026-08-01T10:00:00Z', title: 'Product Designer', company_name: 'Adyen',
      location: 'Bengaluru', job_url: 'https://example.test/job',
    }],
    interviewing: [], offer: [], ghosted: [],
  },
  needsYou: [], rejected: [], failed: [], pendingReview: [],
  byStatus: { applied: 1, interviewing: 0, offer: 0, ghosted: 0, rejected: 0, failed: 0, pending_review: 0 },
};

function mockBoardFetch() {
  global.fetch = jest.fn((url, opts = {}) => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(
      /\/api\/applications$/.test(String(url)) ? BOARD : { ok: true }
    ),
  }));
}

beforeEach(() => {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ id: 42, fullName: 'Test' }));
  mockBoardFetch();
});

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('Progress board card moves', () => {
  it('renders the stage columns, not the dead status columns', async () => {
    render(<Applications />);
    expect(await screen.findByText('Product Designer')).toBeInTheDocument();
    // The old columns were a vocabulary nothing can write; their headers
    // promised movement the server refused.
    expect(screen.queryByText(/first call/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/final round/i)).not.toBeInTheDocument();
  });

  it('moving a card calls the tracker stage endpoint with a stage word', async () => {
    const user = userEvent.setup();
    render(<Applications />);
    await screen.findByText('Product Designer');

    const select = screen.getAllByRole('combobox')[0];
    await user.selectOptions(select, 'interviewing');

    await waitFor(() => {
      const call = global.fetch.mock.calls.find(([u]) => /\/api\/tracker\/31\/stage$/.test(String(u)));
      expect(call).toBeTruthy();
      expect(call[1].method).toBe('PATCH');
      expect(JSON.parse(call[1].body)).toEqual({ stage: 'interviewing' });
    });

    // And the old writer is not called at all.
    expect(global.fetch.mock.calls.some(([u]) => /\/status$/.test(String(u)))).toBe(false);
  });
});
