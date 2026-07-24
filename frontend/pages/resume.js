import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Resume.module.css';

const TABS = ['Resume Manager', 'Tailor for a Job', 'ATS Checker'];

export default function Resume() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [tab, setTab] = useState('Resume Manager');
  const [resumes, setResumes] = useState([]);
  const [tailoredHistory, setTailoredHistory] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const base = process.env.NEXT_PUBLIC_API_URL;

  const loadData = useCallback(async (authToken) => {
    setLoading(true);
    try {
      const [resumesRes, tailoredRes, jobsRes] = await Promise.all([
        fetch(`${base}/api/resume`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/resume/tailored`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/jobs?limit=50`),
      ]);

      if (resumesRes.ok) setResumes((await resumesRes.json()).resumes || []);
      if (tailoredRes.ok) setTailoredHistory((await tailoredRes.json()).tailored || []);
      if (jobsRes.ok) setJobs((await jobsRes.json()).jobs || []);
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
            reload={() => loadData(token)}
            setMessage={setMessage}
          />
        ) : tab === 'Tailor for a Job' ? (
          <TailorForJob jobs={jobs} token={token} base={base} reload={() => loadData(token)} />
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

  const handleDownload = (filename, text) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className={styles.card}>
        <p className={page.sectionLabel}>Your resume</p>
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
                <button className={page.secondaryButton} onClick={() => handleDownload(`resume-${r.id}.txt`, r.original_file_text)}>Download</button>
                <button className={page.deleteButton} onClick={() => handleDeleteResume(r.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={page.tailoredGrid}>
        {tailoredHistory.map((t) => (
          <div key={t.id} className={styles.card} style={{ marginBottom: 0 }}>
            <p className={page.tailoredTitle}>{t.job_title}</p>
            <p className={page.tailoredCompany}>{t.company_name}</p>
            <div className={page.scoreTrack}>
              <div className={page.scoreFill} style={{ width: `${t.ats_score}%` }} />
            </div>
            <p className={page.scoreNum}>{t.ats_score}</p>
            <p className={page.tailoredDate}>{new Date(t.created_at).toLocaleDateString()}</p>
            <div className={page.resumeActions}>
              <button className={page.secondaryButton} onClick={() => handleDownload(`tailored-${t.id}.txt`, t.tailored_summary)}>Download</button>
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

function TailorForJob({ jobs, token, base, reload }) {
  const [jobId, setJobId] = useState('');
  const [tailoring, setTailoring] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleTailor = async () => {
    if (!jobId) return;
    setTailoring(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`${base}/api/resume/tailor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
        reload();
      } else {
        setError(data.error || 'Failed to tailor resume');
      }
    } catch (err) {
      setError('Failed to tailor resume');
    } finally {
      setTailoring(false);
    }
  };

  return (
    <div className={styles.card}>
      <label className={page.sectionLabel}>Select a job</label>
      <select className={page.select} value={jobId} onChange={(e) => setJobId(e.target.value)}>
        <option value="">Choose a job to tailor for&hellip;</option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {(j.title.length > 50 ? `${j.title.slice(0, 50)}…` : j.title)} &middot; {j.company_name}
          </option>
        ))}
      </select>
      <button className={page.saveButton} onClick={handleTailor} disabled={tailoring || !jobId}>
        {tailoring ? 'Tailoring...' : 'Tailor resume'}
      </button>

      {error && <p className={page.errorText}>{error}</p>}

      {result && (
        <>
          <div className={page.compareGrid}>
            <div className={page.compareCol}>
              <p className={page.compareLabel}>ORIGINAL</p>
              <p className={page.compareText}>{result.original}</p>
            </div>
            <div className={page.compareColHighlight}>
              <p className={page.compareLabelHighlight}>TAILORED</p>
              <p className={page.compareText}>{result.tailored}</p>
              <div className={page.pillRow}>
                {result.highlightedSkills.map((s) => (
                  <span key={s} className={page.pill}>{s}</span>
                ))}
              </div>
            </div>
          </div>

          <p className={page.sectionLabel} style={{ marginTop: '1.25rem' }}>ATS Score</p>
          <div className={page.scoreTrackLarge}>
            <div className={page.scoreFillLarge} style={{ width: `${result.atsScore}%` }} />
          </div>
          <p className={page.scoreNumLarge}>{result.atsScore}</p>
        </>
      )}
    </div>
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
