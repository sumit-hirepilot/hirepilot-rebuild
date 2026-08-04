import { useState, useEffect, useCallback } from 'react';
import styles from '../styles/NeedsYou.module.css';
import { API_BASE } from '../lib/apiBase';

/*
 * The one place a parked application gets answered.
 *
 * Rendered by both the Auto Apply screen (scoped to a run) and the Applications
 * page (all-time). It is the SAME component reading the SAME endpoint - the run
 * scoping is a query parameter, not a second implementation, so the two
 * surfaces cannot drift into disagreeing about what is parked.
 *
 * Answers go to /api/apply/profile/answers, the mechanism the skills guard
 * already uses. That matters beyond not duplicating code: the endpoint runs
 * promoteReadyApplications, so answering a question here releases EVERY
 * application waiting on it, not just the one being looked at. Answering
 * "notice period" once should not have to be done nine more times.
 */

const BASE = API_BASE;

export default function NeedsYouDrawer({ runId = null, title, emptyText, onResolved }) {
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState({});

  const load = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const qs = runId ? `?runId=${runId}` : '';
    const res = await fetch(`${BASE}/api/apply/blockers${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (!res || !res.ok) { setData({ blockers: [], total: 0, questionCount: 0 }); return; }
    const j = await res.json();
    setData(j);
  }, [runId]);

  useEffect(() => { load(); }, [load]);

  const save = async (applicationId) => {
    const pending = Object.entries(drafts)
      .filter(([key, v]) => key.startsWith(`${applicationId}::`) && String(v).trim() !== '')
      .map(([key, v]) => ({ question: key.split('::').slice(1).join('::'), answer: v }));
    if (!pending.length) return;

    setBusy(true);
    setNotice(null);
    const token = localStorage.getItem('token');

    // Attach the form's own options so a saved answer can be validated against
    // the next form's list rather than pasted in blind.
    const app = data.blockers.find((b) => b.applicationId === applicationId);
    const withOptions = pending.map((p) => {
      const q = (app?.questions || []).find((x) => x.question === p.question);
      return { ...p, options: q?.options || null, type: q?.type || 'text' };
    });

    const res = await fetch(`${BASE}/api/apply/profile/answers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: withOptions }),
    }).catch(() => null);

    if (res && res.ok) {
      const d = await res.json();
      setNotice(
        d.promoted > 0
          ? `Saved. ${d.promoted} application${d.promoted === 1 ? '' : 's'} released and will go out on the next run.`
          : 'Saved to your profile and reused from now on.'
      );
      setDrafts((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) if (k.startsWith(`${applicationId}::`)) delete next[k];
        return next;
      });
      await load();
      if (onResolved) onResolved(d);
    } else {
      setNotice('Could not save those answers.');
    }
    setBusy(false);
  };

  if (!data) return <div className={styles.loading}>Loading…</div>;

  if (!data.total) {
    return (
      <div className={styles.empty}>
        {emptyText || 'Nothing is waiting on you.'}
      </div>
    );
  }

  return (
    <section className={styles.wrap}>
      <div className={styles.head}>
        <strong>{title || `${data.total} application${data.total === 1 ? '' : 's'} need you`}</strong>
        <span className={styles.sub}>
          {data.questionCount} question{data.questionCount === 1 ? '' : 's'} in total.
          Each answer is saved and reused on every future application.
        </span>
      </div>

      {notice && <div className={styles.notice} onClick={() => setNotice(null)}>{notice}</div>}

      {data.blockers.map((b) => {
        const isOpen = open[b.applicationId] !== false;
        return (
          <div className={styles.card} key={b.applicationId}>
            <button
              className={styles.cardHead}
              onClick={() => setOpen((o) => ({ ...o, [b.applicationId]: !isOpen }))}
            >
              <span>
                <span className={styles.job}>{b.job.title}</span>
                <span className={styles.co}>{b.job.company}</span>
              </span>
              <span className={styles.count}>
                {b.kind === 'human_step' ? 'needs you on the page'
                  : b.kind === 'unresolved' ? 'could not complete'
                    : `${b.questions.length} question${b.questions.length === 1 ? '' : 's'}`}
              </span>
            </button>

            {isOpen && b.kind === 'human_step' && (
              /* No input: a CAPTCHA or login has no answer to type here. */
              <div className={styles.humanStep}>
                {b.humanStepReason || 'This one needs you on the employer’s page.'}
                {b.targetFormUrl && (
                  <a href={b.targetFormUrl} target="_blank" rel="noreferrer"> Open it</a>
                )}
              </div>
            )}

            {/* No form: there is no question to answer, so offering one would
                ask for something we cannot name. */}
            {isOpen && b.kind === 'unresolved' && (
              <div className={styles.humanStep}>
                {b.unresolvedReason}
                {b.targetFormUrl && (
                  <a href={b.targetFormUrl} target="_blank" rel="noreferrer"> Open the form</a>
                )}
              </div>
            )}

            {isOpen && b.kind === 'question' && (
              <div className={styles.body}>
                {b.questions.map((q) => {
                  const key = `${b.applicationId}::${q.question}`;
                  return (
                    <label className={styles.field} key={key}>
                      {/* The employer's own wording, not an internal field name. */}
                      <span className={styles.q}>{q.question}</span>
                      {q.matchedQuestion && q.suggestion ? (
                        <span className={styles.why}>
                          Closest saved answer: “{q.suggestion}”
                          {q.confidence ? ` · only ${Math.round(q.confidence * 100)}% sure` : ''}
                        </span>
                      ) : (
                        <span className={styles.why}>{q.reason}</span>
                      )}

                      {q.options && q.options.length ? (
                        <select
                          className={styles.input}
                          value={drafts[key] ?? ''}
                          onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })}
                        >
                          <option value="">Choose…</option>
                          {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : q.type === 'textarea' ? (
                        <textarea
                          className={styles.input}
                          rows={3}
                          value={drafts[key] ?? ''}
                          onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })}
                        />
                      ) : (
                        <input
                          className={styles.input}
                          value={drafts[key] ?? ''}
                          onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })}
                        />
                      )}
                    </label>
                  );
                })}
                <button
                  className={styles.saveBtn}
                  onClick={() => save(b.applicationId)}
                  disabled={busy}
                >
                  {busy ? 'Saving…' : 'Save and continue this application'}
                </button>
                <p className={styles.foot}>
                  Blank stays blank — nothing is filled in for you, and an
                  unanswered question keeps this application parked.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
