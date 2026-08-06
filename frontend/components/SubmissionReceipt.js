import { useState } from 'react';
import { API_BASE } from '../lib/apiBase';
// A3/H3 — never toLocale* directly: the host locale differs between server and
// browser and hydration fails. lib/format pins locale and time zone.
import { formatDateTime } from '../lib/format';
import styles from '../styles/Receipt.module.css';

/*
 * A4 — the immutable receipt, on screen.
 *
 * The receipt has existed server-side since A4 and nothing rendered it, so a
 * user could not see what was sent in their name. For a product that submits
 * applications autonomously that is the single most important thing to be able
 * to read: exactly which fields went, which answers were given, which file by
 * content hash, and what the platform said back.
 *
 * It is deliberately a record, not a summary. Nothing here is recomputed from
 * current profile values - if it were, it would show what WOULD be sent today
 * rather than what WAS sent, which is the opposite of a receipt.
 */
export default function SubmissionReceipt({ applicationId, token }) {
  const [state, setState] = useState('idle'); // idle | loading | ready | none | error
  const [receipt, setReceipt] = useState(null);
  const [reason, setReason] = useState('');

  const open = async () => {
    setState('loading');
    try {
      const res = await fetch(`${API_BASE}/api/apply/queue/${applicationId}/receipt`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.receipt) { setReceipt(data.receipt); setState('ready'); return; }
      // 404 is a real answer here - this application has no receipt - and the
      // server explains why. Showing that beats an empty panel.
      setReason(data.reason || 'No receipt was recorded for this application.');
      setState('none');
    } catch (err) {
      setState('error');
    }
  };

  if (state === 'idle') {
    return (
      <button type="button" className={styles.trigger} onClick={open}>
        What was sent
      </button>
    );
  }
  if (state === 'loading') return <p className={styles.note}>Loading the receipt…</p>;
  if (state === 'error') {
    return (
      <p className={styles.note} role="alert">
        The receipt could not be loaded. It still exists — this is a display failure, not a missing record.
      </p>
    );
  }
  if (state === 'none') return <p className={styles.note}>{reason}</p>;

  const entries = (obj) => Object.entries(obj || {});

  return (
    <div className={styles.receipt}>
      <p className={styles.title}>What was sent</p>
      <p className={styles.stamp}>
        Submitted {formatDateTime(receipt.submitted_at)}
        {receipt.ats ? ` · via ${receipt.ats}` : ''}
      </p>

      <p className={styles.section}>Fields</p>
      {entries(receipt.fields_sent).length === 0 ? (
        <p className={styles.note}>No fields were recorded.</p>
      ) : (
        <dl className={styles.dl}>
          {entries(receipt.fields_sent).map(([k, v]) => (
            <div key={k} className={styles.row}><dt>{k}</dt><dd>{String(v)}</dd></div>
          ))}
        </dl>
      )}

      <p className={styles.section}>Answers</p>
      {entries(receipt.answers_sent).length === 0 ? (
        <p className={styles.note}>No screening answers were recorded.</p>
      ) : (
        <dl className={styles.dl}>
          {entries(receipt.answers_sent).map(([k, v]) => (
            <div key={k} className={styles.row}><dt>{k}</dt><dd>{String(v)}</dd></div>
          ))}
        </dl>
      )}

      <p className={styles.section}>File</p>
      <dl className={styles.dl}>
        <div className={styles.row}>
          <dt>Filename</dt><dd>{receipt.resume_filename || 'Not recorded'}</dd>
        </div>
        <div className={styles.row}>
          {/* The hash identifies the file by content. A filename can be reused;
              this cannot. */}
          <dt>SHA-256</dt><dd className={styles.hash}>{receipt.resume_sha256 || 'Not recorded'}</dd>
        </div>
      </dl>

      <p className={styles.section}>Platform response</p>
      <dl className={styles.dl}>
        <div className={styles.row}>
          <dt>Confirmation</dt><dd>{receipt.platform_confirmation_id || 'None returned'}</dd>
        </div>
        <div className={styles.row}>
          <dt>Page</dt><dd className={styles.hash}>{receipt.platform_url || 'Not recorded'}</dd>
        </div>
        {receipt.platform_response ? (
          <div className={styles.row}>
            <dt>Response</dt>
            <dd>{typeof receipt.platform_response === 'string'
              ? receipt.platform_response
              : JSON.stringify(receipt.platform_response)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
