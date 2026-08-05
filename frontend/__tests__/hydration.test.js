/*
 * A3 / H2+H3 — no environment-dependent value may be read during initial
 * render.
 *
 * H2 and H3 were filed as two bugs. They are one: the server and the client
 * disagree because the first render reads something only one of them has.
 * Layout read `localStorage.getItem('token')` (absent on the server, present
 * on the client) and index.js read `toLocaleString()` with no locale (the
 * server's ICU locale, then the browser's). React 18 responds by throwing away
 * the server HTML and re-rendering, which is why NO page hydrated cleanly in
 * dev and why the local environment could not verify any UI change.
 *
 * Two assertions, deliberately different in kind:
 *
 *  1. Structural - render the same component under two environments and diff
 *     the markup. If it differs, a mismatch is guaranteed regardless of what
 *     React happens to log. This catches the cause.
 *
 *  2. Behavioural - server-render under one environment, hydrate that exact
 *     markup under the other, and fail on any hydration message React logs.
 *     This catches the symptom, including causes not yet thought of.
 *
 * "I saw no warnings in the console" is not a pass and never was.
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act } from '@testing-library/react';

import Layout from '../components/Layout';

jest.mock('next/router', () => {
  const router = {
    push: jest.fn(), replace: jest.fn(), prefetch: jest.fn().mockResolvedValue(undefined),
    pathname: '/', route: '/', asPath: '/', query: {}, isReady: true,
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
  };
  return { useRouter: () => router, default: router };
});

const HYDRATION_NOISE = /hydrat|did not match|server html|text content/i;

/** Everything React logged as an error or warning during `fn`. */
async function captureConsole(fn) {
  const seen = [];
  const spies = ['error', 'warn'].map((level) => {
    const original = console[level];
    console[level] = (...args) => { seen.push(args.map(String).join(' ')); };
    return () => { console[level] = original; };
  });
  try { await fn(); } finally { spies.forEach((restore) => restore()); }
  return seen;
}

function withToken(token) {
  window.localStorage.clear();
  if (token) {
    window.localStorage.setItem('token', token);
    window.localStorage.setItem('user', JSON.stringify({ id: 1, email: 'a@b.c' }));
  }
}

describe('A3 — initial render does not depend on the environment', () => {
  it('renders identical markup signed-out and signed-in', () => {
    /*
     * The server always renders signed-out: it has no localStorage. If the
     * client's first render differs, hydration cannot succeed. The auth-
     * dependent swap has to happen AFTER mount, behind a mounted flag.
     */
    withToken(null);
    const signedOut = renderToString(<Layout><p>x</p></Layout>);

    withToken('a.jwt.value');
    const signedIn = renderToString(<Layout><p>x</p></Layout>);

    expect(signedIn).toBe(signedOut);
  });
});

describe('A3 — hydrating server markup logs no hydration message', () => {
  it('hydrates a server-rendered Layout without complaint', async () => {
    // Server pass: no token, exactly as production SSR runs.
    withToken(null);
    const serverHtml = renderToString(<Layout><p>x</p></Layout>);

    // Client pass: the token exists by the time the bundle runs.
    withToken('a.jwt.value');
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.appendChild(container);

    const logged = await captureConsole(async () => {
      await act(async () => {
        hydrateRoot(container, <Layout><p>x</p></Layout>);
      });
    });

    const hydrationMessages = logged.filter((m) => HYDRATION_NOISE.test(m));
    expect(hydrationMessages).toEqual([]);
  });
});
