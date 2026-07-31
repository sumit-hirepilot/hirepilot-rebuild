import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Network.module.css';
import { API_BASE } from '../lib/apiBase';

const STATUS_STAGES = ['identified', 'connected', 'messaged', 'referred'];

export default function Network() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [company, setCompany] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);

  const base = API_BASE;

  const loadContacts = useCallback(async (authToken) => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/network`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) setContacts((await res.json()).contacts || []);
    } catch (err) {
      console.error('Failed to load contacts', err);
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
    loadContacts(authToken);

    if (router.query.company) setCompany(router.query.company);
  }, [router, loadContacts]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!company.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${base}/api/network/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company }),
      });
      const data = await res.json();
      if (res.ok) setSuggestions(data.suggestions || []);
    } finally {
      setSearching(false);
    }
  };


  const handleStatusChange = async (contactId, status) => {
    try {
      const res = await fetch(`${base}/api/network/${contactId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      if (res.ok) loadContacts(token);
    } catch (err) {
      console.error('Failed to update contact', err);
    }
  };

  const handleDelete = async (id) => {
    await fetch(`${base}/api/network/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    loadContacts(token);
  };

  if (!user) return null;


  return (
    <>
      <Head>
        <title>Network - HirePilot</title>
      </Head>

      <DashboardLayout title="Network" user={user}>
        <h1 className={styles.greeting} style={{ marginTop: 0 }}>Network</h1>

        <form onSubmit={handleSearch} className={page.searchRow}>
          <input
            className={page.searchInput}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Search a company (e.g. Stripe)"
          />
          <button type="submit" className={page.searchButton} disabled={searching}>
            {searching ? 'Searching...' : 'Find contacts'}
          </button>
        </form>

        {suggestions.length > 0 && (
          <>
            <p className={page.suggestedLabel}>Ways to find real contacts at {company}</p>
            <p className={page.searchNote}>
              These are searches to run against LinkedIn&apos;s own index — not people
              HirePilot has identified. Earlier this panel displayed generated names
              and mutual-connection counts; those were not real, so they are gone.
            </p>
            <div className={page.suggestGrid}>
              {suggestions.map((s) => (
                <div key={s.key} className={styles.card} style={{ marginBottom: 0 }}>
                  <p className={page.suggestName}>{s.label}</p>
                  <div className={page.suggestActions}>
                    <a href={s.url} target="_blank" rel="noreferrer" className={page.linkedinLink}>
                      Search on LinkedIn →
                    </a>
                  </div>
                </div>
              ))}
            </div>
            <p className={page.searchNote}>
              Found someone real? Add them under &ldquo;Your connections&rdquo; to track outreach.
            </p>
          </>
        )}

        <p className={page.connectionsLabel}>Your connections</p>

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : contacts.length === 0 ? (
          <div className={page.emptyState}>
            <div className={page.radar} />
            <p className={page.emptyTitle}>No connections tracked yet</p>
            <p className={page.emptySubtitle}>Contacts you track from a search will appear here.</p>
          </div>
        ) : (
          <div className={styles.card} style={{ marginBottom: 0, padding: 0, overflowX: 'auto' }}>
            <table className={page.table}>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Company</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td className={page.nameCell}>{`${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unnamed'}</td>
                    <td>{c.company_name}</td>
                    <td>{c.job_title || '—'}</td>
                    <td>
                      <div className={page.statusPipeline}>
                        {STATUS_STAGES.map((stage) => (
                          <button
                            key={stage}
                            className={c.status === stage ? page.stageActive : page.stage}
                            onClick={() => handleStatusChange(c.id, stage)}
                          >
                            {stage}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className={page.removeLink} onClick={() => handleDelete(c.id)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardLayout>
    </>
  );
}
