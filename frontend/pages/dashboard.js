import Head from 'next/head';
import { bandFor } from '../lib/scoreBands';
// A7.2 - a company that did not parse must never render as if it did.
import { parsedOr } from '../lib/renderState';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import { API_BASE } from '../lib/apiBase';
import { formatNumber } from '../lib/format';
import Link from 'next/link';
import { timeAgo } from '../lib/format';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];


function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [matches, setMatches] = useState([]);
  // null = not loaded. Never 0, which would assert "no matches" before asking.
  const [matchTotalRaw, setMatchTotalRaw] = useState(null);
  const [appStats, setAppStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [autoApplyIncluded, setAutoApplyIncluded] = useState(true);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (!token || !storedUser) {
      router.push('/login');
      return;
    }

    setUser(JSON.parse(storedUser));

    async function loadData() {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const base = API_BASE;

        const [matchesRes, statsRes, activityRes, profileRes] = await Promise.all([
          fetch(`${base}/api/matches?limit=5`, { headers }),
          fetch(`${base}/api/applications/stats`, { headers }),
          fetch(`${base}/api/activity?limit=8`, { headers }),
          fetch(`${base}/api/profile`, { headers }),
        ]);

        if (matchesRes.ok) {
          const data = await matchesRes.json();
          setMatches(data.matches || []);
          setMatchTotalRaw(typeof data.total === 'number' ? data.total : null);
        }

        if (statsRes.ok) {
          const data = await statsRes.json();
          setAppStats(data);
        }

        if (activityRes.ok) {
          const data = await activityRes.json();
          setActivity(data.activity || []);
        }

        if (profileRes.ok) {
          const profileData = await profileRes.json();
          if (!profileData.user?.onboarding_completed_at) {
            router.push('/onboarding');
            return;
          }
          setProfile(profileData);
          // Item A — the plan's answer arrives with the preference, so the
          // status never has to guess whether "on" means running.
          setAutoApplyIncluded(profileData.autoApplyIncluded !== false);
        }
      } catch (err) {
        // Item 5 — the dashboard had no error state at all: a failed load left
        // an empty page that reads as "you have nothing" rather than "we could
        // not ask". Those are different facts and only one of them is true.
        console.error('Failed to load dashboard data', err);
        setLoadError('Could not reach HirePilot to load your dashboard. Check your connection and try again.');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router]);

  if (!user) return null;

  const now = new Date();
  const dateLabel = `${DAY_NAMES[now.getDay()]} ${now.getDate()} ${MONTH_NAMES[now.getMonth()]}`;
  const firstName = (user.fullName || user.email.split('@')[0]).split(' ')[0];

  const applicationsSent = appStats ? parseInt(appStats.total_applications || 0) : 0;
  const interviews = appStats ? parseInt(appStats.interviews || 0) : 0;
  const scannedToday = appStats ? parseInt(appStats.scanned_today || 0) : 0;
  /*
   * A7.3 — this was `matches.length` from /api/matches?limit=5, labelled
   * "Today's Matches". It was neither today's nor a count of matches: it was
   * how many rows a limit-5 request happened to return, capped at 5. The
   * label named something the number was not.
   *
   * `total` is the real count the same response already carries.
   */
  const matchTotal = matchTotalRaw;
  const prefs = profile?.preferences;
  const autoApplyEnabled = !!prefs?.auto_apply_enabled;
  const dailyLimit = prefs?.auto_apply_limit_per_day || 10;
  const progressPct = Math.min(100, (applicationsSent / dailyLimit) * 100);
  const hasSkills = (profile?.skills || []).length > 0;
  const profileIncomplete = profile && !hasSkills;

  return (
    <>
      <Head>
        <title>Dashboard - HirePilot</title>
      </Head>

      <DashboardLayout title="Dashboard" user={user}>
        <p className={styles.dateLabel}>{dateLabel}</p>
        {/* Item 5 — say we could not ask, rather than showing an empty

            dashboard that reads as "you have nothing". */}

        {loadError && (

          <p className={styles.loadError} role="alert">{loadError}</p>

        )}
        <h1 className={styles.greeting}>{getGreeting()}, {firstName}</h1>

        {profileIncomplete && (
          <div className={styles.setupBanner}>
            <div>
              <p className={styles.setupBannerTitle}>Finish setting up your profile</p>
              <p className={styles.setupBannerText}>Add your skills so HirePilot can start matching and scoring jobs for you.</p>
            </div>
            <Link href="/settings" className={styles.setupBannerButton}>Complete setup</Link>
          </div>
        )}

        <div className={styles.card}>
          <div className={styles.autopilotRow}>
            <div className={styles.autopilotLeft}>
              <span className={autoApplyEnabled ? styles.statusDot : styles.statusDotOff} />
              <div>
                {/* Item A — "Active" must mean running. On a plan without
                    Auto-Pilot the engine refuses, so saying Active would tell
                    the user a thing is happening that is not. */}
                <p className={styles.autopilotTitle}>
                  {!autoApplyIncluded
                    ? 'Auto-Pilot is not on your plan'
                    : (autoApplyEnabled ? 'Auto-Pilot Active' : 'Auto-Pilot Paused')}
                </p>
                <p className={styles.autopilotSubtitle}>
                  {scannedToday} jobs scanned &middot; {applicationsSent} tracked &middot; {matchTotal === null ? '—' : formatNumber(matchTotal)} matches found
                </p>
              </div>
            </div>
            {!autoApplyEnabled && (
              <Link href="/settings" className={styles.autopilotEnableLink}>Turn on in Settings &rarr;</Link>
            )}
          </div>
          <div className={styles.progressWrap}>
            <div className={styles.progressLabels}>
              <span>Daily limit</span>
              <span>{applicationsSent}/{dailyLimit} applications</span>
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </div>

        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Matches above your bar</p>
            <p className={styles.statValue}>{matchTotal === null ? '—' : formatNumber(matchTotal)}</p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Applications Tracked</p>
            <p className={styles.statValue}>{applicationsSent}</p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Interview Pipeline</p>
            <p className={styles.statValue}>{interviews}<span className={styles.statValueUnit}>active</span></p>
          </div>
          {/* Was "Time Saved", hardcoded to 0 - it was never computed, and any
              figure would have required inventing a "minutes saved per
              application" multiplier. Replaced with a count that comes
              straight from the indexed job pool. */}
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Jobs we track</p>
            <p className={styles.statValue}>{formatNumber(scannedToday)}</p>
          </div>
        </div>

        <div className={styles.twoColGrid}>
          <div className={styles.card} style={{ marginBottom: 0 }}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Today&apos;s matches</h2>
              <Link href="/jobs" className={styles.sectionLink}>View all jobs</Link>
            </div>

            {loading ? (
              <p className={styles.emptyState}>Loading&hellip;</p>
            ) : matches.length === 0 ? (
              <p className={styles.emptyState}>
                No matches yet. Add your skills and experience to your profile so HirePilot can start scoring jobs for you.
              </p>
            ) : (
              matches.map((m) => (
                <div key={m.id} className={styles.matchRow}>
                  {/* A7.1/A7.20 — a bare 75 is a number, not a score. The %
                      carries the meaning, and jobs.js already decided that;
                      the dashboard was contradicting it. */}
                  {/* Wave C — a first-time user should not have to learn what
                      a good score looks like by scrolling until the numbers
                      change. The band says it; the number still proves it. */}
                  <div className={styles.matchScore} title="Skills, experience and location">
                    <span className={styles.matchBand}>{bandFor(m.overall_score)?.label}</span>
                    <span>{Math.round(m.overall_score * 100)}%</span>
                  </div>
                  <div>
                    <p className={styles.matchTitle}>{m.title}</p>
                    <p className={styles.matchSubtitle}>
                      {parsedOr(m.company_name, 'Company not stated')} &middot; {m.location}
                      {' · '}
                      {timeAgo(m.posted_at)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className={styles.card} style={{ marginBottom: 0 }}>
            <h2 className={styles.sectionTitle} style={{ marginBottom: '1rem' }}>Recent activity</h2>
            {activity.length === 0 ? (
              <p className={styles.emptyState}>No activity yet. Once Auto-Pilot starts applying, you&apos;ll see updates here.</p>
            ) : (
              activity.map((a, i) => (
                <div key={i} className={styles.activityRow} style={{ marginBottom: '0.875rem' }}>
                  <div>
                    <p className={styles.activityText}>{a.text}</p>
                    <p className={styles.activityTime}>{timeAgo(a.createdAt)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <h2 className={styles.sectionTitle} style={{ margin: '1.5rem 0 1rem' }}>Quick actions</h2>
        <div className={styles.quickActions}>
          <Link href="/jobs" className={styles.quickActionCard}>
            Find Jobs Now <span className={styles.quickActionArrow}>&rarr;</span>
          </Link>
          <Link href="/agents" className={styles.quickActionCard}>
            Create Search Agent <span className={styles.quickActionArrow}>&rarr;</span>
          </Link>
          <Link href="/resume" className={styles.quickActionCard}>
            Tailor Resume <span className={styles.quickActionArrow}>&rarr;</span>
          </Link>
        </div>
      </DashboardLayout>
    </>
  );
}
