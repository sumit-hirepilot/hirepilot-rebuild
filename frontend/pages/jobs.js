import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Jobs.module.css';

const PAGE_SIZE = 20;

function ChipInput({ values, onChange, placeholder, className }) {
  const [draft, setDraft] = useState('');
  const addChip = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className={`${page.chipInputWrap} ${className || ''}`}>
      {values.map((v) => (
        <span key={v} className={page.chip}>
          {v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))}>&times;</button>
        </span>
      ))}
      <input
        className={page.chipInputField}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addChip(); }
        }}
        onBlur={addChip}
        placeholder={values.length ? '' : placeholder}
      />
    </div>
  );
}

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

// Some sources don't expose a trustworthy original-publish-date field (or
// only expose a "last synced/updated" timestamp that isn't the same thing) -
// posted_at is left null rather than backend fabricating a fake recent date,
// so this must say so plainly instead of computing a misleading "Xh ago".
function postedTimeAgo(dateStr) {
  if (!dateStr) return 'Publication date unavailable';
  return timeAgo(dateStr);
}

export default function Jobs() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page_, setPage] = useState(1);
  const [keywords, setKeywords] = useState([]);
  const [excludeTerms, setExcludeTerms] = useState([]);
  const [scope, setScope] = useState('title_description');
  const [experience, setExperience] = useState('');
  const [location, setLocation] = useState('');
  const [datePosted, setDatePosted] = useState('');
  const [jobType, setJobType] = useState('');
  const [company, setCompany] = useState('');
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
  const [includeRelated, setIncludeRelated] = useState(false);
  const [noExactMatches, setNoExactMatches] = useState(false);
  const [relatedJobs, setRelatedJobs] = useState([]);
  const [relatedTotal, setRelatedTotal] = useState(0);
  const [excludedUnknownDateCount, setExcludedUnknownDateCount] = useState(0);

  const base = process.env.NEXT_PUBLIC_API_URL;

  const loadJobs = useCallback(async (authToken, params = {}) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        page: String(params.page ?? page_),
      });
      const kws = params.keywords ?? keywords;
      const excl = params.excludeTerms ?? excludeTerms;
      const scp = params.scope ?? scope;
      const exp = params.experience ?? experience;
      const loc = params.location ?? location;
      const related = params.includeRelated ?? includeRelated;
      const dp = params.datePosted ?? datePosted;
      const jt = params.jobType ?? jobType;
      const co = params.company ?? company;
      kws.forEach((k) => k && qs.append('keywords', k));
      excl.forEach((e) => e && qs.append('exclude', e));
      if (scp) qs.set('scope', scp);
      if (exp) qs.set('experience', exp);
      if (loc) qs.set('location', loc);
      if (related) qs.set('includeRelated', 'true');
      if (dp) qs.set('datePosted', dp);
      if (jt) qs.set('jobType', jt);
      if (co) qs.set('company', co);

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
        setNoExactMatches(!!data.noExactMatches);
        setRelatedJobs(data.relatedJobs || []);
        setRelatedTotal(data.relatedTotal || 0);
        setExcludedUnknownDateCount(data.excludedUnknownDateCount || 0);
      } else {
        // Never silently keep showing a stale/previous result set on
        // failure - that reads as "search is broken and ignoring me".
        setJobs([]);
        setTotal(0);
        setNoExactMatches(false);
        setRelatedJobs([]);
        setExcludedUnknownDateCount(0);
        setMessage('Failed to load jobs. Please try your search again.');
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
  }, [base, page_, keywords, excludeTerms, scope, experience, location, includeRelated, datePosted, jobType, company]);

  useEffect(() => {
    if (!router.isReady) return;
    const authToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!authToken || !storedUser) {
      router.push('/login');
      return;
    }
    setUser(JSON.parse(storedUser));
    setToken(authToken);

    // Deep-link support for the header search (⌘K) which navigates to
    // /jobs?search=X - seed the keyword chips from it on first load.
    const initialSearch = router.query.search;
    const initialKeywords = initialSearch ? [String(initialSearch)] : keywords;
    if (initialSearch) setKeywords(initialKeywords);

    loadJobs(authToken, { page: 1, keywords: initialKeywords });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    loadJobs(token, { page: 1 });
  };

  const goToPage = (p) => {
    setPage(p);
    loadJobs(token, { page: p });
  };

  const handleShowRelated = () => {
    setIncludeRelated(true);
    setPage(1);
    loadJobs(token, { page: 1, includeRelated: true });
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

  const renderJobRow = (job) => {
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
            {' · '}{postedTimeAgo(job.posted_at)}
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
  };

  if (!user) return null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sourceLabels = {
    remoteok: 'Remote OK',
    remotive: 'Remotive',
    weworkremotely: 'We Work Remotely',
    himalayas: 'Himalayas',
    hackernews: 'HN Who’s Hiring',
    nofluffjobs: 'No Fluff Jobs',
    landingjobs: 'Landing.jobs',
    workingnomads: 'Working Nomads',
    jobicy: 'Jobicy',
    jobindex: 'Jobindex',
    greenhouse: 'Greenhouse',
    lever: 'Lever',
    ashby: 'Ashby',
  };

  return (
    <>
      <Head>
        <title>Jobs - HirePilot</title>
      </Head>

      <DashboardLayout title="Jobs" user={user}>
        <form onSubmit={handleSearch} className={page.searchBar}>
          <select value={scope} onChange={(e) => setScope(e.target.value)} className={page.scopeSelect} title="Match keyword in">
            <option value="title">Job title</option>
            <option value="title_description">Title + description</option>
            <option value="description">Description</option>
          </select>
          <ChipInput
            values={keywords}
            onChange={setKeywords}
            placeholder="Enter keyword / title, press Enter to add another"
            className={page.searchInput}
          />
          <button type="submit" className={page.searchButton}>Search</button>
          <label className={page.relatedToggle}>
            <input
              type="checkbox"
              checked={includeRelated}
              onChange={(e) => {
                setIncludeRelated(e.target.checked);
                setPage(1);
                loadJobs(token, { page: 1, includeRelated: e.target.checked });
              }}
            />
            Include related jobs
          </label>
        </form>

        <div className={page.excludeRow}>
          <span className={page.excludeLabel}>Exclude</span>
          <ChipInput
            values={excludeTerms}
            onChange={setExcludeTerms}
            placeholder="Hide jobs mentioning..."
            className={page.excludeInput}
          />
        </div>

        <div className={page.filterRow}>
          <select value={experience} onChange={(e) => setExperience(e.target.value)} className={page.expSelect}>
            <option value="">Experience</option>
            <option value="entry">Entry level</option>
            <option value="mid">Mid level</option>
            <option value="senior">Senior</option>
            <option value="staff">Staff+</option>
          </select>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location"
            className={page.locInput}
          />
          <select value={datePosted} onChange={(e) => setDatePosted(e.target.value)} className={page.expSelect}>
            <option value="">Date posted</option>
            <option value="24h">Past 24 hours</option>
            <option value="3d">Past 3 days</option>
            <option value="7d">Past 7 days</option>
            <option value="30d">Past 30 days</option>
          </select>
          <select value={jobType} onChange={(e) => setJobType(e.target.value)} className={page.expSelect}>
            <option value="">Employment type</option>
            <option value="full-time">Full-time</option>
            <option value="part-time">Part-time</option>
            <option value="contract">Contract</option>
            <option value="internship">Internship</option>
          </select>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company"
            className={page.locInput}
          />
          {(experience || location || datePosted || jobType || company) && (
            <button
              type="button"
              className={page.clearFiltersButton}
              onClick={() => {
                setExperience(''); setLocation(''); setDatePosted(''); setJobType(''); setCompany('');
                setPage(1);
                loadJobs(token, { page: 1, experience: '', location: '', datePosted: '', jobType: '', company: '' });
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        <div className={page.headerRow}>
          <h1 className={styles.greeting} style={{ margin: 0 }}>Jobs</h1>
          <span className={page.resultsCount}>{showSavedOnly ? savedIds.size : total} results</span>
          {!showSavedOnly && datePosted && excludedUnknownDateCount > 0 && (
            <span className={page.unknownDateNote} title="These jobs' sources don't expose a reliable original-publish date, so we can't confirm they fall in this window - shown separately rather than guessing.">
              +{excludedUnknownDateCount} more with unknown publish date (excluded from this filter)
            </span>
          )}
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
          {sources.map((s) => {
            const title = s.lastRunError
              ? `Last run failed: ${s.lastRunError}`
              : s.successRatePct != null
                ? `${s.successRatePct}% success rate (last 20 runs)${s.lastRunDurationMs ? ` · ${Math.round(s.lastRunDurationMs / 1000)}s last run` : ''}`
                : undefined;
            return (
              <span key={s.source} className={page.sourceItem} title={title}>
                <span className={s.count > 0 ? page.sourceDotActive : page.sourceDotInactive} />
                {sourceLabels[s.source] || s.source} ({s.count} &middot; {timeAgo(s.lastFetched)})
              </span>
            );
          })}
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

        <div className={styles.card} style={{ marginBottom: noExactMatches && !includeRelated ? '1rem' : 0 }}>
          {loading ? (
            <p className={styles.emptyState}>Loading jobs&hellip;</p>
          ) : (showSavedOnly ? savedJobs : jobs).length === 0 ? (
            <p className={styles.emptyState}>
              {showSavedOnly
                ? 'No saved jobs yet. Click the star on any job to save it for later.'
                : noExactMatches
                  ? `No exact matches for "${keywords.join(', ')}".${relatedTotal > 0 ? ' See related jobs below, or search a different title.' : ' Try a different search term.'}`
                  : 'No jobs found. Try a different search term.'}
            </p>
          ) : (
            <div className={page.list}>
              {(showSavedOnly ? savedJobs : jobs).map((job) => renderJobRow(job))}
            </div>
          )}
        </div>

        {!showSavedOnly && noExactMatches && !includeRelated && relatedJobs.length > 0 && (
          <>
            <div className={page.relatedHeader}>
              <h2 className={styles.greeting} style={{ fontSize: '1.125rem', margin: 0 }}>Related jobs</h2>
              <button type="button" className={page.pageButton} onClick={handleShowRelated}>
                Show all {relatedTotal} related jobs
              </button>
            </div>
            <div className={styles.card} style={{ marginBottom: 0 }}>
              <div className={page.list}>
                {relatedJobs.map((job) => renderJobRow(job))}
              </div>
            </div>
          </>
        )}
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
            <p className={styles.drawerPosted}>
              {job.posted_at
                ? `Posted ${postedTimeAgo(job.posted_at)} · ${new Date(job.posted_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
                : 'Publication date unavailable'}
            </p>
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
            <p className={styles.drawerText}>
              {tailorResult.addedSkills?.length > 0
                ? `Added ${tailorResult.addedSkills.length} relevant skill${tailorResult.addedSkills.length === 1 ? '' : 's'} this job asks for that weren't in your resume: ${tailorResult.addedSkills.join(', ')}.`
                : 'Your resume already covers everything this job is looking for - no changes needed.'}
            </p>
            <p className={styles.tailorScore}>ATS score: {tailorResult.atsScore}</p>
            <a href="/resume" className={styles.secondaryBtn} style={{ display: 'inline-block', marginTop: '0.5rem' }}>
              Review full diff &amp; download on Resume page
            </a>
          </div>
        )}
        {tailorResult?.error && <p className={styles.errorText}>{tailorResult.error}</p>}
      </div>
    </div>
  );
}
