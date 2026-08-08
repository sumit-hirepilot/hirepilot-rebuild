import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback, useRef } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Agents.module.css';
import { API_BASE } from '../lib/apiBase';

function ChipInput({ values, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const addChip = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };

  return (
    <div className={page.chipInputWrap}>
      {values.map((v) => (
        <span key={v} className={page.chip}>
          {v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))}>&times;</button>
        </span>
      ))}
      <input
        ref={inputRef}
        className={page.chipInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addChip();
          }
        }}
        onBlur={addChip}
        placeholder={placeholder}
      />
    </div>
  );
}

export default function Agents() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [runningId, setRunningId] = useState(null);
  const [message, setMessage] = useState('');
  const [estimate, setEstimate] = useState(0);

  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState([]);
  const [locations, setLocations] = useState([]);
  const [remoteOk, setRemoteOk] = useState(true);
  const [minSalary, setMinSalary] = useState(100);
  const [maxSalary, setMaxSalary] = useState(250);
  const [minMatchScore, setMinMatchScore] = useState(75);
  const [autoApply, setAutoApply] = useState(false);

  const base = API_BASE;

  const loadAgents = useCallback(async (authToken) => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/agents`, { headers: { Authorization: `Bearer ${authToken}` } });
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

  useEffect(() => {
    if (!showForm || !token || keywords.length === 0) {
      setEstimate(0);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${base}/api/agents/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ queryKeywords: keywords, remoteOk }),
        });
        const data = await res.json();
        if (res.ok) setEstimate(data.estimate);
      } catch (err) { /* ignore */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [keywords, remoteOk, showForm, token, base]);

  const resetForm = () => {
    setName(''); setKeywords([]); setLocations([]); setRemoteOk(true);
    setMinSalary(100); setMaxSalary(250); setMinMatchScore(75); setAutoApply(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setMessage('');

    if (!name || keywords.length === 0) {
      setMessage('Name and at least one keyword are required.');
      return;
    }

    try {
      const res = await fetch(`${base}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name,
          queryKeywords: keywords,
          preferredLocations: locations,
          remoteOk,
          minSalary: minSalary * 1000,
          maxSalary: maxSalary * 1000,
          minMatchScore: minMatchScore / 100,
          autoApply,
        }),
      });

      if (res.ok) {
        resetForm();
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isActive: !agent.is_active }),
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
        <title>Saved searches - HirePilot</title>
      </Head>

      <DashboardLayout title="Saved searches" user={user}>
        <div className={page.headerRow}>
          <div>
            <p className={styles.dateLabel}>{agents.length} standing searches</p>
            <h1 className={styles.greeting}>Saved searches</h1>
          </div>
          <button className={page.newButton} onClick={() => setShowForm(true)}>+ New saved search</button>
        </div>

        {message && <div className={page.message}>{message}</div>}

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : agents.length === 0 ? (
          <div className={styles.card}>
            <p className={styles.emptyState}>
              No saved searches yet. Create one and HirePilot keeps scanning for jobs matching your keywords.
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
                      {(agent.preferred_locations || []).join(', ') || 'World'} &middot; min match {Math.round((agent.min_match_score || 0.75) * 100)}%
                    </p>
                  </div>
                  <span className={agent.is_active ? page.badgeActive : page.badgeInactive}>
                    {agent.is_active ? 'Active' : 'Paused'}
                  </span>
                </div>

                <div className={page.agentStats}>
                  <div>
                    <p className={page.statNum}>{agent.match_count}</p>
                    <p className={page.statLabel}>jobs found</p>
                  </div>
                  <div>
                    <p className={page.statNum}>{agent.applied_count}</p>
                    <p className={page.statLabel}>applied</p>
                  </div>
                </div>

                <div className={page.agentActions}>
                  <button className={page.runButton} onClick={() => handleRun(agent.id)} disabled={runningId === agent.id}>
                    {runningId === agent.id ? 'Running...' : 'Run Now'}
                  </button>
                  {agent.match_count > 0 && (
                    <button className={page.secondaryButton} onClick={() => router.push(`/agents/${agent.id}`)}>
                      View matches ({agent.match_count})
                    </button>
                  )}
                  <button className={page.secondaryButton} onClick={() => handleToggleActive(agent)}>
                    {agent.is_active ? 'Pause' : 'Resume'}
                  </button>
                  <button className={page.deleteButton} onClick={() => handleDelete(agent.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DashboardLayout>

      {showForm && (
        <div className={page.modalOverlay} onClick={() => setShowForm(false)}>
          <div className={page.modal} onClick={(e) => e.stopPropagation()}>
            <div className={page.modalHeader}>
              <h2>Create search agent</h2>
              <button onClick={() => setShowForm(false)}>&times;</button>
            </div>

            <form onSubmit={handleCreate}>
              <label className={page.label}>Name + keywords</label>
              <input
                className={page.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agent name"
              />
              <ChipInput values={keywords} onChange={setKeywords} placeholder="Add a keyword (e.g. Product Designer)" />

              <label className={page.label} style={{ marginTop: '1rem' }}>Locations</label>
              <ChipInput values={locations} onChange={setLocations} placeholder="Add a location" />

              <div className={page.toggleRow}>
                <button
                  type="button"
                  className={remoteOk ? page.toggleOn : page.toggleOff}
                  onClick={() => setRemoteOk((v) => !v)}
                >
                  <span />
                </button>
                <span>Remote OK</span>
              </div>

              <label className={page.label}>Salary range</label>
              <div className={page.rangeLabels}>
                <span>${minSalary}K</span>
                <span>${maxSalary}K</span>
              </div>
              <input type="range" min="0" max="150" value={minSalary} onChange={(e) => setMinSalary(Math.min(Number(e.target.value), maxSalary))} className={page.slider} />
              <input type="range" min="150" max="400" value={maxSalary} onChange={(e) => setMaxSalary(Math.max(Number(e.target.value), minSalary))} className={page.slider} />

              <label className={page.label}>Minimum match score: {minMatchScore}%</label>
              <input type="range" min="0" max="100" value={minMatchScore} onChange={(e) => setMinMatchScore(Number(e.target.value))} className={page.slider} />

              <div className={page.toggleRow}>
                <button
                  type="button"
                  className={autoApply ? page.toggleOn : page.toggleOff}
                  onClick={() => setAutoApply((v) => !v)}
                >
                  <span />
                </button>
                <span>Auto-apply to matches</span>
              </div>

              <div className={page.estimateBox}>This agent will find ~{estimate} jobs per week.</div>

              <button type="submit" className={page.createButton}>Save search</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
