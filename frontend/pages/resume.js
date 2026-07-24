import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Resume.module.css';

export default function Resume() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [resumes, setResumes] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [resumeText, setResumeText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState('');

  const base = process.env.NEXT_PUBLIC_API_URL;

  const loadData = useCallback(async (authToken) => {
    setLoading(true);
    try {
      const [resumesRes, jobsRes] = await Promise.all([
        fetch(`${base}/api/resume`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/jobs?limit=50`),
      ]);

      if (resumesRes.ok) {
        const data = await resumesRes.json();
        setResumes(data.resumes || []);
        if (data.resumes?.length) setSelectedResumeId(String(data.resumes[0].id));
      }
      if (jobsRes.ok) {
        const data = await jobsRes.json();
        setJobs(data.jobs || []);
        if (data.jobs?.length) setSelectedJobId(String(data.jobs[0].id));
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

  const handleSaveResume = async (e) => {
    e.preventDefault();
    if (resumeText.trim().length < 20) {
      setMessage('Paste at least 20 characters of resume text.');
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`${base}/api/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: resumeText, isDefault: resumes.length === 0 }),
      });

      if (res.ok) {
        setResumeText('');
        setMessage('Resume saved.');
        loadData(token);
      } else {
        const data = await res.json();
        setMessage(data.error || 'Failed to save resume');
      }
    } catch (err) {
      setMessage('Failed to save resume');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (id) => {
    await fetch(`${base}/api/resume/${id}/default`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    loadData(token);
  };

  const handleDelete = async (id) => {
    await fetch(`${base}/api/resume/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    loadData(token);
  };

  const handleAnalyze = async () => {
    if (!selectedResumeId || !selectedJobId) return;
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fetch(`${base}/api/resume/${selectedResumeId}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jobId: selectedJobId }),
      });
      const data = await res.json();
      if (res.ok) {
        setAnalysis(data);
      } else {
        setMessage(data.error || 'Failed to analyze');
      }
    } catch (err) {
      setMessage('Failed to analyze resume');
    } finally {
      setAnalyzing(false);
    }
  };

  if (!user) return null;

  return (
    <>
      <Head>
        <title>Resume - HirePilot</title>
      </Head>

      <DashboardLayout title="Resume" user={user}>
        <p className={styles.dateLabel}>{resumes.length} saved resume{resumes.length === 1 ? '' : 's'}</p>
        <h1 className={styles.greeting}>Resume</h1>

        {message && <div className={page.message}>{message}</div>}

        <div className={styles.card}>
          <h2 className={styles.sectionTitle} style={{ marginBottom: '0.75rem' }}>Add a resume</h2>
          <p className={page.hint}>
            Paste your resume text below. HirePilot stores it and can compare it against any job description
            to show which keywords you&apos;re missing.
          </p>
          <form onSubmit={handleSaveResume}>
            <textarea
              className={page.textarea}
              rows={8}
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              placeholder="Paste your resume text here..."
            />
            <button type="submit" className={page.saveButton} disabled={saving}>
              {saving ? 'Saving...' : 'Save resume'}
            </button>
          </form>
        </div>

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : resumes.length === 0 ? (
          <div className={styles.card}>
            <p className={styles.emptyState}>No resumes saved yet.</p>
          </div>
        ) : (
          <>
            <div className={styles.card}>
              <h2 className={styles.sectionTitle} style={{ marginBottom: '0.75rem' }}>Your resumes</h2>
              {resumes.map((r) => (
                <div key={r.id} className={page.resumeRow}>
                  <div className={page.resumePreview}>
                    {r.is_default && <span className={page.defaultBadge}>Default</span>}
                    <p className={page.previewText}>{r.original_file_text.slice(0, 140)}&hellip;</p>
                  </div>
                  <div className={page.resumeActions}>
                    {!r.is_default && (
                      <button className={page.secondaryButton} onClick={() => handleSetDefault(r.id)}>
                        Set default
                      </button>
                    )}
                    <button className={page.deleteButton} onClick={() => handleDelete(r.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.card} style={{ marginBottom: 0 }}>
              <h2 className={styles.sectionTitle} style={{ marginBottom: '0.75rem' }}>Match a resume to a job</h2>
              <div className={page.analyzeRow}>
                <select className={page.select} value={selectedResumeId} onChange={(e) => setSelectedResumeId(e.target.value)}>
                  {resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      Resume from {new Date(r.created_at).toLocaleDateString()} {r.is_default ? '(default)' : ''}
                    </option>
                  ))}
                </select>
                <select className={page.select} value={selectedJobId} onChange={(e) => setSelectedJobId(e.target.value)}>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.title} — {j.company_name}</option>
                  ))}
                </select>
                <button className={page.saveButton} onClick={handleAnalyze} disabled={analyzing}>
                  {analyzing ? 'Analyzing...' : 'Analyze'}
                </button>
              </div>

              {analysis && (
                <div className={page.analysisResult}>
                  <p className={page.analysisTitle}>
                    Match against &ldquo;{analysis.jobTitle}&rdquo;
                    {analysis.coveragePercent !== null && ` — ${analysis.coveragePercent}% keyword coverage`}
                  </p>
                  {analysis.coveredSkills.length > 0 && (
                    <p className={page.covered}>Covered: {analysis.coveredSkills.join(', ')}</p>
                  )}
                  {analysis.missingSkills.length > 0 && (
                    <p className={page.missing}>Missing: {analysis.missingSkills.join(', ')}</p>
                  )}
                  <p className={page.suggestion}>{analysis.suggestion}</p>
                </div>
              )}
            </div>
          </>
        )}
      </DashboardLayout>
    </>
  );
}
