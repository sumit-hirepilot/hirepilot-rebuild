/*
 * Feature 15 — a card in "They replied — interviewing" offers prep, and the
 * panel renders only what the server derived: the posting's own skills and
 * sentences, split into strengths and gaps against the user's profile.
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
    applied: [], ghosted: [], offer: [],
    interviewing: [{
      id: 31, job_id: 9, status: 'submitted', tracker_stage: 'interviewing', is_manual: false,
      applied_at: '2026-08-01T10:00:00Z', title: 'Product Designer', company_name: 'Adyen',
      location: 'Bengaluru', job_url: 'https://example.test/job',
    }],
  },
  needsYou: [], rejected: [], failed: [], pendingReview: [],
  byStatus: { applied: 0, interviewing: 1, offer: 0, ghosted: 0, rejected: 0, failed: 0, pending_review: 0 },
};

const PREP = {
  job: { title: 'Product Designer', company_name: 'Adyen' },
  stage: 'interviewing',
  prep: {
    items: [],
    strengths: [{ skill: 'Figma', hasIt: true, quote: 'We need deep command of Figma for daily design work.' }],
    gaps: [{ skill: 'Design Systems', hasIt: false, quote: 'You will own our Design Systems end to end.' }],
    sufficientJd: true,
    definitions: { strengths: 'x', gaps: 'y' },
  },
};

beforeEach(() => {
  localStorage.setItem('token', 't');
  localStorage.setItem('user', JSON.stringify({ id: 42 }));
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (/interview-prep$/.test(u)) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(PREP) });
    }
    if (/\/api\/apply\//.test(u)) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ blockers: [], answers: [] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(BOARD) });
  });
});
afterEach(() => localStorage.clear());

describe('interview prep on the board', () => {
  it('an interviewing card offers prep and renders strengths and gaps with quotes', async () => {
    const user = userEvent.setup();
    render(<Applications />);
    await screen.findByText('Product Designer');

    await user.click(screen.getByRole('button', { name: /prep for this interview/i }));

    await waitFor(() => {
      expect(global.fetch.mock.calls.some(([u]) => /\/api\/applications\/31\/interview-prep$/.test(String(u)))).toBe(true);
    });
    expect(await screen.findByText('Figma')).toBeInTheDocument();
    expect(screen.getByText(/deep command of Figma/)).toBeInTheDocument();
    expect(screen.getByText('Design Systems')).toBeInTheDocument();
    expect(screen.getByText(/own our Design Systems/)).toBeInTheDocument();
  });
});
