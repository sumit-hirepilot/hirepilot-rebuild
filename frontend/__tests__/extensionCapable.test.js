/*
 * The product never instructs a device to do something it cannot do.
 *
 * Nothing in the frontend detected a phone. So on Chrome for Android and every
 * iOS browser, the header offered "Download Extension" and the post-signin
 * modal walked through installing it - and neither can install a Chrome
 * extension at all. That instruction was being shown to precisely the users
 * the landing page invites with "runs in your mobile browser".
 *
 * D46 is why it survived: resizing a desktop window to 375px lays the button
 * out perfectly, and every audit pass did exactly that. A resized window is
 * still a desktop browser. Only what the device itself reports can answer it,
 * so this test drives real user-agent strings rather than a viewport width.
 */

import { canInstallExtension, isMobileBrowser, DESKTOP_ONLY_NOTE } from '../lib/extensionCapable';

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const nav = (userAgent, extra = {}) => ({ userAgent, maxTouchPoints: 0, ...extra });

describe('a phone is recognised by what it reports, not by how wide the window is', () => {
  it('knows Chrome on Android cannot install an extension', () => {
    expect(isMobileBrowser(nav(UA.androidChrome))).toBe(true);
    expect(canInstallExtension(nav(UA.androidChrome))).toBe(false);
  });

  it('knows every iOS browser cannot', () => {
    expect(canInstallExtension(nav(UA.iphoneSafari))).toBe(false);
  });

  it('catches iPadOS, which reports itself as a Mac', () => {
    /*
     * The one that would have slipped through a user-agent check alone: iPadOS
     * sends a desktop Mac UA. The touch count is the difference - a Mac
     * reports 0, an iPad reports 5.
     */
    expect(canInstallExtension(nav(UA.ipadOS, { maxTouchPoints: 5 }))).toBe(false);
  });

  it('does not mistake a real Mac for an iPad', () => {
    expect(canInstallExtension(nav(UA.macChrome, { maxTouchPoints: 0 }))).toBe(true);
  });

  it('does not mistake a touchscreen Windows laptop for a phone', () => {
    // A touch-capable desktop CAN install the extension. Suppressing it there
    // would take a working feature away, which is the costlier error.
    expect(canInstallExtension(nav(UA.winChrome, { maxTouchPoints: 10 }))).toBe(true);
  });

  it('prefers userAgentData.mobile when the browser provides it', () => {
    expect(canInstallExtension(nav(UA.winChrome, { userAgentData: { mobile: true } }))).toBe(false);
    expect(canInstallExtension(nav(UA.androidChrome, { userAgentData: { mobile: false } }))).toBe(true);
  });

  it('treats unknown as capable, so no desktop user loses the feature', () => {
    // Server-side, where navigator does not exist. Also keeps the first client
    // render identical to the server's, which is what avoids a hydration
    // mismatch - the same fault useExtensionDetected was already fixed for.
    expect(canInstallExtension(null)).toBe(true);
  });
});

describe('it explains rather than going silent', () => {
  it('states the reason and what still works', () => {
    /*
     * Hiding the button would drop the only place the desktop-only
     * requirement is stated. A user who never learns why applying does nothing
     * is worse off than one told plainly.
     */
    expect(DESKTOP_ONLY_NOTE).toMatch(/desktop/i);
    expect(DESKTOP_ONLY_NOTE).toMatch(/phone/i);
  });

  it('the layout relabels the control instead of removing it', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'DashboardLayout.js'), 'utf8');

    // The button still renders on a phone - the label and the modal change.
    expect(src).toMatch(/canInstall \? \(/);
    expect(src).toMatch(/Applying needs/);
    expect(src).toMatch(/canInstall=\{canInstall\}/);
  });

  it('never auto-prompts a device that cannot follow the instruction', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'DashboardLayout.js'), 'utf8');
    expect(src).toMatch(/if \(!canInstall\) return;/);
  });
});

describe('the desktop-only label fits a phone header', () => {
  const fs = require('fs');
  const path = require('path');
  const layout = fs.readFileSync(path.join(__dirname, '..', 'components', 'DashboardLayout.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'Dashboard.module.css'), 'utf8');

  it('offers a short form, because the long one clipped the credits pill', () => {
    /*
     * At 375 "Applying needs desktop" made the header 530px wide inside a
     * 375px viewport and clipped the credits value to "45". Page-level
     * overflow read 0 throughout - the header clips internally rather than
     * scrolling the page - so only the screenshot showed it.
     */
    expect(layout).toMatch(/extensionCtaLabelShort/);
    expect(layout).toMatch(/Desktop only/);
  });

  it('shows exactly one of the two forms at any width', () => {
    // Both visible at once would be worse than either alone.
    expect(css).toMatch(/\.extensionCtaLabelShort \{ display: none; \}/);
    const narrow = css.slice(css.indexOf('@media (max-width: 900px)'));
    expect(narrow).toMatch(/\.extensionCtaLabelLong \{ display: none; \}/);
    expect(narrow).toMatch(/\.extensionCtaLabelShort \{ display: inline; \}/);
  });
});
