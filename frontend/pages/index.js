import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import styles from '../styles/Home.module.css';
import { API_BASE } from '../lib/apiBase';

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

// Illustrative examples only - not live user data. Labeled as such wherever shown.
const MATCH_EXAMPLE = {
  title: 'Senior Product Designer',
  company: 'Figma',
  score: 87,
  breakdown: [
    { label: 'Skills matched', value: '9 / 10' },
    { label: 'Experience', value: '6 yrs vs. 5+ required' },
    { label: 'Location', value: 'Remote — match' },
  ],
};

const DIFF_EXAMPLE = [
  { type: 'context', text: 'SKILLS\nFigma, Prototyping, Design Systems, User Research' },
  { type: 'added', text: ', Accessibility (WCAG)' },
  { type: 'context', text: '\n\nEXPERIENCE\nSenior Product Designer — 2021–present' },
];

const TRACK_EXAMPLE = [
  { status: 'Applied', count: 12 },
  { status: 'Phone Screen', count: 3 },
  { status: 'Interview', count: 2 },
  { status: 'Offer', count: 1 },
];

const FAQS = [
  {
    q: 'How does HirePilot find jobs?',
    a: 'HirePilot polls a fixed list of real sources every 6 hours: general remote-job boards, plus a maintained, individually-verified list of companies whose own Greenhouse, Lever, or Ashby career page is queried directly through that platform’s public job API — the same mechanism the company’s own careers page uses. There is no "search every company" endpoint for any of these platforms, so coverage is a real but bounded list, not the entire internet.',
  },
  {
    q: 'Does HirePilot submit real applications to employers?',
    a: 'Not yet. Every "applied" status you see is a real record in HirePilot’s own tracker — it has not submitted a form on Greenhouse, Workday, or any other external ATS on your behalf. Auto-Pilot can draft a tailored resume and cover letter and queue an application within the rules you set, and you can require your own approval before anything counts as applied.',
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

export default function Home() {
  const [sources, setSources] = useState([]);
  const [tickerIndex, setTickerIndex] = useState(0);
  const [openFaq, setOpenFaq] = useState(0);
  const [rejectedDiff, setRejectedDiff] = useState(false);
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

  const totalJobs = sources.reduce((sum, s) => sum + s.count, 0);
  const directCompanyCount = sources.filter((s) => DIRECT_ATS.has(s.source)).length;
  const activeTicker = sources[tickerIndex];

  return (
    <>
      <Head>
        <title>HirePilot - Job Search on Autopilot</title>
        <meta name="description" content="Real jobs, scored against your real resume, tailored honestly - no invented AI, no fake automation." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <Layout>
        {/* Hero */}
        <section className={styles.hero}>
          <div className="container">
            <div className={styles.heroContent}>
              <div>
                <p className={styles.label}>REAL JOBS · REAL SCORING · ONE TRACKER</p>
                <h1>Your job search, actually on autopilot.</h1>
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
                    <span className={styles.terminalLabel}>live · synced every 6h</span>
                  </div>
                  <div className={styles.terminalBody}>
                    {activeTicker ? (
                      <p className={styles.terminalLine}>
                        <span className={styles.terminalPrompt}>&gt;</span> scanning{' '}
                        {SOURCE_LABELS[activeTicker.source] || activeTicker.source}…{' '}
                        <span className={styles.terminalCount}>{activeTicker.count} active</span>
                      </p>
                    ) : (
                      <p className={styles.terminalLine}>
                        <span className={styles.terminalPrompt}>&gt;</span> connecting to live sources…
                      </p>
                    )}
                  </div>
                  <div className={styles.statStrip}>
                    <div className={styles.statCell}>
                      <span className={styles.statNumber}>
                        {totalJobs ? totalJobs.toLocaleString() : '—'}
                      </span>
                      <span>active jobs indexed</span>
                    </div>
                    <div className={styles.statCell}>
                      <span className={styles.statNumber}>{sources.length || '—'}</span>
                      <span>live sources</span>
                    </div>
                    <div className={styles.statCell}>
                      <span className={styles.statNumber}>
                        {directCompanyCount ? '180+' : '—'}
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
                    {(sources.length ? sources : [{ source: 'greenhouse', count: 0 }, { source: 'ashby', count: 0 }, { source: 'lever', count: 0 }])
                      .slice(0, 4)
                      .map((s) => (
                        <p key={s.source} className={styles.terminalLine}>
                          <span className={styles.terminalPrompt}>&gt;</span> {SOURCE_LABELS[s.source] || s.source}{' '}
                          <span className={styles.terminalCount}>+{s.count}</span>
                        </p>
                      ))}
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
                  <p className={styles.exampleTag}>Illustrative example</p>
                  <div className={styles.matchHeader}>
                    <div>
                      <p className={styles.matchTitle}>{MATCH_EXAMPLE.title}</p>
                      <p className={styles.matchCompany}>{MATCH_EXAMPLE.company}</p>
                    </div>
                    <span className={styles.matchScore}>{MATCH_EXAMPLE.score}%</span>
                  </div>
                  {MATCH_EXAMPLE.breakdown.map((row) => (
                    <div key={row.label} className={styles.matchRow}>
                      <span>{row.label}</span>
                      <span>{row.value}</span>
                    </div>
                  ))}
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
                  <p className={styles.exampleTag}>Illustrative example</p>
                  <pre className={styles.diffPre}>
                    {DIFF_EXAMPLE[0].text}
                    <span
                      className={rejectedDiff ? styles.diffRejected : styles.diffAdded}
                      onClick={() => setRejectedDiff((r) => !r)}
                      title="Click to toggle accept/reject"
                    >
                      {DIFF_EXAMPLE[1].text}
                    </span>
                    {DIFF_EXAMPLE[2].text}
                  </pre>
                  <p className={styles.diffHint}>
                    {rejectedDiff ? 'Rejected — click to accept again' : 'Added — click to reject'}
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
                  <p className={styles.exampleTag}>Illustrative example</p>
                  <div className={styles.trackRow}>
                    {TRACK_EXAMPLE.map((col) => (
                      <div key={col.status} className={styles.trackColumn}>
                        <span className={styles.trackCount}>{col.count}</span>
                        <span className={styles.trackLabel}>{col.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Honesty section */}
        <section className={styles.honest}>
          <div className="container">
            <p className={styles.label} style={{ textAlign: 'center' }}>NO FAKE AUTO-SUBMIT</p>
            <h2 style={{ textAlign: 'center' }}>What &quot;applied&quot; actually means here.</h2>
            <div className={styles.honestGrid}>
              <div className={styles.honestCard}>
                <h4>Tracked, first</h4>
                <p>
                  Every apply — manual or automated — creates a real record in your own tracker,
                  so you always know exactly where you stand with every company.
                </p>
              </div>
              <div className={styles.honestCard}>
                <h4>Auto-Pilot, within your rules</h4>
                <p>
                  Turn it on and it finds matches, drafts a tailored resume and cover letter, and
                  applies within the daily limit, minimum score, and company rules you set.
                </p>
              </div>
              <div className={styles.honestCard}>
                <h4>Review before it counts</h4>
                <p>
                  Turn on &quot;review before submit&quot; and nothing Auto-Pilot drafts is
                  marked applied until you personally approve it.
                </p>
              </div>
            </div>
            <p className={styles.honestDisclaimer}>
              HirePilot does not currently submit forms on external ATS platforms (Greenhouse,
              Workday, and the rest) on your behalf. Every &quot;applied&quot; status reflects a
              real record in your own tracker, not a live submission to the employer&apos;s
              system — we&apos;d rather tell you that plainly than let a dashboard number imply
              otherwise.
            </p>
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
            <Link href="/signup" className="btn-primary">
              Start Free
            </Link>
          </div>
        </section>
      </Layout>
    </>
  );
}
