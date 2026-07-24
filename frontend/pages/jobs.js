import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Jobs.module.css';

const PAGE_SIZE = 20;

function timeAgo(dateStr) {
  if (!dateStr) return 'never';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Jobs() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page_, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [experience, setExperience] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(true);
  const [appliedIds, setAppliedIds] = useState(new Set());
  const [matchByJobId, setMatchByJobId] = useState({});
  const [sources, setSources] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [savedIds, setSavedIds] = useState(new Set());
  const [savedJobs, setSavedJobs] = useState([]);
  const [showSavedOnly, setShowSavedOnly] = useState(false);

  const base = process.env.NEXT_PUBLIC_API_URL;

  const loadJobs = useCallback(async (authToken, params = {}) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        page: String(params.page ?? page_),
      });
      const kw = params.keyword ?? keyword;
      const exp = params.experience ?? experience;
      const loc = params.location ?? location;
      if (kw) qs.set('search', kw);
      if (exp) qs.set('experience', exp);
      if (loc) qs.set('location', loc);

      const [jobsRes, appsRes, matchesRes, sourcesRes, savedRes] = await Promise.all([
        fetch(`${base}/api/jobs?${qs.toString()}`),
        fetch(`${base}/api/applications`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/matches?limit=100`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/jobs/sources`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/jobs/saved/list`, { headers: { Authorization: `Bearer ${authToken}` } }),
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
        (data.rejected || []).forEach((a) => ids.add(a.job_id));
        setAppliedIds(ids);
      }

      if (matchesRes.ok) {
        const data = await matchesRes.json();
        const byId = {};
        (data.matches || []).forEach((m) => { byId[m.job_id] = m; });
        setMatchByJobId(byId);
      }

      if (sourcesRes.ok) {
        const data = await sourcesRes.json();
        setSources(data.sources || []);
      }

      if (savedRes.ok) {
        const data = await savedRes.json();
        setSavedJobs(data.jobs || []);
        setSavedIds(new Set((data.jobs || []).map((j) => j.id)));
      }
    } catch (err) {
      console.error('Failed to load jobs', err);
    } finally {
      setLoading(false);
    }
  }, [base, page_, keyword, experience, location]);

  useEffect(() => {
    const authToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!authToken || !storedUser) {
      router.push('/login');
      return;
    }
    setUser(JSON.parse(storedUser));
    setToken(authToken);
    loadJobs(authToken, { page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    loadJobs(token, { page: 1 });
  };

  const goToPage = (p) => {
    setPage(p);
    loadJobs(token, { page: p });
  };

  const handleApply = async (jobId) => {
    setMessage('');
    try {
      const res = await fetch(`${base}/api/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setMessage('');
    try {
      const res = await fetch(`${base}/api/jobs/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`Fetched ${data.total} jobs (${data.new} new, ${data.updated} updated).`);
        loadJobs(token, { page: 1 });
        setPage(1);
      } else {
        setMessage(data.error || 'Failed to refresh jobs');
      }
    } catch (err) {
      setMessage('Failed to refresh jobs');
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSave = async (job) => {
    const isSaved = savedIds.has(job.id);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (isSaved) next.delete(job.id); else next.add(job.id);
      return next;
    });
    setSavedJobs((prev) => (isSaved ? prev.filter((j) => j.id !== job.id) : [job, ...prev]));
    try {
      await fetch(`${base}/api/jobs/${job.id}/save`, {
        method: isSaved ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error('Failed to toggle saved job', err);
    }
  };

  const toggleSelect = (jobId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  if (!user) return null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sourceLabels = { remoteok: 'Remote OK', remotive: 'Remotive', weworkremotely: 'We Work Remotely' };

  return (
    <>
      <Head>
        <title>Jobs - HirePilot</title>
      </Head>

      <DashboardLayout title="Jobs" user={user}>
        <form onSubmit={handleSearch} className={page.searchBar}>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Enter keyword / title"
            className={page.searchInput}
          />
          <select value={experience} onChange={(e) => setExperience(e.target.value)} className={page.expSelect}>
            <option value="">Select experience</option>
            <option value="entry">Entry level</option>
            <option value="mid">Mid level</option>
            <option value="senior">Senior</option>
            <option value="staff">Staff+</option>
          </select>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Enter location"
            className={page.locInput}
          />
          <button type="submit" className={page.searchButton}>Search</button>
        </form>

        <div className={page.headerRow}>
          <h1 className={styles.greeting} style={{ margin: 0 }}>Jobs</h1>
          <span className={page.resultsCount}>{showSavedOnly ? savedIds.size : total} results</span>
          <button
            type="button"
            className={showSavedOnly ? page.pageActive : page.pageButton}
            onClick={() => setShowSavedOnly((v) => !v)}
          >
            {showSavedOnly ? '★ Saved jobs' : '☆ Saved jobs'} ({savedIds.size})
          </button>
          <button type="button" className={page.refreshButton} onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh jobs'}
          </button>
        </div>

        <div className={page.sourcesBanner}>
          <span className={page.liveLabel}>⚡ Live sources</span>
          {sources.map((s) => (
            <span key={s.source} className={page.sourceItem}>
              <span className={s.count > 0 ? page.sourceDotActive : page.sourceDotInactive} />
              {sourceLabels[s.source] || s.source} ({s.count} &middot; {timeAgo(s.lastFetched)})
            </span>
          ))}
        </div>

        {message && <div className={page.message}>{message}</div>}

        {!showSavedOnly && totalPages > 1 && (
          <div className={page.pagination}>
            <button disabled={page_ <= 1} onClick={() => goToPage(page_ - 1)}>&lsaquo; Previous</button>
            {Array.from({ length: Math.min(totalPages, 8) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => goToPage(p)}
                className={p === page_ ? page.pageActive : page.pageButton}
              >
                {p}
              </button>
            ))}
            <button disabled={page_ >= totalPages} onClick={() => goToPage(page_ + 1)}>Next &rsaquo;</button>
          </div>
        )}

        <div className={styles.card} style={{ marginBottom: 0 }}>
          {loading ? (
            <p className={styles.emptyState}>Loading jobs&hellip;</p>
          ) : (showSavedOnly ? savedJobs : jobs).length === 0 ? (
            <p className={styles.emptyState}>
              {showSavedOnly ? 'No saved jobs yet. Click the star on any job to save it for later.' : 'No jobs found. Try a different search term.'}
            </p>
          ) : (
            <div className={page.list}>
              {(showSavedOnly ? savedJobs : jobs).map((job) => {
                const match = matchByJobId[job.id];
                const score = match ? Math.round(match.overall_score * 100) : null;
                return (
                  <div key={job.id} className={page.jobRow}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(job.id)}
                      onChange={() => toggleSelect(job.id)}
                      className={page.checkbox}
                    />
                    <div className={page.avatar}>{job.company_name?.charAt(0) || '?'}</div>
                    <div className={page.jobInfo} onClick={() => setSelectedJob(job)}>
                      <p className={page.jobTitle}>{job.title}</p>
                      <p className={page.jobSubtitle}>{job.company_name}</p>
                      <p className={page.jobMeta}>
                        {job.location || 'Remote'}
                        {job.salary_min ? ` · $${Math.round(job.salary_min / 1000)}K${job.salary_max ? `-${Math.round(job.salary_max / 1000)}K` : '+'}` : ''}
                        {' · '}{timeAgo(job.posted_at)}
                      </p>
                    </div>
                    {score !== null && (
                      <div className={page.scoreRing}>{score}</div>
                    )}
                    <div className={page.jobActions}>
                      <button
                        className={page.saveButton}
                        onClick={() => toggleSave(job)}
                        aria-label={savedIds.has(job.id) ? 'Unsave job' : 'Save job'}
                        title={savedIds.has(job.id) ? 'Unsave job' : 'Save job'}
                      >
                        {savedIds.has(job.id) ? '★' : '☆'}
                      </button>
                      <button className={page.viewButton} onClick={() => setSelectedJob(job)}>View Details</button>
                      {appliedIds.has(job.id) ? (
                        <span className={page.appliedBadge}>Applied</span>
                      ) : (
                        <button className={page.applyButton} onClick={() => handleApply(job.id)}>Apply Now</button>
                      )}
                      <a href={job.job_url} target="_blank" rel="noreferrer" className={page.originalLink}>Original posting</a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DashboardLayout>

      {selectedJob && (
        <JobDetailDrawer
          job={selectedJob}
          match={matchByJobId[selectedJob.id]}
          applied={appliedIds.has(selectedJob.id)}
          onClose={() => setSelectedJob(null)}
          onApply={() => { handleApply(selectedJob.id); }}
          token={token}
          base={base}
          router={router}
        />
      )}
    </>
  );
}

function JobDetailDrawer({ job, match, applied, onClose, onApply, token, base, router }) {
  const [tailoring, setTailoring] = useState(false);
  const [tailorResult, setTailorResult] = useState(null);
  const [recruiter, setRecruiter] = useState(null);
  const [recruiterLoading, setRecruiterLoading] = useState(true);
  const [recruiterAdded, setRecruiterAdded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRecruiter(null);
    setRecruiterAdded(false);
    setRecruiterLoading(true);

    async function loadRecruiter() {
      try {
        const res = await fetch(`${base}/api/network/suggest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ company: job.company_name }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const hiringContact = (data.suggestions || []).find((s) => s.relationshipType === 'hiring_manager');
        if (!cancelled) setRecruiter(hiringContact || null);
      } catch (err) {
        console.error('Failed to detect recruiter contact', err);
      } finally {
        if (!cancelled) setRecruiterLoading(false);
      }
    }

    if (job.company_name) loadRecruiter();
    return () => { cancelled = true; };
  }, [job.id, job.company_name, base, token]);

  const handleAddRecruiter = async () => {
    if (!recruiter) return;
    try {
      await fetch(`${base}/api/network`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          jobId: job.id,
          companyName: job.company_name,
          firstName: recruiter.firstName,
          lastName: recruiter.lastName,
          jobTitle: recruiter.title,
          relationshipType: recruiter.relationshipType,
          notes: recruiter.message,
        }),
      });
      setRecruiterAdded(true);
    } catch (err) {
      console.error('Failed to add recruiter contact', err);
    }
  };

  const handleTailor = async () => {
    setTailoring(true);
    setTailorResult(null);
    try {
      const res = await fetch(`${base}/api/resume/tailor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setTailorResult(data);
      } else {
        setTailorResult({ error: data.error || 'Failed to tailor resume' });
      }
    } catch (err) {
      setTailorResult({ error: 'Failed to tailor resume' });
    } finally {
      setTailoring(false);
    }
  };

  const skillsPct = match ? Math.round(match.skills_match_score * 100) : null;
  const expPct = match ? Math.round(match.experience_match_score * 100) : null;
  const locPct = match ? Math.round(match.location_match_score * 100) : null;
  const overall = match ? Math.round(match.overall_score * 100) : null;

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <div>
            <h2 className={styles.drawerTitle}>{job.title}</h2>
            <p className={styles.drawerSubtitle}>{job.company_name} &middot; {job.location || 'Remote'}</p>
          </div>
          <button className={styles.drawerClose} onClick={onClose}>&times;</button>
        </div>

        {match && (
          <div className={styles.fitCard}>
            <div className={styles.fitRing}>{overall}</div>
            <div className={styles.fitBars}>
              <p className={styles.fitTitle}>Why you&apos;re a good fit</p>
              <div className={styles.fitRow}><span>Skills</span><div className={styles.fitTrack}><div className={styles.fitFill} style={{ width: `${skillsPct}%` }} /></div><span>{skillsPct}%</span></div>
              <div className={styles.fitRow}><span>Experience</span><div className={styles.fitTrack}><div className={styles.fitFill} style={{ width: `${expPct}%` }} /></div><span>{expPct}%</span></div>
              <div className={styles.fitRow}><span>Location</span><div className={styles.fitTrack}><div className={styles.fitFill} style={{ width: `${locPct}%` }} /></div><span>{locPct}%</span></div>
            </div>
          </div>
        )}

        <h3 className={styles.drawerSectionTitle}>Recruiter contact</h3>
        {recruiterLoading ? (
          <p className={styles.drawerText}>Scanning for a hiring contact at {job.company_name}&hellip;</p>
        ) : recruiter ? (
          <div className={styles.fitCard} style={{ alignItems: 'flex-start' }}>
            <div className={page.avatar}>{recruiter.firstName.charAt(0)}</div>
            <div className={styles.fitBars}>
              <p className={styles.fitTitle}>{recruiter.firstName} {recruiter.lastName} &middot; {recruiter.title}</p>
              <p className={styles.drawerText}>{recruiter.message}</p>
              <div className={styles.drawerActions} style={{ marginTop: '0.5rem' }}>
                {recruiterAdded ? (
                  <span className={styles.appliedTag}>Added to network</span>
                ) : (
                  <button className={styles.secondaryBtn} onClick={handleAddRecruiter}>Add to network</button>
                )}
                <a href={recruiter.linkedinSearchUrl} target="_blank" rel="noreferrer" className={styles.secondaryBtn}>
                  Find on LinkedIn
                </a>
              </div>
            </div>
          </div>
        ) : (
          <p className={styles.drawerText}>No hiring contact detected for {job.company_name} yet. Try Find Referrals below to search more broadly.</p>
        )}

        <h3 className={styles.drawerSectionTitle}>Description</h3>
        <p className={styles.drawerText}>{job.description || 'No description available.'}</p>

        {job.requirements && (
          <>
            <h3 className={styles.drawerSectionTitle}>Requirements</h3>
            <p className={styles.drawerText}>{job.requirements}</p>
          </>
        )}

        {(job.salary_min || job.salary_max) && (
          <>
            <h3 className={styles.drawerSectionTitle}>Salary comparison</h3>
            <p className={styles.drawerText}>
              ${Math.round(job.salary_min / 1000)}K to ${Math.round((job.salary_max || job.salary_min) / 1000)}K &middot; USD
            </p>
          </>
        )}

        <div className={styles.drawerActions}>
          <button className={styles.secondaryBtn} onClick={handleTailor} disabled={tailoring}>
            {tailoring ? 'Tailoring...' : 'Tailor Resume'}
          </button>
          {applied ? (
            <span className={styles.appliedTag}>Applied</span>
          ) : (
            <button className={styles.primaryBtn} onClick={onApply}>Apply with Autofill</button>
          )}
          <a href={job.job_url} target="_blank" rel="noreferrer" className={styles.secondaryBtn}>Original Posting</a>
          <button className={styles.secondaryBtn} onClick={() => router.push(`/network?jobId=${job.id}&company=${encodeURIComponent(job.company_name)}`)}>
            Find Referrals
          </button>
        </div>

        {tailorResult && !tailorResult.error && (
          <div className={styles.tailorResult}>
            <p className={styles.tailorLabel}>TAILORED</p>
            <p className={styles.drawerText}>{tailorResult.tailored}</p>
            <p className={styles.tailorScore}>ATS score: {tailorResult.atsScore}</p>
          </div>
        )}
        {tailorResult?.error && <p className={styles.errorText}>{tailorResult.error}</p>}
      </div>
    </div>
  );
}
