/*
 * Feature 14 — the job drawer shows a referral path made only of honest
 * ingredients: the user's OWN contacts at the company, and searches into
 * LinkedIn's real index. Empty baskets say so; nothing renders a person
 * HirePilot did not verify exists.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import JobsPage from '../pages/jobs';

jest.mock('next/router', () => {
  const router = {
    push: jest.fn(() => Promise.resolve()), replace: jest.fn(() => Promise.resolve()),
    pathname: '/jobs', route: '/jobs', asPath: '/jobs', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

const JOB = {
  id: 9, title: 'Product Designer', company_name: 'Adyen', source: 'greenhouse',
  location: 'Bengaluru', posted_at: new Date().toISOString(), overall_score: '0.71',
};

function mockApis({ referral }) {
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (/referral-path\/9$/.test(u)) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(referral) });
    }
    if (/\/api\/jobs\/9\/ats$/.test(u)) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }
    if (/\/api\/jobs\/9$/.test(u)) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ...JOB, description: 'A role.', contactEmails: [], skills: [] }),
      });
    }
    const saved = /\/saved\//.test(u);
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        jobs: saved ? [] : [JOB], total: saved ? 0 : 1,
        relatedJobs: [], relatedTotal: 0, noExactMatches: false, emptyReason: null,
        ranking: { mode: 'ranked', sort: 'score', minScore: 0.4, unscoredInPage: 0, undatedTotal: null },
        sources: [], matches: [], applications: [], facets: {},
      }),
    });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('token', 't');
  window.localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }));
});

async function openDrawer() {
  render(<JobsPage />);
  await waitFor(() => expect(screen.getAllByText(/Product Designer/).length).toBeGreaterThan(0));
  const user = userEvent.setup();
  await user.click(screen.getAllByRole('button', { name: /view details/i })[0]);
}

describe('referral path in the job drawer', () => {
  it('renders the searches and an honest empty for zero own contacts', async () => {
    mockApis({
      referral: {
        job: { id: 9, title: 'Product Designer', company_name: 'Adyen', companyStated: true },
        yourContacts: [], postedContacts: [],
        searches: [
          { key: 'recruiter', label: 'Recruiters & talent partners', url: 'https://www.linkedin.com/search/results/people/?keywords=Adyen%20recruiter' },
          { key: 'hiring_manager', label: 'Hiring managers & team leads', url: 'https://www.linkedin.com/search/results/people/?keywords=Adyen%20manager' },
          { key: 'peer', label: 'People already in this kind of role', url: 'https://www.linkedin.com/search/results/people/?keywords=Adyen%20designer' },
        ],
        areIdentifiedPeople: false,
      },
    });
    await openDrawer();

    expect(await screen.findByText(/find a referral/i)).toBeInTheDocument();
    expect(screen.getByText(/no contacts of yours at Adyen yet/i)).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /recruiters & talent partners|hiring managers|people already in/i });
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('linkedin.com/search/results/people'));
  });

  it('renders the user\'s own contact at the company', async () => {
    mockApis({
      referral: {
        job: { id: 9, title: 'Product Designer', company_name: 'Adyen', companyStated: true },
        yourContacts: [{ id: 1, first_name: 'Priya', last_name: 'K', relationship_type: 'recruiter', company_name: 'Adyen' }],
        postedContacts: [], searches: [], areIdentifiedPeople: false,
      },
    });
    await openDrawer();

    expect(await screen.findByText(/Priya K/)).toBeInTheDocument();
    expect(screen.queryByText(/no contacts of yours/i)).not.toBeInTheDocument();
  });
});
