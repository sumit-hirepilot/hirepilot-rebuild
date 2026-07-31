import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Inbox.module.css';

/*
 * Inbox (PRD 3.4).
 *
 * Recruiter mail arriving at a proxy address, categorised and matched back to
 * the application it belongs to.
 *
 * The category chips are a filter, not a verdict - a message the classifier
 * could not read stays in "Other" rather than being guessed into Rejection.
 * Telling someone they were rejected when they were not is the one error this
 * screen must never make.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://hirepilot-production-e70d.up.railway.app';

const CATEGORIES = [
  ['all', 'All'], ['verification', 'Verification'], ['rejection', 'Rejection'],
  ['interview', 'Interview'], ['assessment', 'Assessment'], ['reminder', 'Reminder'],
  ['offer', 'Offer'], ['applied', 'Applied'], ['other', 'Other'],
];

const TONE = {
  offer: 'good', interview: 'good', rejection: 'bad',
  assessment: 'warn', verification: 'info', reminder: 'warn',
};

export default function Inbox() {
  const router = useRouter();
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState(null);
  const [counts, setCounts] = useState({});
  const [proxyEmail, setProxyEmail] = useState(null);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (t, cat, q) => {
    const params = new URLSearchParams();
    if (cat && cat !== 'all') params.set('category', cat);
    if (q) params.set('search', q);
    const res = await fetch(`${BASE}/api/inbox?${params}`, {
      headers: { Authorization: `Bearer ${t}` },
    }).catch(() => null);
    if (!res || !res.ok) { setMessages([]); return; }
    const d = await res.json();
    setMessages(d.messages || []);
    setCounts(d.counts || {});
    setProxyEmail(d.proxyEmail || null);
  }, []);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { router.replace('/login'); return; }
    setToken(t);
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch { /* stale */ }
    load(t, 'all', '');
  }, [router, load]);

  const open = async (id) => {
    const res = await fetch(`${BASE}/api/inbox/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (res && res.ok) {
      const d = await res.json();
      setSelected(d.message);
      // Reflect the read state without a round trip for the whole list.
      setMessages((prev) => (prev || []).map((m) => (m.id === id ? { ...m, is_read: true } : m)));
    }
  };

  const copyProxy = () => {
    if (!proxyEmail) return;
    navigator.clipboard.writeText(proxyEmail).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* clipboard blocked - the address is on screen anyway */ });
  };

  if (!messages) {
    return (
      <DashboardLayout user={user}>
        <Head><title>Inbox - HirePilot</title></Head>
        <div className={page.loading}>Loading…</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout user={user}>
      <Head><title>Inbox - HirePilot</title></Head>

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Inbox</h1>
          <p className={styles.pageSubtitle}>
            Recruiter mail, sorted and matched to the application it belongs to.
            Verification codes are pulled out so autofill can use them.
          </p>
        </div>
      </div>

      {proxyEmail && (
        <div className={page.proxyBar}>
          <div>
            <span className={page.proxyLabel}>Your application address</span>
            <code className={page.proxyAddr}>{proxyEmail}</code>
          </div>
          <div className={page.proxyActions}>
            <button className={page.ghostBtn} onClick={copyProxy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <p className={page.proxyHint}>
            Use this when an application asks for your email, or forward recruiter
            mail here. It reaches your real inbox either way.
          </p>
        </div>
      )}

      <div className={page.chips}>
        {CATEGORIES.map(([id, label]) => {
          const n = id === 'all'
            ? Object.values(counts).reduce((a, b) => a + b, 0)
            : (counts[id] || 0);
          return (
            <button
              key={id}
              className={category === id ? page.chipOn : page.chip}
              onClick={() => { setCategory(id); setSelected(null); load(token, id, search); }}
            >
              {label}{n ? <span className={page.chipN}>{n}</span> : null}
            </button>
          );
        })}
      </div>

      <input
        className={page.search}
        placeholder="Search sender, subject or company…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); load(token, category, e.target.value); }}
      />

      <div className={page.split}>
        <div className={page.list}>
          {messages.length === 0 && (
            <div className={page.empty}>
              <strong>Nothing here yet.</strong>
              <p>
                Mail sent to your application address shows up here, sorted by what
                it is. Nothing is filed as a rejection unless it plainly says so.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <button
              key={m.id}
              className={`${page.item} ${selected?.id === m.id ? page.itemOn : ''} ${m.is_read ? '' : page.itemUnread}`}
              onClick={() => open(m.id)}
            >
              <div className={page.itemTop}>
                <span className={page.itemFrom}>{m.from_name || m.from_email || 'Unknown sender'}</span>
                <span className={`${page.cat} ${page[TONE[m.category] || 'neutral']}`}>{m.category}</span>
              </div>
              <div className={page.itemSubject}>{m.subject || '(no subject)'}</div>
              {m.job_title && <div className={page.itemJob}>{m.job_title}</div>}
              {m.otp_code && <div className={page.itemOtp}>Code {m.otp_code}</div>}
              <div className={page.itemDate}>
                {m.received_at ? new Date(m.received_at).toLocaleString() : ''}
              </div>
            </button>
          ))}
        </div>

        <div className={page.reader}>
          {!selected && <p className={page.readerEmpty}>Pick a message to read it.</p>}
          {selected && (
            <>
              <h2 className={page.readerSubject}>{selected.subject || '(no subject)'}</h2>
              <div className={page.readerFrom}>
                {selected.from_name ? `${selected.from_name} · ` : ''}{selected.from_email}
              </div>
              <div className={page.readerMeta}>
                <span className={`${page.cat} ${page[TONE[selected.category] || 'neutral']}`}>{selected.category}</span>
                {selected.job_title && <span>{selected.job_title} · {selected.job_company}</span>}
                {selected.received_at && <span>{new Date(selected.received_at).toLocaleString()}</span>}
              </div>
              {selected.otp_code && (
                <div className={page.otpBox}>
                  Verification code <strong>{selected.otp_code}</strong>
                </div>
              )}
              <pre className={page.readerBody}>{selected.body_text || '(no text content)'}</pre>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
