import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Network.module.css';

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

  const base = process.env.NEXT_PUBLIC_API_URL;

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

  const handleTrack = async (suggestion) => {
    try {
      const res = await fetch(`${base}/api/network`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          jobId: router.query.jobId || null,
          companyName: company,
          firstName: suggestion.firstName,
          lastName: suggestion.lastName,
          jobTitle: suggestion.title,
          relationshipType: suggestion.relationshipType,
          notes: suggestion.message,
        }),
      });
      if (res.ok) loadContacts(token);
    } catch (err) {
      console.error('Failed to track contact', err);
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

  const relBadge = { hiring_manager: 'Hiring Manager', alumni: 'Alumni', employee: 'Employee' };

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
            <p className={page.suggestedLabel}>Suggested contacts at {company}</p>
            <div className={page.suggestGrid}>
              {suggestions.map((s, i) => (
                <div key={i} className={styles.card} style={{ marginBottom: 0 }}>
                  <div className={page.suggestHeader}>
                    <div className={page.avatar}>{s.firstName[0]}{s.lastName[0]}</div>
                    <div style={{ flex: 1 }}>
                      <p className={page.suggestName}>{s.firstName} {s.lastName}</p>
                      <p className={page.suggestTitle}>{s.title}</p>
                    </div>
                    <span className={page.relBadge}>{relBadge[s.relationshipType]}</span>
                  </div>
                  <p className={page.mutualText}>{s.mutualConnections} mutual connections</p>
                  <p className={page.messageText}>&ldquo;{s.message}&rdquo;</p>
                  <div className={page.suggestActions}>
                    <a href={s.linkedinSearchUrl} target="_blank" rel="noreferrer" className={page.linkedinLink}>Connect on LinkedIn</a>
                    <button className={page.trackButton} onClick={() => handleTrack(s)}>Track</button>
                  </div>
                </div>
              ))}
            </div>
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
