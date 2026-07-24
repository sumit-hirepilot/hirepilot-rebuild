import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Jobs.module.css';

export default function Jobs() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [appliedIds, setAppliedIds] = useState(new Set());
  const [applyingId, setApplyingId] = useState(null);
  const [message, setMessage] = useState('');

  const base = process.env.NEXT_PUBLIC_API_URL;

  const loadJobs = useCallback(async (authToken, searchTerm) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (searchTerm) params.set('search', searchTerm);

      const [jobsRes, appsRes] = await Promise.all([
        fetch(`${base}/api/jobs?${params.toString()}`),
        fetch(`${base}/api/applications`, { headers: { Authorization: `Bearer ${authToken}` } }),
      ]);

      if (jobsRes.ok) {
        const data = await jobsRes.json();
        setJobs(data.jobs || []);
        setTotal(data.total || 0);
      }

      if (appsRes.ok) {
        const data = await appsRes.json();
        const ids = new Set();
        Object.values(data.kanban || {}).forEach((list) => list.forEach((a) => ids.add(a.job_id)));
        setAppliedIds(ids);
      }
    } catch (err) {
      console.error('Failed to load jobs', err);
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
    loadJobs(authToken, '');
  }, [router, loadJobs]);

  const handleSearch = (e) => {
    e.preventDefault();
    loadJobs(token, search);
  };

  const handleApply = async (jobId) => {
    setApplyingId(jobId);
    setMessage('');
    try {
      const res = await fetch(`${base}/api/applications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jobId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || 'Failed to apply');
        return;
      }

      setAppliedIds((prev) => new Set(prev).add(jobId));
      setMessage('Application submitted.');
    } catch (err) {
      setMessage('Failed to apply. Please try again.');
    } finally {
      setApplyingId(null);
    }
  };

  if (!user) return null;

  return (
    <>
      <Head>
        <title>Jobs - HirePilot</title>
      </Head>

      <DashboardLayout title="Jobs" user={user}>
        <div className={page.headerRow}>
          <div>
            <p className={styles.dateLabel}>{total} active jobs</p>
            <h1 className={styles.greeting}>Browse jobs</h1>
          </div>
          <form onSubmit={handleSearch} className={page.searchForm}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or description..."
              className={page.searchInput}
            />
            <button type="submit" className={page.searchButton}>Search</button>
          </form>
        </div>

        {message && <div className={page.message}>{message}</div>}

        <div className={styles.card} style={{ marginBottom: 0 }}>
          {loading ? (
            <p className={styles.emptyState}>Loading jobs&hellip;</p>
          ) : jobs.length === 0 ? (
            <p className={styles.emptyState}>No jobs found. Try a different search term.</p>
          ) : (
            <div className={page.list}>
              {jobs.map((job) => (
                <div key={job.id} className={page.jobRow}>
                  <div className={page.jobInfo}>
                    <p className={page.jobTitle}>{job.title}</p>
                    <p className={page.jobSubtitle}>
                      {job.company_name} &middot; {job.location || 'Remote'}
                      {job.salary_min ? ` · $${Number(job.salary_min).toLocaleString()}${job.salary_max ? `-$${Number(job.salary_max).toLocaleString()}` : '+'}` : ''}
                    </p>
                  </div>
                  <div className={page.jobActions}>
                    <a href={job.job_url} target="_blank" rel="noreferrer" className={page.viewLink}>
                      View posting
                    </a>
                    {appliedIds.has(job.id) ? (
                      <span className={page.appliedBadge}>Applied</span>
                    ) : (
                      <button
                        className={page.applyButton}
                        onClick={() => handleApply(job.id)}
                        disabled={applyingId === job.id}
                      >
                        {applyingId === job.id ? 'Applying...' : 'Apply'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DashboardLayout>
    </>
  );
}
