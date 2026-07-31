import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Profile.module.css';
import { API_BASE } from '../lib/apiBase';

/*
 * Profile (PRD 3.8).
 *
 * Everything here is an answer that will be typed into a real employer's form,
 * so the screen is built around one rule: a blank is a blank. Nothing is
 * pre-selected on the user's behalf, and the self-identification section says
 * plainly that leaving it empty is a valid choice - because on the actual ATS
 * form it is, and defaulting it would make a claim nobody made.
 *
 * The completeness meter counts only the fields forms genuinely ask for, so it
 * measures how often Auto Apply will have to stop and ask rather than how full
 * the page looks.
 */

const BASE = API_BASE;

const YES_NO = [['', 'Not answered'], ['true', 'Yes'], ['false', 'No']];

const SELF_ID = {
  self_id_gender: {
    label: 'Gender',
    options: ['Male', 'Female', 'Non-binary', 'Decline to self-identify'],
  },
  self_id_ethnicity: {
    label: 'Race / ethnicity',
    options: ['Asian', 'Black or African American', 'Hispanic or Latino',
      'Native American or Alaska Native', 'Native Hawaiian or Pacific Islander',
      'White', 'Two or more races', 'Decline to self-identify'],
  },
  self_id_veteran: {
    label: 'Veteran status',
    options: ['I am not a protected veteran', 'I identify as a protected veteran',
      'Decline to self-identify'],
  },
  self_id_disability: {
    label: 'Disability status',
    options: ['Yes, I have a disability (or previously had one)',
      'No, I do not have a disability', 'Decline to self-identify'],
  },
};

// Only fields employers actually ask for. See the note above.
const COUNTED = [
  'full_name', 'email', 'phone', 'current_location', 'linkedin_url',
  'years_experience', 'notice_period', 'salary_expectation', 'work_authorization',
  'authorized_countries',
];

export default function Profile() {
  const router = useRouter();
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [p, setP] = useState(null);
  const [knowledge, setKnowledge] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async (t) => {
    const get = (path) => fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [ap, kn] = await Promise.all([get('/api/apply/profile'), get('/api/apply/knowledge')]);
    setP(ap?.profile || {});
    setKnowledge(kn?.stats || kn || null);
  }, []);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { router.replace('/login'); return; }
    setToken(t);
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch { /* stale */ }
    load(t);
  }, [router, load]);

  const set = (k, v) => setP((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setBusy(true);
    setNotice(null);
    // Send only what this screen owns. custom_answers is merged server-side and
    // must not be touched from here - a partial write once wiped 49 answers.
    const body = {};
    for (const [k, v] of Object.entries(p || {})) {
      if (k === 'custom_answers' || k === 'user_id' || k === 'id') continue;
      if (k.endsWith('_at')) continue;
      body[k] = v === '' ? null : v;
    }
    const res = await fetch(`${BASE}/api/apply/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setNotice(res && res.ok ? 'Saved. These answers are reused on every future application.' : 'Could not save.');
    if (res && res.ok) await load(token);
    setBusy(false);
  };

  if (!p) {
    return (
      <DashboardLayout user={user}>
        <Head><title>Profile - HirePilot</title></Head>
        <div className={page.loading}>Loading…</div>
      </DashboardLayout>
    );
  }

  const filled = COUNTED.filter((f) => {
    const v = p[f];
    return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== '';
  }).length;
  const pct = Math.round((filled / COUNTED.length) * 100);
  const savedAnswers = Object.keys(p.custom_answers || {}).length;

  const text = (k, label, extra = {}) => (
    <label className={page.field}>
      <span className={page.label}>{label}</span>
      <input
        className={page.input}
        value={p[k] ?? ''}
        onChange={(e) => set(k, e.target.value)}
        {...extra}
      />
    </label>
  );

  const bool = (k, label, hint) => (
    <label className={page.field}>
      <span className={page.label}>{label}</span>
      <select className={page.input} value={String(p[k] ?? '')} onChange={(e) => set(k, e.target.value === '' ? null : e.target.value === 'true')}>
        {YES_NO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <span className={page.hint}>{hint}</span>}
    </label>
  );

  return (
    <DashboardLayout user={user}>
      <Head><title>Profile - HirePilot</title></Head>

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Profile</h1>
          <p className={styles.pageSubtitle}>
            The answers HirePilot types into employers&apos; forms. Every one of
            these is reused on every future application.
          </p>
        </div>
        <button className={page.saveBtn} onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>

      {notice && <div className={page.notice} onClick={() => setNotice(null)}>{notice}</div>}

      <div className={page.meterCard}>
        <div className={page.meterTop}>
          <span className={page.meterPct}>{pct}% complete</span>
          <span className={page.meterSub}>
            {filled} of {COUNTED.length} fields employers commonly ask for
          </span>
        </div>
        <div className={page.meterTrack}><div className={page.meterFill} style={{ width: `${pct}%` }} /></div>
        <p className={page.meterHint}>
          This counts only what forms actually ask. Each gap is a place Auto
          Apply has to stop and ask you mid-run.
          {savedAnswers > 0 && ` You also have ${savedAnswers} saved answers to questions beyond these.`}
        </p>
      </div>

      <div className={page.grid}>
        <section className={page.card}>
          <h2 className={page.cardTitle}>Identity and contact</h2>
          <div className={page.fields}>
            {text('full_name', 'Full name')}
            {text('email', 'Email', { type: 'email' })}
            {text('phone', 'Phone')}
            {text('current_location', 'Current location')}
            {text('zip_code', 'Postal / ZIP code')}
            {text('linkedin_url', 'LinkedIn URL')}
            {text('portfolio_url', 'Portfolio URL')}
            {text('github_url', 'GitHub URL')}
            {text('pronouns', 'Pronouns')}
          </div>
        </section>

        <section className={page.card}>
          <h2 className={page.cardTitle}>Current role</h2>
          <div className={page.fields}>
            {text('current_title', 'Job title')}
            {text('current_company', 'Company')}
            {text('years_experience', 'Years of experience', { type: 'number', min: 0, max: 60 })}
            {text('notice_period', 'Notice period', { placeholder: 'e.g. Immediate (0 days)' })}
            {text('salary_expectation', 'Expected salary')}
            {text('salary_currency', 'Currency', { placeholder: 'INR' })}
          </div>
          <p className={page.hint}>
            Expected salary is never used to answer a question about your current
            salary. The two are kept deliberately separate.
          </p>
        </section>

        <section className={page.card}>
          <h2 className={page.cardTitle}>Work authorization</h2>
          <div className={page.fields}>
            {text('work_authorization', 'Authorization status')}
            {text('visa_type', 'Visa type', { placeholder: 'e.g. None required, H-1B, Tier 2' })}
            <label className={page.field}>
              <span className={page.label}>Countries you can work in</span>
              <input
                className={page.input}
                value={(p.authorized_countries || []).join(', ')}
                onChange={(e) => set('authorized_countries', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
                placeholder="India, United Kingdom"
              />
              <span className={page.hint}>
                Comma separated. Used per posting: a role in a country not on this
                list is answered &quot;no&quot;, not guessed.
              </span>
            </label>
            {bool('requires_sponsorship', 'Requires visa sponsorship')}
          </div>
        </section>

        <section className={page.card}>
          <h2 className={page.cardTitle}>Work preferences</h2>
          <div className={page.fields}>
            {bool('willing_to_relocate', 'Willing to relocate')}
            {bool('in_person_ok', 'Can work in person / on site')}
            {bool('start_immediately', 'Can start immediately')}
            {bool('has_transport', 'Have reliable transport')}
            {bool('needs_accommodation', 'Need workplace accommodations')}
          </div>
        </section>

        <section className={page.card}>
          <h2 className={page.cardTitle}>Background disclosures</h2>
          <div className={page.fields}>
            {bool('prior_employee', 'Previously employed by the company applied to', 'Asked by name on the form, so this is only a default.')}
            {text('gov_clearance', 'Security clearance', { placeholder: 'e.g. None' })}
            {bool('gov_ties', 'Government or state-owned entity ties')}
          </div>
        </section>

        <section className={page.card}>
          <h2 className={page.cardTitle}>Voluntary self-identification</h2>
          {/* The one section that must never be filled in on someone's behalf. */}
          <p className={page.cardHint}>
            Optional on every form that asks, and optional here. Left blank,
            HirePilot leaves the question blank rather than choosing for you —
            including &quot;decline to answer&quot;, which is itself an answer.
          </p>
          <div className={page.fields}>
            {Object.entries(SELF_ID).map(([k, cfg]) => (
              <label className={page.field} key={k}>
                <span className={page.label}>{cfg.label}</span>
                <select className={page.input} value={p[k] ?? ''} onChange={(e) => set(k, e.target.value)}>
                  <option value="">Not answered</option>
                  {cfg.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>

        <section className={page.card}>
          <h2 className={page.cardTitle}>What HirePilot has learned</h2>
          <p className={page.cardHint}>
            Answers picked up from real forms and reused since. This is what makes
            each application ask you less than the last.
          </p>
          <div className={page.learnRow}>
            <div className={page.learnStat}>
              <span className={page.learnNum}>{savedAnswers}</span>
              <span className={page.learnLabel}>saved answers</span>
            </div>
            <div className={page.learnStat}>
              <span className={page.learnNum}>{knowledge?.variations ?? 0}</span>
              <span className={page.learnLabel}>question wordings recognised</span>
            </div>
            <div className={page.learnStat}>
              <span className={page.learnNum}>{knowledge?.concepts ?? 0}</span>
              <span className={page.learnLabel}>distinct questions understood</span>
            </div>
          </div>
        </section>
      </div>

      <div className={page.footBar}>
        <button className={page.saveBtn} onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </DashboardLayout>
  );
}
