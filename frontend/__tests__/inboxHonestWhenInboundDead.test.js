/*
 * The proxy-address bar told every user "forward recruiter mail here. It
 * reaches your real inbox either way." On the current production the inbound
 * webhook is unconfigured (503) and mail sent there reaches nobody - verified
 * server-side 2026-08-08. The API now reports inboundConfigured; these pin
 * that the page reads it rather than asserting delivery it cannot know about.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';

import InboxPage from '../pages/inbox';

jest.mock('next/router', () => {
  const router = {
    push: jest.fn(() => Promise.resolve()), replace: jest.fn(() => Promise.resolve()),
    pathname: '/inbox', route: '/inbox', asPath: '/inbox', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

function mockInbox({ inboundConfigured }) {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      messages: [], counts: {},
      proxyEmail: 'hp-abc123@hirepilot-mail.com',
      inboundConfigured,
    }),
  }));
}

beforeEach(() => {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ id: 42, fullName: 'Test' }));
});

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('Inbox is honest about whether mail can actually arrive', () => {
  it('does not present the address as live when inbound mail is unconfigured', async () => {
    mockInbox({ inboundConfigured: false });
    render(<InboxPage />);

    expect(await screen.findByText(/not connected yet/i)).toBeInTheDocument();
    // The delivery promise must not render alongside a dead address.
    expect(screen.queryByText(/reaches your real inbox/i)).not.toBeInTheDocument();
    // And the dead address is not offered for use on applications.
    expect(screen.queryByText('hp-abc123@hirepilot-mail.com')).not.toBeInTheDocument();
  });

  it('renders the address and its promise when inbound mail is configured', async () => {
    mockInbox({ inboundConfigured: true });
    render(<InboxPage />);

    expect(await screen.findByText('hp-abc123@hirepilot-mail.com')).toBeInTheDocument();
    expect(screen.getByText(/reaches your real inbox/i)).toBeInTheDocument();
    expect(screen.queryByText(/not connected yet/i)).not.toBeInTheDocument();
  });
});
