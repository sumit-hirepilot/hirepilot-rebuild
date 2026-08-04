import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../../components/DashboardLayout';
import styles from '../../styles/Dashboard.module.css';
import page from '../../styles/ApplicationDetail.module.css';
import { API_BASE } from '../../lib/apiBase';

/*
 * Application detail (PRD 3.10).
 *
 * Everything that will be, or already was, typed into the employer's form -
 * grouped the way the form groups it, with each answer showing where it came
 * from.
 *
 * There is no approve button. Readiness decides whether this runs, so the only
 * actions here are editing an answer and skipping the application. What the
 * screen is for is answering "what exactly is being sent, and on whose word",
 * which stays worth showing whether or not anyone has to click first.
 */

const BASE = API_BASE;

const STATUS = {
  approved: ['Ready to send', 'ok'],
  submitting: ['In flight — answering form fields…', 'busy'],
  needs_user: ['Needs you', 'warn'],
  submitted: ['Applied — confirmed by the employer', 'good'],
  failed: ['Failed', 'bad'],
  preparing: ['Preparing', 'busy'],
};

// Where an answer came from. The user should never have to guess whether they
// said something or the system inferred it.
const SOURCE = {
  profile: ['From your profile', 'lock'],
  profile_custom: ['A saved answer', 'lock'],
  profile_similar: ['Reused from a similar question', 'reuse'],
  user_edited: ['You edited this', 'edit'],
  low_confidence: ['Close match — confirm it', 'ask'],
  requires_user: ['Only you can answer this', 'ask'],
  profile_gap: ['Missing from your profile', 'ask'],
  unmapped: ['New question', 'ask'],
};

// PRD 3.10 asks for the form grouped into sections rather than one flat list.
const GROUPS = [
  ['Personal information', /name|email|phone|location|linkedin|portfolio|github|address|postal|zip/i],
  ['Work authorization', /authoriz|sponsor|visa|eligible|right to work|work permit/i],
  ['Voluntary disclosures', /gender|hispanic|latino|race|ethnic|veteran|disabilit|self-?identif/i],
  ['Referral and background', /how did you hear|referr|non-?compete|clearance|background|convicted|previously (employed|worked)/i],
];

function groupOf(question) {
  for (const [name, re] of GROUPS) if (re.test(question || '')) return name;
  return 'Questions from this employer';
}

export default function ApplicationDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [item, setItem] = useState(null);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async (t, appId) => {
    const res = await fetch(`${BASE}/api/apply/queue/${appId}`, {
      headers: { Authorization: `Bearer ${t}` },
    }).catch(() => null);
    if (!res || !res.ok) { setMissing(true); return; }
    const d = await res.json();
    setItem(d.item);
  }, []);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { router.replace('/login'); return; }
    setToken(t);
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch { /* stale */ }
    if (id) load(t, id);
  }, [router, id, load]);

  const saveEdits = async () => {
    if (!Object.keys(edits).length) return;
    setBusy(true);
    const res = await fetch(`${BASE}/api/apply/queue/${id}/answers`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // saveToProfile: an answer corrected here is corrected everywhere, which
      // is the whole point of editing it rather than patching one form.
      body: JSON.stringify({ answers: edits, saveToProfile: true }),
    }).catch(() => null);
    setNotice(res && res.ok
      ? 'Saved to this application and to your profile, so it is reused next time.'
      : 'Could not save those answers.');
    if (res && res.ok) { setEdits({}); await load(token, id); }
    setBusy(false);
  };

  const skip = async () => {
    setBusy(true);
    await fetch(`${BASE}/api/apply/queue/${id}/skip`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    router.push('/apply-queue');
  };

  if (missing) {
    return (
      <DashboardLayout user={user}>
        <Head><title>Application - HirePilot</title></Head>
        <p className={styles.emptyState}>That application is not in your queue.</p>
      </DashboardLayout>
    );
  }
  if (!item) {
    return (
      <DashboardLayout user={user}>
        <Head><title>Application - HirePilot</title></Head>
        <div className={page.loading}>Loading…</div>
      </DashboardLayout>
    );
  }

  const [statusLabel, statusTone] = STATUS[item.status] || [item.status, 'neutral'];
  const questions = item.screeningQuestions || [];
  const grouped = {};
  for (const q of questions) {
    const g = groupOf(q.question);
    (grouped[g] = grouped[g] || []).push(q);
  }

  const answerFor = (q) => (edits[q.question] !== undefined ? edits[q.question] : (q.answer ?? ''));

  const row = (q, locked) => {
    const [srcLabel, srcTone] = SOURCE[q.source] || ['', 'neutral'];
    const blocking = q.required && !q.optional && !answerFor(q);
    return (
      <div className={blocking ? page.rowBlocking : page.row} key={q.question}>
        <div className={page.q}>
          {q.question}
          {q.required && !q.optional && <span className={page.req}> *</span>}
        </div>

        {locked ? (
          // PRD 3.10: fields sourced from the saved profile carry a lock. They
          // are edited on the Profile page, where the change applies everywhere,
          // rather than per-application where it would silently diverge.
          <div className={page.locked}>
            <span className={page.lockIcon} aria-hidden="true">🔒</span>
            <span>{answerFor(q) || <em className={page.blank}>Not set</em>}</span>
          </div>
        ) : q.options && q.options.length ? (
          <select
            className={page.input}
            value={answerFor(q)}
            onChange={(e) => setEdits({ ...edits, [q.question]: e.target.value })}
          >
            <option value="">Not answered</option>
            {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (q.type === 'textarea' || String(answerFor(q)).length > 90) ? (
          <textarea
            className={page.input}
            rows={4}
            value={answerFor(q)}
            onChange={(e) => setEdits({ ...edits, [q.question]: e.target.value })}
          />
        ) : (
          <input
            className={page.input}
            value={answerFor(q)}
            onChange={(e) => setEdits({ ...edits, [q.question]: e.target.value })}
          />
        )}

        <div className={page.meta}>
          {srcLabel && <span className={`${page.src} ${page[srcTone]}`}>{srcLabel}</span>}
          {typeof q.confidence === 'number' && (
            <span className={page.conf}>{Math.round(q.confidence * 100)}% sure</span>
          )}
          {q.matchedQuestion && (
            <span className={page.from}>from “{String(q.matchedQuestion).slice(0, 60)}”</span>
          )}
          {q.reason && !q.answer && <span className={page.reason}>{q.reason}</span>}
        </div>
      </div>
    );
  };

  return (
    <DashboardLayout user={user}>
      <Head><title>{item.job.title} - HirePilot</title></Head>

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{item.job.title}</h1>
          <p className={styles.pageSubtitle}>
            {item.job.company}{item.job.location ? ` · ${item.job.location}` : ''}
          </p>
        </div>
        <span className={`${page.status} ${page[statusTone]}`}>{statusLabel}</span>
      </div>

      {notice && <div className={page.notice} onClick={() => setNotice(null)}>{notice}</div>}

      {/*
        * These answers are current profile state, not a record of what was sent.
        * screening_answers is rewritten by every later discovery run, so on a
        * submitted application this shows what WOULD be sent now - which is not
        * necessarily what went out. Saying so is the interim fix; an immutable
        * submission record is the real one (G0.6).
        *
        * A user's only defence against a bad automated submission is being able
        * to see what left. Letting this page imply it is that record would be
        * the same failure as a fabricated counter, with worse consequences.
        */}
      {item.status === 'submitted' && (
        <div className={page.failure}>
          These answers are your current profile values, not a copy of what was
          submitted. HirePilot does not yet keep an immutable record of the exact
          fields sent, so anything you have changed since will read differently
          here. The employer&apos;s confirmation below is the part that is fixed.
        </div>
      )}

      {item.failureReason && (
        <div className={page.failure}>
          {item.failureReason}
          {item.retryCount > 0 && ` (attempt ${item.retryCount})`}
        </div>
      )}

      {/* Evidence first when it exists: it is the only thing that makes the
          word "Applied" mean anything on this screen. */}
      {item.evidence && (
        <div className={page.evidence}>
          <strong>Confirmed by {item.job.company}</strong>
          {item.evidence.confirmationText && (
            <blockquote>“{item.evidence.confirmationText.slice(0, 300)}”</blockquote>
          )}
          <div className={page.evidenceMeta}>
            {item.evidence.confirmationId && <span>Reference {item.evidence.confirmationId}</span>}
            {item.evidence.verifiedAt && <span>Verified {new Date(item.evidence.verifiedAt).toLocaleString()}</span>}
          </div>
        </div>
      )}

      <div className={page.grid}>
        <div className={page.main}>
          <section className={page.card}>
            <h2 className={page.cardTitle}>Personal information</h2>
            <p className={page.cardHint}>
              From your profile. Editing these on the{' '}
              <a href="/profile">Profile page</a> changes them for every
              application, rather than just this one.
            </p>
            {(item.standardFields || []).map((f) => row(f, true))}
          </section>

          {Object.entries(grouped).map(([groupName, qs]) => (
            <section className={page.card} key={groupName}>
              <h2 className={page.cardTitle}>{groupName}</h2>
              {groupName === 'Voluntary disclosures' && (
                <p className={page.cardHint}>
                  Optional on the employer&apos;s form and optional here. Left
                  blank, it is submitted blank.
                </p>
              )}
              {qs.map((q) => row(q, false))}
            </section>
          ))}

          {questions.length === 0 && (
            <section className={page.card}>
              <h2 className={page.cardTitle}>Questions from this employer</h2>
              <p className={page.cardHint}>
                Not read yet. The extension reports the real questions when it
                opens the form — what is prepared here comes from the posting,
                and the two often differ.
              </p>
            </section>
          )}

          {item.coverLetter && (
            <section className={page.card}>
              <h2 className={page.cardTitle}>Cover letter</h2>
              <pre className={page.letter}>{item.coverLetter}</pre>
            </section>
          )}
        </div>

        <aside className={page.side}>
          <section className={page.card}>
            <h2 className={page.cardTitle}>Resume</h2>
            <div className={page.resumeName}>{item.resume?.filename || 'No file'}</div>
            {typeof item.resume?.atsScore === 'number' && (
              <div className={page.ats}>
                <span className={page.atsNum}>{item.resume.atsScore}%</span>
                <span className={page.atsLabel}>keyword coverage for this posting</span>
              </div>
            )}
            {(item.resume?.addedSkills || []).length > 0 && (
              <>
                <div className={page.cardHint} style={{ marginTop: 10 }}>Highlighted for this role</div>
                <div className={page.chips}>
                  {item.resume.addedSkills.slice(0, 14).map((s) => (
                    <span className={page.chip} key={s}>{s}</span>
                  ))}
                </div>
              </>
            )}
            <p className={page.cardHint} style={{ marginTop: 10 }}>
              The file uploaded is the one you gave us, unchanged. Tailoring
              shows here and goes into free-text fields — it does not rewrite
              your PDF behind your back.
            </p>
          </section>

          <section className={page.card}>
            <h2 className={page.cardTitle}>Where it goes</h2>
            <div className={page.kv}><span>ATS</span><span>{item.atsPlatform || 'unknown'}</span></div>
            <div className={page.kv}>
              <span>Automated</span>
              <span>{item.automationSupported ? 'Yes' : 'No — opened for you'}</span>
            </div>
            {item.targetFormUrl && (
              <a className={page.link} href={item.targetFormUrl} target="_blank" rel="noreferrer">
                Open the posting
              </a>
            )}
          </section>
        </aside>
      </div>

      <div className={page.footBar}>
        {Object.keys(edits).length > 0 && (
          <button className={page.primaryBtn} onClick={saveEdits} disabled={busy}>
            {busy ? 'Saving…' : `Save ${Object.keys(edits).length} answer${Object.keys(edits).length === 1 ? '' : 's'}`}
          </button>
        )}
        {item.status !== 'submitted' && (
          <button className={page.ghostBtn} onClick={skip} disabled={busy}>Skip this application</button>
        )}
      </div>
    </DashboardLayout>
  );
}
