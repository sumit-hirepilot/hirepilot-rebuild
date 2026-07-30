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

export default function ExtensionInstallModal({ token, apiBase }) {
  const [detected, setDetected] = useState(null); // null = still checking
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(null);

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
        setOpen(false);
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
      if (localStorage.getItem(DISMISS_KEY) !== '1') setOpen(true);
    }, 1200);

    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
  }, [check]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setOpen(false);
  };

  const copy = (text, which) => {
    navigator.clipboard.writeText(text).then(
      () => { setCopied(which); setTimeout(() => setCopied(null), 2000); },
      () => setCopied('failed')
    );
  };

  if (!open || detected) return null;

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
              <p className={styles.stepTitle}>Turn on <strong>Developer mode</strong></p>
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
