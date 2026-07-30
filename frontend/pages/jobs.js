import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback, useRef } from 'react';
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

/*
 * Multi-select facet dropdown: label button, checkbox list with live counts,
 * and an explicit Apply. Selections are staged locally and only committed on
 * Apply, so ticking three boxes triggers one query rather than three - and
 * the user can back out via Cancel without having already changed results.
 */
function FilterPanel({ label, options, selected, onApply, searchable = false, hint }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(selected);
  const [term, setTerm] = useState('');
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef(null);

  // Panels are left-aligned to their trigger by default, but triggers sitting
  // near the right edge would push the panel (and its Apply button) off
  // screen. Measure on open and flip the anchor when it would overflow.
  useEffect(() => {
    if (!open || !ref.current) return;
    const { left } = ref.current.getBoundingClientRect();
    const PANEL_WIDTH = 272; // keep in sync with .filterPanel width
    setAlignRight(left + PANEL_WIDTH > window.innerWidth - 16);
  }, [open]);

  useEffect(() => { setDraft(selected); }, [selected, open]);

  // Close on outside click / Escape - expected dismissal for a popover.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (value) => {
    setDraft((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const visible = searchable && term
    ? options.filter((o) => o.label.toLowerCase().includes(term.toLowerCase()))
    : options;

  return (
    <div className={page.filterPanelWrap} ref={ref}>
      <button
        type="button"
        className={selected.length ? page.filterTriggerActive : page.filterTrigger}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {label}
        {selected.length > 0 && <span className={page.filterCount}>{selected.length}</span>}
        <span aria-hidden="true" className={page.filterCaret}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className={alignRight ? page.filterPanelRight : page.filterPanel} role="dialog" aria-label={label}>
          <div className={page.filterPanelHead}>
            <span className={page.filterPanelTitle}>{label}</span>
            <button type="button" className={page.filterPanelClose} onClick={() => setOpen(false)} aria-label={`Close ${label}`}>×</button>
          </div>

          {hint && <p className={page.filterHint}>{hint}</p>}

          {searchable && (
            <input
              className={page.filterSearch}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
            />
          )}

          <div className={page.filterOptions}>
            {visible.length === 0 && <p className={page.filterEmpty}>No options match.</p>}
            {visible.map((o) => (
              <label key={o.value} className={page.filterOption}>
                <input
                  type="checkbox"
                  checked={draft.includes(o.value)}
                  onChange={() => toggle(o.value)}
                />
                <span className={page.filterOptionLabel}>{o.label}</span>
                <span className={page.filterOptionCount}>({o.count.toLocaleString()})</span>
              </label>
            ))}
          </div>

          <div className={page.filterPanelFoot}>
            <button
              type="button"
              className={page.filterClear}
              onClick={() => setDraft([])}
              disabled={draft.length === 0}
            >
              Clear
            </button>
            <button
              type="button"
              className={page.filterApply}
              onClick={() => { onApply(draft); setOpen(false); }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Shared by the source-health strip and the detail drawer, so it lives at
// module scope rather than inside one component.
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

// "on-site" -> "On site", "full-time" -> "Full time"
function titleCase(v) {
  if (!v) return '';
  const t = String(v).replace(/[-_]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

// Salary was previously printed as `$<salary_min/1000>K` for every job
// regardless of the row's actual currency, so a 25,000 PLN/month NoFluffJobs
// figure rendered as "$25K" - wrong currency and wrong period at once.
// Show the real currency, and mark per-month figures as such.
const MONTHLY_SOURCES = new Set(['nofluffjobs']);

function formatSalary(job) {
  const cur = job.currency || 'USD';
  const per = MONTHLY_SOURCES.has(job.source) ? '/mo' : '';
  const k = (n) => (n >= 10000 ? `${Math.round(n / 1000)}K` : `${Math.round(n)}`);
  const range = job.salary_max ? `${k(job.salary_min)}-${k(job.salary_max)}` : `${k(job.salary_min)}+`;
  return `${cur} ${range}${per}`;
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
  const [jobTypes, setJobTypes] = useState([]);
  const [workArrangements, setWorkArrangements] = useState([]);
  const [salary, setSalary] = useState([]);
  const [facets, setFacets] = useState(null);
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
      const jt = params.jobTypes ?? jobTypes;
      const wa = params.workArrangements ?? workArrangements;
      const sal = params.salary ?? salary;
      const co = params.company ?? company;
      kws.forEach((k) => k && qs.append('keywords', k));
      excl.forEach((e) => e && qs.append('exclude', e));
      if (scp) qs.set('scope', scp);
      if (exp) qs.set('experience', exp);
      if (loc) qs.set('location', loc);
      if (related) qs.set('includeRelated', 'true');
      if (dp) qs.set('datePosted', dp);
      jt.forEach((v) => v && qs.append('jobType', v));
      wa.forEach((v) => v && qs.append('workArrangement', v));
      sal.forEach((v) => v && qs.append('salary', v));
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
  }, [base, page_, keywords, excludeTerms, scope, experience, location, includeRelated, datePosted, jobTypes, workArrangements, salary, company]);

  // Facet counts are fetched once and reflect the whole active job pool, so
  // each option can show how many jobs it would match before it's applied.
  useEffect(() => {
    fetch(`${base}/api/jobs/facets`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setFacets(d))
      .catch(() => {});
  }, [base]);

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
            {job.salary_min ? ` · ${formatSalary(job)}` : ''}
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
          <FilterPanel
            label="Employment type"
            searchable
            selected={jobTypes}
            options={(facets?.jobType || []).map((o) => ({
              value: o.value,
              label: o.value.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
              count: o.count,
            }))}
            onApply={(vals) => { setJobTypes(vals); loadJobs(token, { page: 1, jobTypes: vals }); }}
          />

          <FilterPanel
            label="Workplace"
            selected={workArrangements}
            options={(facets?.workArrangement || []).map((o) => ({
              value: o.value,
              label: o.value.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
              count: o.count,
            }))}
            onApply={(vals) => { setWorkArrangements(vals); loadJobs(token, { page: 1, workArrangements: vals }); }}
          />

          {/* USD-equivalent bands. Source salaries are in mixed currencies and
              converted with static reference rates, hence "approx" - the band
              is reliable, the exact figure isn't, so we don't show one. */}
          <FilterPanel
            label="Salary (USD)"
            hint="Converted to USD at approximate rates. Only ~16% of postings publish pay."
            selected={salary}
            options={(facets?.salary || []).map((o) => ({
              value: o.value,
              label: o.label || o.value,
              count: o.count,
            }))}
            onApply={(vals) => { setSalary(vals); loadJobs(token, { page: 1, salary: vals }); }}
          />
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company"
            className={page.locInput}
          />
          {(experience || location || datePosted || jobTypes.length || workArrangements.length || salary.length || company) && (
            <button
              type="button"
              className={page.clearFiltersButton}
              onClick={() => {
                setExperience(''); setLocation(''); setDatePosted('');
                setJobTypes([]); setWorkArrangements([]); setSalary([]); setCompany('');
                setPage(1);
                loadJobs(token, {
                  page: 1, experience: '', location: '', datePosted: '',
                  jobTypes: [], workArrangements: [], salary: [], company: '',
                });
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
  const [detail, setDetail] = useState(null);
  const [recruiterLoading, setRecruiterLoading] = useState(true);
  const [recruiterAdded, setRecruiterAdded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRecruiter(null);
    // Clear too, or the previously-opened job's skills/experience linger in
    // the meta grid until the new fetch resolves.
    setDetail(null);
    setRecruiterAdded(false);
    setRecruiterLoading(true);

    // Only surfaces a contact the employer actually published in the posting.
    // This previously called /api/network/suggest, which invents a plausible
    // name and title from hardcoded lists - that read as a real hiring manager
    // in the UI when no such person had been identified.
    async function loadRecruiter() {
      try {
        const res = await fetch(`${base}/api/jobs/${job.id}`);
        if (!res.ok) return;
        const data = await res.json();
        const emails = data.contactEmails || [];
        if (!cancelled) {
          setDetail(data);
          setRecruiter(emails.length ? { emails } : null);
        }
      } catch (err) {
        console.error('Failed to load published contact details', err);
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

        {/* At-a-glance facts. Every row is rendered only when the underlying
            column actually has a value, so an absent field is simply omitted
            rather than shown as "N/A" or filled with a plausible default. */}
        <div className={page.metaGrid}>
          <div className={page.metaItem}>
            <span className={page.metaLabel}>Location</span>
            <span className={page.metaValue}>{job.location || 'Not specified'}</span>
          </div>
          {job.work_arrangement && (
            <div className={page.metaItem}>
              <span className={page.metaLabel}>Workplace</span>
              <span className={page.metaValue}>{titleCase(job.work_arrangement)}</span>
            </div>
          )}
          {job.job_type && (
            <div className={page.metaItem}>
              <span className={page.metaLabel}>Employment type</span>
              <span className={page.metaValue}>{titleCase(job.job_type)}</span>
            </div>
          )}
          {(detail?.experienceLevel || job.experienceLevel) && (
            <div className={page.metaItem}>
              <span className={page.metaLabel}>Experience</span>
              <span className={page.metaValue}>{titleCase(detail?.experienceLevel || job.experienceLevel)}</span>
            </div>
          )}
          {job.salary_min && (
            <div className={page.metaItem}>
              <span className={page.metaLabel}>Salary (as published)</span>
              <span className={page.metaValue}>{formatSalary(job)}</span>
            </div>
          )}
          <div className={page.metaItem}>
            <span className={page.metaLabel}>Posted</span>
            <span className={page.metaValue}>
              {job.posted_at
                ? new Date(job.posted_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                : 'Not published by source'}
            </span>
          </div>
          <div className={page.metaItem}>
            <span className={page.metaLabel}>Listed via</span>
            <span className={page.metaValue}>{sourceLabels[job.source] || job.source}</span>
          </div>
          {job.country && (
            <div className={page.metaItem}>
              <span className={page.metaLabel}>Country</span>
              <span className={page.metaValue}>{job.country}</span>
            </div>
          )}
        </div>

        {detail?.skills?.length > 0 && (
          <>
            <h3 className={styles.drawerSectionTitle}>Skills &amp; technologies</h3>
            <div className={page.skillChips}>
              {detail.skills.map((s) => (
                <span key={s} className={page.skillChip}>{s}</span>
              ))}
            </div>
            <p className={page.contactNote}>
              Matched from terms written in this posting — not inferred from the job title.
            </p>
          </>
        )}

        <h3 className={styles.drawerSectionTitle}>Contact from this posting</h3>
        {recruiterLoading ? (
          <p className={styles.drawerText}>Checking the posting for a published contact&hellip;</p>
        ) : recruiter ? (
          <div className={styles.fitCard} style={{ alignItems: 'flex-start' }}>
            <div className={styles.fitBars}>
              <p className={styles.fitTitle}>Published in this job ad</p>
              {recruiter.emails.map((em) => (
                <p key={em} className={styles.drawerText} style={{ marginBottom: '0.25rem' }}>
                  <a href={`mailto:${em}?subject=${encodeURIComponent(`Application - ${job.title}`)}`}>{em}</a>
                </p>
              ))}
              <p className={page.contactNote}>
                Taken directly from the posting text — not guessed from a name pattern.
              </p>
            </div>
          </div>
        ) : (
          <p className={styles.drawerText}>
            This posting doesn&apos;t publish a contact address. Apply through the
            original posting instead — HirePilot won&apos;t invent an email, since a
            guessed address either bounces or reaches an unrelated person.
          </p>
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
