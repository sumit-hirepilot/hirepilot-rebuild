import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import NeedsYouDrawer from '../components/NeedsYouDrawer';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Applications.module.css';
import { API_BASE } from '../lib/apiBase';

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
  const [pendingReview, setPendingReview] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('grid');
  const [retrying, setRetrying] = useState(null);
  const [reviewing, setReviewing] = useState(null);

  const base = API_BASE;

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
        setPendingReview(data.pendingReview || []);
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

  const handleApprove = async (applicationId) => {
    setReviewing(applicationId);
    try {
      const res = await fetch(`${base}/api/applications/${applicationId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) await loadApplications(token);
    } catch (err) {
      console.error('Failed to approve application', err);
    } finally {
      setReviewing(null);
    }
  };

  const handleDiscard = async (applicationId) => {
    setReviewing(applicationId);
    try {
      const res = await fetch(`${base}/api/applications/${applicationId}/discard`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) await loadApplications(token);
    } catch (err) {
      console.error('Failed to discard application', err);
    } finally {
      setReviewing(null);
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
        {/*
          * The persistent, all-time list. Same component and same endpoint the
          * Auto Apply screen uses - it passes a runId, this does not. A blocker
          * from a run days ago is findable here without remembering which run
          * produced it, which is the whole reason this surface exists.
          */}
        <div style={{ marginBottom: 20 }}>
          <NeedsYouDrawer
            emptyText="Nothing is waiting on you. Parked applications show up here with the question that stopped them."
            onResolved={() => loadApplications(localStorage.getItem('token'))}
          />
        </div>

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

        {pendingReview.length > 0 && (
          <div className={page.pendingReviewSection}>
            <p className={page.pendingReviewTitle}>
              Pending your review ({pendingReview.length}) - Auto-Pilot drafted these, approve to actually mark them applied
            </p>
            {pendingReview.map((app) => (
              <div key={app.id} className={page.pendingReviewRow}>
                <div>
                  <p className={page.roleCell} style={{ marginBottom: '0.125rem' }}>{app.title}</p>
                  <p className={styles.emptyState} style={{ margin: 0, fontSize: '0.75rem' }}>{app.company_name}</p>
                </div>
                <div className={page.pendingReviewActions}>
                  <button
                    className={page.approveButton}
                    onClick={() => handleApprove(app.id)}
                    disabled={reviewing === app.id}
                  >
                    {reviewing === app.id ? 'Working...' : 'Approve'}
                  </button>
                  <button
                    className={page.discardButton}
                    onClick={() => handleDiscard(app.id)}
                    disabled={reviewing === app.id}
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

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
