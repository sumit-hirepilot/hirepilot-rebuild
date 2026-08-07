import { useEffect, useState } from 'react';
import styles from '../styles/ScoreChangeNotice.module.css';
import { formatNumber } from '../lib/format';

const DISMISS_KEY = 'hp_d49_notice_dismissed';

/*
 * D49 — the match score changed, so the product says so.
 *
 * `skillsScore` moved from `matched / yourSkills` to
 * `matched / max(whatTheJobAsksFor, 4)`. Every score in the index moved with
 * it: mean 0.619 -> 0.746 on a 220-job sample, and the band that held 180 of
 * those 220 jobs broke into five.
 *
 * A user who saw 62% yesterday and 75% today with no explanation is looking at
 * a label that disagrees with the data behind it - which is the exact defect
 * the change was made to remove. Shipping the formula without this notice
 * would re-introduce it one level up, so the two ship together.
 *
 * It stops showing when the re-score is complete AND the user has dismissed
 * it. A notice that outlives the change it describes is its own small lie.
 */
export default function ScoreChangeNotice({ token, base }) {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(true);   // assume dismissed until known

  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === '1'); } catch { setDismissed(false); }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch(`${base}/api/matches/rescore-status`, { headers: { Authorization: `Bearer ${token}` } })
      // Status before body: an error page is also JSON and parses into nulls
      // that read like "nothing left to do".
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStatus(d))
      .catch(() => {});
  }, [token, base]);

  if (dismissed || !status) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
    setDismissed(true);
  };

  return (
    <div className={styles.notice} role="status">
      <p className={styles.title}>We changed how match scores are calculated.</p>
      <p className={styles.body}>
        A job&apos;s score is now the share of <strong>what it asks for</strong> that you
        already have. Before, it was the share of <strong>your</strong> skills the job
        happened to mention &mdash; which meant adding a real skill could lower your
        scores. Most scores have gone up. Nothing about your profile or your
        applications changed.
      </p>
      {!status.complete && status.total > 0 && (
        <p className={styles.progress}>
          {/* formatNumber, not toLocaleString: an unlocalised toLocale* uses the
              host's locale, so the server and the browser disagree and hydration
              fails. The lint rule caught this one. */}
          Recalculating: {formatNumber(status.done)} of {formatNumber(status.total)} done.
          Scores still on the old calculation will update shortly.
        </p>
      )}
      <button type="button" className={styles.ok} onClick={dismiss}>Got it</button>
    </div>
  );
}
