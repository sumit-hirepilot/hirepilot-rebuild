/*
 * A4 / Item 0 — a tester must be able to read what was sent in their name.
 *
 * The receipt has existed server-side since A4 and nothing rendered it. For a
 * product that submits applications autonomously, being unable to see what
 * went out is the defect that matters most: everything else can be corrected
 * afterwards, an application cannot be unsent.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SubmissionReceipt from '../components/SubmissionReceipt';

const RECEIPT = {
  submitted_at: '2026-08-06T10:00:00Z',
  ats: 'greenhouse',
  fields_sent: { first_name: 'Sumit', email: 'a@b.c' },
  answers_sent: { 'Are you authorised to work in the US?': 'Yes' },
  resume_filename: 'Sumit_Resume.pdf',
  resume_sha256: 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12',
  platform_confirmation_id: 'GH-88213',
  platform_url: 'https://boards.greenhouse.io/x/confirmation',
  platform_response: 'Application received',
};

const mockFetch = (ok, body) => {
  global.fetch = jest.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) }));
};

describe('A4 — the receipt shows what was actually sent', () => {
  it('renders fields, answers, the file hash and the platform response', async () => {
    const user = userEvent.setup();
    mockFetch(true, { receipt: RECEIPT });
    render(<SubmissionReceipt applicationId={31} token="t" />);

    await user.click(screen.getByRole('button', { name: /what was sent/i }));

    // Every one of the four things the order names.
    expect(await screen.findByText('first_name')).toBeInTheDocument();
    expect(screen.getByText('Sumit')).toBeInTheDocument();
    expect(screen.getByText(/Are you authorised to work/)).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText(RECEIPT.resume_sha256)).toBeInTheDocument();
    expect(screen.getByText('GH-88213')).toBeInTheDocument();
    expect(screen.getByText('Application received')).toBeInTheDocument();
  });

  it('asks the server for that application, not for the current profile', async () => {
    // A receipt recomputed from today's profile would show what WOULD be sent,
    // which is the opposite of a record.
    const user = userEvent.setup();
    mockFetch(true, { receipt: RECEIPT });
    render(<SubmissionReceipt applicationId={31} token="t" />);
    await user.click(screen.getByRole('button', { name: /what was sent/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(String(global.fetch.mock.calls[0][0])).toMatch(/\/api\/apply\/queue\/31\/receipt$/);
  });

  it('states why there is none rather than showing an empty panel', async () => {
    const user = userEvent.setup();
    mockFetch(false, { receipt: null, reason: 'No submission receipt was recorded for this application.' });
    render(<SubmissionReceipt applicationId={31} token="t" />);
    await user.click(screen.getByRole('button', { name: /what was sent/i }));

    expect(await screen.findByText(/No submission receipt was recorded/)).toBeInTheDocument();
  });

  it('distinguishes a display failure from a missing record', async () => {
    // "It could not be loaded" and "it does not exist" are different facts and
    // a user acting on the wrong one would be badly misled.
    const user = userEvent.setup();
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    render(<SubmissionReceipt applicationId={31} token="t" />);
    await user.click(screen.getByRole('button', { name: /what was sent/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/display failure, not a missing record/i);
  });

  it('never invents a value it was not given', async () => {
    const user = userEvent.setup();
    mockFetch(true, { receipt: { ...RECEIPT, resume_sha256: null, platform_confirmation_id: null } });
    render(<SubmissionReceipt applicationId={31} token="t" />);
    await user.click(screen.getByRole('button', { name: /what was sent/i }));

    expect(await screen.findByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByText('None returned')).toBeInTheDocument();
  });
});
