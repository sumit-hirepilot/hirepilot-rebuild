import Head from 'next/head';
// A7.4 - a key must never reach a user as a key.
import { labelFor } from '../lib/labels';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import styles from '../styles/Home.module.css';
import { API_BASE } from '../lib/apiBase';
import { formatDateTime, formatNumber } from '../lib/format';

const SOURCE_LABELS = {
  remoteok: 'RemoteOK',
  remotive: 'Remotive',
  himalayas: 'Himalayas',
  hackernews: "HN Who's Hiring",
  nofluffjobs: 'NoFluffJobs',
  landingjobs: 'Landing.jobs',
  workingnomads: 'Working Nomads',
  jobicy: 'Jobicy',
  jobindex: 'JobIndex',
  greenhouse: "companies' own Greenhouse boards",
  lever: "companies' own Lever boards",
  ashby: "companies' own Ashby boards",
  weworkremotely: 'We Work Remotely',
};

const DIRECT_ATS = new Set(['greenhouse', 'lever', 'ashby']);

/*
 * Facts about how the product works, not examples of it working.
 *
 * These three panels previously showed a fabricated Figma role scored 87%, a
 * fabricated resume diff, and fabricated tracker counts, each captioned
 * "Illustrative example". A caption does not make an invented number safe on a
 * page whose whole claim is that it does not invent numbers - and a visitor
 * scanning the strip reads 87% before they read the caption.
 *
 * A real score cannot be shown here at all: scoring runs against a user's own
 * skills and experience, and a logged-out visitor has none. So the panel shows
 * the actual weights the engine uses instead of a number it cannot compute.
 * Every value below is read from shipped code and cited to its file.
 */

// services/matchingEngine.js, calculateMatch()
const SCORE_WEIGHTS = [
  { label: 'Skills overlap', weight: 40 },
  { label: 'Experience fit', weight: 30 },
  { label: 'Location fit', weight: 20 },
  { label: 'Salary alignment', weight: 10 },
];

/*
 * services/resumeGuard.js - the checks every proposed edit must pass.
 *
 * These are the REAL rule identifiers, quoted so the page can be checked
 * against the code rather than believed. tools/check-landing-claims.js fails
 * the ship gate if this list stops matching resumeGuard's actual rules.
 *
 * It listed a `no_deletion` rule that had been removed, under a heading that
 * said "three checks" when there were two - the page kept advertising a
 * mechanism the code no longer had. Found by reading the live page; no test
 * covered it, and every suite was green.
 */
const GUARD_RULES = [
  { rule: 'invented_number', plain: 'A figure not already in your material is rejected outright.' },
  { rule: 'untraceable_claim', plain: 'Every word must trace to your resume, skills or work history.' },
];

/* Derived, never typed: a hardcoded count is what drifted the first time. */
const COUNT_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

// routes/apply.js - the real status lifecycle.
const TRACK_STATES = [
  { state: 'approved', plain: 'everything required is answered' },
  { state: 'submitting', plain: 'the extension is filling the form' },
  { state: 'needs_user', plain: 'paused on a question, login, CAPTCHA or consent' },
  { state: 'submitted', plain: 'the employer confirmed it — nothing else earns this' },
];


const FAQS = [
  {
    q: 'What does "applied" mean in the tracker?',
    a: 'That the employer\u2019s own confirmation page was captured after submission \u2014 the stored text is the proof, and you can read it on the application. Nothing else sets that status. An application you entered by hand is labelled as your own record, kept visibly distinct from a verified submission, because they are different kinds of claim.',
  },
  {
    q: 'How much control do I have over what gets sent?',
    a: 'Auto Apply runs within limits you set: a daily cap, a minimum match score, and company rules. You can turn on "submits automatically" or leave it filling the form and stopping, and the drawer states which of the two is in force before you press anything. Consent checkboxes are never ticked for you at any setting.',
  },
  {
    q: 'How does HirePilot find jobs?',
    a: 'HirePilot polls a fixed list of real sources every 6 hours: general remote-job boards, plus a maintained, individually-verified list of companies whose own Greenhouse, Lever, or Ashby career page is queried directly through that platform’s public job API — the same mechanism the company’s own careers page uses. There is no "search every company" endpoint for any of these platforms, so coverage is a real but bounded list, not the entire internet.',
  },
  {
    q: 'Does HirePilot submit real applications to employers?',
    a: 'Yes, through the browser extension, which fills and submits the form in your own signed-in browser rather than from a server. An application is only marked applied once the employer’s own confirmation page has been captured — there is no code path that sets that status without it. It pauses and asks you when a form needs something only you can give: a login, a CAPTCHA, a consent tick, or a question your profile has never answered. Automated coverage today is Greenhouse only \u2014 the one adapter verified end to end against a live posting. Lever and Ashby adapters are built but disabled until each has a verified live run, because an application cannot be unsent. Workday, Taleo and iCIMS are not automated and are opened for you to complete.',
  },
  {
    q: 'Is this powered by an LLM?',
    a: 'No. Match scoring, resume tailoring, and cover letter drafting are rule-based: keyword and skill matching against your real resume text, not a language model generating content. It’s slower to expand than an AI system, but every output is traceable back to a specific rule.',
  },
  {
    q: 'How does resume tailoring actually work?',
    a: 'HirePilot reads the job description, finds skills already present elsewhere in your resume’s text that the job asks for but your skills section doesn’t list, and proposes adding just those. It never removes your original content or invents experience — every proposed line is shown as a diff you accept or reject individually before it’s used.',
  },
  {
    q: 'Is there a cost?',
    a: 'HirePilot is free right now — there’s no billing set up. That may change as it matures, but nothing here is a paid tier today.',
  },
];

/*
 * Counters are fetched on the SERVER so the HTML carries real integers.
 *
 * They were client-only, so the first paint - and anything that does not run
 * JavaScript, including every crawler and preview card - saw "—". "Real
 * integers within 2s" cannot be satisfied by a value that only exists after
 * hydration.
 *
 * A failure here does not blank the page: `stats` comes back null and the hero
 * says so, with the last sync time, instead of hanging on a skeleton.
 */
export async function getServerSideProps() {
  const base = process.env.NEXT_PUBLIC_API_URL || 'https://hirepilot-production-e70d.up.railway.app';
  try {
    const ctrl = new AbortController();
    // Well inside the 2s budget; a slow stats query must not hold the page.
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${base}/api/jobs/stats`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { props: { stats: null } };
    return { props: { stats: await res.json() } };
  } catch {
    return { props: { stats: null } };
  }
}

export default function Home({ stats = null }) {
  const [sources, setSources] = useState([]);
  const [tickerIndex, setTickerIndex] = useState(0);
  const [openFaq, setOpenFaq] = useState(0);
  const tickerRef = useRef(null);

  useEffect(() => {
    const loadSources = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/jobs/sources`);
        if (res.ok) {
          const data = await res.json();
          setSources((data.sources || []).filter((s) => s.count > 0));
        }
      } catch (err) {
        // Landing page still works with no live stats - just skips the ticker.
      }
    };
    loadSources();
  }, []);

  useEffect(() => {
    if (!sources.length) return undefined;
    tickerRef.current = setInterval(() => {
      setTickerIndex((i) => (i + 1) % sources.length);
    }, 2200);
    return () => clearInterval(tickerRef.current);
  }, [sources]);

  const liveTotal = sources.reduce((sum, s) => sum + s.count, 0);
  const totalJobs = stats?.jobs ?? (liveTotal || null);
  const sourceCount = stats?.sources ?? (sources.length || null);
  // The real number of companies whose own board is polled. This was the string
  // "180+", shown whenever any direct-ATS source existed.
  const directCompanyCount = stats?.directCompanies ?? null;
  const lastSynced = stats?.lastSyncedAt
    ? formatDateTime(stats.lastSyncedAt)
    : null;
  const activeTicker = sources[tickerIndex];

  return (
    <>
      <Head>
        {/* A7.25 — this said "Job Search on Autopilot" while og:title said "job
            search with the numbers shown". One page cannot describe two
            products, and only one of those two is what ships: applications are
            drafted and wait for your approval. The numbers-shown framing is
            the one the product keeps. */}
        <title>HirePilot — job search with the numbers shown</title>
        <meta name="description" content="Job search with the numbers shown. Every match score breaks down into its four weights, every resume edit is checked against your own material, and an application only counts as applied once the employer confirms it." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />

        {/* Accurate to the product as built. Nothing here claims a capability
            the app does not have - the copy moves to match the product, never
            the other way round. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="HirePilot" />
        <meta property="og:title" content="HirePilot — job search with the numbers shown" />
        <meta property="og:description" content="Match scores that break down into their weights. Resume tailoring that cannot invent experience. Applied means the employer confirmed it." />
        <meta property="og:url" content="https://hirepilot-rebuild-production.up.railway.app" />
        <meta property="og:image" content="https://hirepilot-rebuild-production.up.railway.app/og.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="HirePilot — job search with the numbers shown" />
        <meta name="twitter:description" content="Match scores that break down into their weights. Resume tailoring that cannot invent experience. Applied means the employer confirmed it." />
        <meta name="twitter:image" content="https://hirepilot-rebuild-production.up.railway.app/og.png" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <Layout>
        {/* Hero */}
        <section className={styles.hero}>
          <div className="container">
            <div className={styles.heroContent}>
              <div>
                <p className={styles.label}>REAL JOBS · REAL SCORING · ONE TRACKER</p>
                {/* A7.25 — was "actually on autopilot", on the same page that says
                  applications sit "in your review queue waiting for your
                  approval". The product parks drafts for approval on purpose,
                  so the sentence moved rather than the product. */}
                <h1>Your job search, with every number shown.</h1>
                <p className={styles.subtitle}>
                  HirePilot indexes real openings from every source it watches, scores each one
                  against your real resume, and tailors your resume before you apply — with every
                  change shown to you, nothing invented.
                </p>
                <div className={styles.ctaButtons}>
                  <Link href="/signup" className="btn-primary">
                    Start Free
                  </Link>
                  <a href="#pipeline" className="btn-secondary">
                    See how it works →
                  </a>
                </div>
              </div>

              <div className={styles.heroPanel}>
                <div className={styles.terminalCard}>
                  <div className={styles.terminalHeader}>
                    <span className={styles.terminalDot} />
                    <span className={styles.terminalDot} />
                    <span className={styles.terminalDot} />
                    <span className={styles.terminalLabel}>live · updated every 6 hours</span>
                  </div>
                  <div className={styles.terminalBody}>
                    {activeTicker ? (
                      <p className={styles.terminalLine}>
                        <span className={styles.terminalPrompt}>&gt;</span> scanning{' '}
                        {labelFor(activeTicker.source, SOURCE_LABELS)}…{' '}
                        <span className={styles.terminalCount}>{activeTicker.count} active</span>
                      </p>
                    ) : (
                      <p className={styles.terminalLine}>
                        <span className={styles.terminalPrompt}>&gt;</span>{' '}
                        {stats
                          ? `${stats.sources} sources indexed${lastSynced ? ` · last synced ${lastSynced}` : ''}`
                          : 'source count unavailable — the stats service did not respond'}
                      </p>
                    )}
                  </div>
                  <div className={styles.statStrip}>
                    <div className={styles.statCell}>
                      <span className={styles.statNumber}>
                        {totalJobs ? formatNumber(totalJobs) : <span className={styles.statUnknown}>unavailable</span>}
                      </span>
                      <span>active jobs we track</span>
                    </div>
                    <div className={styles.statCell}>
                      <span className={styles.statNumber}>
                        {sourceCount || <span className={styles.statUnknown}>unavailable</span>}
                      </span>
                      <span>live sources</span>
                    </div>
                    <div className={styles.statCell}>
                      <span className={styles.statNumber}>
                        {directCompanyCount ? formatNumber(directCompanyCount) : <span className={styles.statUnknown}>unavailable</span>}
                      </span>
                      <span>companies watched directly</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pipeline */}
        <section id="pipeline" className={styles.pipeline}>
          <div className="container">
            <p className={styles.label} style={{ textAlign: 'center' }}>THE PIPELINE</p>
            <h2 style={{ textAlign: 'center' }}>Four honest stages. No black box.</h2>

            <div className={styles.pipelineRow}>
              <div className={styles.pipelineText}>
                <span className={styles.stageTag}>01 · SCAN</span>
                <h3>Every posting, found the same day it goes up.</h3>
                <p>
                  HirePilot polls its real sources every 6 hours — general job boards, plus a
                  verified list of companies whose own Greenhouse, Lever, or Ashby career page is
                  hit directly through that platform&apos;s public job API. That&apos;s the same
                  mechanism the company&apos;s own careers page uses, not scraping.
                </p>
              </div>
              <div className={styles.pipelineVisual}>
                <div className={styles.terminalCard}>
                  <div className={styles.terminalHeader}>
                    <span className={styles.terminalDot} />
                    <span className={styles.terminalDot} />
                    <span className={styles.terminalDot} />
                  </div>
                  <div className={styles.terminalBody}>
                    {/* No zeroed placeholder rows. This listed greenhouse,
                        ashby and lever at "+0" until the fetch returned, which
                        reads as "these boards have no jobs" rather than "not
                        loaded yet" - and on a failed fetch it stayed that way. */}
                    {sources.length ? (
                      sources.slice(0, 4).map((s) => (
                        <p key={s.source} className={styles.terminalLine}>
                          <span className={styles.terminalPrompt}>&gt;</span> {labelFor(s.source, SOURCE_LABELS)}{' '}
                          <span className={styles.terminalCount}>+{s.count}</span>
                        </p>
                      ))
                    ) : (
                      <p className={styles.terminalLine}>
                        <span className={styles.terminalPrompt}>&gt;</span>{' '}
                        {stats
                          ? `${formatNumber(stats.jobs)} jobs across ${stats.sources} sources`
                          : 'per-board counts unavailable right now'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className={`${styles.pipelineRow} ${styles.pipelineRowReverse}`}>
              <div className={styles.pipelineText}>
                <span className={styles.stageTag}>02 · MATCH</span>
                <h3>Match scoring you can see the reasons for.</h3>
                <p>
                  Every match is scored against your real skills, years of experience, and
                  location — rule-based, not a model guessing. The same breakdown shown here is
                  what you see on every job in your dashboard.
                </p>
              </div>
              <div className={styles.pipelineVisual}>
                <div className={styles.matchCard}>
                  <p className={styles.factTag}>The actual weights, from the scoring engine</p>
                  {SCORE_WEIGHTS.map((row) => (
                    <div key={row.label} className={styles.matchRow}>
                      <span>{row.label}</span>
                      <span className={styles.matchWeight}>{row.weight}%</span>
                    </div>
                  ))}
                  <p className={styles.factNote}>
                    Your score is these four, computed against your own skills and
                    experience. There is no number to show here until you have a
                    profile — so this shows the formula instead of inventing one.
                  </p>
                </div>
              </div>
            </div>

            <div className={styles.pipelineRow}>
              <div className={styles.pipelineText}>
                <span className={styles.stageTag}>03 · TAILOR</span>
                <h3>A tailored resume, with every change shown first.</h3>
                <p>
                  HirePilot finds skills a job asks for that aren&apos;t in your skills section
                  yet and proposes adding them — it never removes your content or invents
                  experience. Click an addition below to see it toggle.
                </p>
              </div>
              <div className={styles.pipelineVisual}>
                <div className={styles.diffCard}>
                  <p className={styles.factTag}>
                    Every proposed edit passes these {COUNT_WORD[GUARD_RULES.length] || GUARD_RULES.length} checks
                  </p>
                  {GUARD_RULES.map((r) => (
                    <div key={r.rule} className={styles.matchRow}>
                      <code className={styles.factCode}>{r.rule}</code>
                      <span>{r.plain}</span>
                    </div>
                  ))}
                  <p className={styles.factNote}>
                    Enforced in code, not by instruction. An edit that fails any of
                    them is rejected before you ever see it offered.
                  </p>
                </div>
              </div>
            </div>

            <div className={`${styles.pipelineRow} ${styles.pipelineRowReverse}`}>
              <div className={styles.pipelineText}>
                <span className={styles.stageTag}>04 · TRACK</span>
                <h3>One tracker, not five browser tabs.</h3>
                <p>
                  Every application status lives in one board, whether it was applied to
                  manually or drafted by Auto-Pilot and sitting in your review queue waiting for
                  your approval.
                </p>
              </div>
              <div className={styles.pipelineVisual}>
                <div className={styles.trackCard}>
                  <p className={styles.factTag}>The real status lifecycle</p>
                  {TRACK_STATES.map((s2) => (
                    <div key={s2.state} className={styles.matchRow}>
                      <code className={styles.factCode}>{s2.state}</code>
                      <span>{s2.plain}</span>
                    </div>
                  ))}
                  <p className={styles.factNote}>
                    Counts are not shown here because they would be someone
                    else&apos;s. Yours appear on your own tracker.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>


        {/* FAQ */}
        <section className={styles.faq}>
          <div className="container">
            <p className={styles.label} style={{ textAlign: 'center' }}>QUESTIONS</p>
            <h2 style={{ textAlign: 'center' }}>What people ask before signing up.</h2>
            <div className={styles.faqList}>
              {FAQS.map((item, i) => (
                <div key={item.q} className={styles.faqItem}>
                  <button
                    type="button"
                    className={styles.faqQuestion}
                    onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                  >
                    <span>{item.q}</span>
                    <span className={styles.faqToggle}>{openFaq === i ? '−' : '+'}</span>
                  </button>
                  {openFaq === i && <p className={styles.faqAnswer}>{item.a}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className={styles.cta}>
          <div className="container">
            <h2>Ready for lift-off.</h2>
            {/* A7.25 — mobile, stated as what it is. There is no app, and
                BACKLOG_MOBILE.md is explicit that surfacing store links for one
                would be a claim the product cannot keep. */}
            <p className={styles.mobileNote}>
              HirePilot runs in your mobile browser — the whole product, nothing to install.
              Submitting an application uses the Chrome extension, which is desktop-only.
            </p>
            <Link href="/signup" className="btn-primary">
              Start Free
            </Link>
          </div>
        </section>
      </Layout>
    </>
  );
}
