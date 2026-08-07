import Link from 'next/link';
import { useState } from 'react';
import styles from '../styles/AddJobByLink.module.css';

/*
 * Feature 4a — paste any job link.
 *
 * The design decision that matters is what happens when a board REFUSES.
 * LinkedIn and Naukri decline automated requests, and this product does not
 * work around a refusal - D19 drew that line and it has not moved. So a
 * refusal is not an error state here: it is a handoff. The board is named, the
 * reason is given, and the description box opens with the cursor in it,
 * because pasting the text produces the identical result.
 *
 * That is why the feature works "on every board" honestly. Not because every
 * board can be fetched - several cannot - but because the one path that always
 * works is one keystroke away when the other does not.
 */
export default function AddJobByLink({ token, base, onAdded }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [added, setAdded] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    setAdded(null);
    try {
      const res = await fetch(`${base}/api/jobs/from-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: url.trim() }),
      });
      // Status before body: an error page is also JSON and parses into nulls
      // that read like missing fields rather than like a failure.
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setAdded(data);
        setUrl('');
        if (onAdded) onAdded(data);
      } else {
        /*
         * The whole error object is kept, not just its message: `canPaste` and
         * `board` are what turn a dead end into a next step, and flattening
         * this to a string is how "could not fetch" gets shipped.
         */
        setError({
          message: data.error || `That link could not be read (${res.status}).`,
          reason: data.reason || 'unknown',
          board: data.board || null,
          canPaste: data.canPaste !== false,
        });
      }
    } catch {
      setError({
        message: 'Could not reach HirePilot to read that link. Check your connection and try again.',
        reason: 'network',
        canPaste: true,
      });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={styles.opener} onClick={() => setOpen(true)}>
        + Add a job by link
      </button>
    );
  }

  return (
    <div className={styles.panel}>
      <form onSubmit={submit}>
        <label className={styles.label} htmlFor="jobLinkUrl">
          Paste a job link from any board
        </label>
        <div className={styles.row}>
          <input
            id="jobLinkUrl"
            type="url"
            className={styles.input}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            autoComplete="off"
          />
          <button type="submit" className={styles.go} disabled={busy || !url.trim()}>
            {busy ? 'Reading…' : 'Add job'}
          </button>
        </div>
        <p className={styles.note}>
          Greenhouse, Lever and Ashby links are read through their own public job APIs.
          Other boards are opened once, as a normal visitor. Nothing is added to anyone
          else&apos;s job list — a job you add is yours.
        </p>
      </form>

      {added && (
        <div className={styles.ok} role="status">
          <p className={styles.okTitle}>
            Added: {added.job?.title}
            {added.job?.companyStated ? ` at ${added.job.company_name}` : ''}
          </p>
          <p className={styles.okDetail}>
            {added.score != null
              ? `Scored ${Math.round((added.score.overall_score ?? added.score) * 100)}% against your profile.`
              : 'Saved. Scoring will catch up shortly.'}
            {!added.job?.postedAtKnown && ' The posting did not state a publication date, so none is shown.'}
            {added.weak && ' That page gave only a title and a short summary, so the description may be thin.'}
          </p>
        </div>
      )}

      {error && (
        <div className={styles.err} role="alert">
          <p className={styles.errMessage}>{error.message}</p>
          {error.canPaste && (
            /*
             * The handoff. A refusal from a board is not the end of the task -
             * pasting the description reaches the same place, and saying so
             * here is the difference between a wall and a detour.
             */
            <Link className={styles.pasteLink} href="/resume?tab=Tailor%20for%20a%20Job">
              Paste the description instead &rarr;
            </Link>
          )}
        </div>
      )}

      <button type="button" className={styles.close} onClick={() => { setOpen(false); setError(null); setAdded(null); }}>
        Close
      </button>
    </div>
  );
}
