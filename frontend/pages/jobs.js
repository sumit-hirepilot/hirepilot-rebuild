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
                <span className={page.filterOptionCount}>{allOption.count.toLocaleString()}</span>
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

/*
 * Which hosts can be shown in the preview pane.
 *
 * Checked against live response headers rather than assumed: Greenhouse and
 * Lever send no frame-ancestors and no X-Frame-Options, so they embed. Ashby
 * sends X-Frame-Options: DENY and company careers domains typically send
 * SAMEORIGIN, so those would render an empty frame - they get a content preview
 * built from the posting we already hold instead of a blank box.
 */
const EMBEDDABLE_HOSTS = /(^|\.)(job-boards\.greenhouse\.io|boards\.greenhouse\.io|jobs\.lever\.co)$/i;

function canEmbed(url) {
  try {
    return EMBEDDABLE_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

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

// Thresholds match the bands buildAtsGuide() uses on the backend, so the badge
// colour never disagrees with the written verdict inside the drawer.
function atsBadgeClass(score) {
  if (score >= 70) return page.atsBadgeGood;
  if (score >= 45) return page.atsBadgeWarn;
  return page.atsBadgeBad;
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
  const [relatedTotal, setRelatedTotal] = useState(0);
  const [excludedUnknownDateCount, setExcludedUnknownDateCount] = useState(0);

  const base = process.env.NEXT_PUBLIC_API_URL;

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
        loadAtsScores(data.jobs || [], authToken);
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
  }, [base, page_, keywords, excludeTerms, scope, experience, location, includeRelated, datePosted, jobTypes, workArrangements, salary, company, loadAtsScores]);

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
          <div className={page.scoreRing} title="Profile match score: skills, experience and location">{score}</div>
        )}
        {/* ATS keyword coverage is a different measure from the match score
            above: match compares your profile to the role, this compares your
            resume's wording to this posting's wording. Both are shown so a
            strong profile fit with weak keyword coverage is visible. */}
        {atsScores[job.id] !== undefined && (
          <div
            className={atsBadgeClass(atsScores[job.id])}
            title={`ATS keyword coverage: ${atsScores[job.id]}% of this posting's meaningful terms appear in your resume. Open the job for the full breakdown.`}
          >
            <span className={page.atsBadgeLabel}>ATS</span>
            {atsScores[job.id]}%
          </div>
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
            <span className={page.appliedBadge}>In queue</span>
          ) : (
            <button className={page.applyButton} onClick={() => handleQueue(job.id)} title="Prepares a tailored resume, cover letter and pre-filled answers, then waits for your approval in the Apply Queue before anything is submitted.">Prepare application</button>
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
          onApply={() => { handleQueue(selectedJob.id); }}
          token={token}
          base={base}
          router={router}
          onPrev={(() => {
            const list = showSavedOnly ? savedJobs : jobs;
            const i = list.findIndex((j) => j.id === selectedJob.id);
            return i > 0 ? () => setSelectedJob(list[i - 1]) : null;
          })()}
          onNext={(() => {
            const list = showSavedOnly ? savedJobs : jobs;
            const i = list.findIndex((j) => j.id === selectedJob.id);
            return i > -1 && i < list.length - 1 ? () => setSelectedJob(list[i + 1]) : null;
          })()}
        />
      )}
    </>
  );
}

function JobDetailDrawer({ job, match, applied, onClose, onApply, token, base, router, onPrev, onNext }) {
  /*
   * Preview pane.
   *
   * Default is a rendering of the posting HirePilot already holds, NOT an
   * iframe. Framing a third-party ATS is unreliable in practice: Ashby sends
   * X-Frame-Options: DENY, company careers domains send SAMEORIGIN, and even
   * where headers permit it the page can render blank. A blank white panel is
   * worse than no preview, so the live page is opt-in via "Load live page" and
   * only offered for hosts that actually allow framing.
   */
  const [showLive, setShowLive] = useState(false);
  const previewUrl = job.apply_url || job.job_url;
  const embeddable = canEmbed(previewUrl);
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
    setShowLive(false);
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
    <div className={styles.previewOverlay} onClick={onClose}>
      {/* Left: the live posting where the ATS allows framing, otherwise a
          preview built from the posting text we already hold. Never an empty
          frame - Ashby and company careers domains refuse to be embedded. */}
      <div className={styles.previewPane} onClick={(e) => e.stopPropagation()}>
        {onPrev && (
          <button className={styles.previewNavPrev} onClick={onPrev} aria-label="Previous job">&larr;</button>
        )}
        <div className={styles.previewFrame}>
          {embeddable && showLive ? (
            <iframe
              key={previewUrl}
              src={previewUrl}
              title={`${job.title} at ${job.company_name}`}
              className={styles.previewIframe}
              /*
               * allow-same-origin is required, not optional: these boards are
               * React apps that read their own origin's storage on boot, and
               * without it the frame renders blank white. It grants the frame
               * access to ITS own origin (greenhouse.io), not to HirePilot -
               * the document is cross-origin either way, so this does not
               * expose anything of ours. allow-top-navigation is deliberately
               * withheld so the embedded page cannot navigate the whole tab.
               */
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              referrerPolicy="no-referrer-when-downgrade"
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <div className={styles.previewFallback}>
              <div className={styles.previewFallbackHead}>
                <span className={styles.previewAvatar}>{job.company_name?.charAt(0) || '?'}</span>
                <div>
                  <p className={styles.previewFallbackTitle}>{job.title}</p>
                  <p className={styles.previewFallbackCo}>
                    {job.company_name}
                    {job.location ? ` · ${job.location}` : ''}
                  </p>
                </div>
                <div className={styles.previewToolbar}>
                  {embeddable && (
                    <button
                      type="button"
                      className={styles.previewLiveBtn}
                      onClick={() => setShowLive(true)}
                    >
                      Load live page
                    </button>
                  )}
                  <a
                    className={styles.previewOpenBtn}
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open original &#8599;
                  </a>
                </div>
              </div>
              <div className={styles.previewFallbackBody}>
                {/* The list endpoint omits description to keep the payload
                    small; the drawer's own /api/jobs/:id fetch carries it. */}
                {decodeLegacyEntities((detail && detail.description) || job.description
                  || (detail === null ? 'Loading posting\u2026' : 'No description was published for this role.'))
                  // Rows ingested before the stripHtml fix have no newlines at
                  // all (it used to collapse every whitespace run), so fall back
                  // to sentence-boundary splitting for those rather than
                  // rewriting 13,869 rows on a nearly-full volume.
                  .split(/\n+/).flatMap((block) => {
                    const t = block.trim();
                    if (!t) return [];
                    if (t.length < 320) return [t];
                    // Break before a capitalised word that follows sentence-end
                    // punctuation - conservative enough not to split mid-acronym.
                    return t.split(/(?<=[.!?:])\s+(?=[A-Z])/).map((x) => x.trim()).filter(Boolean);
                  })
                  .slice(0, 120).map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
              </div>
              <p className={styles.previewFallbackNote}>
                Posting text as HirePilot ingested it from{' '}
                {sourceLabels[job.source] || job.source}
                {embeddable
                  ? '. "Load live page" embeds the employer\u2019s own page instead.'
                  : `. ${job.company_name} does not allow its pages to be embedded, so open the original to see it on their site.`}
              </p>
            </div>
          )}
        </div>
        {embeddable && showLive && (
          <button
            type="button"
            className={styles.previewBackBtn}
            onClick={() => setShowLive(false)}
          >
            &larr; Back to posting text
          </button>
        )}
        {onNext && (
          <button className={styles.previewNavNext} onClick={onNext} aria-label="Next job">&rarr;</button>
        )}
      </div>

      {/* Right: the drawer */}
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <div>
            <p className={styles.drawerKicker}>{job.job_type ? titleCase(job.job_type) : 'Role'}</p>
            <h2 className={styles.drawerTitle}>{job.title}</h2>
            <p className={styles.drawerSubtitle}>
              <span className={styles.drawerAvatar}>{job.company_name?.charAt(0) || '?'}</span>
              {job.company_name}
            </p>
          </div>
          <div className={styles.drawerHeadActions}>
            <a
              className={styles.drawerExternal}
              href={previewUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open original posting in a new tab"
              title="Open original posting"
            >&#8599;</a>
            <button className={styles.drawerClose} onClick={onClose} aria-label="Close">&times;</button>
          </div>
        </div>

        <dl className={styles.metaList}>
          <div className={styles.metaRow}><dt>Company</dt><dd>{job.company_name}</dd></div>
          <div className={styles.metaRow}><dt>Location</dt><dd>{job.location || 'Not specified'}</dd></div>
          <div className={styles.metaRow}><dt>Region</dt><dd>{region}</dd></div>
          <div className={styles.metaRow}>
            <dt>Posted</dt>
            <dd>
              {job.posted_at
                ? new Date(job.posted_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                : 'Publication date unavailable'}
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
            <span className={styles.appliedTag}>Tracked</span>
          ) : (
            <button className={styles.primaryBtn} onClick={onApply}>Prepare application</button>
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
