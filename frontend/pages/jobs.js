import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback, useRef } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Jobs.module.css';
import { API_BASE } from '../lib/apiBase';
import { countText, parsedOr } from '../lib/renderState';
import { formatDate, formatNumber, timeAgo, fetchedAgo, NO_DATE } from '../lib/format';
import Link from 'next/link';

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
function FilterPanel({ label, options, selected, onApply, searchable = false, hint, allOption = null }) {
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
            {allOption && (
              // Clearing the selection IS "all", so this row deselects rather
              // than adding a value the server would have to special-case.
              <button
                type="button"
                className={draft.length === 0 ? page.filterAllActive : page.filterAll}
                onClick={() => setDraft([])}
              >
                <span className={page.filterOptionLabel}>{allOption.label}</span>
                <span className={page.filterOptionCount}>{formatNumber(allOption.count)}</span>
              </button>
            )}
            {visible.map((o) => (
              <label key={o.value} className={page.filterOption}>
                <input
                  type="checkbox"
                  checked={draft.includes(o.value)}
                  onChange={() => toggle(o.value)}
                />
                <span className={page.filterOptionLabel}>{o.label}</span>
                <span className={page.filterOptionCount}>({formatNumber(o.count)})</span>
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

// Same buckets the backend REGION_SQL produces, for display in the drawer.
const REGION_LABELS = {
  north_america: 'North America',
  europe: 'Europe',
  india: 'India',
  asia_pacific: 'Asia-Pacific',
  latin_america: 'Latin America',
  mea: 'Middle East & Africa',
  unspecified: 'Not specified',
};

// Rows ingested before the two-pass entity fix still carry literal &nbsp; and
// similar in their description text. Cleaned at render so existing postings
// read correctly without rewriting them on a nearly-full volume.
function decodeLegacyEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[^\S\n]{2,}/g, ' ');
}

function regionFor(location) {
  const t = ` ${String(location || '').toLowerCase()} `;
  if (/bengaluru|bangalore|mumbai|delhi|hyderabad|pune|chennai|gurgaon|gurugram|noida|kolkata|india/.test(t)) return 'India';
  if (/united states|\busa\b|u\.s\.|san francisco|new york|seattle|austin|boston|chicago|los angeles|denver|atlanta|toronto|vancouver|canada|, *(ca|ny|tx|wa|ma|il|co|ga|or|fl|va|nc|pa|az|mn|mi|ut|dc)\b/.test(t)) return 'North America';
  if (/london|dublin|ireland|united kingdom|\buk\b|warszawa|warsaw|krak|poland|berlin|munich|germany|paris|france|amsterdam|netherlands|madrid|barcelona|spain|lisbon|portugal|milan|italy|zurich|switzerland|vienna|austria|stockholm|sweden|copenhagen|denmark|oslo|norway|helsinki|finland|prague|czech|budapest|europe|emea/.test(t)) return 'Europe';
  if (/singapore|sydney|melbourne|australia|auckland|new zealand|tokyo|japan|seoul|korea|beijing|shanghai|china|hong kong|taipei|taiwan|manila|philippines|jakarta|indonesia|bangkok|thailand|kuala lumpur|malaysia|vietnam|apac|asia/.test(t)) return 'Asia-Pacific';
  if (/paulo|rio de janeiro|brazil|brasil|mexico|guadalajara|buenos aires|argentina|santiago|chile|bogot|colombia|lima|peru|costa rica|uruguay|panama|latam|latin america/.test(t)) return 'Latin America';
  if (/dubai|abu dhabi|\buae\b|emirates|riyadh|saudi|doha|qatar|kuwait|bahrain|oman|tel aviv|israel|cairo|egypt|morocco|nairobi|kenya|lagos|nigeria|cape town|johannesburg|south africa|africa|middle east/.test(t)) return 'Middle East & Africa';
  return 'Not specified';
}


function atsRingClass(score) {
  if (score >= 70) return page.atsRingGood;
  if (score >= 45) return page.atsRingWarn;
  return page.atsRingBad;
}

function atsSeverityClass(sev) {
  if (sev === 'good') return page.sevGood;
  if (sev === 'warn') return page.sevWarn;
  if (sev === 'bad') return page.sevBad;
  if (sev === 'action') return page.sevAction;
  return page.sevInfo;
}

function severityLabel(sev) {
  return { good: 'OK', warn: 'Check', bad: 'Risk', action: 'Do', info: 'Note' }[sev] || 'Note';
}

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


// Some sources don't expose a trustworthy original-publish-date field (or
// only expose a "last synced/updated" timestamp that isn't the same thing) -
// posted_at is left null rather than backend fabricating a fake recent date,
// so this must say so plainly instead of computing a misleading "Xh ago".
// A7.3: timeAgo already returns the one canonical NO_DATE string.
const postedTimeAgo = timeAgo;

/*
 * A7.13 — say which filter emptied the result, and what relaxing it is worth.
 *
 * "No jobs match these filters" names every filter and blames none, so the
 * only move it leaves is to clear all of them. The server counts with each one
 * dropped and sends the real numbers; this turns them into a sentence.
 *
 * Every number here came from a COUNT. When the server found no single
 * responsible filter it says so - naming one anyway would send the user to
 * relax the wrong control, which is worse than the generic sentence it
 * replaced.
 */
function emptyReasonText({ emptyReason, keywords, noExactMatches, relatedTotal }) {
  const cause = emptyReason?.primary
    ? (emptyReason.filters || []).find((f) => f.key === emptyReason.primary)
    : null;

  if (cause) {
    const without = `${cause.label} is what emptied this - ${cause.withoutIt} ${cause.withoutIt === 1 ? 'job matches' : 'jobs match'} without it.`;
    return noExactMatches && relatedTotal > 0
      ? `No exact matches. ${without} Related jobs are below.`
      : `No jobs match. ${without}`;
  }

  if (emptyReason && Array.isArray(emptyReason.filters) && emptyReason.filters.length > 0) {
    return 'No jobs match, and no single filter explains it - the combination is what empties the result. Try removing two at once.';
  }

  if (noExactMatches) {
    return `No exact matches for "${keywords.join(', ')}".${relatedTotal > 0 ? ' See related jobs below, or search a different title.' : ' Try a different search term.'}`;
  }
  return 'No jobs found. Try a different search term.';
}

export default function Jobs() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [jobs, setJobs] = useState([]);
  /*
   * A2c — null is "not asked yet", 0 is "the server said none".
   * This was useState(0), so the first paint rendered "0 results" against a
   * database of 23,949 jobs, and a failed search rendered the same thing.
   */
  const [total, setTotal] = useState(null);
  const [jobsError, setJobsError] = useState(null);
  // A7.1 — the floor and the ranking mode are the user's, and both are visible.
  const [rankMode, setRankMode] = useState('ranked');
  const [sortBy, setSortBy] = useState(null); // null = follow the server default
  const [minScore, setMinScore] = useState(0.4);
  const [ranking, setRanking] = useState(null);
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
  const [regions, setRegions] = useState([]);
  const [facets, setFacets] = useState(null);
  const [atsScores, setAtsScores] = useState({});
  const [hasResume, setHasResume] = useState(true);
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
  const [relatedTotal, setRelatedTotal] = useState(null);
  // A7.13 — which filter emptied the result, with a real count per filter.
  const [emptyReason, setEmptyReason] = useState(null);
  const [excludedUnknownDateCount, setExcludedUnknownDateCount] = useState(null);

  const base = API_BASE;

  // Scored in one batch per page rather than per row. Failure is silent by
  // design: an ATS score is supplementary, and a scoring outage shouldn't stop
  // the job list itself from rendering.
  const loadAtsScores = useCallback(async (jobList, authToken) => {
    const ids = (jobList || []).map((j) => j.id).filter(Boolean);
    if (!ids.length) return;
    try {
      const res = await fetch(`${base}/api/jobs/ats-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ jobIds: ids }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setHasResume(data.hasResume !== false);
      setAtsScores((prev) => ({ ...prev, ...(data.scores || {}) }));
    } catch (err) {
      // Non-fatal - rows simply render without an ATS badge.
    }
  }, [base]);

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
      const rg = params.regions ?? regions;
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
      rg.forEach((v) => v && qs.append('region', v));
      if (co) qs.set('company', co);
      // Score ranking is the default; `recent` is the explicit unranked browse.
      /*
       * A7.7 — sort and ranked are separate. Choosing "newest" must not throw
       * away the scores; it changes the order of the same personalised set.
       *
       * Read through params first, like every other control on this page.
       * Setting state alone does not refetch here - loadJobs is called
       * explicitly by each control - so a button that only calls its setter
       * silently does nothing.
       */
      const rMode = params.rankMode ?? rankMode;
      const srt = params.sortBy ?? sortBy;
      const floor = params.minScore ?? minScore;
      if (rMode !== 'ranked') qs.set('ranked', '0');
      if (srt) qs.set('sort', srt);
      if (rMode === 'ranked') qs.set('minScore', String(floor));

      const [jobsRes, appsRes, matchesRes, sourcesRes, savedRes] = await Promise.all([
        // A7.1: this call sent no Authorization header, so /api/jobs could not
        // know whose feed it was building and fell back to posted_at DESC.
        // That single omission is why "View all jobs" left the scored product.
        fetch(`${base}/api/jobs?${qs.toString()}`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/applications`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/matches?limit=100`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/jobs/sources`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/jobs/saved/list`, { headers: { Authorization: `Bearer ${authToken}` } }),
      ]);

      if (jobsRes.ok) {
        const data = await jobsRes.json();
        setJobs(data.jobs || []);
        loadAtsScores(data.jobs || [], authToken);
        setJobsError(null);
        setRanking(data.ranking || null);
        // `|| 0` would turn a missing total into a confident zero.
        setTotal(typeof data.total === 'number' ? data.total : null);
        setNoExactMatches(!!data.noExactMatches);
        setRelatedJobs(data.relatedJobs || []);
        setRelatedTotal(typeof data.relatedTotal === 'number' ? data.relatedTotal : null);
        setEmptyReason(data.emptyReason || null);
        setExcludedUnknownDateCount(typeof data.excludedUnknownDateCount === 'number' ? data.excludedUnknownDateCount : null);
      } else {
        // Never silently keep showing a stale/previous result set on
        // failure - that reads as "search is broken and ignoring me".
        setJobs([]);
        // Not 0: the count is unknown after a failure, not zero.
        setTotal(null);
        setJobsError(`The job search did not answer (${jobsRes.status}).`);
        setNoExactMatches(false);
        setEmptyReason(null);
        setRelatedJobs([]);
        setExcludedUnknownDateCount(null);
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
  }, [base, page_, keywords, excludeTerms, scope, experience, location, includeRelated, datePosted, jobTypes, workArrangements, salary, company, rankMode, sortBy, minScore, loadAtsScores]);

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

    // Restore the full search from the URL. ?search=X is the header ⌘K
    // shortcut's shape and is folded into keywords.
    const q = { ...router.query };
    if (q.search && !q.keywords) q.keywords = [String(q.search)];
    restoreFromQuery(q, authToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  /*
   * Search state lives in the URL, not only in React state.
   *
   * Previously keywords/page/filters existed solely in component state, so
   * paging forward and pressing Back - or refreshing, or opening a job and
   * returning - dropped the search and silently reset to page 1 of everything.
   * Writing it to the query string makes Back/Forward restore the exact result
   * set and makes a search shareable.
   */
  const buildQuery = (o = {}) => {
    const q = {};
    const kws = o.keywords ?? keywords;
    const excl = o.excludeTerms ?? excludeTerms;
    const jt = o.jobTypes ?? jobTypes;
    const wa = o.workArrangements ?? workArrangements;
    const sal = o.salary ?? salary;
    const rg = o.regions ?? regions;
    const pg = o.page ?? page_;
    const scp = o.scope ?? scope;
    const exp = o.experience ?? experience;
    const loc = o.location ?? location;
    const dp = o.datePosted ?? datePosted;
    const co = o.company ?? company;
    const rel = o.includeRelated ?? includeRelated;
    const saved = o.showSavedOnly ?? showSavedOnly;

    if (kws.length) q.keywords = kws;
    if (excl.length) q.exclude = excl;
    if (jt.length) q.jobType = jt;
    if (wa.length) q.workArrangement = wa;
    if (sal.length) q.salary = sal;
    if (rg.length) q.region = rg;
    if (pg > 1) q.page = String(pg);
    if (scp && scp !== 'title_description') q.scope = scp;
    if (exp) q.experience = exp;
    if (loc) q.location = loc;
    if (dp) q.datePosted = dp;
    if (co) q.company = co;
    if (rel) q.includeRelated = 'true';
    if (saved) q.saved = 'true';
    return q;
  };

  // shallow: true - the URL changes without re-running getServerSideProps or
  // remounting; loadJobs is driven explicitly by the caller instead.
  //
  // selfPush guards against the routeChangeComplete handler above reacting to
  // our own push and redundantly re-restoring (and re-fetching) what we just
  // applied. Only genuine history navigation should trigger a restore.
  const selfPush = useRef(false);
  const syncUrl = (o = {}) => {
    selfPush.current = true;
    router.push({ pathname: '/jobs', query: buildQuery(o) }, undefined, { shallow: true })
      .finally(() => { selfPush.current = false; });
  };

  const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

  // Reads the query string back into state. Used on first load and whenever
  // the user navigates history.
  const restoreFromQuery = useCallback((q, authToken) => {
    const kws = asArray(q.keywords);
    const excl = asArray(q.exclude);
    const jt = asArray(q.jobType);
    const wa = asArray(q.workArrangement);
    const sal = asArray(q.salary);
    const rg = asArray(q.region);
    const pg = Math.max(1, parseInt(q.page, 10) || 1);
    const scp = q.scope || 'title_description';
    const exp = q.experience || '';
    const loc = q.location || '';
    const dp = q.datePosted || '';
    const co = q.company || '';
    const rel = q.includeRelated === 'true';
    const saved = q.saved === 'true';

    setKeywords(kws); setExcludeTerms(excl); setJobTypes(jt);
    setWorkArrangements(wa); setSalary(sal); setRegions(rg);
    setPage(pg); setScope(scp); setExperience(exp); setLocation(loc);
    setDatePosted(dp); setCompany(co); setIncludeRelated(rel); setShowSavedOnly(saved);

    loadJobs(authToken, {
      page: pg, keywords: kws, excludeTerms: excl, jobTypes: jt,
      workArrangements: wa, salary: sal, regions: rg, scope: scp,
      experience: exp, location: loc, datePosted: dp, company: co,
      includeRelated: rel,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadJobs]);

  const MULTI_KEYS = ['keywords', 'exclude', 'jobType', 'workArrangement', 'salary', 'region'];

  const queryFromSearch = (search) => {
    const sp = new URLSearchParams(search);
    const q = {};
    for (const [k, v] of sp.entries()) q[k] = v;
    // URLSearchParams entries() collapses repeated keys to the last value, so
    // the multi-select facets have to be read with getAll.
    MULTI_KEYS.forEach((k) => {
      const all = sp.getAll(k);
      if (all.length) q[k] = all;
    });
    return q;
  };

  /*
   * Back / Forward restore.
   *
   * Driven off router.events rather than a raw popstate listener. The listener
   * version read window.location at fire time, which meant a popstate arriving
   * while the URL was mid-transition (or already on another page) restored an
   * empty query and silently wiped the user's search - the chips vanished while
   * the results stayed filtered. routeChangeComplete hands us the destination
   * URL directly, and the /jobs guard stops us reacting to navigations away.
   */
  useEffect(() => {
    if (!token) return undefined;
    const onRouteChange = (url) => {
      const [path, search = ''] = String(url).split('?');
      if (path !== '/jobs') return;
      if (selfPush.current) return;
      restoreFromQuery(queryFromSearch(search), token);
    };
    router.events.on('routeChangeComplete', onRouteChange);
    return () => router.events.off('routeChangeComplete', onRouteChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, restoreFromQuery]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    syncUrl({ page: 1 });
    loadJobs(token, { page: 1 });
  };

  const goToPage = (p) => {
    setPage(p);
    syncUrl({ page: p });
    loadJobs(token, { page: p });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleShowRelated = () => {
    setIncludeRelated(true);
    setPage(1);
    loadJobs(token, { page: 1, includeRelated: true });
  };

  // Queues jobs for real submission: the backend prepares a tailored resume,
  // cover letter and pre-filled answers, then the Apply Queue review screen is
  // the approval gate before the extension submits on the employer's site.
  const handleQueue = async (jobIds) => {
    const ids = Array.isArray(jobIds) ? jobIds : [jobIds];
    setMessage('');
    try {
      const res = await fetch(`${base}/api/apply/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jobIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || 'Could not prepare the application');
        return;
      }
      setAppliedIds((prev) => {
        const next = new Set(prev);
        data.items.forEach((i) => next.add(i.jobId));
        return next;
      });
      setSelectedIds(new Set());
      const skipped = data.skipped?.length
        ? ` ${data.skipped.length} already in your queue or tracker.`
        : '';
      setMessage(
        `Prepared ${data.queued} application${data.queued === 1 ? '' : 's'} - review and approve in your Apply Queue.${skipped}`
      );
    } catch (err) {
      setMessage('Could not prepare the application. Please try again.');
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
    // The ranked feed carries the score on the row itself; matchByJobId is the
    // fallback for the unranked browse, where only the top-100 are annotated.
    const match = matchByJobId[job.id];
    const rawScore = job.overall_score ?? match?.overall_score ?? null;
    const score = rawScore === null || rawScore === undefined ? null : Math.round(Number(rawScore) * 100);
    return (
      <div key={job.id} className={page.jobRow}>
        {/* A7.6 - this had no accessible name of any kind: no id, no label, no
            aria-label, no title. Twenty rows announced as "checkbox, unchecked"
            with nothing to tell them apart, so the bulk control was fully
            usable by sight and unusable otherwise. The name is built from the
            same two strings the row shows, through the same parsedOr, so the
            spoken name and the visible one cannot drift. */}
        <input
          type="checkbox"
          checked={selectedIds.has(job.id)}
          onChange={() => toggleSelect(job.id)}
          className={page.checkbox}
          aria-label={`Select ${job.title} at ${parsedOr(job.company_name, 'Company not stated')}`}
        />
        <div className={page.avatar}>{job.company_name?.charAt(0) || '?'}</div>
        <div className={page.jobInfo} onClick={() => setSelectedJob(job)}>
          <p className={page.jobTitle}>{job.title}</p>
          <p className={page.jobSubtitle}>{parsedOr(job.company_name, 'Company not stated')}</p>
          <p className={page.jobMeta}>
            {job.location || 'Remote'}
            {job.salary_min ? ` · ${formatSalary(job)}` : ''}
            {' · '}{postedTimeAgo(job.posted_at)}
          </p>
        </div>
        {/* The ATS badge lives in the drawer now. It answers "how well does my
            resume's wording match this posting" - a question you ask about one
            job you are considering, not about twenty you are scanning past. */}
        {/* A7.1 — a bare "75" is not a score, it is a number; the % carries the
            meaning. Kept to ONE line: .scoreRing is a fixed 2.5rem flex circle,
            so a second child becomes a sibling flex item and spills out of the
            ring across the actions beside it. */}
        {score !== null && (
          <div className={page.scoreRing} title="Profile match score: skills, experience and location">{score}%</div>
        )}
        <div className={page.jobActions}>
          <button className={page.viewButton} onClick={() => setSelectedJob(job)}>View Details</button>
          {appliedIds.has(job.id) ? (
            <span className={page.appliedBadge}>In queue</span>
          ) : (
            <button
              className={page.applyButton}
              onClick={() => handleQueue(job.id)}
              title="Queues this with a tailored resume, cover letter and pre-filled answers. The extension fills and submits it."
            >
              Apply Now
            </button>
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
            onApply={(vals) => { setJobTypes(vals); setPage(1); syncUrl({ page: 1, jobTypes: vals }); loadJobs(token, { page: 1, jobTypes: vals }); }}
          />

          {/* Region groups the free-text location into continents. Derived on
              the server from the location string, because jobs.country is
              populated on under a quarter of rows. India is its own bucket
              rather than being buried inside Asia-Pacific. */}
          <FilterPanel
            label="Location"
            hint="Grouped by region. Postings that only say Remote or Hybrid fall under Not specified."
            selected={regions}
            allOption={{
              label: 'All regions',
              count: (facets?.region || []).reduce((n, o) => n + o.count, 0),
            }}
            options={(facets?.region || []).map((o) => ({
              value: o.value,
              label: o.label || o.value,
              count: o.count,
            }))}
            onApply={(vals) => {
              setRegions(vals);
              setPage(1);
              syncUrl({ page: 1, regions: vals });
              loadJobs(token, { page: 1, regions: vals });
            }}
          />

          <FilterPanel
            label="Workplace"
            selected={workArrangements}
            options={(facets?.workArrangement || []).map((o) => ({
              value: o.value,
              label: o.value.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
              count: o.count,
            }))}
            onApply={(vals) => { setWorkArrangements(vals); setPage(1); syncUrl({ page: 1, workArrangements: vals }); loadJobs(token, { page: 1, workArrangements: vals }); }}
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
            onApply={(vals) => { setSalary(vals); setPage(1); syncUrl({ page: 1, salary: vals }); loadJobs(token, { page: 1, salary: vals }); }}
          />
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company"
            className={page.locInput}
          />
          {(experience || location || datePosted || jobTypes.length || workArrangements.length || salary.length || regions.length || company) && (
            <button
              type="button"
              className={page.clearFiltersButton}
              onClick={() => {
                setExperience(''); setLocation(''); setDatePosted('');
                setJobTypes([]); setWorkArrangements([]); setSalary([]);
                setRegions([]); setCompany('');
                setPage(1);
                const cleared = {
                  page: 1, experience: '', location: '', datePosted: '',
                  jobTypes: [], workArrangements: [], salary: [], regions: [], company: '',
                };
                // Keywords survive a filter clear - clearing filters is not the
                // same action as clearing the search.
                syncUrl(cleared);
                loadJobs(token, cleared);
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {/*
          * A7.1 — the ranking and its floor are stated, not silent. A user
          * seeing 300 results out of 23,958 is entitled to know a filter is
          * doing that, and to move it.
          */}
        <div className={page.rankBar}>
          <div className={page.rankModes}>
            <button
              type="button"
              className={(ranking?.sort || 'score') === 'score' ? page.rankOn : page.rankOff}
              onClick={() => { setSortBy('score'); setPage(1); loadJobs(token, { page: 1, sortBy: 'score' }); }}
            >
              Best match
            </button>
            <button
              type="button"
              className={ranking?.sort === 'recent' ? page.rankOn : page.rankOff}
              onClick={() => { setSortBy('recent'); setPage(1); loadJobs(token, { page: 1, sortBy: 'recent' }); }}
            >
              Newest first
            </button>
            <button
              type="button"
              className={rankMode === 'ranked' ? page.rankOff : page.rankOn}
              onClick={() => {
                const next = rankMode === 'ranked' ? 'all' : 'ranked';
                setRankMode(next); setPage(1);
                loadJobs(token, { page: 1, rankMode: next });
              }}
              title="Every indexed job, not scored against your profile"
            >
              {rankMode === 'ranked' ? 'Browse all jobs' : 'Back to my matches'}
            </button>
          </div>
          {rankMode === 'ranked' ? (
            <label className={page.floorControl}>
              <span>
                {ranking?.sort === 'recent'
                  ? 'Newest first, then best match'
                  : 'Best match first, ties broken by newest'}
                {' · '}Only show matches above {Math.round(minScore * 100)}%
              </span>
              <input
                type="range"
                min="0" max="0.9" step="0.05"
                value={minScore}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMinScore(v); setPage(1);
                  loadJobs(token, { page: 1, minScore: v });
                }}
              />
            </label>
          ) : (
            <span className={page.floorNote}>
              Unranked. Every indexed job, newest first - not scored against your profile.
            </span>
          )}
          {/* A7.17 - before the ranking paths were collapsed, a date filter ran
              inside the 500-row match store, so every row it could return was
              already scored and this state never existed. It now searches the
              whole index, which surfaces jobs newer than the last scoring run.
              Showing a page of cards with no score and no explanation reads as
              a bug; the floor keeps them deliberately, so say that. */}
          {rankMode === 'ranked' && ranking?.unscoredInPage > 0 && (
            <span className={page.floorNote}>
              {ranking.unscoredInPage} on this page {ranking.unscoredInPage === 1 ? 'is' : 'are'} not
              scored yet - newer than your last match run. The {Math.round(minScore * 100)}% floor
              cannot judge them, so they are kept rather than hidden.
            </span>
          )}
        </div>

        <div className={page.headerRow}>
          <h1 className={styles.greeting} style={{ margin: 0 }}>Jobs</h1>
          <span className={page.resultsCount}>
            {showSavedOnly
              ? countText({ value: savedIds.size, unit: 'saved', zeroText: 'No saved jobs' }).text
              : countText({
                  value: total,
                  loading,
                  error: jobsError,
                  unit: 'results',
                  /*
                   * A7.13 — this said "No jobs match these filters" while a
                   * related job was rendered directly below it. Both were on
                   * screen at once and a reader can only believe one. `total`
                   * counts exact matches; when related results are showing,
                   * the line has to say which number it is quoting.
                   */
                  zeroText: relatedTotal > 0
                    ? `No exact matches · ${relatedTotal} related`
                    : 'No jobs match these filters',
                  errorText: 'Result count unavailable',
                }).text}
          </span>
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
          {/* A7.14 - not every source in this list is live, and calling the
              whole row "Live sources" made the one that isn't unreadable. */}
          <span className={page.liveLabel}>⚡ Sources</span>
          {sources.map((s) => {
            /* The dot used to key off `count > 0`, which is wrong in both
               directions: a source that died overnight still has yesterday's
               rows and read as active, while a working source that matched
               nothing read as dead. Status comes from the server now. */
            const title = s.status === 'not_connected'
              ? 'Not fetched: this board is behind bot protection, and we do not circumvent it. See SOURCES.md.'
              : s.lastRunError
                ? `Last run failed: ${s.lastRunError}`
                : s.successRatePct != null
                  ? `${s.successRatePct}% success rate (last 20 runs)${s.lastRunDurationMs ? ` · ${Math.round(s.lastRunDurationMs / 1000)}s last run` : ''}`
                  : undefined;
            const detail = s.status === 'not_connected'
              // No count, because nothing counted it. "0" would read as measured.
              ? 'not connected'
              : s.status === 'never_run'
                ? `${s.count} · never fetched`
                : s.status === 'failing'
                  ? `${s.count} · last fetch failed`
                  : `${s.count} · ${fetchedAgo(s.lastFetched)}`;
            return (
              <span key={s.source} className={page.sourceItem} title={title}>
                <span
                  className={
                    s.status === 'live'
                      ? page.sourceDotActive
                      : s.status === 'failing'
                        ? page.sourceDotInactive
                        : page.sourceDotOff
                  }
                />
                {sourceLabels[s.source] || s.source} ({detail})
              </span>
            );
          })}
        </div>

        {message && <div className={page.message}>{message}</div>}

        {selectedIds.size > 0 && (
          <div className={page.bulkBar}>
            <span>
              {selectedIds.size} job{selectedIds.size === 1 ? '' : 's'} selected
            </span>
            <div className={page.bulkActions}>
              <button
                className={page.bulkPrimary}
                onClick={() => handleQueue(Array.from(selectedIds))}
              >
                Prepare {selectedIds.size} application{selectedIds.size === 1 ? '' : 's'}
              </button>
              <button className={page.bulkGhost} onClick={() => setSelectedIds(new Set())}>
                Clear
              </button>
            </div>
          </div>
        )}

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
                : emptyReasonText({ emptyReason, keywords, noExactMatches, relatedTotal })}
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
          atsScore={atsScores[selectedJob.id]}
          saved={savedIds.has(selectedJob.id)}
          onToggleSave={() => toggleSave(selectedJob)}
          applied={appliedIds.has(selectedJob.id)}
          onClose={() => setSelectedJob(null)}
          onApply={() => { handleQueue(selectedJob.id); }}
          token={token}
          base={base}
          router={router}
        />
      )}
    </>
  );
}

function JobDetailDrawer({ job, match, atsScore, saved, onToggleSave, applied, onClose, onApply, token, base, router }) {
  // apply_url points at the ATS form where we have one; job_url can be the
  // company careers page, which is not always the application itself.
  const applyUrl = job.apply_url || job.job_url;
  const [tailoring, setTailoring] = useState(false);
  const [tailorResult, setTailorResult] = useState(null);
  const [recruiter, setRecruiter] = useState(null);
  const [detail, setDetail] = useState(null);
  const [ats, setAts] = useState(null);
  const [recruiterLoading, setRecruiterLoading] = useState(true);
  const [recruiterAdded, setRecruiterAdded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRecruiter(null);
    // Clear too, or the previously-opened job's skills/experience linger in
    // the meta grid until the new fetch resolves.
    setDetail(null);
    setAts(null);
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

    async function loadAts() {
      try {
        const res = await fetch(`${base}/api/jobs/${job.id}/ats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setAts(data);
      } catch (err) {
        // Leave the section in its loading state rather than asserting a score.
      }
    }

    loadAts();
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

  const region = regionFor(job.location);

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <div>
            <p className={styles.drawerKicker}>{job.job_type ? titleCase(job.job_type) : 'Role'}</p>
            <h2 className={styles.drawerTitle}>{job.title}</h2>
            <p className={styles.drawerSubtitle}>
              <span className={styles.drawerAvatar}>{job.company_name?.charAt(0) || '?'}</span>
              {parsedOr(job.company_name, 'Company not stated')}
            </p>
            {/* ATS coverage belongs to one posting you are considering, not to a
                list you are scanning. It measures how much of THIS posting's
                wording appears in your resume - a different question from the
                profile match score, so it is labelled rather than left as a
                bare number next to another bare number. */}
            {atsScore !== undefined && atsScore !== null && (
              <p className={styles.drawerAts} title="Share of this posting's meaningful terms that appear in your resume.">
                <span className={styles.drawerAtsLabel}>ATS match</span>
                <strong>{atsScore}%</strong>
                <span className={styles.drawerAtsHint}>
                  of this posting&apos;s terms appear in your resume
                </span>
              </p>
            )}
          </div>
          <div className={styles.drawerHeadActions}>
            {/* Saving moved here with the star's removal from the card. The
                "Saved jobs" filter still exists, so dropping the only way to
                add to it would have left a filter for something you could no
                longer do. */}
            <button
              className={saved ? styles.drawerSavedOn : styles.drawerSaved}
              onClick={onToggleSave}
              aria-label={saved ? 'Remove from saved jobs' : 'Save this job'}
              title={saved ? 'Remove from saved jobs' : 'Save this job'}
            >
              {saved ? '★' : '☆'}
            </button>
            <a
              className={styles.drawerExternal}
              href={applyUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open original posting in a new tab"
              title="Open original posting"
            >&#8599;</a>
            <button className={styles.drawerClose} onClick={onClose} aria-label="Close">&times;</button>
          </div>
        </div>

        <dl className={styles.metaList}>
          <div className={styles.metaRow}><dt>Company</dt><dd>{parsedOr(job.company_name, 'Company not stated')}</dd></div>
          <div className={styles.metaRow}><dt>Location</dt><dd>{job.location || 'Not specified'}</dd></div>
          <div className={styles.metaRow}><dt>Region</dt><dd>{region}</dd></div>
          <div className={styles.metaRow}>
            <dt>Posted</dt>
            <dd>
              {/* A7.3: NO_DATE is the one canonical string for this state. */}
              {job.posted_at ? formatDate(job.posted_at) : NO_DATE}
            </dd>
          </div>
          <div className={styles.metaRow}><dt>Source</dt><dd>{sourceLabels[job.source] || job.source}</dd></div>
          {job.salary_min ? (
            <div className={styles.metaRow}><dt>Salary</dt><dd>{formatSalary(job)}</dd></div>
          ) : null}
        </dl>

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
                ? formatDate(job.posted_at)
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

        <h3 className={styles.drawerSectionTitle}>ATS keyword check</h3>
        {ats === null ? (
          <p className={styles.drawerText}>Checking your resume against this posting&hellip;</p>
        ) : ats.hasResume === false ? (
          <p className={styles.drawerText}>{ats.message}</p>
        ) : (
          <>
            <div className={page.atsHeadRow}>
              <div className={atsRingClass(ats.score)}>{ats.score}%</div>
              <p className={page.atsHeadText}>
                {/* matchedCount, not matched.length - the word list is trimmed
                    for payload size, so counting it would under-report and
                    contradict the score shown alongside. */}
                {ats.matchedCount ?? ats.matched?.length ?? 0} of {ats.totalKeywords} meaningful
                terms in this posting also appear in your resume.
              </p>
            </div>

            <div className={page.atsGuide}>
              {(ats.guide || []).map((g, i) => (
                <div key={i} className={page.atsGuideItem}>
                  <span className={atsSeverityClass(g.severity)}>{severityLabel(g.severity)}</span>
                  <div>
                    <p className={page.atsGuideTitle}>{g.title}</p>
                    <p className={page.atsGuideDetail}>{g.detail}</p>
                    {g.note && <p className={page.atsGuideNote}>{g.note}</p>}
                  </div>
                </div>
              ))}
            </div>

            {ats.missing?.length > 0 && (
              <>
                {/* State the truncation. A bare "Missing terms" above 18 chips
                    reads as the complete list when there may be hundreds. */}
                <p className={page.atsSubhead}>
                  Missing terms
                  {(ats.missingCount ?? ats.missing.length) > 18
                    && ` — showing 18 of ${ats.missingCount ?? ats.missing.length}`}
                </p>
                <div className={page.skillChips}>
                  {ats.missing.slice(0, 18).map((m) => (
                    <span key={m} className={page.atsMissingChip}>{m}</span>
                  ))}
                </div>
              </>
            )}
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
        {/* The jobs list endpoint omits description to keep the payload small,
            so this reads the drawer's own /api/jobs/:id fetch. Rendered as
            paragraphs: rows ingested before the stripHtml fix arrived with no
            newlines at all, so they are also split on sentence boundaries. */}
        <div className={styles.drawerBody}>
          {decodeLegacyEntities(
            (detail && detail.description) || job.description
            || (detail === null ? 'Loading posting\u2026' : 'No description available.')
          )
            .split(/\n+/)
            .flatMap((block) => {
              const t = block.trim();
              if (!t) return [];
              if (t.length < 320) return [t];
              return t.split(/(?<=[.!?:])\s+(?=[A-Z])/).map((x) => x.trim()).filter(Boolean);
            })
            .slice(0, 120)
            .map((para, i) => <p key={i}>{para}</p>)}
        </div>

        {(detail?.requirements || job.requirements) && (
          <>
            <h3 className={styles.drawerSectionTitle}>Requirements</h3>
            <div className={styles.drawerBody}>
              {decodeLegacyEntities(detail?.requirements || job.requirements)
                .split(/\n+/).map((t) => t.trim()).filter(Boolean).slice(0, 60)
                .map((para, i) => <p key={i}>{para}</p>)}
            </div>
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
            <span className={styles.appliedTag}>Tracked</span>
          ) : (
            // Same wording as the card, so the drawer is not offering a
            // differently-named version of the same action.
            <button className={styles.primaryBtn} onClick={onApply}>Apply Now</button>
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
            <Link href="/resume" className={styles.secondaryBtn} style={{ display: 'inline-block', marginTop: '0.5rem' }}>
              Review full diff &amp; download on Resume page
            </Link>
          </div>
        )}
        {tailorResult?.error && <p className={styles.errorText}>{tailorResult.error}</p>}
      </div>
    </div>
  );
}
