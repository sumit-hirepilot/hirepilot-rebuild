import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Applications.module.css';

const COLUMNS = [
  { key: 'applied', label: 'Applied' },
  { key: 'phone_screen', label: 'Phone Screen' },
  { key: 'technical_interview', label: 'Technical Interview' },
  { key: 'onsite', label: 'Onsite' },
  { key: 'offer', label: 'Offer' },
  { key: 'hired', label: 'Hired' },
  { key: 'failed', label: 'Failed' },
  { key: 'rejected', label: 'Rejected' },
];

export default function Applications() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [kanban, setKanban] = useState(null);
  const [rejected, setRejected] = useState([]);
  const [failed, setFailed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('grid');
  const [retrying, setRetrying] = useState(null);

  const base = process.env.NEXT_PUBLIC_API_URL;

  const loadApplications = useCallback(async (authToken) => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/applications`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setKanban(data.kanban);
        setRejected(data.rejected || []);
        setFailed(data.failed || []);
      }
    } catch (err) {
      console.error('Failed to load applications', err);
    } finally {
      setLoading(false);
    }
  }, [base]);

  const handleRetry = async (applicationId) => {
    setRetrying(applicationId);
    try {
      const res = await fetch(`${base}/api/applications/${applicationId}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) await loadApplications(token);
    } catch (err) {
      console.error('Failed to retry application', err);
    } finally {
      setRetrying(null);
    }
  };

  useEffect(() => {
    const authToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!authToken || !storedUser) {
      router.push('/login');
      return;
    }
    setUser(JSON.parse(storedUser));
    setToken(authToken);
    loadApplications(authToken);
  }, [router, loadApplications]);

  const handleStatusChange = async (applicationId, newStatus) => {
    try {
      const res = await fetch(`${base}/api/applications/${applicationId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) loadApplications(token);
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  if (!user) return null;

  const allStatuses = [
    { key: 'applied', label: 'Applied' },
    { key: 'phone_screen', label: 'Phone Screen' },
    { key: 'technical_interview', label: 'Technical Interview' },
    { key: 'onsite', label: 'Onsite' },
    { key: 'offer', label: 'Offer' },
    { key: 'hired', label: 'Hired' },
    { key: 'rejected', label: 'Rejected' },
  ];
  const columnsData = { ...(kanban || {}), rejected, failed };
  const allApps = kanban
    ? [...Object.values(kanban).flat(), ...rejected, ...failed].sort((a, b) => new Date(b.applied_at) - new Date(a.applied_at))
    : [];
  const totalCount = allApps.length;

  return (
    <>
      <Head>
        <title>Applications - HirePilot</title>
      </Head>

      <DashboardLayout title="Applications" user={user}>
        <div className={page.headerRow}>
          <div>
            <p className={styles.dateLabel}>{totalCount} total applications</p>
            <h1 className={styles.greeting}>Application pipeline</h1>
          </div>
          <div className={page.viewToggle}>
            <button
              className={view === 'grid' ? page.viewButtonActive : page.viewButton}
              onClick={() => setView('grid')}
              aria-label="Grid view"
            >
              ▦
            </button>
            <button
              className={view === 'list' ? page.viewButtonActive : page.viewButton}
              onClick={() => setView('list')}
              aria-label="List view"
            >
              ☰
            </button>
          </div>
        </div>

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : view === 'list' ? (
          <div className={styles.card} style={{ marginBottom: 0, padding: 0, overflowX: 'auto' }}>
            <table className={page.table}>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Applied</th>
                </tr>
              </thead>
              <tbody>
                {allApps.map((app) => (
                  <tr key={app.id}>
                    <td className={page.roleCell}>
                      {app.title}
                      {app.submitted_by === 'auto_pilot' && <span className={page.autoBadge}>Auto-Pilot</span>}
                    </td>
                    <td>{app.company_name}</td>
                    <td>
                      {app.status === 'failed' ? (
                        <button
                          type="button"
                          className={page.retryButton}
                          onClick={() => handleRetry(app.id)}
                          disabled={retrying === app.id}
                          title={app.failure_reason || 'Application failed'}
                        >
                          {retrying === app.id ? 'Retrying…' : 'Retry'}
                        </button>
                      ) : (
                        <select
                          className={page.statusSelectInline}
                          value={app.status}
                          onChange={(e) => handleStatusChange(app.id, e.target.value)}
                        >
                          {allStatuses.map((c) => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>{new Date(app.applied_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {allApps.length === 0 && (
                  <tr><td colSpan={4} className={styles.emptyState}>No applications yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={page.board}>
            {COLUMNS.map((col) => {
              const items = columnsData[col.key] || [];
              return (
                <div key={col.key} className={page.column}>
                  <div className={page.columnHeader}>
                    <span>{col.label}</span>
                    <span className={page.columnCount}>{items.length}</span>
                  </div>

                  <div className={page.columnBody}>
                    {items.length === 0 ? (
                      <p className={page.emptyColumn}>No applications</p>
                    ) : (
                      items.map((app) => (
                        <div key={app.id} className={page.card}>
                          <p className={page.cardTitle}>
                            {app.title}
                            {app.submitted_by === 'auto_pilot' && <span className={page.autoBadge}>Auto-Pilot</span>}
                          </p>
                          <p className={page.cardSubtitle}>{app.company_name}</p>
                          <p className={page.cardMeta}>
                            {new Date(app.applied_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                          </p>
                          {app.status === 'failed' ? (
                            <>
                              <p className={page.failureReason}>{app.failure_reason}</p>
                              <button
                                type="button"
                                className={page.retryButton}
                                onClick={() => handleRetry(app.id)}
                                disabled={retrying === app.id}
                              >
                                {retrying === app.id ? 'Retrying…' : 'Retry'}
                              </button>
                            </>
                          ) : (
                            <select
                              className={page.statusSelect}
                              value={app.status}
                              onChange={(e) => handleStatusChange(app.id, e.target.value)}
                            >
                              {allStatuses.map((c) => (
                                <option key={c.key} value={c.key}>{c.label}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DashboardLayout>
    </>
  );
}
