import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Agents.module.css';

export default function Agents() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', keywords: '', excludeKeywords: '' });
  const [runningId, setRunningId] = useState(null);
  const [message, setMessage] = useState('');

  const base = process.env.NEXT_PUBLIC_API_URL;

  const loadAgents = useCallback(async (authToken) => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/agents`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
      }
    } catch (err) {
      console.error('Failed to load agents', err);
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
    loadAgents(authToken);
  }, [router, loadAgents]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setMessage('');

    const keywords = formData.keywords.split(',').map((k) => k.trim()).filter(Boolean);
    if (!formData.name || keywords.length === 0) {
      setMessage('Name and at least one keyword are required.');
      return;
    }

    try {
      const res = await fetch(`${base}/api/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: formData.name,
          queryKeywords: keywords,
          excludeKeywords: formData.excludeKeywords.split(',').map((k) => k.trim()).filter(Boolean),
        }),
      });

      if (res.ok) {
        setFormData({ name: '', keywords: '', excludeKeywords: '' });
        setShowForm(false);
        loadAgents(token);
      } else {
        const data = await res.json();
        setMessage(data.error || 'Failed to create agent');
      }
    } catch (err) {
      setMessage('Failed to create agent');
    }
  };

  const handleRun = async (agentId) => {
    setRunningId(agentId);
    setMessage('');
    try {
      const res = await fetch(`${base}/api/agents/${agentId}/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`Scanned ${data.jobsScanned} jobs, found ${data.newMatches} new match${data.newMatches === 1 ? '' : 'es'}.`);
        loadAgents(token);
      } else {
        setMessage(data.error || 'Failed to run agent');
      }
    } catch (err) {
      setMessage('Failed to run agent');
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = async (agentId) => {
    try {
      const res = await fetch(`${base}/api/agents/${agentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) loadAgents(token);
    } catch (err) {
      console.error('Failed to delete agent', err);
    }
  };

  const handleToggleActive = async (agent) => {
    try {
      const res = await fetch(`${base}/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: agent.name,
          description: agent.description,
          isActive: !agent.is_active,
          queryKeywords: agent.query_keywords,
          includeKeywords: agent.include_keywords,
          excludeKeywords: agent.exclude_keywords,
        }),
      });
      if (res.ok) loadAgents(token);
    } catch (err) {
      console.error('Failed to update agent', err);
    }
  };

  if (!user) return null;

  return (
    <>
      <Head>
        <title>Search Agents - HirePilot</title>
      </Head>

      <DashboardLayout title="Search Agents" user={user}>
        <div className={page.headerRow}>
          <div>
            <p className={styles.dateLabel}>{agents.length} standing searches</p>
            <h1 className={styles.greeting}>Search Agents</h1>
          </div>
          <button className={page.newButton} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New agent'}
          </button>
        </div>

        {message && <div className={page.message}>{message}</div>}

        {showForm && (
          <form onSubmit={handleCreate} className={`${styles.card} ${page.form}`}>
            <div className={page.formGroup}>
              <label>Agent name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Senior Frontend Roles"
                className={page.input}
              />
            </div>
            <div className={page.formGroup}>
              <label>Keywords (comma separated)</label>
              <input
                type="text"
                value={formData.keywords}
                onChange={(e) => setFormData((p) => ({ ...p, keywords: e.target.value }))}
                placeholder="react, frontend, typescript"
                className={page.input}
              />
            </div>
            <div className={page.formGroup}>
              <label>Exclude keywords (optional)</label>
              <input
                type="text"
                value={formData.excludeKeywords}
                onChange={(e) => setFormData((p) => ({ ...p, excludeKeywords: e.target.value }))}
                placeholder="senior, lead"
                className={page.input}
              />
            </div>
            <button type="submit" className={page.newButton}>Create agent</button>
          </form>
        )}

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : agents.length === 0 ? (
          <div className={styles.card}>
            <p className={styles.emptyState}>
              No search agents yet. Create one to have HirePilot keep scanning for jobs matching your keywords.
            </p>
          </div>
        ) : (
          <div className={page.list}>
            {agents.map((agent) => (
              <div key={agent.id} className={styles.card} style={{ marginBottom: '1rem' }}>
                <div className={page.agentHeader}>
                  <div>
                    <p className={page.agentName}>{agent.name}</p>
                    <p className={page.agentKeywords}>
                      Keywords: {(agent.query_keywords || []).join(', ') || '—'}
                    </p>
                    {agent.exclude_keywords?.length > 0 && (
                      <p className={page.agentKeywords}>
                        Excludes: {agent.exclude_keywords.join(', ')}
                      </p>
                    )}
                  </div>
                  <span className={agent.is_active ? page.badgeActive : page.badgeInactive}>
                    {agent.is_active ? 'Active' : 'Paused'}
                  </span>
                </div>

                <div className={page.agentMeta}>
                  <span>{agent.match_count} match{agent.match_count === '1' ? '' : 'es'} found</span>
                  <span>
                    {agent.last_run_at ? `Last run ${new Date(agent.last_run_at).toLocaleString()}` : 'Never run'}
                  </span>
                </div>

                <div className={page.agentActions}>
                  <button className={page.runButton} onClick={() => handleRun(agent.id)} disabled={runningId === agent.id}>
                    {runningId === agent.id ? 'Running...' : 'Run now'}
                  </button>
                  <button className={page.secondaryButton} onClick={() => handleToggleActive(agent)}>
                    {agent.is_active ? 'Pause' : 'Resume'}
                  </button>
                  <button className={page.deleteButton} onClick={() => handleDelete(agent.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DashboardLayout>
    </>
  );
}
