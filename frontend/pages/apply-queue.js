import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/ApplyQueue.module.css';
import { API_BASE } from '../lib/apiBase';

/*
 * The approval gate.
 *
 * Everything the extension will put into the employer's form is shown here
 * first, and approval is the one human decision in the pipeline. The backend
 * will not run an application while a required answer is missing, so this screen surfaces
 * those gaps rather than letting the user click past them.
 */

const STATUS_LABEL = {
  ready_for_review: 'Needs review',
  approved: 'Ready - the extension will submit it',
  submitting: 'Submitting',
  needs_user: 'Needs you',
  submitted: 'Submitted',
  failed: 'Failed',
};

const SOURCE_LABEL = {
  profile: 'From your Application Profile',
  profile_custom: 'From a saved answer',
  profile_similar: 'Reused from a similar question you answered',
  low_confidence: 'Close match found - confirm before sending',
  user_edited: 'You edited this',
  profile_gap: 'Missing from your profile',
  requires_user: 'Only you can answer this',
  unmapped: 'New question - answer once and it is saved',
};

export default function ApplyQueue() {
  const router = useRouter();
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [queue, setQueue] = useState([]);
  const [submitted, setSubmitted] = useState([]);
  const [counts, setCounts] = useState({});
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const base = API_BASE;

  const loadQueue = useCallback(async (authToken) => {
    try {
      const [qRes, sRes] = await Promise.all([
        fetch(`${base}/api/apply/queue`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/apply/submitted`, { headers: { Authorization: `Bearer ${authToken}` } }),
      ]);
      if (qRes.ok) {
        const d = await qRes.json();
        setQueue(d.queue || []);
        setCounts(d.counts || {});
      }
      if (sRes.ok) {
        const d = await sRes.json();
        setSubmitted(d.submitted || []);
      }
    } catch (err) {
      setError('Could not load the queue.');
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    const authToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!authToken || !storedUser) { router.push('/login'); return; }
    setUser(JSON.parse(storedUser));
    setToken(authToken);
    loadQueue(authToken);
  }, [router, loadQueue]);

  const openDetail = async (id) => {
    setSelected(id);
    setDetail(null);
    setEdits({});
    setError(null);
    try {
      const res = await fetch(`${base}/api/apply/queue/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('load failed');
      const d = await res.json();
      setDetail(d.item);
    } catch {
      setError('Could not load this application.');
    }
  };

  const allAnswers = detail
    ? [...(detail.standardFields || []), ...(detail.screeningQuestions || [])]
    : [];
  const blocking = allAnswers.filter(
    (a) => a.required && !a.optional && !a.answer && !edits[a.question]
  );

  const saveEdits = async () => {
    if (!Object.keys(edits).length) return true;
    const res = await fetch(`${base}/api/apply/queue/${selected}/answers`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: edits, saveToProfile: true }),
    });
    return res.ok;
  };

  const skip = async () => {
    setBusy(true);
    await fetch(`${base}/api/apply/queue/${selected}/skip`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    setSelected(null);
    setDetail(null);
    await loadQueue(token);
    setBusy(false);
  };



  return (
    <DashboardLayout user={user}>
      <Head><title>Apply Queue - HirePilot</title></Head>

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Apply Queue</h1>
          <p className={styles.pageSubtitle}>
            Everything queued here is submitted automatically by the browser
            extension, on the employer&apos;s own site, and recorded against their
            confirmation. Nothing waits on you unless a question is missing from
            your profile, or the employer demands a login, CAPTCHA or consent.
          </p>
        </div>

      </div>

      {notice && <div className={page.notice}>{notice}</div>}
      {error && <div className={page.error}>{error}</div>}

      <div className={page.summary}>
        {['approved', 'submitting', 'needs_user', 'submitted'].map((k) => (
          <div key={k} className={page.summaryCard}>
            <span className={page.summaryNum}>{counts[k] || 0}</span>
            <span className={page.summaryLabel}>{STATUS_LABEL[k]}</span>
          </div>
        ))}
        <div className={`${page.summaryCard} ${page.summaryCardOk}`}>
          <span className={page.summaryNum}>{submitted.length}</span>
          <span className={page.summaryLabel}>Verified submitted</span>
        </div>
      </div>

      <div className={page.split}>
        {/* Queue list */}
        <div className={page.list}>
          {loading && <p className={page.muted}>Loading&hellip;</p>}
          {!loading && !queue.length && (
            <div className={page.empty}>
              <p><strong>Nothing queued.</strong></p>
              <p className={page.muted}>
                Pick jobs on the Jobs page and choose &ldquo;Apply Now&rdquo; to
                build a queue.
              </p>
              <button className={page.primaryBtn} onClick={() => router.push('/jobs')}>
                Browse jobs
              </button>
            </div>
          )}
          {queue.map((item) => (
            <button
              key={item.id}
              className={`${page.row} ${selected === item.id ? page.rowActive : ''}`}
              onClick={() => openDetail(item.id)}
            >
              <div className={page.rowMain}>
                <span className={page.rowTitle}>{item.title}</span>
                <span className={page.rowMeta}>
                  {item.company_name}
                  {item.location ? ` · ${item.location}` : ''}
                </span>
                <span className={page.rowTags}>
                  <span className={page.atsTag}>{item.submission_channel}</span>
                  {!item.automationSupported && (
                    <span className={page.manualTag}>manual submit</span>
                  )}
                  {item.ats_score !== null && item.ats_score !== undefined && (
                    <span className={page.scoreTag}>{item.ats_score}% keyword match</span>
                  )}
                </span>
              </div>
              <span className={`${page.status} ${page[`s_${item.status}`] || ''}`}>
                {STATUS_LABEL[item.status] || item.status}
              </span>
            </button>
          ))}
        </div>

        {/* Review pane */}
        <div className={page.detail}>
          {!selected && (
            <p className={page.muted}>Select an application to review what will be submitted.</p>
          )}
          {selected && !detail && <p className={page.muted}>Loading&hellip;</p>}

          {detail && (
            <>
              <div className={page.detailHead}>
                <h2>{detail.job.title}</h2>
                <p className={page.muted}>
                  {detail.job.company}
                  {detail.job.location ? ` · ${detail.job.location}` : ''}
                </p>
                <a
                  className={page.formLink}
                  href={detail.targetFormUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Employer application form &rarr;
                </a>
              </div>

              {!detail.automationSupported && (
                <div className={page.warnBox}>
                  <strong>No automation adapter for {detail.atsPlatform}</strong>
                  <p>
                    HirePilot will open this form for you with your materials ready,
                    but you will need to fill and submit it yourself. It stays out of
                    your applied count until a confirmation is captured.
                  </p>
                </div>
              )}

              {blocking.length > 0 && (
                <div className={page.warnBox}>
                  <strong>{blocking.length} answer{blocking.length === 1 ? '' : 's'} needed before this can be submitted</strong>
                  <p>Fill these in below. Approval is blocked until they are answered.</p>
                </div>
              )}

              {/* Documents */}
              <section className={page.section}>
                <h3>Documents</h3>
                <div className={page.docRow}>
                  <span className={page.docName}>{detail.resume.filename || 'resume.pdf'}</span>
                  <span className={page.docNote}>
                    Your original file, uploaded as-is
                  </span>
                </div>
                {detail.resume.addedSkills?.length > 0 ? (
                  <p className={page.tailorNote}>
                    Tailoring added these terms from the posting that your resume
                    did not already mention:{' '}
                    <strong>{detail.resume.addedSkills.join(', ')}</strong>. Nothing
                    was rewritten or removed.
                  </p>
                ) : (
                  <p className={page.tailorNote}>
                    No tailoring needed - your resume already covers this posting&apos;s terms.
                  </p>
                )}
              </section>

              {/* Cover letter */}
              <section className={page.section}>
                <h3>Cover letter</h3>
                <pre className={page.letter}>{detail.coverLetter}</pre>
              </section>

              {/* Answers */}
              <section className={page.section}>
                <h3>
                  Form answers
                  {detail.screeningQuestions === null && (
                    <span className={page.pending}>
                      screening questions read when the extension opens the form
                    </span>
                  )}
                </h3>
                {allAnswers.map((a) => {
                  const value = edits[a.question] !== undefined ? edits[a.question] : (a.answer || '');
                  const needed = a.required && !a.optional && !value;
                  return (
                    <div key={a.question} className={page.field}>
                      <label className={page.fieldLabel}>
                        {a.question}
                        {a.required && !a.optional && <span className={page.req}>*</span>}
                      </label>
                      {a.options?.length ? (
                        <select
                          className={`${page.input} ${needed ? page.inputNeeded : ''}`}
                          value={value}
                          onChange={(e) => setEdits({ ...edits, [a.question]: e.target.value })}
                        >
                          <option value="">Select an answer</option>
                          {a.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : a.type === 'textarea' ? (
                        <textarea
                          className={`${page.input} ${needed ? page.inputNeeded : ''}`}
                          rows={4}
                          value={value}
                          onChange={(e) => setEdits({ ...edits, [a.question]: e.target.value })}
                        />
                      ) : (
                        <input
                          className={`${page.input} ${needed ? page.inputNeeded : ''}`}
                          type="text"
                          value={value}
                          onChange={(e) => setEdits({ ...edits, [a.question]: e.target.value })}
                        />
                      )}
                      <span className={page.fieldSource}>
                        {edits[a.question] !== undefined
                          ? 'You edited this'
                          : SOURCE_LABEL[a.source] || a.source}
                        {a.confidence !== undefined && edits[a.question] === undefined && (
                          <span className={a.confidence >= 0.7 ? page.confHigh : page.confLow}>
                            {' '}{Math.round(a.confidence * 100)}% match
                          </span>
                        )}
                        {a.reason ? ` — ${a.reason}` : ''}
                      </span>
                      {a.matchedQuestion && edits[a.question] === undefined && (
                        <span className={page.matchedFrom}>
                          reused from: &ldquo;{a.matchedQuestion.slice(0, 90)}
                          {a.matchedQuestion.length > 90 ? '…' : ''}&rdquo;
                          {a.conceptLabel ? ` · ${a.conceptLabel}` : ''}
                        </span>
                      )}
                    </div>
                  );
                })}
              </section>

              {detail.evidence && (
                <section className={`${page.section} ${page.evidenceBox}`}>
                  <h3>Employer confirmation</h3>
                  {detail.evidence.confirmationId && (
                    <p><strong>Reference:</strong> {detail.evidence.confirmationId}</p>
                  )}
                  <p><strong>Submitted:</strong> {new Date(detail.evidence.submittedAt).toLocaleString()}</p>
                  <pre className={page.letter}>{detail.evidence.confirmationText}</pre>
                </section>
              )}

              {detail.failureReason && (
                <div className={page.error}>
                  {detail.failureReason}
                  {detail.retryCount > 0 && ` (attempt ${detail.retryCount})`}
                </div>
              )}

              <div className={page.actions}>
                {detail.status !== 'submitted' && (
                  <>
                    {/* No approve button. An application with every answer
                        resolved is already queued to run; one with a gap is
                        released by answering it, here or in the extension
                        drawer, not by a separate click. */}
                    {blocking.length > 0 && (
                      <span className={page.finePrint}>
                        Answer the {blocking.length} question{blocking.length === 1 ? '' : 's'} above and this
                        goes out on the extension&apos;s next run.
                      </span>
                    )}
                    <button className={page.ghostBtn} onClick={skip} disabled={busy}>
                      Skip this one
                    </button>
                  </>
                )}
              </div>
              {detail.status !== 'submitted' && (
                <p className={page.finePrint}>
                  This is submitted to {detail.job.company} automatically, exactly as
                  shown above. Nothing is marked as applied until the
                  employer&apos;s own confirmation is captured.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
