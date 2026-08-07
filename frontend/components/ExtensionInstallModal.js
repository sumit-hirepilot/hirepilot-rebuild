import { useEffect, useState } from 'react';
import styles from '../styles/ExtensionModal.module.css';
import { DESKTOP_ONLY_NOTE } from '../lib/extensionCapable';

/*
 * Prompts the user to install the browser extension.
 *
 * The extension is what actually submits applications on employer sites, so
 * without it the Apply Queue can prepare work that can never be executed. This
 * appears once after sign-in and stays gone once the extension is detected or
 * the user dismisses it.
 *
 * Detection: a web page cannot enumerate installed extensions, so the extension
 * announces itself - it stamps data-hirepilot-extension on <html> and answers a
 * postMessage handshake (content/announce.js). Both are checked because the
 * page may mount before or after the content script runs.
 */

const DISMISS_KEY = 'hp_ext_prompt_dismissed';
// Packaged at build time by scripts/build-extension-zip.js, so the download can
// never be a stale copy of the extension folder.
const ZIP_URL = '/hirepilot-extension.zip';

/*
 * Inline "i" popover. Developer mode is the step people stall on - it sounds
 * riskier than it is, and the toggle is easy to miss - so the explanation sits
 * next to the step rather than in a separate help page.
 */
function InfoButton({ label, children }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => {
      if (!e.target.closest?.(`[data-info="${label}"]`)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, label]);

  return (
    <span className={styles.infoWrap} data-info={label}>
      <button
        type="button"
        className={styles.infoBtn}
        aria-label={`More about ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && (
        <span className={styles.infoPop} role="tooltip">
          {children}
        </span>
      )}
    </span>
  );
}

/*
 * Detection, shared by the modal's auto-prompt and the nav CTA (which hides
 * itself once the extension is present).
 *
 * Returns null while still checking, a version string when detected, false when
 * concluded absent - three states, because "not yet known" must not look the
 * same as "not installed".
 *
 * The result is cached OUTSIDE React. Every page mounts its own DashboardLayout,
 * so navigating unmounts and remounts it; without a cache the hook reset to null
 * and re-ran the 1.2s probe on each route change, which made the CTA vanish and
 * pop back in on every navigation. The cache makes the answer immediate after
 * the first determination.
 *
 * sessionStorage backs it so a full reload is also instant. Caching a negative
 * is safe because the DOM attribute is checked synchronously first, so a newly
 * installed extension is picked up immediately regardless of what was cached.
 */
const CACHE_KEY = 'hp_ext_detected';
let cachedDetection; // undefined = never determined this session

/*
 * Whether the automatic prompt has already fired this session.
 *
 * Module-level, not component state: DashboardLayout remounts on every route
 * change, and now that detection resolves instantly from cache, a component-state
 * flag would re-open the modal on every single navigation.
 */
let promptShownThisSession = false;
export const extensionPrompt = {
  shouldShow() {
    if (promptShownThisSession) return false;
    try { if (localStorage.getItem(DISMISS_KEY) === '1') return false; } catch { /* private mode */ }
    return true;
  },
  markShown() { promptShownThisSession = true; },
};

function readAttr() {
  if (typeof document === 'undefined') return null;
  return document.documentElement.getAttribute('data-hirepilot-extension');
}

function initialDetection() {
  // Present right now wins over anything cached.
  const attr = readAttr();
  if (attr) return attr;
  if (cachedDetection !== undefined) return cachedDetection;
  if (typeof sessionStorage !== 'undefined') {
    const stored = sessionStorage.getItem(CACHE_KEY);
    if (stored === 'false') { cachedDetection = false; return false; }
    if (stored) { cachedDetection = stored; return stored; }
  }
  return null;
}

function remember(value) {
  cachedDetection = value;
  try { sessionStorage.setItem(CACHE_KEY, String(value)); } catch { /* private mode */ }
}

export function useExtensionDetected() {
  /*
   * Starts null on EVERY first render, server and client alike.
   *
   * It used to seed from the cache synchronously, which reads document and
   * sessionStorage - neither exists on the server. So the server rendered no
   * extension button and the client rendered one, and React threw a hydration
   * mismatch on every page in the app: "Expected server HTML to contain a
   * matching <button> in <header>".
   *
   * The cache is still applied immediately below, in an effect, so a remount
   * still settles within a frame rather than flickering through the full probe.
   */
  const [detected, setDetected] = useState(null);

  useEffect(() => {
    const cached = initialDetection();
    if (cached !== null) setDetected(cached);
  }, []);

  useEffect(() => {
    // Already known - but still listen, in case it is installed mid-session.
    let settled = detected !== null;

    const onMessage = (e) => {
      if (e.source !== window || !e.data) return;
      if (e.data.type === 'HIREPILOT_EXT_PONG') {
        settled = true;
        const v = e.data.version || 'installed';
        remember(v);
        setDetected(v);
      }
    };
    window.addEventListener('message', onMessage);

    const attr = readAttr();
    if (attr) {
      remember(attr);
      setDetected(attr);
      settled = true;
    } else {
      window.postMessage({ type: 'HIREPILOT_EXT_PING' }, window.location.origin);
    }

    // Only wait out the grace period when there is no answer yet. A cached
    // result means this remount does not need to re-probe.
    const timer = settled ? null : setTimeout(() => {
      if (readAttr()) return;
      remember(false);
      setDetected(false);
    }, 1200);

    return () => {
      window.removeEventListener('message', onMessage);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return detected;
}

export { DISMISS_KEY };

/*
 * Controlled: the owner decides when it is open, so the same component serves
 * both the one-time prompt after sign-in and the "Download Extension" CTA in the
 * top bar. `onDismiss` is what the CTA path skips - reopening from the nav should
 * not un-dismiss the automatic prompt, and closing it there should not re-arm it.
 */
export default function ExtensionInstallModal({ token, apiBase, open, onClose, onDismiss, canInstall = true }) {
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const dismiss = () => {
    if (onDismiss) onDismiss();
    onClose();
  };

  const copy = (text, which) => {
    navigator.clipboard.writeText(text).then(
      () => { setCopied(which); setTimeout(() => setCopied(null), 2000); },
      () => setCopied('failed')
    );
  };

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="extTitle">
      <div className={styles.modal}>
        <button className={styles.close} onClick={dismiss} aria-label="Close">&times;</button>

        {/*
          * On a browser that cannot install a Chrome extension - Chrome on
          * Android, every iOS browser - this says so and stops. Walking someone
          * through steps their device cannot perform is an instruction that
          * cannot be followed, and it was being shown to exactly the users the
          * landing page invites with "runs in your mobile browser".
          *
          * Invisible to a resized desktop window (D46): the steps lay out
          * perfectly at 375px. Only what the phone itself reports answers this.
          */}
        {!canInstall ? (
          <>
            <span className={styles.badge}>Desktop only</span>
            <h2 id="extTitle" className={styles.title}>Applying needs a desktop browser</h2>
            <p className={styles.lead}>{DESKTOP_ONLY_NOTE}</p>
            <p className={styles.lead}>
              You can do everything else here on your phone &mdash; search, scoring,
              tailoring, the tracker. When you are next at a computer, open this
              page again and the setup will be waiting.
            </p>
            <button type="button" className={styles.downloadBtn} onClick={dismiss}>
              Got it
            </button>
          </>
        ) : (
        <>
        <span className={styles.badge}>One-time setup</span>
        <h2 id="extTitle" className={styles.title}>Install the HirePilot Apply extension</h2>
        <p className={styles.lead}>
          HirePilot prepares each application &mdash; tailored resume, cover letter,
          pre-filled answers &mdash; but the extension is what submits it on the
          employer&apos;s own site, in your browser session. Without it, the Apply
          Queue can prepare applications it cannot send.
        </p>

        <ol className={styles.steps}>
          <li>
            <span className={styles.stepNum}>1</span>
            <div>
              <p className={styles.stepTitle}>Download and unzip it</p>
              <a className={styles.downloadBtn} href={ZIP_URL} download>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3v12" />
                  <path d="m7 11 5 5 5-5" />
                  <path d="M4 19h16" />
                </svg>
                Download hirepilot-extension.zip
              </a>
              <p className={styles.hint}>
                Unzip it and keep the folder somewhere permanent &mdash; Chrome loads
                an unpacked extension from that folder each time it starts, so
                deleting it later disables the extension.
              </p>
            </div>
          </li>
          <li>
            <span className={styles.stepNum}>2</span>
            <div>
              <p className={styles.stepTitle}>Open Chrome&apos;s extensions page</p>
              <code className={styles.code}>chrome://extensions</code>
              <p className={styles.hint}>
                Chrome blocks pages from linking here, so paste it into the address bar.
              </p>
            </div>
          </li>
          <li>
            <span className={styles.stepNum}>3</span>
            <div>
              <p className={styles.stepTitle}>
                Turn on <strong>Developer mode</strong>
                <InfoButton label="Developer mode">
                  <strong>Where it is:</strong> a toggle in the top-right corner of
                  the <em>chrome://extensions</em> page, on the same row as the
                  &ldquo;Extensions&rdquo; heading.
                  <br /><br />
                  <strong>What it does:</strong> it lets Chrome load an extension
                  from a folder on your machine instead of only from the Chrome Web
                  Store. That is the only reason it is needed here &mdash; HirePilot
                  Apply is not published to the store.
                  <br /><br />
                  <strong>Is it safe:</strong> it changes nothing on its own. It only
                  reveals the &ldquo;Load unpacked&rdquo; button. Chrome will show a
                  &ldquo;Disable developer mode extensions&rdquo; warning on startup;
                  that is expected, and you can turn the toggle back off once the
                  extension is loaded.
                </InfoButton>
              </p>
              <p className={styles.hint}>Toggle at the top right of that page.</p>
            </div>
          </li>
          <li>
            <span className={styles.stepNum}>4</span>
            <div>
              <p className={styles.stepTitle}>Click <strong>Load unpacked</strong> and pick the unzipped folder</p>
              <p className={styles.hint}>
                Select the folder itself, the one containing{' '}
                <code className={styles.codeInline}>manifest.json</code> &mdash; not the
                zip and not a folder above it.
              </p>
            </div>
          </li>
          <li>
            <span className={styles.stepNum}>5</span>
            <div>
              <p className={styles.stepTitle}>Connect it to your account</p>
              <p className={styles.hint}>
                Open the extension, set the HirePilot URL to <code className={styles.codeInline}>{apiBase}</code>,
                and paste this pairing code. It signs the extension in as you &mdash;
                treat it like your password, and do not share it.
              </p>
              <div className={styles.copyRow}>
                <code className={styles.tokenBox}>{token ? `${token.slice(0, 28)}…` : 'signing in…'}</code>
                <button
                  className={styles.copyBtn}
                  onClick={() => copy(token, 'token')}
                  disabled={!token}
                >
                  {copied === 'token' ? 'Copied' : 'Copy token'}
                </button>
              </div>
              {copied === 'failed' && (
                <p className={styles.err}>Could not copy &mdash; select the text manually.</p>
              )}
            </div>
          </li>
        </ol>

        <div className={styles.actions}>
          <button className={styles.primary} onClick={() => window.location.reload()}>
            I&apos;ve installed it &mdash; recheck
          </button>
          <button className={styles.ghost} onClick={dismiss}>Later</button>
        </div>

        <p className={styles.footnote}>
          Applications are only ever submitted after you approve them on the review
          screen, and nothing is marked as applied until the employer&apos;s
          confirmation is captured.
        </p>
        </>
        )}
      </div>
    </div>
  );
}
