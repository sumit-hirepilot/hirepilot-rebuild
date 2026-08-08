import Head from 'next/head';
// A7.4 - a key must never reach a user as a key.
import { labelFor } from '../lib/labels';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Analytics.module.css';
import { API_BASE } from '../lib/apiBase';

const STATUS_LABELS = {
  applied: 'Applied',
  phone_screen: 'Phone Screen',
  technical_interview: 'Technical Interview',
  onsite: 'Onsite',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
  failed: 'Failed',
};

const SOURCE_LABELS = {
  remoteok: 'Remote OK',
  remotive: 'Remotive',
  weworkremotely: 'We Work Remotely',
};

export default function Analytics() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const base = API_BASE;

  const loadData = useCallback(async (authToken) => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/analytics`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error('Failed to load analytics', err);
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
    loadData(authToken);
  }, [router, loadData]);

  if (!user) return null;

  const totals = data?.totals;
  const maxDaily = data ? Math.max(1, ...data.daily.map((d) => d.count)) : 1;
  const maxStatus = data ? Math.max(1, ...data.statusBreakdown.map((s) => s.count)) : 1;
  const maxSource = data ? Math.max(1, ...data.sourceBreakdown.map((s) => s.count)) : 1;

  return (
    <>
      <Head>
        <title>How it is going - HirePilot</title>
      </Head>

      <DashboardLayout title="Analytics" user={user}>
        <h1 className={styles.greeting} style={{ marginTop: 0 }}>How it is going</h1>

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : !totals || totals.totalApplications === 0 ? (
          <p className={styles.emptyState}>No applications yet. Once you start applying, your stats will show up here.</p>
        ) : (
          <>
            <div className={page.statsGrid}>
              <div className={styles.statCard}>
                <p className={styles.statLabel}>Total Applications</p>
                <p className={styles.statValue}>{totals.totalApplications}</p>
              </div>
              <div className={styles.statCard}>
                <p className={styles.statLabel}>Response Rate</p>
                <p className={styles.statValue}>{totals.responseRate}<span className={styles.statValueUnit}>%</span></p>
              </div>
              {/* Was "Hired" reading totals.hired - a status no write path
                  records, so the tile was a permanent 0 presented as a fact
                  about the user. Offers are what the tracker records. */}
              <div className={styles.statCard}>
                <p className={styles.statLabel}>Offers</p>
                <p className={styles.statValue}>{totals.offers}</p>
              </div>
              <div className={styles.statCard}>
                <p className={styles.statLabel}>Sent by Auto-Pilot</p>
                <p className={styles.statValue}>{totals.autoApplied}</p>
              </div>
            </div>

            <div className={page.twoColGrid}>
              <div className={styles.card} style={{ marginBottom: 0 }}>
                <p className={page.sectionTitle}>Applications - last 14 days</p>
                <div className={page.chart}>
                  {data.daily.map((d) => (
                    <div key={d.date} className={page.barCol}>
                      {d.count > 0 && <span className={page.barCount}>{d.count}</span>}
                      <div className={page.bar} style={{ height: `${(d.count / maxDaily) * 100}%` }} />
                      <span className={page.barLabel}>
                        {new Date(d.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }).replace(' ', ' ').slice(0, 6)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.card} style={{ marginBottom: 0 }}>
                <p className={page.sectionTitle}>Status breakdown</p>
                {data.statusBreakdown.length === 0 ? (
                  <p className={styles.emptyState}>No data yet.</p>
                ) : (
                  data.statusBreakdown.map((s) => (
                    <div key={s.status} className={page.breakdownRow}>
                      <span className={page.breakdownLabel}>{labelFor(s.status, STATUS_LABELS)}</span>
                      <div className={page.breakdownTrack}>
                        <div className={page.breakdownFill} style={{ width: `${(s.count / maxStatus) * 100}%` }} />
                      </div>
                      <span className={page.breakdownCount}>{s.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className={styles.card}>
              <p className={page.sectionTitle}>Applications by source</p>
              {data.sourceBreakdown.length === 0 ? (
                <p className={styles.emptyState}>No data yet.</p>
              ) : (
                data.sourceBreakdown.map((s) => (
                  <div key={s.source} className={page.breakdownRow}>
                    <span className={page.breakdownLabel}>{labelFor(s.source, SOURCE_LABELS)}</span>
                    <div className={page.breakdownTrack}>
                      <div className={page.breakdownFill} style={{ width: `${(s.count / maxSource) * 100}%` }} />
                    </div>
                    <span className={page.breakdownCount}>{s.count}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </DashboardLayout>
    </>
  );
}
