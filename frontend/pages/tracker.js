import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Tracker.module.css';
import { API_BASE } from '../lib/apiBase';

/*
 * Tracker (PRD 3.5).
 *
 * Applications that actually reached an employer. In-progress work deliberately
 * does not appear here - it lives on the Dashboard - so this board answers one
 * question only: where has each real application got to.
 *
 * Cards say whether a submission was verified against the employer's own
 * confirmation or entered by hand. Those are different kinds of claim and the
 * board should not blur them.
 */

const BASE = API_BASE;

const COLUMNS = [
  { id: 'applied', label: 'Applied', empty: 'Verified applications land here automatically.' },
  { id: 'interviewing', label: 'Interviewing', empty: 'Move a card here when you hear back.' },
  { id: 'offer', label: 'Offer', empty: 'Nothing yet.' },
  { id: 'rejected', label: 'Rejected', empty: 'Nothing here.' },
  { id: 'ghosted', label: 'Ghosted', empty: 'Silent for a month or more.' },
];

export default function Tracker() {
  const router = useRouter();
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [columns, setColumns] = useState(null);
  const [counts, setCounts] = useState({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ company: '', title: '', location: '', url: '', stage: 'applied' });

  const load = useCallback(async (t, q = '') => {
    const res = await fetch(`${BASE}/api/tracker${q ? `?search=${encodeURIComponent(q)}` : ''}`, {
      headers: { Authorization: `Bearer ${t}` },
    }).catch(() => null);
    if (!res || !res.ok) return;
    const d = await res.json();
    setColumns(d.columns || {});
    setCounts(d.counts || {});
  }, []);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { router.replace('/login'); return; }
    setToken(t);
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch { /* stale */ }
    load(t);
  }, [router, load]);

  const move = async (id, stage) => {
    setBusy(true);
    await fetch(`${BASE}/api/tracker/${id}/stage`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    }).catch(() => null);
    await load(token, search);
    setBusy(false);
  };

  const addManual = async (e) => {
    e.preventDefault();
    if (!draft.company || !draft.title) return;
    setBusy(true);
    const res = await fetch(`${BASE}/api/tracker/manual`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    }).catch(() => null);
    if (res && res.ok) {
      setAdding(false);
      setDraft({ company: '', title: '', location: '', url: '', stage: 'applied' });
      await load(token, search);
    } else {
      setNotice('Could not add that application.');
    }
    setBusy(false);
  };

  const sweep = async () => {
    setBusy(true);
    const res = await fetch(`${BASE}/api/tracker/sweep-ghosted`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 30 }),
    }).catch(() => null);
    const d = res && res.ok ? await res.json() : null;
    setNotice(d ? `${d.moved} application${d.moved === 1 ? '' : 's'} silent for ${d.days}+ days moved to Ghosted.` : 'Could not sweep.');
    await load(token, search);
    setBusy(false);
  };

  const exportCsv = () => {
    // Auth is a bearer header, so a plain link cannot fetch this - pull it and
    // hand the browser a blob instead.
    fetch(`${BASE}/api/tracker/export.csv`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'hirepilot-tracker.csv';
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => setNotice('Could not export.'));
  };

  if (!columns) {
    return (
      <DashboardLayout user={user}>
        <Head><title>Tracker - HirePilot</title></Head>
        <div className={page.loading}>Loading…</div>
      </DashboardLayout>
    );
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <DashboardLayout user={user}>
      <Head><title>Tracker - HirePilot</title></Head>

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Tracker</h1>
          <p className={styles.pageSubtitle}>
            Applications that reached an employer. Anything still being filled
            stays on the Dashboard until it is actually sent.
          </p>
        </div>
      </div>

      <div className={page.toolbar}>
        <input
          className={page.search}
          placeholder="Search company or role…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); load(token, e.target.value); }}
        />
        <button className={page.ghostBtn} onClick={() => setAdding((v) => !v)}>Add application</button>
        <button className={page.ghostBtn} onClick={sweep} disabled={busy} title="Move applications silent for 30+ days">
          Sweep ghosted
        </button>
        <button className={page.ghostBtn} onClick={exportCsv}>Export CSV</button>
        <span className={page.total}>{total} tracked</span>
      </div>

      {notice && <div className={page.notice} onClick={() => setNotice(null)}>{notice}</div>}

      {adding && (
        <form className={page.addForm} onSubmit={addManual}>
          <p className={page.addHint}>
            For an application you made outside HirePilot. It is marked as your own
            record rather than a verified submission.
          </p>
          <div className={page.addRow}>
            <input required placeholder="Company" value={draft.company}
              onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
            <input required placeholder="Role" value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <input placeholder="Location" value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
            <select value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value })}>
              {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <button className={page.primaryBtn} disabled={busy}>Add</button>
          </div>
        </form>
      )}

      <div className={page.board}>
        {COLUMNS.map((col) => (
          <div key={col.id} className={page.col}>
            <div className={page.colHead}>
              <span className={page.colLabel}>{col.label}</span>
              <span className={page.colCount}>{counts[col.id] || 0}</span>
            </div>
            <div className={page.colBody}>
              {(columns[col.id] || []).length === 0 && (
                <p className={page.colEmpty}>{col.empty}</p>
              )}
              {(columns[col.id] || []).map((c) => (
                <div key={c.id} className={page.card}>
                  <div className={page.cardTitle}>{c.title}</div>
                  <div className={page.cardCo}>
                    {c.company_name}{c.location ? ` · ${c.location}` : ''}
                  </div>

                  {/* Verified vs self-reported is the distinction the whole
                      product rests on, so the card states which it is. */}
                  <div className={page.cardMeta}>
                    {c.is_manual ? (
                      <span className={page.tagManual}>Your own record</span>
                    ) : (
                      <span className={page.tagVerified}>Confirmed by employer</span>
                    )}
                    {c.submitted_at && (
                      <span className={page.cardDate}>
                        {new Date(c.submitted_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {c.employer_confirmation_id && (
                    <div className={page.cardRef}>Ref {c.employer_confirmation_id}</div>
                  )}

                  <select
                    className={page.moveSel}
                    value={c.tracker_stage}
                    onChange={(e) => move(c.id, e.target.value)}
                    disabled={busy}
                    aria-label={`Move ${c.title}`}
                  >
                    {COLUMNS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </DashboardLayout>
  );
}
