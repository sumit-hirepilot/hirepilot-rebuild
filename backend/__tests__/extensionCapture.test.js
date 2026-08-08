/*
 * Feature 13 — one-click capture from any posting (E3).
 *
 * The extension's background worker gains HP_CAPTURE_TAB: read the active
 * tab's URL, hand it to the same POST /api/jobs/from-url the paste box uses,
 * and report the server's own outcome - the added job with its score, or the
 * refusal with the server's sentence and the paste fallback. No extension
 * copy of the fetch/extract/refusal logic: the server owns it.
 *
 * These drive the REAL background.js through a stubbed chrome, because the
 * extension cannot be loaded into a browser in this environment and an
 * untested message handler is how the retry/approve class of defect shipped.
 * (extension/test/ exists but no runner executes it - these live in the
 * backend suite, which does run.)
 */

/* eslint-disable global-require */

let messageHandler = null;
let storageData = {};

function freshChrome() {
  messageHandler = null;
  storageData = { token: 'tok-123' };
  global.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => { messageHandler = fn; } },
      sendMessage: jest.fn(() => Promise.resolve()),
      lastError: null,
    },
    storage: {
      local: {
        get: jest.fn(() => Promise.resolve({ ...storageData })),
        set: jest.fn((v) => { Object.assign(storageData, v); return Promise.resolve(); }),
        remove: jest.fn((k) => { delete storageData[k]; return Promise.resolve(); }),
      },
    },
    tabs: {
      query: jest.fn(() => Promise.resolve([{ id: 5, url: 'https://boards.example.com/jobs/123' }])),
      get: jest.fn(), create: jest.fn(), remove: jest.fn(), sendMessage: jest.fn(),
    },
    action: {
      setBadgeText: jest.fn(() => Promise.resolve()),
      setBadgeBackgroundColor: jest.fn(() => Promise.resolve()),
    },
    scripting: { executeScript: jest.fn() },
    permissions: { contains: jest.fn() },
  };
}

function loadBackground() {
  jest.isolateModules(() => {
    require('../../extension/background.js');
  });
  expect(messageHandler).toBeTruthy();
}

function dispatch(msg) {
  return new Promise((resolve) => {
    messageHandler(msg, { tab: null }, resolve);
  });
}

beforeEach(() => {
  freshChrome();
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.chrome;
  delete global.fetch;
});

describe('HP_CAPTURE_TAB', () => {
  it('sends the active tab URL to the server and reports the added job', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true, status: 201,
      text: () => Promise.resolve(JSON.stringify({
        job: { id: 9, title: 'Product Designer', company_name: 'Adyen', companyStated: true, postedAtKnown: false },
        score: 0.71, alreadyHad: false, weak: false,
      })),
    });
    loadBackground();

    const r = await dispatch({ type: 'HP_CAPTURE_TAB' });

    expect(r.ok).toBe(true);
    expect(r.job.title).toBe('Product Designer');
    expect(r.score).toBe(0.71);

    const [url, opts] = global.fetch.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/jobs\/from-url$/);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ url: 'https://boards.example.com/jobs/123' });
    expect(opts.headers.Authorization).toBe('Bearer tok-123');
  });

  it('reports the server\'s refusal in its own words, with the paste fallback', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false, status: 422,
      text: () => Promise.resolve(JSON.stringify({
        error: 'Instahyre blocks automated readers. Paste the description instead.',
        reason: 'blocked_by_site', canPaste: true,
      })),
    });
    loadBackground();

    const r = await dispatch({ type: 'HP_CAPTURE_TAB' });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('refused');
    expect(r.detail).toMatch(/blocks automated readers/);
    // The popup needs somewhere to send the user - the app's paste box.
    expect(r.appBase).toMatch(/^https?:\/\//);
  });

  it('refuses a non-web tab without calling the server', async () => {
    global.chrome.tabs.query.mockResolvedValueOnce([{ id: 5, url: 'chrome://extensions' }]);
    loadBackground();

    const r = await dispatch({ type: 'HP_CAPTURE_TAB' });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_a_page');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('says sign in first when there is no token, without calling the server', async () => {
    storageData = {};
    loadBackground();

    const r = await dispatch({ type: 'HP_CAPTURE_TAB' });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_connected');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
