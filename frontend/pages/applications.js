import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Applications.module.css';

const COLUMNS = [
  { key: 'applied', label: 'Applied' },
  { key: 'phone_screen', label: 'Phone Screen' },
  { key: 'interview', label: 'Interview' },
  { key: 'offer', label: 'Offer' },
  { key: 'hired', label: 'Hired' },
  { key: 'rejected', label: 'Rejected' },
];

export default function Applications() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [kanban, setKanban] = useState(null);
  const [loading, setLoading] = useState(true);

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
      }
    } catch (err) {
      console.error('Failed to load applications', err);
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
    setToken(authToken);
    loadApplications(authToken);
  }, [router, loadApplications]);

  const handleStatusChange = async (applicationId, newStatus) => {
    try {
      const res = await fetch(`${base}/api/applications/${applicationId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        loadApplications(token);
      }
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  if (!user) return null;

  const totalCount = kanban ? Object.values(kanban).reduce((sum, list) => sum + list.length, 0) : 0;

  return (
    <>
      <Head>
        <title>Applications - HirePilot</title>
      </Head>

      <DashboardLayout title="Applications" user={user}>
        <p className={styles.dateLabel}>{totalCount} total applications</p>
        <h1 className={styles.greeting}>Application pipeline</h1>

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : (
          <div className={page.board}>
            {COLUMNS.map((col) => {
              const items = kanban?.[col.key] || [];
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
                          <p className={page.cardTitle}>{app.title}</p>
                          <p className={page.cardSubtitle}>{app.company_name}</p>
                          <p className={page.cardMeta}>
                            Applied {new Date(app.applied_at).toLocaleDateString()}
                          </p>
                          <select
                            className={page.statusSelect}
                            value={app.status}
                            onChange={(e) => handleStatusChange(app.id, e.target.value)}
                          >
                            {COLUMNS.map((c) => (
                              <option key={c.key} value={c.key}>{c.label}</option>
                            ))}
                          </select>
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
