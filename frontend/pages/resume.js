import Head from 'next/head';
// A7.2 - a company that did not parse must never render as if it did.
import { parsedOr } from '../lib/renderState';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Resume.module.css';
import { API_BASE } from '../lib/apiBase';
import { formatDate } from '../lib/format';

const TABS = ['Resume Manager', 'Tailor for a Job', 'Cover Letters', 'Screening Answers', 'ATS Checker'];

// Downloads a file from an authenticated API endpoint (can't just use a
// plain <a href> since the request needs a Bearer token).
/*
 * The tailored text, saved as a file, from what the page already holds.
 *
 * There was a "Download PDF" button here pointing at
 * GET /api/resume/tailored/:id/pdf. That route was deleted in 5dddb82, which
 * replaced server-side rendering with the editor printing the document the
 * user is looking at - but these two callers were never updated, so the button
 * has returned 404 ever since. Reproduced on production before changing it.
 *
 * Not re-pointed at the editor: the editor prints the user's resume DOCUMENT,
 * and this is a tailored variant of it. Sending them there would download
 * something other than what the button names, which is the failure this whole
 * pass is about. The tailored text is the thing the product actually holds for
 * this row, so that is what the button offers, under its real name.
 */
function downloadText(text, filename) {
  const blob = new Blob([String(text || '')], { type: 'text/plain;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

async function downloadAuthed(url, token, fallbackFilename) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return false;
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : fallbackFilename;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
  return true;
}

export default function Resume() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [tab, setTab] = useState('Resume Manager');

  /*
   * Honour ?tab= on load and on back/forward.
   *
   * settings.js has done this since PRD 3.9; this page never did, and nothing
   * needed it until feature 4a. When a board refuses a link, the refusal
   * offers "Paste the description instead ->" pointing at
   * /resume?tab=Tailor%20for%20a%20Job - and the page opened Resume Manager,
   * so the one path that always works was unreachable from the place that
   * offers it. The link was right; the destination ignored it.
   *
   * Found by the audit, by CLICKING the handoff rather than checking the href.
   */
  useEffect(() => {
    const t = router.query.tab;
    if (typeof t === 'string' && TABS.includes(t)) setTab(t);
  }, [router.query.tab]);
  const [resumes, setResumes] = useState([]);
  const [tailoredHistory, setTailoredHistory] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const base = API_BASE;

  /*
   * `quiet` refreshes the data WITHOUT blanking the screen.
   *
   * loadData set loading=true unconditionally, and line ~162 swaps the whole
   * tab body for a spinner while loading. So every reload() unmounted the tab
   * and destroyed its local state - and reload() is what runs immediately
   * after a successful tailor, one line after setResult(data).
   *
   * The effect on production: paste a job description, press Tailor resume,
   * the request succeeds and writes a row, and the screen throws the result
   * away and resets to "Pick a job we have". The work happened and the user
   * saw nothing. It hit BOTH tailoring paths, not just the pasted one.
   *
   * Only the FIRST load has nothing to show yet, so only the first load
   * spins. Found by the audit, by pasting a JD and pressing the button.
   */
  const loadData = useCallback(async (authToken, { quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [resumesRes, tailoredRes, matchesRes] = await Promise.all([
        fetch(`${base}/api/resume`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/resume/tailored`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/matches?limit=50&minScore=0`, { headers: { Authorization: `Bearer ${authToken}` } }),
      ]);

      if (resumesRes.ok) setResumes((await resumesRes.json()).resumes || []);
      if (tailoredRes.ok) setTailoredHistory((await tailoredRes.json()).tailored || []);

      // The job picker should offer your actual matches (ranked, relevant),
      // not an arbitrary global "most recent" list unrelated to your profile -
      // otherwise a job you actually want to tailor for often isn't even an
      // option if it's more than ~50 postings old. Fall back to recent jobs
      // only if matching hasn't run yet, so the picker is never empty.
      if (matchesRes.ok) {
        const matchData = await matchesRes.json();
        const matchJobs = (matchData.matches || matchData || []).map((m) => ({
          id: m.job_id,
          title: m.title,
          company_name: m.company_name,
        }));
        if (matchJobs.length) {
          setJobs(matchJobs);
        } else {
          const fallback = await fetch(`${base}/api/jobs?limit=50`);
          if (fallback.ok) setJobs((await fallback.json()).jobs || []);
        }
      }
    } catch (err) {
      console.error('Failed to load resume data', err);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    const authToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!authToken || !storedUser) {
      router.push('/login');
      return;
    }
    setUser(JSON.parse(storedUser));
    setToken(authToken);
    loadData(authToken);
  }, [router, loadData]);

  if (!user) return null;

  return (
    <>
      <Head>
        <title>Resume - HirePilot</title>
      </Head>

      <DashboardLayout title="Resume" user={user}>
        <h1 className={styles.greeting} style={{ marginTop: 0 }}>Resume</h1>

        <div className={page.tabs}>
          {TABS.map((t) => (
            <button
              key={t}
              className={tab === t ? page.tabActive : page.tab}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {message && <div className={page.message}>{message}</div>}

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : tab === 'Resume Manager' ? (
          <ResumeManager
            resumes={resumes}
            tailoredHistory={tailoredHistory}
            token={token}
            base={base}
            reload={() => loadData(token, { quiet: true })}
            setMessage={setMessage}
          />
        ) : tab === 'Tailor for a Job' ? (
          <TailorForJob jobs={jobs} token={token} base={base} reload={() => loadData(token, { quiet: true })} />
        ) : tab === 'Cover Letters' ? (
          <CoverLetters jobs={jobs} token={token} base={base} />
        ) : tab === 'Screening Answers' ? (
          <ScreeningAnswers jobs={jobs} token={token} base={base} />
        ) : (
          <AtsChecker token={token} base={base} />
        )}
      </DashboardLayout>
    </>
  );
}

function ResumeManager({ resumes, tailoredHistory, token, base, reload, setMessage }) {
  const [resumeText, setResumeText] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [selectedSkills, setSelectedSkills] = useState(new Set());
  const [selectedExp, setSelectedExp] = useState(new Set());
  const [applying, setApplying] = useState(false);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploading(true);
    setParsed(null);
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('saveAsDefault', resumes.length === 0 ? 'true' : 'false');

      const res = await fetch(`${base}/api/resume/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || 'Failed to process resume file');
        return;
      }

      setParsed(data.parsed);
      setSelectedSkills(new Set(data.parsed.skills || []));
      setSelectedExp(new Set((data.parsed.experience || []).map((_, i) => i)));
      setMessage(`Resume uploaded. Found ${data.parsed.skills.length} skills and ${data.parsed.experience.length} work history entries below - review and add them to your profile.`);
      reload();
    } catch (err) {
      setMessage('Failed to upload resume. Try pasting the text instead.');
    } finally {
      setUploading(false);
    }
  };

  const toggleSkill = (skill) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill); else next.add(skill);
      return next;
    });
  };

  const toggleExp = (i) => {
    setSelectedExp((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const handleApplyParsed = async () => {
    setApplying(true);
    try {
      const skills = Array.from(selectedSkills);
      const experience = (parsed.experience || []).filter((_, i) => selectedExp.has(i));

      const res = await fetch(`${base}/api/resume/apply-parsed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ skills, experience }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`Profile updated: ${data.skillsAdded} skills and ${data.experienceAdded} work history entries added.`);
        setParsed(null);
      } else {
        setMessage(data.error || 'Failed to update profile');
      }
    } finally {
      setApplying(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (resumeText.trim().length < 20) {
      setMessage('Paste at least 20 characters of resume text.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${base}/api/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: resumeText, isDefault: resumes.length === 0 }),
      });
      if (res.ok) {
        setResumeText('');
        setMessage('Resume saved.');
        reload();
      } else {
        const data = await res.json();
        setMessage(data.error || 'Failed to save resume');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteResume = async (id) => {
    await fetch(`${base}/api/resume/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    reload();
  };

  const handleDeleteTailored = async (id) => {
    await fetch(`${base}/api/resume/tailored/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    reload();
  };

  return (
    <>
      <div className={styles.card}>
        <p className={page.sectionLabel}>Upload your resume</p>
        <p className={page.helpText}>Upload a .pdf, .docx, or .txt file. We&apos;ll extract your skills and work history for you to review before adding them to your profile.</p>
        <label className={page.uploadDropzone}>
          <input type="file" accept=".pdf,.docx,.txt,.md" onChange={handleFileUpload} disabled={uploading} style={{ display: 'none' }} />
          {uploading ? 'Uploading & parsing…' : 'Click to choose a file, or drag one here'}
        </label>
      </div>

      {parsed && (
        <div className={styles.card}>
          <p className={page.sectionLabel}>Review what we found</p>

          {parsed.skills.length > 0 && (
            <>
              <p className={page.helpText}>Skills (click to deselect any that don&apos;t apply)</p>
              <div className={page.pillRow}>
                {parsed.skills.map((s) => (
                  <button
                    type="button"
                    key={s}
                    className={selectedSkills.has(s) ? page.pillGreen : page.pill}
                    onClick={() => toggleSkill(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}

          {parsed.experience.length > 0 && (
            <>
              <p className={page.helpText} style={{ marginTop: '1rem' }}>Work history</p>
              {parsed.experience.map((exp, i) => (
                <label key={i} className={page.resumeRow} style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedExp.has(i)}
                    onChange={() => toggleExp(i)}
                    style={{ marginRight: '0.75rem' }}
                  />
                  <div className={page.resumePreview}>
                    <p className={page.previewText}>
                      {exp.jobTitle || 'Unknown title'} {exp.companyName ? `at ${exp.companyName}` : ''}
                      {' · '}{exp.startDateRaw}{' - '}{exp.currentlyWorking ? 'Present' : exp.endDateRaw}
                    </p>
                  </div>
                </label>
              ))}
            </>
          )}

          {parsed.skills.length === 0 && parsed.experience.length === 0 && (
            <p className={styles.emptyState}>We couldn&apos;t confidently detect skills or work history in this file. Try pasting your resume text below instead.</p>
          )}

          {(parsed.skills.length > 0 || parsed.experience.length > 0) && (
            <button className={page.saveButton} onClick={handleApplyParsed} disabled={applying}>
              {applying ? 'Adding to profile...' : 'Add selected to my profile'}
            </button>
          )}
        </div>
      )}

      <div className={styles.card}>
        <p className={page.sectionLabel}>Or paste your resume text</p>
        <textarea
          className={page.textarea}
          rows={6}
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
          placeholder="Paste your resume text here (click or drop to replace)..."
        />
        <button className={page.saveButton} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save resume'}
        </button>
      </div>

      {resumes.length > 0 && (
        <div className={styles.card}>
          <p className={page.sectionLabel}>Saved resumes</p>
          {resumes.map((r) => (
            <div key={r.id} className={page.resumeRow}>
              <div className={page.resumePreview}>
                {r.is_default && <span className={page.defaultBadge}>Default</span>}
                <p className={page.previewText}>{r.original_file_text.slice(0, 120)}&hellip;</p>
              </div>
              <div className={page.resumeActions}>
                <button
                  className={page.secondaryButton}
                  onClick={() => downloadAuthed(`${base}/api/resume/${r.id}/original`, token, r.label || `resume-${r.id}`)}
                >
                  Download original
                </button>
                <button className={page.deleteButton} onClick={() => handleDeleteResume(r.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={page.tailoredGrid}>
        {tailoredHistory.map((t) => (
          <div key={t.id} className={styles.card} style={{ marginBottom: 0 }}>
            {/*
              * A resume tailored from a PASTED job description has no employer
              * behind it that this product can vouch for. It says so, rather
              * than rendering an empty company that reads like data we lost.
              */}
            <p className={page.tailoredTitle}>
              {t.source === 'pasted_jd' ? 'Pasted job description' : t.job_title}
            </p>
            <p className={page.tailoredCompany}>
              {t.source === 'pasted_jd'
                ? 'You pasted this one — no company on file'
                : parsedOr(t.company_name, 'Company not stated')}
            </p>
            <span className={t.confirmed_at ? page.defaultBadge : page.draftBadge}>
              {t.confirmed_at ? 'Confirmed' : 'Draft'}
            </span>
            <div className={page.scoreTrack} style={{ marginTop: '0.5rem' }}>
              <div className={page.scoreFill} style={{ width: `${t.ats_score}%` }} />
            </div>
            <p className={page.scoreNum}>{t.ats_score}</p>
            <p className={page.tailoredDate}>{formatDate(t.created_at)}</p>
            <div className={page.resumeActions}>
              {t.confirmed_at && (
                <button
                  className={page.secondaryButton}
                  onClick={() => downloadText(t.tailored_summary, `tailored-${t.job_title || 'pasted-jd'}.txt`)}
                >
                  Download text
                </button>
              )}
              <button className={page.deleteButton} onClick={() => handleDeleteTailored(t.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {resumes.length === 0 && tailoredHistory.length === 0 && (
        <p className={styles.emptyState}>No resumes saved yet.</p>
      )}
    </>
  );
}

/*
 * Feature 3 — two ways to say which job, one of which needs no job at all.
 *
 * In India the role usually arrives by WhatsApp, by email, or on a board this
 * product cannot fetch. Making people find an indexed job first meant the
 * common case was the unsupported one.
 *
 * The two inputs are mutually exclusive on purpose, and the backend refuses if
 * both are sent rather than quietly choosing - tailoring against something the
 * user did not pick is the kind of surprise that ends up in an application.
 */
function TailorForJob({ jobs, token, base, reload }) {
  const [mode, setMode] = useState('indexed');
  const [jobText, setJobText] = useState('');
  const [jobId, setJobId] = useState('');
  const [tailoring, setTailoring] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [rejectedIndices, setRejectedIndices] = useState(new Set());
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  // Feature 8. `saveVersionState` holds the outcome of the last save attempt,
  // including a REFUSAL - the endpoint answers 422 with a reason when the job
  // has no company to file under, and a refusal the UI drops is a refusal the
  // user never hears.
  const [savingVersion, setSavingVersion] = useState(false);
  const [saveVersionState, setSaveVersionState] = useState(null);

  const usingPaste = mode === 'paste';
  const canTailor = usingPaste ? jobText.trim().length >= 40 : Boolean(jobId);

  const handleTailor = async () => {
    if (!canTailor) return;
    setTailoring(true);
    setError('');
    setResult(null);
    setConfirmed(null);
    setRejectedIndices(new Set());
    try {
      const res = await fetch(`${base}/api/resume/tailor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // Exactly one of them, ever. The backend refuses both together.
        body: JSON.stringify(usingPaste ? { jobText } : { jobId }),
      });
      // Status before body: an error page is also JSON and parses into nulls
      // that read like missing fields rather than like a failure.
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(data);
        reload();
      } else {
        setError(data.error || `Could not tailor the resume (${res.status}).`);
      }
    } catch (err) {
      setError('Failed to tailor resume');
    } finally {
      setTailoring(false);
    }
  };

  const toggleChange = (index) => {
    setRejectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const addedParts = (result?.diff || []).filter((p) => p.added);
  const acceptedCount = addedParts.length - rejectedIndices.size;

  /*
   * Feature 8 — keep this version against the employer, to reuse for the next
   * role there.
   *
   * The 422 path is the one that matters: a pasted JD has no verified employer
   * and a linked job whose page never named one is stored without it, so the
   * server refuses rather than filing the resume under a company that does not
   * exist. That reason is rendered.
   */
  const handleSaveVersion = async () => {
    if (savingVersion || !result?.id) return;
    setSavingVersion(true);
    setSaveVersionState(null);
    try {
      const res = await fetch(`${base}/api/resume/company-versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tailoredResumeId: result.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaveVersionState({
          ok: true,
          companyName: data.companyName,
          replaced: data.replaced === true,
        });
      } else {
        setSaveVersionState({
          ok: false,
          // Prefer the sentence written for a reader; fall back to the status
          // so a failure never renders as an empty box.
          detail: data.detail || data.error || `Could not save that version (${res.status}).`,
        });
      }
    } catch (err) {
      setSaveVersionState({ ok: false, detail: 'Could not save that version. Please try again.' });
    } finally {
      setSavingVersion(false);
    }
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const acceptedIndices = addedParts.filter((p) => !rejectedIndices.has(p.index)).map((p) => p.index);
      const res = await fetch(`${base}/api/resume/tailored/${result.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ acceptedIndices }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfirmed(data);
        reload();
      } else {
        setError(data.error || 'Failed to confirm tailored resume');
      }
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={page.tailorModes} role="group" aria-label="Where the job description comes from">
        <button
          type="button"
          className={mode === 'indexed' ? page.tailorModeOn : page.tailorModeOff}
          aria-pressed={mode === 'indexed'}
          onClick={() => setMode('indexed')}
        >
          Pick a job we have
        </button>
        <button
          type="button"
          className={mode === 'paste' ? page.tailorModeOn : page.tailorModeOff}
          aria-pressed={mode === 'paste'}
          onClick={() => setMode('paste')}
        >
          Paste a job description
        </button>
      </div>

      {mode === 'indexed' ? (
        <>
          <label className={page.sectionLabel} htmlFor="tailorJob">Select a job</label>
          <select id="tailorJob" className={page.select} value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Choose a job to tailor for&hellip;</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {(j.title.length > 50 ? `${j.title.slice(0, 50)}…` : j.title)} &middot; {parsedOr(j.company_name, 'Company not stated')}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <label className={page.sectionLabel} htmlFor="tailorPaste">Paste the job description</label>
          <textarea
            id="tailorPaste"
            className={page.tailorPaste}
            value={jobText}
            onChange={(e) => setJobText(e.target.value)}
            rows={9}
            placeholder="Paste the whole posting here — from WhatsApp, an email, or any site."
          />
          {/*
            * Said plainly, because it is the thing a person would reasonably
            * worry about: the paste is read for skills and nothing else, and
            * the same rule applies as everywhere else - nothing goes on the
            * resume that is not already true of them.
            */}
          <p className={page.tailorPasteNote}>
            {jobText.trim().length} characters. We read it for skills only — anything it
            asks for that is not already in your resume, skills or work history is shown
            as a question, never added on its own.
          </p>
        </>
      )}

      <button className={page.saveButton} onClick={handleTailor} disabled={tailoring || !canTailor}>
        {tailoring ? 'Tailoring...' : 'Tailor resume'}
      </button>

      {error && <p className={page.errorText}>{error}</p>}

      {result && (
        <>
          <p className={page.tailorNote}>
            Your resume is preserved as-is - we only ever add missing job-relevant keywords, never rewrite or remove anything.
            Click any added line below to accept or reject it individually.
          </p>

          <div className={page.compareGrid}>
            <div className={page.compareCol}>
              <p className={page.compareLabel}>ORIGINAL</p>
              <pre className={page.compareTextPre}>{result.originalText}</pre>
            </div>
            <div className={page.compareColHighlight}>
              <p className={page.compareLabelHighlight}>TAILORED ({acceptedCount} change{acceptedCount === 1 ? '' : 's'} accepted)</p>
              <pre className={page.compareTextPre}>
                {(result.diff || []).map((part) => {
                  if (!part.added) return <span key={part.index}>{part.value}</span>;
                  const rejected = rejectedIndices.has(part.index);
                  return (
                    <span
                      key={part.index}
                      onClick={() => toggleChange(part.index)}
                      className={rejected ? page.diffRejected : page.diffAdded}
                      title={rejected ? 'Rejected - click to accept' : 'Accepted - click to reject'}
                    >
                      {part.value}
                    </span>
                  );
                })}
              </pre>
              {result.matchedSkills?.length > 0 && (
                <>
                  <p className={page.compareLabel} style={{ marginTop: '0.75rem' }}>Already in your resume</p>
                  <div className={page.pillRow}>
                    {result.matchedSkills.map((s) => <span key={s} className={page.pillGreen}>{s}</span>)}
                  </div>
                </>
              )}

              {/*
                * Skills the job asks for that were NOT added, and why.
                *
                * The guard withholds anything it cannot trace to the user's own
                * resume, skills or work history - after D51 that includes things
                * like "Marketing" matched only against "market positioning". The
                * design is that a withheld skill becomes a QUESTION rather than a
                * silent addition, and this page dropped the question: it rendered
                * the matched skills and the score and discarded needsConfirmation
                * entirely, so the user saw a tailored resume with no sign that
                * anything had been held back or that it was theirs to confirm.
                *
                * The editor page had always shown these. This one had not.
                */}
              {result.needsConfirmation?.length > 0 && (
                <>
                  <p className={page.compareLabel} style={{ marginTop: '0.75rem' }}>
                    Not added — only you can say whether these are yours
                  </p>
                  <ul className={page.holdList}>
                    {result.needsConfirmation.map((s) => (
                      <li key={s.text || s}>
                        <strong>{s.text || s}</strong>
                        {s.why ? <span className={page.holdWhy}> — {s.why}</span> : null}
                      </li>
                    ))}
                  </ul>
                  <p className={page.holdNote}>
                    The job mentions these and your resume does not, so they were left out.
                    Add them to your profile if you have the experience, and tailor again.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* The acronym stays - "ATS score" is the phrase Indian job seekers
              actually search for - but it never stands alone over a bare number.
              Feature 2: plain words on the surface, the term kept where it is
              the word people know. */}
          <p className={page.sectionLabel} style={{ marginTop: '1.25rem' }}>
            ATS score
            <span className={page.sectionLabelHint}>
              {' '}— how much of the job&apos;s own wording your resume already uses
            </span>
          </p>
          <div className={page.scoreTrackLarge}>
            <div className={page.scoreFillLarge} style={{ width: `${result.atsScore}%` }} />
          </div>
          <p className={page.scoreNumLarge}>{result.atsScore}</p>

          {/* Feature 8: keep this version for the employer. Offered whatever
              the company situation is - the server decides, and explains. */}
          <div className={page.versionSaveRow}>
            <button
              className={page.secondaryButton}
              onClick={handleSaveVersion}
              disabled={savingVersion}
              aria-busy={savingVersion}
            >
              {savingVersion
                ? 'Saving…'
                : `Save this version${result.companyName ? ` for ${result.companyName}` : ''}`}
            </button>
            {saveVersionState?.ok && (
              <p className={page.versionSaved}>
                Saved for {saveVersionState.companyName}.
                {saveVersionState.replaced
                  ? ' This replaced the version you had saved for them.'
                  : ' You can reuse it for the next role there.'}
              </p>
            )}
            {saveVersionState && !saveVersionState.ok && (
              <p className={page.versionRefused} role="status">{saveVersionState.detail}</p>
            )}
          </div>

          {!confirmed ? (
            <button className={page.saveButton} onClick={handleConfirm} disabled={confirming} style={{ marginTop: '1rem' }}>
              {confirming ? 'Confirming...' : `Confirm tailored version (${acceptedCount} change${acceptedCount === 1 ? '' : 's'})`}
            </button>
          ) : (
            <div className={page.confirmedBox}>
              <p className={page.confirmedText}>Tailored resume confirmed and saved for this application.</p>
              <div className={page.resumeActions}>
                <button
                  className={page.secondaryButton}
                  onClick={() => downloadText(result.tailoredText, `tailored-${result.jobTitle || 'resume'}.txt`)}
                >
                  Download tailored text
                </button>
                <button
                  className={page.secondaryButton}
                  onClick={() => downloadAuthed(`${base}/api/resume/${result.resumeId}/original`, token, 'original-resume')}
                  title="Original file, unmodified"
                >
                  Download original
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CoverLetters({ jobs, token, base }) {
  const [jobId, setJobId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`${base}/api/resume/cover-letters`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setHistory((await res.json()).coverLetters || []);
    } finally {
      setLoadingHistory(false);
    }
  }, [base, token]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleGenerate = async () => {
    if (!jobId) return;
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(`${base}/api/resume/cover-letter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (res.ok) {
        loadHistory();
      } else {
        setError(data.error || 'Failed to generate cover letter');
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id) => {
    await fetch(`${base}/api/resume/cover-letters/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    loadHistory();
  };

  return (
    <>
      <div className={styles.card}>
        <label className={page.sectionLabel}>Generate a cover letter</label>
        <p className={page.helpText}>Templated from your profile and the job details - always shown here for you to review and personalize before sending.</p>
        <select className={page.select} value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="">Choose a job&hellip;</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {(j.title.length > 50 ? `${j.title.slice(0, 50)}…` : j.title)} &middot; {parsedOr(j.company_name, 'Company not stated')}
            </option>
          ))}
        </select>
        <button className={page.saveButton} onClick={handleGenerate} disabled={generating || !jobId}>
          {generating ? 'Generating...' : 'Generate cover letter'}
        </button>
        {error && <p className={page.errorText}>{error}</p>}
      </div>

      {loadingHistory ? (
        <p className={styles.emptyState}>Loading&hellip;</p>
      ) : history.length === 0 ? (
        <p className={styles.emptyState}>No cover letters yet.</p>
      ) : (
        history.map((cl) => (
          <div key={cl.id} className={styles.card}>
            <p className={page.tailoredTitle}>{cl.job_title}</p>
            <p className={page.tailoredCompany}>{parsedOr(cl.company_name, 'Company not stated')}</p>
            <p className={page.compareText} style={{ whiteSpace: 'pre-line' }}>{cl.content}</p>
            <div className={page.resumeActions} style={{ marginTop: '0.75rem' }}>
              <button className={page.deleteButton} onClick={() => handleDelete(cl.id)}>Delete</button>
            </div>
          </div>
        ))
      )}
    </>
  );
}

function ScreeningAnswers({ jobs, token, base }) {
  const [jobId, setJobId] = useState('');
  const [question, setQuestion] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`${base}/api/resume/screening-answers`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setHistory((await res.json()).answers || []);
    } finally {
      setLoadingHistory(false);
    }
  }, [base, token]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleGenerate = async () => {
    if (!question.trim()) return;
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(`${base}/api/resume/screening-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question, jobId: jobId || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setQuestion('');
        loadHistory();
      } else {
        setError(data.error || 'Failed to generate answer');
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <div className={styles.card}>
        <label className={page.sectionLabel}>Ask a screening question</label>
        <p className={page.helpText}>Get a draft answer based on your profile - always shown here for you to review and edit before submitting.</p>
        <select className={page.select} value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="">No specific job (general answer)</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {(j.title.length > 50 ? `${j.title.slice(0, 50)}…` : j.title)} &middot; {parsedOr(j.company_name, 'Company not stated')}
            </option>
          ))}
        </select>
        <textarea
          className={page.textarea}
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Why do you want to work here?"
        />
        <button className={page.saveButton} onClick={handleGenerate} disabled={generating || !question.trim()}>
          {generating ? 'Generating...' : 'Generate answer'}
        </button>
        {error && <p className={page.errorText}>{error}</p>}
      </div>

      {loadingHistory ? (
        <p className={styles.emptyState}>Loading&hellip;</p>
      ) : history.length === 0 ? (
        <p className={styles.emptyState}>No screening answers yet.</p>
      ) : (
        history.map((a) => (
          <div key={a.id} className={styles.card}>
            {a.job_title && <p className={page.tailoredCompany}>{a.job_title} &middot; {parsedOr(a.company_name, 'Company not stated')}</p>}
            <p className={page.tailoredTitle}>{a.question}</p>
            <p className={page.compareText} style={{ marginTop: '0.5rem' }}>{a.answer}</p>
          </div>
        ))
      )}
    </>
  );
}

function AtsChecker({ token, base }) {
  const [jobDescription, setJobDescription] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const res = await fetch(`${base}/api/resume/ats-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jobDescription, resumeText }),
      });
      const data = await res.json();
      if (res.ok) setResult(data);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className={page.atsGrid}>
      <div>
        <label className={page.sectionLabel}>Job description</label>
        <textarea
          className={page.textarea}
          rows={8}
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste the job description..."
        />
        <label className={page.sectionLabel}>Your resume text</label>
        <textarea
          className={page.textarea}
          rows={8}
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
          placeholder="Paste your resume text..."
        />
        <button className={page.saveButton} onClick={handleCheck} disabled={checking || !jobDescription || !resumeText}>
          {checking ? 'Checking...' : 'Check my resume'}
        </button>
      </div>

      <div className={styles.card} style={{ marginBottom: 0 }}>
        {!result ? (
          <p className={styles.emptyState}>Results will appear here.</p>
        ) : (
          <>
            <p className={page.sectionLabel}>Keyword match</p>
            <div className={page.scoreTrack}>
              <div className={page.scoreFill} style={{ width: `${result.score}%` }} />
            </div>
            <p className={page.scoreNum}>{result.score}</p>

            <p className={page.matchedLabel}>Matched ({result.matched.length})</p>
            <div className={page.pillRow}>
              {result.matched.map((k) => <span key={k} className={page.pillGreen}>{k}</span>)}
            </div>

            <p className={page.missingLabel}>Missing ({result.missing.length})</p>
            <div className={page.pillRow}>
              {result.missing.map((k) => <span key={k} className={page.pillRed}>{k}</span>)}
            </div>

            <p className={page.tipsLabel}>Tips</p>
            <ul className={page.tipsList}>
              {result.tips.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
