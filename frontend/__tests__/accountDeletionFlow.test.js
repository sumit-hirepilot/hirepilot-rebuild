/*
 * L5 — the delete button must delete. Its entire previous behaviour was
 * flash('Account deletion is disabled in this demo deployment.').
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Settings from '../pages/settings';

const routerReplace = jest.fn(() => Promise.resolve());
jest.mock('next/router', () => {
  const router = {
    push: jest.fn(() => Promise.resolve()), replace: (...a) => routerReplace(...a),
    pathname: '/settings', route: '/settings', asPath: '/settings', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

beforeEach(() => {
  localStorage.setItem('token', 't');
  localStorage.setItem('user', JSON.stringify({ id: 4, email: 'c@s.local', fullName: 'T' }));
  global.fetch = jest.fn((url, opts = {}) => {
    if (/\/api\/auth\/account$/.test(String(url)) && opts.method === 'DELETE') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ deleted: true }) });
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

describe('account deletion from settings', () => {
  it('asks for the password, calls the real endpoint, clears the session', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(await screen.findByRole('button', { name: /^account$/i }));
    await user.click(await screen.findByRole('button', { name: /delete my account/i }));

    // The old fake response must be gone.
    expect(screen.queryByText(/disabled in this demo/i)).not.toBeInTheDocument();

    const pw = await screen.findByLabelText(/type your password/i);
    await user.type(pw, 'hunter2-real');
    await user.click(screen.getByRole('button', { name: /delete everything/i }));

    await waitFor(() => {
      const call = global.fetch.mock.calls.find(([u, o]) => /\/api\/auth\/account$/.test(String(u)) && o?.method === 'DELETE');
      expect(call).toBeTruthy();
      expect(JSON.parse(call[1].body)).toEqual({ password: 'hunter2-real' });
    });
    await waitFor(() => {
      expect(localStorage.getItem('token')).toBeNull();
      expect(routerReplace).toHaveBeenCalledWith('/');
    });
  });

  it('a wrong password shows the server sentence and keeps the session', async () => {
    global.fetch.mockImplementation((url, opts = {}) => {
      if (/\/api\/auth\/account$/.test(String(url)) && opts.method === 'DELETE') {
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'That password is not right. Nothing was deleted.' }) });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ profile: {}, preferences: {}, skills: [], experience: [], resumes: [], answers: [], plan: { id: 'free', name: 'Free' }, user: { id: 4, email: 'c@s.local', fullName: 'T' } }),
      });
    });
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(await screen.findByRole('button', { name: /^account$/i }));
    await user.click(await screen.findByRole('button', { name: /delete my account/i }));
    await user.type(await screen.findByLabelText(/type your password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /delete everything/i }));

    expect(await screen.findByText(/not right\. Nothing was deleted/i)).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBe('t');
  });
});
