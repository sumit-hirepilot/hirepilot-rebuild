/*
 * Feature 11 — the patterns section renders what the analyzer computed, and
 * ONLY that. The insufficient state states the real number and the floor; a
 * withheld rate renders as "not enough data", never as 0%.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';

import Analytics from '../pages/analytics';

jest.mock('next/router', () => {
  const router = {
    push: jest.fn(() => Promise.resolve()), replace: jest.fn(() => Promise.resolve()),
    pathname: '/analytics', route: '/analytics', asPath: '/analytics', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

const BASE_ANALYTICS = {
  daily: [], statusBreakdown: [], sourceBreakdown: [],
  totals: { totalApplications: 20, responses: 5, offers: 1, autoApplied: 0, responseRate: 25 },
};

function mockApis({ rejections }) {
  global.fetch = jest.fn((url) => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(
      /\/rejections$/.test(String(url)) ? rejections : BASE_ANALYTICS
    ),
  }));
}

beforeEach(() => {
  localStorage.setItem('token', 't');
  localStorage.setItem('user', JSON.stringify({ id: 1, fullName: 'T' }));
});
afterEach(() => localStorage.clear());

describe('rejection intelligence on the analytics page', () => {
  it('states the floor and the real count when there is not enough data', async () => {
    mockApis({
      rejections: {
        sufficient: false, sentTotal: 3, needed: 15,
        bySource: null, bySeniority: null, byScoreBand: null,
        definitions: {},
      },
    });
    render(<Analytics />);

    expect(await screen.findByText(/3 of the 15 sent applications/i)).toBeInTheDocument();
    // No fabricated pattern sneaks in under the floor.
    expect(screen.queryByText(/response rate by source/i)).not.toBeInTheDocument();
  });

  it('renders per-source rates, and "not enough data" for thin groups instead of 0%', async () => {
    mockApis({
      rejections: {
        sufficient: true, sentTotal: 16, needed: 15,
        definitions: { responseRate: 'x', ghosted: 'y', scoreBand: 'z' },
        bySource: [
          { key: 'greenhouse', label: 'greenhouse', applications: 15, responses: 6, rejections: 4, ghosted: 2, pending: 3, sufficient: true, responseRate: 40 },
          { key: 'lever', label: 'lever', applications: 1, responses: 0, rejections: 1, ghosted: 0, pending: 0, sufficient: false, responseRate: null },
        ],
        bySeniority: [
          { key: 'senior', label: 'Senior', applications: 16, responses: 6, rejections: 5, ghosted: 2, pending: 3, sufficient: true, responseRate: 38 },
        ],
        byScoreBand: [
          { key: 'strong', label: 'Strong match (75%+)', applications: 16, responses: 6, rejections: 5, ghosted: 2, pending: 3, sufficient: true, responseRate: 38 },
        ],
      },
    });
    render(<Analytics />);

    expect(await screen.findByText('greenhouse')).toBeInTheDocument();
    expect(screen.getByText(/\b40%/)).toBeInTheDocument();
    expect(screen.getByText(/not enough data \(1\)/i)).toBeInTheDocument();
    // The thin group must never print a rate.
    expect(screen.queryByText(/^0%/)).not.toBeInTheDocument();
  });
});
