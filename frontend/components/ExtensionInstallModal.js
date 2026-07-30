import { useCallback, useEffect, useState } from 'react';
import styles from '../styles/ExtensionModal.module.css';

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
const EXT_PATH = 'hirepilot-rebuild/extension';

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
 * same as "not installed" or the CTA flashes on every page load.
 */
export function useExtensionDetected() {
  const [detected, setDetected] = useState(null);

  const check = useCallback(() => {
    const attr = document.documentElement.getAttribute('data-hirepilot-extension');
    if (attr) { setDetected(attr); return true; }
    return false;
  }, []);

  useEffect(() => {
    let settled = false;

    const onMessage = (e) => {
      if (e.source !== window || !e.data) return;
      if (e.data.type === 'HIREPILOT_EXT_PONG') {
        settled = true;
        setDetected(e.data.version || 'installed');
      }
    };
    window.addEventListener('message', onMessage);

    if (check()) {
      settled = true;
    } else {
      window.postMessage({ type: 'HIREPILOT_EXT_PING' }, window.location.origin);
    }

    // Give the content script a moment to land before concluding it is absent -
    // otherwise a slow inject shows the prompt to someone who already has it.
    const timer = setTimeout(() => {
      if (settled || check()) return;
      setDetected(false);
    }, 1200);

    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
  }, [check]);

  return detected;
}

export { DISMISS_KEY };

/*
 * Controlled: the owner decides when it is open, so the same component serves
 * both the one-time prompt after sign-in and the "Download Extension" CTA in the
 * top bar. `onDismiss` is what the CTA path skips - reopening from the nav should
 * not un-dismiss the automatic prompt, and closing it there should not re-arm it.
 */
export default function ExtensionInstallModal({ token, apiBase, open, onClose, onDismiss }) {
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
              <p className={styles.stepTitle}>Open Chrome&apos;s extensions page</p>
              <code className={styles.code}>chrome://extensions</code>
              <p className={styles.hint}>
                Chrome blocks pages from linking here, so paste it into the address bar.
              </p>
            </div>
          </li>
          <li>
            <span className={styles.stepNum}>2</span>
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
            <span className={styles.stepNum}>3</span>
            <div>
              <p className={styles.stepTitle}>Click <strong>Load unpacked</strong> and pick this folder</p>
              <div className={styles.copyRow}>
                <code className={styles.code}>{EXT_PATH}</code>
                <button className={styles.copyBtn} onClick={() => copy(EXT_PATH, 'path')}>
                  {copied === 'path' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </li>
          <li>
            <span className={styles.stepNum}>4</span>
            <div>
              <p className={styles.stepTitle}>Connect it to your account</p>
              <p className={styles.hint}>
                Open the extension, set the HirePilot URL to <code className={styles.codeInline}>{apiBase}</code>,
                and paste this access token. It is a live session for your account &mdash;
                treat it like your password.
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
      </div>
    </div>
  );
}
