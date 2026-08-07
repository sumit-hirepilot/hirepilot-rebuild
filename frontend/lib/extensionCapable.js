/*
 * Can this browser install the Chrome extension at all?
 *
 * Nothing in the frontend detected a phone. So on a real Android or iOS
 * browser the header still offered "Download Extension" and the post-signin
 * modal still prompted for it — and neither Chrome on Android nor any iOS
 * browser can install an extension. The product was offering an action that
 * cannot be performed, to the users the landing page invites in with "runs in
 * your mobile browser".
 *
 * D46 is why this went unseen: resizing the window sets a true viewport width,
 * so the button lays out perfectly at 375px in every audit pass. Nothing about
 * a resized desktop browser is different from a phone in the way that matters
 * here. Only something a phone reports can answer this question.
 *
 * DIRECTION OF ERROR, on purpose: unknown means CAPABLE. A desktop user who is
 * wrongly told they cannot install has lost the feature; a phone user who is
 * wrongly offered it sees a download that does nothing, which is what already
 * happens today. So this only suppresses when it is confident, and never
 * HIDES the fact — the callers replace the button with a plain sentence
 * saying applying needs a desktop browser, rather than silently removing it.
 */

/** Signals a phone actually reports. Order matters: cheapest and clearest first. */
export function isMobileBrowser(nav = typeof navigator === 'undefined' ? null : navigator) {
  if (!nav) return false;

  // The modern, structured answer, where it exists. Chrome and Edge give it.
  if (nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean') {
    return nav.userAgentData.mobile;
  }

  const ua = String(nav.userAgent || '');
  if (/Android|iPhone|iPod|IEMobile|Opera Mini/i.test(ua)) return true;

  /*
   * iPadOS reports itself as a Mac. The touch count is what separates them:
   * a real Mac reports 0, an iPad reports 5. Checked only for Mac-like UAs so
   * a touchscreen laptop is never caught by it.
   */
  if (/Macintosh|Mac OS X/i.test(ua) && Number(nav.maxTouchPoints) > 1) return true;

  if (/\biPad\b/i.test(ua)) return true;

  return false;
}

/**
 * True when the extension can be installed here.
 *
 * Safe on the server: `navigator` is absent there, so this returns true and
 * the first client render matches the server's. The callers re-evaluate after
 * mount, which is where the real answer arrives.
 */
export function canInstallExtension(nav = typeof navigator === 'undefined' ? null : navigator) {
  if (!nav) return true;          // unknown -> capable, per the note above
  return !isMobileBrowser(nav);
}

/** What to say instead, when it cannot. Never silence — always the reason. */
export const DESKTOP_ONLY_NOTE =
  'Applying uses the Chrome extension, which needs a desktop browser. Everything else here works on your phone.';
