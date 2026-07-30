/*
 * Presence beacon, injected only into HirePilot's own pages.
 *
 * HirePilot needs to know whether the extension is installed so it can show the
 * install prompt to people who need it and stay out of the way for everyone
 * else. A web page cannot query installed extensions, so the extension
 * announces itself instead: it stamps an attribute on <html> and answers a
 * window-message handshake.
 *
 * Deliberately narrow - this file is a beacon, not a bridge. It exposes only the
 * version and never touches the queue, the access token, or storage, so nothing
 * on the page can drive the extension through it. The real control channel is
 * chrome.runtime messaging between the popup and the background worker.
 */

(() => {
  const VERSION = chrome.runtime.getManifest().version;

  const stamp = () => {
    const el = document.documentElement;
    if (!el) return;
    el.setAttribute('data-hirepilot-extension', VERSION);
  };

  stamp();
  // Next.js hydration can replace the root's attributes, so re-stamp once the
  // document is ready rather than assuming the first write survives.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', stamp, { once: true });
  }

  // Handshake, for a page that loads before the content script runs.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'HIREPILOT_EXT_PING') return;
    stamp();
    window.postMessage({ type: 'HIREPILOT_EXT_PONG', version: VERSION }, window.location.origin);
  });

  // Announce unprompted too, so a listener mounted after load still hears it.
  window.postMessage({ type: 'HIREPILOT_EXT_PONG', version: VERSION }, window.location.origin);
})();
