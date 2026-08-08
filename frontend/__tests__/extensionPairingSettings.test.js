/*
 * E5 — Settings pairs the extension with a one-time code, not the login token.
 *
 * The Integrations tab used to carry a "Copy pairing code" button that actually
 * copied the raw 7-day login JWT to the clipboard, under text telling the user
 * to treat it like a password. This pins the replacement: a Generate button
 * that calls the pairing endpoint and shows a short code, and the absence of
 * the old copy-the-login-token behaviour.
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

const LOGIN_TOKEN = 'login.jwt.value';
const writeText = jest.fn(() => Promise.resolve());

// userEvent.setup() installs its OWN navigator.clipboard, so this must run
// AFTER setup() in each test to be the stub the component actually calls.
function installClipboard() {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  writeText.mockClear();
}

beforeEach(() => {
  localStorage.setItem('token', LOGIN_TOKEN);
  localStorage.setItem('user', JSON.stringify({ id: 4, email: 'c@s.local', fullName: 'T' }));

  global.fetch = jest.fn((url, opts = {}) => {
    const u = String(url);
    if (/\/api\/auth\/extension\/pair$/.test(u) && opts.method === 'POST') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: 'ABCD-EFGH', ttlSeconds: 600 }) });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        profile: {}, preferences: {}, skills: [], experience: [], resumes: [],
        answers: [], plan: { id: 'free', name: 'Free' }, inboundMail: false,
        user: { id: 4, email: 'c@s.local', fullName: 'T' },
      }),
    });
  });
});
afterEach(() => { localStorage.clear(); jest.clearAllMocks(); });

describe('extension pairing from Settings → Integrations', () => {
  it('generates a one-time code from the server and shows it', async () => {
    const user = userEvent.setup();
    installClipboard();
    render(<Settings />);

    await user.click(await screen.findByRole('button', { name: /integrations/i }));

    // The old scare copy is gone.
    expect(screen.queryByText(/valid 7 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/treat it like your password/i)).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /generate pairing code/i }));

    // The server's code is rendered for the user to type in.
    expect(await screen.findByText('ABCD-EFGH')).toBeInTheDocument();

    // It called the pairing endpoint with the login token as AUTH, not as the
    // thing being handed to the extension.
    const call = global.fetch.mock.calls.find(([u, o]) => /\/api\/auth\/extension\/pair$/.test(String(u)) && o?.method === 'POST');
    expect(call).toBeTruthy();
    expect(call[1].headers.Authorization).toBe(`Bearer ${LOGIN_TOKEN}`);

    // Generating a code must never copy the login token to the clipboard.
    expect(writeText).not.toHaveBeenCalledWith(LOGIN_TOKEN);
  });

  it('copies the pairing code — never the login token', async () => {
    const user = userEvent.setup();
    installClipboard();
    render(<Settings />);
    await user.click(await screen.findByRole('button', { name: /integrations/i }));
    await user.click(await screen.findByRole('button', { name: /generate pairing code/i }));
    await screen.findByText('ABCD-EFGH');

    await user.click(screen.getByRole('button', { name: /copy code/i }));

    expect(writeText).toHaveBeenCalledWith('ABCD-EFGH');
    expect(writeText).not.toHaveBeenCalledWith(LOGIN_TOKEN);
  });
});
