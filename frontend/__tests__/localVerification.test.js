/*
 * A3 / H5 — the two facts that make local verification meaningful.
 *
 * For most of this project the dev environment could not verify anything: no
 * page hydrated cleanly, so a component could mount, render nothing, fetch
 * nothing, and look identical to one that worked. Two defects reached
 * production behind that blind spot - A7.1's sort control that did nothing and
 * A2c's badge that overflowed its ring.
 *
 * "It looked fine locally" is not a check. These are:
 *   1. the React root attaches and produces real content
 *   2. the component actually issues its API request
 *
 * Asserted in CI so the claim is machine-checked on every run, not re-observed
 * by hand each time.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';

/*
 * Static imports, and NO jest.resetModules(). Resetting the registry and then
 * require()-ing a page hands it a second copy of React while RTL still holds
 * the first, and every hook throws "Cannot read properties of null (reading
 * 'useState')" - a failure about the harness, not the page.
 */
import ApplicationsPage from '../pages/applications';
import AutoApplyPage from '../pages/auto-apply';

const push = jest.fn();
const replace = jest.fn();

jest.mock('next/router', () => {
  const router = {
    push: (...a) => push(...a),
    replace: (...a) => replace(...a),
    pathname: '/', route: '/', asPath: '/', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

function mockFetch() {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      kanban: {}, rejected: [], failed: [], pendingReview: [],
      blockers: [], total: 0, questionCount: 0,
      queue: [], counts: {}, matches: [], submitted: [], profile: null, run: null,
    }),
  }));
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  window.localStorage.clear();
  window.localStorage.setItem('token', 'test-token');
  window.localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }));
  mockFetch();
});

const PAGES = [
  { name: 'applications', Page: ApplicationsPage, endpoint: /\/api\/applications/ },
  { name: 'auto-apply', Page: AutoApplyPage, endpoint: /\/api\/(profile|apply\/queue)/ },
];

describe.each(PAGES)('A3 / H5 — $name verifies locally', ({ Page, endpoint }) => {
  it('attaches a React root that renders real content', async () => {
    const { container } = render(<Page />);

    // Not "no error thrown" - actual rendered substance. A component that
    // returns null passes a smoke test and fails this.
    await waitFor(() => expect(container.textContent.trim().length).toBeGreaterThan(20));
    expect(container.querySelector('*')).not.toBeNull();
  });

  it('issues its API request on mount', async () => {
    render(<Page />);

    await waitFor(() => {
      const called = global.fetch.mock.calls.map((c) => String(c[0]));
      expect(called.some((u) => endpoint.test(u))).toBe(true);
    });
  });
});
