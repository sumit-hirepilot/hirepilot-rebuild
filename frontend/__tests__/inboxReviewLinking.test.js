/*
 * Feature 12 — an actionable message the matcher could not place waits for
 * the USER to say which application it belongs to. The page must surface
 * that state and send the link call; a message about an interview must never
 * quietly sit unfiled while a tracker card stays in "applied".
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import InboxPage from '../pages/inbox';

jest.mock('next/router', () => {
  const router = {
    push: jest.fn(() => Promise.resolve()), replace: jest.fn(() => Promise.resolve()),
    pathname: '/inbox', route: '/inbox', asPath: '/inbox', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

const MESSAGE = {
  id: 900, from_email: 'recruiter@meta.com', from_name: 'Meta Recruiting',
  subject: 'Interview invitation', category: 'interview', otp_code: null,
  company_name: 'meta', is_read: false, received_at: '2026-08-08T05:00:00Z',
  application_id: null, preview: 'We would like to schedule a call', job_title: null,
};

function mockApis() {
  global.fetch = jest.fn((url, opts = {}) => {
    const u = String(url);
    if (/\/api\/inbox\/900\/link$/.test(u)) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, applicationId: 7, stage: 'interviewing' }) });
    }
    if (/\/api\/inbox\/900$/.test(u)) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ message: { ...MESSAGE, body_text: 'We would like to schedule a call.' } }) });
    }
    if (/\/api\/tracker/.test(u)) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          columns: {
            applied: [{ id: 7, title: 'Product Designer', company_name: 'Meta' },
              { id: 8, title: 'Staff Designer', company_name: 'Stripe' }],
            ghosted: [], interviewing: [], rejected: [], offer: [],
          },
          counts: {}, total: 2,
        }),
      });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        messages: [MESSAGE], counts: { interview: 1 }, needsReview: 1,
        proxyEmail: 'hp-x@hirepilot-mail.com', inboundConfigured: true,
      }),
    });
  });
}

beforeEach(() => {
  localStorage.setItem('token', 't');
  localStorage.setItem('user', JSON.stringify({ id: 42 }));
  mockApis();
});
afterEach(() => localStorage.clear());

describe('inbox review linking', () => {
  it('says how many messages wait for the user to place them', async () => {
    render(<InboxPage />);
    expect(await screen.findByText(/1 message needs you to say which application/i)).toBeInTheDocument();
  });

  it('linking an open unmatched message calls the link endpoint with the chosen application', async () => {
    const user = userEvent.setup();
    render(<InboxPage />);

    await user.click(await screen.findByText('Interview invitation'));
    // The message is actionable and unlinked, so the review control renders.
    const select = await screen.findByRole('combobox', { name: /which application/i });
    await user.selectOptions(select, '7');
    await user.click(screen.getByRole('button', { name: /^link$/i }));

    await waitFor(() => {
      const call = global.fetch.mock.calls.find(([u]) => /\/api\/inbox\/900\/link$/.test(String(u)));
      expect(call).toBeTruthy();
      expect(call[1].method).toBe('POST');
      expect(JSON.parse(call[1].body)).toEqual({ applicationId: 7 });
    });
  });
});
