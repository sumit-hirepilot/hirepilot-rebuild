/*
 * L1 — the settings page claimed "recruiter mail works today" and "the Inbox
 * page has your forwarding address" unconditionally. On a deployment with no
 * mail secret both sentences are false, and they sat one tab away from the
 * inbox page saying the opposite. The copy now reads the capability payload,
 * so the two surfaces cannot disagree.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Settings from '../pages/settings';

jest.mock('next/router', () => {
  const router = {
    push: jest.fn(() => Promise.resolve()), replace: jest.fn(() => Promise.resolve()),
    pathname: '/settings', route: '/settings', asPath: '/settings', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

function mockApis({ inboundMail }) {
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (/\/api\/capabilities$/.test(u)) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ inboundMail, atsSandbox: false }) });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        profile: {}, preferences: {}, skills: [], experience: [],
        resumes: [], answers: [], plan: { id: 'free', name: 'Free' },
        user: { id: 1, email: 'a@b.c', fullName: 'T' },
      }),
    });
  });
}

async function openTab(name) {
  render(<Settings />);
  const user = userEvent.setup();
  const tab = await screen.findByRole('button', { name });
  await user.click(tab);
  return user;
}

beforeEach(() => {
  localStorage.setItem('token', 't');
  localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c', fullName: 'T' }));
});
afterEach(() => localStorage.clear());

describe('settings mail copy follows the capability', () => {
  it('unconnected deployment: no working-mail claim anywhere on the page', async () => {
    mockApis({ inboundMail: false });
    await openTab(/^email$/i);

    expect(await screen.findByText(/not connected yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/works today/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/has your forwarding address/i)).not.toBeInTheDocument();
  });

  it('connected deployment: the working claim renders', async () => {
    mockApis({ inboundMail: true });
    await openTab(/^email$/i);

    expect(await screen.findByText(/has your forwarding address/i)).toBeInTheDocument();
    expect(screen.queryByText(/not connected yet/i)).not.toBeInTheDocument();
  });
});
