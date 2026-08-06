/*
 * A7.18 — clearing a page of drafts was twenty clicks, one Approve per row.
 *
 * A queue that costs twenty clicks to clear is a queue people stop clearing,
 * and this one sits directly in front of the apply pipeline.
 *
 * Clicked, not inspected. Presence is not function: a checkbox that renders and
 * a checkbox that selects are different things, and the assertion that matters
 * is on the ARGUMENT the request carries - which ids were actually sent - not
 * on the button existing or the row looking checked.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ApplicationsPage from '../pages/applications';

jest.mock('next/router', () => {
  const router = {
    push: jest.fn(() => Promise.resolve()),
    replace: jest.fn(() => Promise.resolve()),
    pathname: '/applications', route: '/applications', asPath: '/applications',
    query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router };
});

const PENDING = [
  { id: 11, title: 'Product Designer', company_name: 'Acme', status: 'pending_review' },
  { id: 12, title: 'Senior Designer', company_name: 'Globex', status: 'pending_review' },
  { id: 13, title: 'Design Lead', company_name: 'Initech', status: 'pending_review' },
];

let bulkCalls;

beforeEach(() => {
  bulkCalls = [];
  localStorage.setItem('token', 't');
  global.fetch = jest.fn((url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/applications/approve-bulk')) {
      bulkCalls.push(JSON.parse(opts.body || '{}'));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ approved: [], count: 0, unchanged: [] }) });
    }
    if (u.includes('/api/applications')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ kanban: {}, rejected: [], failed: [], pendingReview: PENDING }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
});

const selectAll = () => screen.getByRole('checkbox', { name: /select all/i });

describe('A7.18 — select all, then approve once', () => {
  it('sends every id on the page in ONE request', async () => {
    const user = userEvent.setup();
    render(<ApplicationsPage />);
    await waitFor(() => expect(selectAll()).toBeInTheDocument());

    await user.click(selectAll());
    await user.click(screen.getByRole('button', { name: /approve selected \(3\)/i }));

    await waitFor(() => expect(bulkCalls).toHaveLength(1));
    // The argument that carries the value.
    expect(bulkCalls[0].ids.sort()).toEqual([11, 12, 13]);
  });

  it('sends only what was ticked when the selection is partial', async () => {
    const user = userEvent.setup();
    render(<ApplicationsPage />);
    await waitFor(() => expect(selectAll()).toBeInTheDocument());

    await user.click(screen.getByRole('checkbox', { name: /select senior designer/i }));
    await user.click(screen.getByRole('button', { name: /approve selected \(1\)/i }));

    await waitFor(() => expect(bulkCalls).toHaveLength(1));
    expect(bulkCalls[0].ids).toEqual([12]);
  });

  it('shows a partial selection as indeterminate rather than rounding it', async () => {
    // Some-but-not-all is neither on nor off. Checked would claim the other two
    // are going too; unchecked would claim nothing is selected.
    const user = userEvent.setup();
    render(<ApplicationsPage />);
    await waitFor(() => expect(selectAll()).toBeInTheDocument());

    await user.click(screen.getByRole('checkbox', { name: /select design lead/i }));

    expect(selectAll().indeterminate).toBe(true);
    expect(selectAll().checked).toBe(false);
  });

  it('unticks everything when select-all is turned off', async () => {
    const user = userEvent.setup();
    render(<ApplicationsPage />);
    await waitFor(() => expect(selectAll()).toBeInTheDocument());

    await user.click(selectAll());
    expect(selectAll().checked).toBe(true);
    await user.click(selectAll());

    expect(screen.getByRole('button', { name: /approve selected \(0\)/i })).toBeDisabled();
  });

  it('cannot fire with nothing selected', async () => {
    render(<ApplicationsPage />);
    await waitFor(() => expect(selectAll()).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /approve selected \(0\)/i })).toBeDisabled();
    expect(bulkCalls).toHaveLength(0);
  });

  it('does not promise that approving marks anything applied', async () => {
    /*
     * The old copy read "approve to actually mark them applied". It never did
     * that and could not - the row carries no submission record, which is
     * exactly what the table refuses.
     */
    render(<ApplicationsPage />);
    await waitFor(() => expect(selectAll()).toBeInTheDocument());

    expect(screen.queryByText(/mark them applied/i)).not.toBeInTheDocument();
    expect(screen.getByText(/nothing is marked applied until an employer receipt/i)).toBeInTheDocument();
  });
});
