import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import NeedsYouDrawer from '../components/NeedsYouDrawer';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/AutoApply.module.css';
import { API_BASE } from '../lib/apiBase';
import { parsedOr } from '../lib/renderState';

/*
 * Auto Apply.
 *
 * Set the filters once and the queue runs itself. There is no approval step and
 * no per-job Apply button - an application whose answers all resolve from the
 * profile is filled and submitted, and the only thing that stops it is a
 * question nobody has answered yet or something only a human can do.
 *
 * Three panels exist because they are the three questions someone actually has
 * before switching this on, and each is answered with real data rather than a
 * claim:
 *
 *   Reach    which of these postings can actually be automated, and which
 *            cannot - stated per ATS, up front, instead of discovered as a
 *            silent failure later
 *   Learning how much the profile already knows, so "it gets easier" is a
 *            number that moves rather than a promise
 *   Proof    every submission with the employer's own confirmation text, since
 *            Applied here means verified and nothing else sets it
 */

const BASE = API_BASE;

const QUALITY = [
  { id: 0.85, label: 'Excellent', hint: 'Only your strongest matches. Fewest applications, sharpest fit.' },
  { id: 0.7, label: 'Strong', hint: 'Clear matches with a gap or two. A good default.' },
  { id: 0.55, label: 'Good', hint: 'Reasonable matches. More volume, less precision.' },
  { id: 0.4, label: 'Stretch', hint: 'Anything plausible. Highest volume, lowest hit rate.' },
];

// Which platforms the extension can actually drive, and - just as importantly -
// which it cannot. Claiming coverage we do not have is how a queue silently
// fills with applications that were never sent.
const COVERAGE = [
  { name: 'Greenhouse', state: 'full', note: 'Verified end to end on a live posting' },
  { name: 'Lever', state: 'full', note: 'Adapter built; not yet verified on a live form' },
  { name: 'Ashby', state: 'full', note: 'Adapter built; not yet verified on a live form' },
  { name: 'Company career pages', state: 'partial', note: 'Works where the page embeds one of the above' },
  { name: 'Workday, Taleo, iCIMS', state: 'none', note: 'No adapter yet - queued and opened for you, never auto-submitted' },
];

const PAUSE_LABEL = {
  captcha: 'CAPTCHA',
  login: 'Sign-in',
  mfa: 'MFA / one-time code',
  consent: 'A consent box only you can tick',
  unmapped_required_field: 'A question not in your profile yet',
  final_submit: 'Waiting on your Submit click',
};

export default function AutoApply() {
  const router = useRouter();
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [queue, setQueue] = useState([]);
  const [counts, setCounts] = useState({});
  const [knowledge, setKnowledge] = useState(null);
  const [profile, setProfile] = useState(null);
  const [submitted, setSubmitted] = useState([]);
  const [matches, setMatches] = useState([]);
  const [matchTotal, setMatchTotal] = useState(null);
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async (t) => {
    const get = (p) => fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

    const [pf, q, kn, ap, sub, rn] = await Promise.all([
      get('/api/profile'), get('/api/apply/queue'), get('/api/apply/knowledge'),
      get('/api/apply/profile'), get('/api/apply/submitted'), get('/api/apply/runs/latest'),
    ]);

    /*
     * Every `get` above collapses a failure to null, and each setter below is
     * guarded by `if (x)`. That is fine for one panel going quiet, but when
     * the two that carry the user's own settings and counts both fail, the
     * page still renders its defaults - "0 queued to send", "10/day",
     * "Strong" - and a visitor reads those as their configuration. They were
     * never loaded. Say so instead.
     */
    setLoadError(!pf && !q
      ? 'Could not load your Auto Apply settings. The figures below are defaults, not your saved configuration.'
      : null);
    // Run progress is read from the server, not from the extension's in-memory
    // counters - those are evicted with the service worker and would blank the
    // display mid-batch.
    if (rn) setRun(rn.run);

    if (pf) setPrefs(pf.profile || pf);
    if (q) { setQueue(q.queue || []); setCounts(q.counts || {}); }
    if (kn) setKnowledge(kn.stats || kn);
    if (ap) setProfile(ap.profile || null);
    if (sub) setSubmitted(sub.submitted || []);

    /*
     * Scored matches, not the job feed. /api/jobs ignores minScore entirely, so
     * this panel was listing whatever came back - a Dutch customer-service role
     * and a journalism internship sat under "Next up" as though Auto Apply were
     * about to send them. The preview has to be the same set the filter selects,
     * or it is worse than showing nothing.
     */
    const minScore = (pf?.profile?.auto_apply_min_score ?? pf?.auto_apply_min_score) || 0.7;
    const m = await get(`/api/matches?limit=8&minScore=${minScore}`);
    setMatches(m?.matches || []);
    setMatchTotal(m?.total ?? null);
  }, []);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { router.replace('/login'); return; }
    setToken(t);
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch { /* stale */ }
    load(t);
    // Mount only. `router` in the dependency list changes identity on
    // navigation, and with `load` alongside it the effect's behaviour became
    // dependent on render timing rather than on mounting - the page rendered
    // its shell and never fetched anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePrefs = async (patch) => {
    setBusy(true);
    setNotice(null);
    const next = { ...(prefs?.preferences || prefs || {}), ...patch };
    setPrefs(next); // optimistic: these are toggles, and a lagging switch feels broken
    try {
      // /preferences, not /profile: PUT /api/profile updates the user row and
      // ignores these keys, so the filters would have saved into nothing.
      const res = await fetch(`${BASE}/api/profile/preferences`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoApplyEnabled: next.auto_apply_enabled,
          autoApplyLimitPerDay: next.auto_apply_limit_per_day,
          autoApplyMinScore: next.auto_apply_min_score,
        }),
      });
      if (!res.ok) throw new Error('Could not save that.');
      await load(token);
    } catch (err) {
      setNotice(err.message);
      await load(token);
    } finally {
      setBusy(false);
    }
  };

  /*
   * Render with defaults rather than hanging on a fetch.
   *
   * This returned a bare "Loading…" until prefs arrived, so ANY failure to
   * populate it - a shape that did not match, an effect that did not fire -
   * left the page permanently blank with no error and no way in. A settings
   * screen should show its controls and fill in values as they land, not
   * withhold itself until every request has answered.
   *
   * The preferences live under `preferences` on /api/profile; reading them off
   * the root object silently yielded undefined for every one.
   */
  const p = prefs?.preferences || prefs || {};
  const on = Boolean(p.auto_apply_enabled);
  const cap = p.auto_apply_limit_per_day ?? 10;
  const minScore = p.auto_apply_min_score ?? 0.7;
  const savedAnswers = Object.keys(profile?.custom_answers || {}).length;
  const blocked = queue.filter((q) => q.status === 'needs_user');
  const ready = counts.approved || 0;

  return (
    <DashboardLayout user={user}>
      <Head><title>Auto Apply - HirePilot</title></Head>

      {loadError && (
        <div className={page.loadError} role="alert">
          <p className={page.loadErrorTitle}>{loadError}</p>
          <button type="button" className={page.retryButton} onClick={() => load(token)}>
            Try again
          </button>
        </div>
      )}

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Auto Apply</h1>
          <p className={styles.pageSubtitle}>
            Set your filters once. HirePilot fills and submits matching applications
            in your own browser, and marks nothing as applied without the
            employer&apos;s confirmation.
          </p>
        </div>
        <button
          className={on ? page.toggleOn : page.toggleOff}
          onClick={() => savePrefs({ auto_apply_enabled: !on })}
          disabled={busy}
        >
          <span className={page.dot} />
          {on ? 'Auto Apply is on' : 'Turn on Auto Apply'}
        </button>
      </div>

      {notice && <div className={page.notice}>{notice}</div>}

      {/* Live state first. What it is doing right now beats any description. */}
      <div className={page.strip}>
        <div className={page.stat}>
          <span className={page.statNum}>{ready}</span>
          <span className={page.statLabel}>queued to send</span>
        </div>
        <div className={page.stat}>
          <span className={page.statNum}>{counts.submitting || 0}</span>
          <span className={page.statLabel}>submitting now</span>
        </div>
        <div className={`${page.stat} ${blocked.length ? page.statWarn : ''}`}>
          <span className={page.statNum}>{blocked.length}</span>
          <span className={page.statLabel}>waiting on you</span>
        </div>
        <div className={`${page.stat} ${page.statGood}`}>
          <span className={page.statNum}>{submitted.length}</span>
          <span className={page.statLabel}>confirmed sent</span>
        </div>
      </div>

      {/*
        * The shared drawer, scoped to this run. Same component and same
        * endpoint the Applications page uses for the all-time list - the run is
        * a query parameter, not a second implementation.
        */}
      {run && (
        <div className={page.runPanel}>
          <div className={page.runHead}>
            <strong>{run.running ? 'Run in progress' : 'Last run'}</strong>
            <span>
              {run.submitted} of {run.total} sent
              {run.needsYou > 0 ? ` · ${run.needsYou} need you` : ''}
            </span>
          </div>
          <NeedsYouDrawer
            runId={run.id}
            title={`${run.needsYou} of ${run.total} in this run need you`}
            emptyText="Nothing from this run is waiting on you."
            onResolved={() => load(token)}
          />
        </div>
      )}

      <div className={page.grid}>
        <div className={page.main}>
          <section className={page.card}>
            <h2 className={page.cardTitle}>Match quality</h2>
            <p className={page.cardHint}>
              Only apply to jobs at least this strong a match. A higher bar means
              fewer, sharper applications.
            </p>
            <div className={page.pills}>
              {QUALITY.map((q) => (
                <button
                  key={q.id}
                  className={Math.abs(minScore - q.id) < 0.03 ? page.pillOn : page.pill}
                  onClick={() => savePrefs({ auto_apply_min_score: q.id })}
                  disabled={busy}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <p className={page.pillHint}>
              {(QUALITY.find((q) => Math.abs(minScore - q.id) < 0.03) || QUALITY[1]).hint}
            </p>
          </section>

          <section className={page.card}>
            <h2 className={page.cardTitle}>Daily cap</h2>
            <p className={page.cardHint}>
              At most this many applications a day. A cap is worth keeping: a
              hundred applications in an afternoon reads as a bot to the people
              on the other end.
            </p>
            <div className={page.capRow}>
              <input
                type="range" min="1" max="50" value={cap}
                onChange={(e) => setPrefs({ ...prefs, auto_apply_limit_per_day: Number(e.target.value) })}
                onMouseUp={(e) => savePrefs({ auto_apply_limit_per_day: Number(e.target.value) })}
                onTouchEnd={(e) => savePrefs({ auto_apply_limit_per_day: Number(e.target.value) })}
                className={page.range}
              />
              <span className={page.capNum}>{cap}<small>/day</small></span>
            </div>
          </section>

          {/* The honest differentiator. Stated before you switch it on, not
              discovered when an application silently does not go out. */}
          <section className={page.card}>
            <h2 className={page.cardTitle}>Where this actually works</h2>
            <p className={page.cardHint}>
              Applications run in your own browser through the extension, so they
              reach forms behind a login that a server-side tool cannot. What it
              cannot drive is listed too.
            </p>
            <ul className={page.coverage}>
              {COVERAGE.map((c) => (
                <li key={c.name}>
                  <span className={page[`state_${c.state}`]} />
                  <span className={page.covName}>{c.name}</span>
                  <span className={page.covNote}>{c.note}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={page.card}>
            <h2 className={page.cardTitle}>What it has learned</h2>
            <p className={page.cardHint}>
              Every question you answer once is reused everywhere after. This is
              the number that decides how often Auto Apply has to stop and ask.
            </p>
            <div className={page.learnRow}>
              <div className={page.learnStat}>
                <span className={page.learnNum}>{savedAnswers}</span>
                <span className={page.learnLabel}>answers saved to your profile</span>
              </div>
              <div className={page.learnStat}>
                <span className={page.learnNum}>{knowledge?.variations ?? 0}</span>
                <span className={page.learnLabel}>question wordings recognised</span>
              </div>
              <div className={page.learnStat}>
                <span className={page.learnNum}>{knowledge?.concepts ?? 0}</span>
                <span className={page.learnLabel}>distinct questions understood</span>
              </div>
            </div>
            <p className={page.pillHint}>
              A question worded differently on Lever than on Greenhouse still
              resolves to the answer you already gave. Current salary is never
              matched to expected salary.
            </p>
          </section>
        </div>

        <aside className={page.side}>
          <section className={page.card}>
            <h2 className={page.cardTitle}>Next up</h2>
            <p className={page.cardHint}>
              {matchTotal === null
                ? 'Matches at your current bar.'
                : `${matchTotal} job${matchTotal === 1 ? '' : 's'} clear your bar right now. The strongest are shown here.`}
            </p>
            {matches.length === 0 && (
              <p className={page.empty}>
                Nothing clears this bar yet. Lower it, or wait for the next
                ingestion run.
              </p>
            )}
            {matches.map((m) => (
              <div key={m.id} className={page.match}>
                <div className={page.matchRow}>
                  <span className={page.matchTitle}>{m.title}</span>
                  <span className={page.matchScore}>{Math.round((m.overall_score || 0) * 100)}%</span>
                </div>
                <div className={page.matchCo}>
                  {/* A2c: a job ingested with company_name = "name" rendered as
                      `name · Philippines`. A field that is its own column name
                      did not parse, and must not be shown as an employer. */}
                  {parsedOr(m.company_name, 'Company not stated')}{m.location ? ` · ${m.location}` : ''}
                </div>
              </div>
            ))}
          </section>

          {/* Proof, not a run count. Each row carries the employer's own words. */}
          <section className={page.card}>
            <h2 className={page.cardTitle}>Confirmed sent</h2>
            <p className={page.cardHint}>
              Every one of these was verified against the employer&apos;s own
              confirmation page. Nothing else is ever marked applied.
            </p>
            {submitted.length === 0 && (
              <p className={page.empty}>
                Nothing confirmed yet. Applications appear here once the employer
                confirms them, not when they are sent.
              </p>
            )}
            {submitted.slice(0, 6).map((s) => (
              <div key={s.id} className={page.proof}>
                <div className={page.proofTitle}>{s.title}</div>
                <div className={page.matchCo}>{parsedOr(s.company_name, 'Company not stated')}</div>
                {s.confirmationExcerpt && (
                  <div className={page.proofQuote}>“{s.confirmationExcerpt.slice(0, 110)}”</div>
                )}
                {s.employer_confirmation_id && (
                  <div className={page.proofRef}>Ref {s.employer_confirmation_id}</div>
                )}
              </div>
            ))}
          </section>
        </aside>
      </div>
    </DashboardLayout>
  );
}
