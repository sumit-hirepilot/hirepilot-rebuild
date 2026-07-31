import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Settings.module.css';
import { API_BASE } from '../lib/apiBase';

const TABS = ['Account', 'Apply', 'Memory', 'Portfolio', 'Plans', 'Referrals', 'Email',
  'Apply Profile', 'Preferences', 'Auto-Pilot', 'Integrations', 'Profile'];

const BASE_URL = API_BASE;

function ChipInput({ values, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
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
        className={page.chipInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addChip(); } }}
        onBlur={addChip}
        placeholder={placeholder}
      />
    </div>
  );
}

export default function Settings() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [tab, setTab] = useState('Account');
  // PRD 3.9 specifies deep links of the form /settings?tab=Plans, which the
  // credit pill and the near-limit banner both point at.
  const [plans, setPlans] = useState(null);
  const [prefsForm, setPrefsForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const [profileForm, setProfileForm] = useState({ fullName: '', title: '', location: '', profileSummary: '' });
  const [skills, setSkills] = useState([]);
  const [preferences, setPreferences] = useState({
    defaultRoles: [], preferredLocations: [], workArrangements: [],
    autoApplyEnabled: false, autoApplyLimitPerDay: 10, autoApplyMinScore: 75,
    blacklistCompanies: [], dreamCompanies: [],
    resumeTailorMode: 'honest', autoTailorResume: true,
    coverLetterMode: 'always', reviewBeforeSubmit: false,
  });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  // Application Profile: the answers employer forms ask on every application.
  // Kept separate from the display profile above because these values are
  // submitted to employers, so nothing here is ever guessed or defaulted.
  const [applyProfile, setApplyProfile] = useState(null);
  const [applyCompleteness, setApplyCompleteness] = useState(0);
  const [savingApply, setSavingApply] = useState(false);
  const [runningAutoPilot, setRunningAutoPilot] = useState(false);

  const base = API_BASE;

  const loadProfile = useCallback(async (authToken) => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/profile`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) {
        const data = await res.json();
        setProfileForm({
          fullName: data.user.full_name || '',
          title: data.user.title || '',
          location: data.user.location || '',
          profileSummary: data.user.profile_summary || '',
        });
        setSkills((data.skills || []).map((s) => s.skill));
        if (data.preferences) {
          setPreferences({
            defaultRoles: data.preferences.default_roles || [],
            preferredLocations: data.preferences.preferred_locations || [],
            workArrangements: data.preferences.work_arrangements || [],
            autoApplyEnabled: data.preferences.auto_apply_enabled || false,
            autoApplyLimitPerDay: data.preferences.auto_apply_limit_per_day || 10,
            autoApplyMinScore: Math.round((data.preferences.auto_apply_min_score || 0.75) * 100),
            blacklistCompanies: data.preferences.blacklist_companies || [],
            dreamCompanies: data.preferences.dream_companies || [],
            resumeTailorMode: data.preferences.resume_tailor_mode || 'honest',
            autoTailorResume: data.preferences.auto_tailor_resume !== false,
            coverLetterMode: data.preferences.cover_letter_mode || 'always',
            reviewBeforeSubmit: data.preferences.review_before_submit || false,
          });
        }
      }
    } finally {
      setLoading(false);
    }
  }, [base]);

  const loadApplyProfile = useCallback(async (authToken) => {
    try {
      const res = await fetch(`${base}/api/apply/profile`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) {
        const data = await res.json();
        setApplyProfile(data.profile || {});
        setApplyCompleteness(data.completeness || 0);
      }
    } catch { /* section shows a retry state */ }
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
    loadProfile(authToken);
    loadApplyProfile(authToken);

    // Plans and the two apply toggles power the new tabs; both fail quietly so
    // a settings page never blanks because one panel could not load.
    fetch(`${BASE_URL}/api/plans`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setPlans(d)).catch(() => {});
    fetch(`${BASE_URL}/api/profile`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.preferences && setPrefsForm(d.preferences))
      .catch(() => {});
  }, [router, loadProfile, loadApplyProfile]);

  // Honour ?tab= on load and on back/forward.
  useEffect(() => {
    const t = router.query.tab;
    if (typeof t === 'string' && TABS.includes(t)) setTab(t);
  }, [router.query.tab]);

  // The two account-level toggles that govern the whole apply flow (PRD 4).
  const savePref = async (patch) => {
    setPrefsForm((prev) => ({ ...prev, ...patch }));
    const body = {};
    if ('auto_approve' in patch) body.autoApprove = patch.auto_approve;
    if ('review_before_submit' in patch) body.reviewBeforeSubmit = patch.review_before_submit;
    if ('portfolio_public' in patch) body.portfolioPublic = patch.portfolio_public;
    if ('notify_recommendations' in patch) body.notifyRecommendations = patch.notify_recommendations;
    if ('notify_product' in patch) body.notifyProduct = patch.notify_product;
    if ('timezone' in patch) body.timezone = patch.timezone;
    /*
     * /preferences, not /profile. PUT /api/profile updates the USER row (name,
     * title, location) and ignores everything else, so posting preference keys
     * there returned 200 and silently changed nothing - every toggle on these
     * tabs would have looked saved and done nothing.
     */
    const res = await fetch(`${BASE_URL}/api/profile/preferences`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res && res.ok) {
      // Re-seed from the server so the switch reflects what was actually stored
      // rather than what was clicked.
      const saved = await res.json().catch(() => null);
      if (saved) setPrefsForm(saved);
    } else {
      setMessage('Could not save that setting.');
    }
  };

  const choosePlan = async (tier) => {
    const res = await fetch(`${BASE_URL}/api/plans/select`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    }).catch(() => null);
    if (res && res.ok) {
      const d = await res.json();
      setPlans((prev) => (prev ? { ...prev, current: d.current } : prev));
      setMessage(`Switched to ${d.current.tierName}. No payment was taken — billing is not connected yet.`);
    }
  };

  const saveApplyProfile = async (e) => {
    e.preventDefault();
    setSavingApply(true);
    try {
      const res = await fetch(`${base}/api/apply/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(applyProfile),
      });
      const data = await res.json();
      if (res.ok) {
        setApplyProfile(data.profile);
        setApplyCompleteness(data.completeness || 0);
        flash('Application profile saved.');
      } else {
        flash(data.error || 'Could not save.');
      }
    } finally {
      setSavingApply(false);
    }
  };

  const ap = (field) => applyProfile?.[field] ?? '';
  const setAp = (field, value) => setApplyProfile((p) => ({ ...(p || {}), [field]: value }));
  // Tri-state boolean: employer forms distinguish "No" from "not answered",
  // so these selects round-trip null explicitly.
  const apBool = (field) => {
    const v = applyProfile?.[field];
    return v === true ? 'yes' : v === false ? 'no' : '';
  };
  const setApBool = (field, raw) => {
    setApplyProfile((p) => ({
      ...(p || {}),
      [field]: raw === 'yes' ? true : raw === 'no' ? false : null,
    }));
  };

  const flash = (text) => {
    setMessage(text);
    setTimeout(() => setMessage(''), 4000);
  };

  const recalcMatches = (authToken) => {
    fetch(`${base}/api/matches/recalculate`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } }).catch(() => {});
  };

  const handleAddSkill = async (skill) => {
    const res = await fetch(`${base}/api/profile/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ skill }),
    });
    if (res.ok) {
      setSkills((prev) => [...prev, skill]);
      recalcMatches(token);
    }
  };

  const handleRemoveSkill = async (skill) => {
    const profileRes = await fetch(`${base}/api/profile`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await profileRes.json();
    const match = (data.skills || []).find((s) => s.skill === skill);
    if (match) {
      await fetch(`${base}/api/profile/skills/${match.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      setSkills((prev) => prev.filter((s) => s !== skill));
      recalcMatches(token);
    }
  };

  const handleProfileSave = async (e) => {
    e.preventDefault();
    const res = await fetch(`${base}/api/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(profileForm),
    });
    if (res.ok) {
      const updated = await res.json();
      const storedUser = JSON.parse(localStorage.getItem('user'));
      const merged = { ...storedUser, fullName: updated.full_name };
      localStorage.setItem('user', JSON.stringify(merged));
      setUser(merged);
      flash('Profile updated.');
      recalcMatches(token);
    } else {
      flash('Failed to update profile.');
    }
  };

  const savePreferences = async (extra) => {
    const res = await fetch(`${base}/api/profile/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        defaultRoles: preferences.defaultRoles,
        preferredLocations: preferences.preferredLocations,
        workArrangements: preferences.workArrangements,
        autoApplyEnabled: preferences.autoApplyEnabled,
        autoApplyLimitPerDay: preferences.autoApplyLimitPerDay,
        autoApplyMinScore: preferences.autoApplyMinScore / 100,
        blacklistCompanies: preferences.blacklistCompanies,
        dreamCompanies: preferences.dreamCompanies,
        resumeTailorMode: preferences.resumeTailorMode,
        autoTailorResume: preferences.autoTailorResume,
        coverLetterMode: preferences.coverLetterMode,
        reviewBeforeSubmit: preferences.reviewBeforeSubmit,
        ...extra,
      }),
    });
    flash(res.ok ? 'Saved.' : 'Failed to save.');
    if (res.ok) recalcMatches(token);
  };

  const toggleArrayValue = (field, value) => {
    setPreferences((prev) => {
      const arr = prev[field];
      const exists = arr.includes(value);
      return { ...prev, [field]: exists ? arr.filter((v) => v !== value) : [...arr, value] };
    });
  };

  const handleRunAutoPilotNow = async () => {
    setRunningAutoPilot(true);
    try {
      const res = await fetch(`${base}/api/applications/run-auto-pilot`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      flash(res.ok ? data.message : (data.error || 'Failed to run Auto-Pilot'));
    } catch (err) {
      flash('Failed to run Auto-Pilot');
    } finally {
      setRunningAutoPilot(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      flash('New passwords do not match.');
      return;
    }
    const res = await fetch(`${base}/api/profile/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }),
    });
    const data = await res.json();
    if (res.ok) {
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      flash('Password updated.');
    } else {
      flash(data.error || 'Failed to update password.');
    }
  };

  if (!user) return null;

  return (
    <>
      <Head>
        <title>Settings - HirePilot</title>
      </Head>

      <DashboardLayout title="Settings" user={user}>
        <h1 className={styles.greeting} style={{ marginTop: 0 }}>Settings</h1>

        <div className={page.tabs}>
          {TABS.map((t) => (
            <button
              key={t}
              className={tab === t ? page.tabActive : page.tab}
              onClick={() => {
                setTab(t);
                // shallow: the tab is client state, so this updates the address
                // bar for sharing and back-button without refetching the page.
                router.push({ pathname: '/settings', query: { tab: t } }, undefined, { shallow: true });
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {message && <div className={page.message}>{message}</div>}

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : tab === 'Apply' ? (
          <div className={styles.card}>
            <p className={page.masterTitle}>How applying behaves</p>
            <p className={page.masterSubtitle}>
              Two switches govern the whole flow. Everything else follows from them.
            </p>

            <label className={page.toggleRow}>
              <input
                type="checkbox"
                checked={prefsForm?.auto_approve !== false}
                onChange={(e) => savePref({ auto_approve: e.target.checked })}
              />
              <span>
                <strong>Auto-approve</strong>
                <em>Skip the tailoring preview and apply straight through.</em>
              </span>
            </label>

            <label className={page.toggleRow}>
              <input
                type="checkbox"
                checked={Boolean(prefsForm?.review_before_submit)}
                onChange={(e) => savePref({ review_before_submit: e.target.checked })}
              />
              <span>
                <strong>Review before submit</strong>
                <em>
                  Pause on the review screen before anything is sent, whatever
                  Auto-approve says. Off by default on this account because you
                  asked for the approval step to be removed — turning it on puts
                  it back for every application.
                </em>
              </span>
            </label>

            <p className={page.masterSubtitle} style={{ marginTop: 16 }}>
              Neither switch changes what &quot;Applied&quot; means. That still
              requires the employer&apos;s own confirmation.
            </p>
          </div>
        ) : tab === 'Memory' ? (
          <div className={styles.card}>
            <p className={page.masterTitle}>What HirePilot remembers</p>
            <p className={page.masterSubtitle}>
              Answers picked up from real forms and reused since. Edit or delete
              any of them — a wrong answer here would be repeated on every future
              application.
            </p>
            {applyProfile && Object.keys(applyProfile.custom_answers || {}).length === 0 && (
              <p className={styles.emptyState}>Nothing learned yet.</p>
            )}
            {applyProfile && Object.entries(applyProfile.custom_answers || {}).slice(0, 200).map(([k, v]) => {
              const answer = typeof v === 'string' ? v : v?.answer;
              const question = (typeof v === 'object' && v?.question) || k.replace(/_/g, ' ');
              return (
                <div key={k} className={page.memoryRow}>
                  <div className={page.memoryQ}>{question}</div>
                  <div className={page.memoryA}>{answer}</div>
                </div>
              );
            })}
            <p className={page.masterSubtitle} style={{ marginTop: 14 }}>
              Full editing lives on the <a href="/profile">Profile</a> page.
            </p>
          </div>
        ) : tab === 'Portfolio' ? (
          <div className={styles.card}>
            <p className={page.masterTitle}>Public portfolio</p>
            <p className={page.masterSubtitle}>Private by default. Nothing is shared until you turn this on.</p>
            <label className={page.toggleRow}>
              <input
                type="checkbox"
                checked={Boolean(prefsForm?.portfolio_public)}
                onChange={(e) => savePref({ portfolio_public: e.target.checked })}
              />
              <span>
                <strong>Make my portfolio public</strong>
                <em>Publishes a page with your work history and links.</em>
              </span>
            </label>
          </div>
        ) : tab === 'Plans' ? (
          <div className={styles.card}>
            <p className={page.masterTitle}>Plan</p>
            {plans?.current && (
              <p className={page.masterSubtitle}>
                On <strong>{plans.current.tierName}</strong> — {plans.current.remaining} of{' '}
                {plans.current.total} applications left this month.
              </p>
            )}
            {plans && <p className={page.masterSubtitle}>{plans.creditPolicy}</p>}
            <div className={page.planGrid}>
              {(plans?.tiers || []).map((t) => (
                <div key={t.id} className={plans?.current?.tier === t.id ? page.planCardOn : page.planCard}>
                  <div className={page.planName}>
                    {t.name}{t.popular && <span className={page.planTag}>Most popular</span>}
                  </div>
                  <div className={page.planApps}>{t.applicationsPerMonth.toLocaleString()}<small> applications / month</small></div>
                  <ul className={page.planFeatures}>
                    {t.features.map((f) => <li key={f}>{f}</li>)}
                    <li>{t.autoApply ? 'Auto Apply included' : 'Auto Apply not included'}</li>
                  </ul>
                  <button
                    className={page.saveButton}
                    disabled={plans?.current?.tier === t.id}
                    onClick={() => choosePlan(t.id)}
                  >
                    {plans?.current?.tier === t.id ? 'Current plan' : `Switch to ${t.name}`}
                  </button>
                </div>
              ))}
            </div>
            {/* Stated rather than implied: no card is charged, because no
                billing provider is connected. */}
            <p className={page.masterSubtitle} style={{ marginTop: 14 }}>
              Billing is not connected yet, so switching plans takes no payment
              and asks for no card. Prices are not shown because they have not
              been set.
            </p>
          </div>
        ) : tab === 'Referrals' ? (
          <div className={styles.card}>
            <p className={page.masterTitle}>Referrals</p>
            <p className={page.masterSubtitle}>
              Share your link. Rewards are paid in free applications.
            </p>
            <div className={page.referralBox}>
              <code>
                {typeof window !== 'undefined' ? `${window.location.origin}/signup?ref=${user?.id || ''}` : ''}
              </code>
            </div>
            <p className={page.masterSubtitle}>
              Nothing is credited automatically yet — referral rewards need the
              billing side wired up first, and showing a balance that cannot be
              spent would be worse than showing none.
            </p>
          </div>
        ) : tab === 'Email' ? (
          <div className={styles.card}>
            <p className={page.masterTitle}>Email and notifications</p>
            <label className={page.toggleRow}>
              <input
                type="checkbox"
                checked={prefsForm?.notify_recommendations !== false}
                onChange={(e) => savePref({ notify_recommendations: e.target.checked })}
              />
              <span><strong>Job recommendations</strong><em>New matches at your bar.</em></span>
            </label>
            <label className={page.toggleRow}>
              <input
                type="checkbox"
                checked={Boolean(prefsForm?.notify_product)}
                onChange={(e) => savePref({ notify_product: e.target.checked })}
              />
              <span><strong>Product updates</strong><em>Occasional notes about new features.</em></span>
            </label>
            <div className={page.formGroup} style={{ marginTop: 14 }}>
              <label>Timezone</label>
              <input
                className={page.input}
                value={prefsForm?.timezone || ''}
                placeholder="Asia/Kolkata"
                onChange={(e) => setPrefsForm((prev) => ({ ...prev, timezone: e.target.value }))}
                onBlur={(e) => savePref({ timezone: e.target.value })}
              />
            </div>
            <p className={page.masterSubtitle} style={{ marginTop: 14 }}>
              Recruiter mail is handled on the <a href="/inbox">Inbox</a> page,
              which has your forwarding address.
            </p>
          </div>
        ) : tab === 'Profile' ? (
          <div className={styles.card}>
            <form onSubmit={handleProfileSave} className={page.form}>
              <div className={page.formRow}>
                <div className={page.formGroup}>
                  <label>Name</label>
                  <input className={page.input} value={profileForm.fullName} onChange={(e) => setProfileForm((p) => ({ ...p, fullName: e.target.value }))} />
                </div>
                <div className={page.formGroup}>
                  <label>Email</label>
                  <input className={page.input} value={user.email} disabled />
                </div>
              </div>
              <div className={page.formGroup}>
                <label>Title</label>
                <input className={page.input} value={profileForm.title} onChange={(e) => setProfileForm((p) => ({ ...p, title: e.target.value }))} placeholder="Senior Product Designer" />
              </div>
              <div className={page.formGroup}>
                <label>Skills</label>
                <ChipInput values={skills} onChange={(next) => {
                  const added = next.find((s) => !skills.includes(s));
                  const removed = skills.find((s) => !next.includes(s));
                  if (added) handleAddSkill(added);
                  if (removed) handleRemoveSkill(removed);
                }} placeholder="Add a skill" />
              </div>
              <button type="submit" className={page.saveButton}>Save changes</button>
            </form>
          </div>
        ) : tab === 'Apply Profile' ? (
          <div className={styles.card}>
            <p className={page.masterTitle}>Job Application Profile</p>
            <p className={page.masterSubtitle}>
              These answers pre-fill employer application forms. Only questions you
              have answered here are filled automatically - anything else is asked
              on the review screen instead of being guessed. {applyCompleteness}% complete.
            </p>
            {applyProfile === null ? (
              <p className={styles.emptyState}>Loading&hellip;</p>
            ) : (
              <form onSubmit={saveApplyProfile} className={page.form}>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>Full name</label>
                    <input className={page.input} value={ap('full_name')} onChange={(e) => setAp('full_name', e.target.value)} />
                  </div>
                  <div className={page.formGroup}>
                    <label>Email on applications</label>
                    <input className={page.input} type="email" value={ap('email')} onChange={(e) => setAp('email', e.target.value)} />
                  </div>
                </div>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>Phone</label>
                    <input className={page.input} value={ap('phone')} onChange={(e) => setAp('phone', e.target.value)} />
                  </div>
                  <div className={page.formGroup}>
                    <label>Current location</label>
                    <input className={page.input} value={ap('current_location')} onChange={(e) => setAp('current_location', e.target.value)} />
                  </div>
                </div>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>LinkedIn URL</label>
                    <input className={page.input} value={ap('linkedin_url')} onChange={(e) => setAp('linkedin_url', e.target.value)} />
                  </div>
                  <div className={page.formGroup}>
                    <label>Portfolio URL</label>
                    <input className={page.input} value={ap('portfolio_url')} onChange={(e) => setAp('portfolio_url', e.target.value)} />
                  </div>
                </div>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>Current company</label>
                    <input className={page.input} value={ap('current_company')} onChange={(e) => setAp('current_company', e.target.value)} />
                  </div>
                  <div className={page.formGroup}>
                    <label>Current title</label>
                    <input className={page.input} value={ap('current_title')} onChange={(e) => setAp('current_title', e.target.value)} />
                  </div>
                </div>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>Years of experience</label>
                    <input className={page.input} type="number" step="0.5" min="0" value={ap('years_experience')} onChange={(e) => setAp('years_experience', e.target.value)} />
                  </div>
                  <div className={page.formGroup}>
                    <label>Notice period</label>
                    <input className={page.input} placeholder="e.g. 30 days" value={ap('notice_period')} onChange={(e) => setAp('notice_period', e.target.value)} />
                  </div>
                </div>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>Salary expectation</label>
                    <input className={page.input} placeholder="e.g. 180000" value={ap('salary_expectation')} onChange={(e) => setAp('salary_expectation', e.target.value)} />
                  </div>
                  <div className={page.formGroup}>
                    <label>Salary currency</label>
                    <input className={page.input} placeholder="e.g. USD" value={ap('salary_currency')} onChange={(e) => setAp('salary_currency', e.target.value)} />
                  </div>
                </div>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>Authorized to work (in the countries you apply to)</label>
                    <input className={page.input} placeholder='Answer used for "are you authorized to work" questions, e.g. Yes' value={ap('work_authorization')} onChange={(e) => setAp('work_authorization', e.target.value)} />
                  </div>
                  <div className={page.formGroup}>
                    <label>Need visa sponsorship?</label>
                    <select className={page.input} value={apBool('requires_sponsorship')} onChange={(e) => setApBool('requires_sponsorship', e.target.value)}>
                      <option value="">Not answered</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                </div>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>Willing to relocate?</label>
                    <select className={page.input} value={apBool('willing_to_relocate')} onChange={(e) => setApBool('willing_to_relocate', e.target.value)}>
                      <option value="">Not answered</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                  <div className={page.formGroup}>
                    <label>Pronouns (optional)</label>
                    <input className={page.input} value={ap('pronouns')} onChange={(e) => setAp('pronouns', e.target.value)} />
                  </div>
                </div>
                <button type="submit" className={page.saveButton} disabled={savingApply}>
                  {savingApply ? 'Saving\u2026' : 'Save application profile'}
                </button>
              </form>
            )}
          </div>
        ) : tab === 'Preferences' ? (
          <div className={styles.card}>
            <div className={page.formGroup}>
              <label>Default roles</label>
              <ChipInput values={preferences.defaultRoles} onChange={(v) => setPreferences((p) => ({ ...p, defaultRoles: v }))} placeholder="Add a role" />
            </div>
            <div className={page.formGroup}>
              <label>Default locations</label>
              <ChipInput values={preferences.preferredLocations} onChange={(v) => setPreferences((p) => ({ ...p, preferredLocations: v }))} placeholder="Add a location" />
            </div>
            <div className={page.chipRow}>
              {['remote', 'hybrid', 'onsite'].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={preferences.workArrangements.includes(t) ? page.toggleChipActive : page.toggleChip}
                  onClick={() => toggleArrayValue('workArrangements', t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <button className={page.saveButton} onClick={() => savePreferences({})}>Save changes</button>
          </div>
        ) : tab === 'Auto-Pilot' ? (
          <div className={styles.card}>
            <div className={page.masterRow}>
              <div>
                <p className={page.masterTitle}>Master Auto-Pilot switch</p>
                <p className={page.masterSubtitle}>Applies to your best matches automatically.</p>
              </div>
              <button
                type="button"
                className={preferences.autoApplyEnabled ? page.toggleOn : page.toggleOff}
                onClick={() => setPreferences((p) => ({ ...p, autoApplyEnabled: !p.autoApplyEnabled }))}
              >
                <span />
              </button>
            </div>

            {preferences.autoApplyEnabled && (
              <button
                type="button"
                className={page.secondaryButton}
                onClick={handleRunAutoPilotNow}
                disabled={runningAutoPilot}
                style={{ marginBottom: '1.25rem' }}
              >
                {runningAutoPilot ? 'Running Auto-Pilot...' : 'Run Auto-Pilot now'}
              </button>
            )}

            <label className={page.rangeLabel}>Daily application limit: {preferences.autoApplyLimitPerDay}</label>
            <input
              type="range" min="1" max="50"
              value={preferences.autoApplyLimitPerDay}
              onChange={(e) => setPreferences((p) => ({ ...p, autoApplyLimitPerDay: Number(e.target.value) }))}
              className={page.slider}
            />

            <label className={page.rangeLabel}>Default minimum match score: {preferences.autoApplyMinScore}%</label>
            <input
              type="range" min="0" max="100"
              value={preferences.autoApplyMinScore}
              onChange={(e) => setPreferences((p) => ({ ...p, autoApplyMinScore: Number(e.target.value) }))}
              className={page.slider}
            />

            <div className={page.formGroup} style={{ marginTop: '1rem' }}>
              <label>Resume tailoring</label>
              <div className={page.chipRow}>
                {[
                  { value: 'off', label: 'Off' },
                  { value: 'honest', label: 'Honest' },
                  { value: 'aggressive', label: 'Aggressive' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={preferences.resumeTailorMode === opt.value ? page.toggleChipActive : page.toggleChip}
                    onClick={() => setPreferences((p) => ({ ...p, resumeTailorMode: opt.value }))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className={page.masterSubtitle} style={{ marginTop: '0.375rem' }}>
                Honest only adds skills the job asks for that your resume is missing. Aggressive also restates skills you already have to boost keyword density. Never invents skills you don&apos;t have.
              </p>
            </div>

            <div className={page.masterRow}>
              <div>
                <p className={page.masterTitle}>Auto-tailor resume for Auto-Pilot applications</p>
                <p className={page.masterSubtitle}>Generates a tailored resume version for every job Auto-Pilot applies to.</p>
              </div>
              <button
                type="button"
                className={preferences.autoTailorResume ? page.toggleOn : page.toggleOff}
                onClick={() => setPreferences((p) => ({ ...p, autoTailorResume: !p.autoTailorResume }))}
              >
                <span />
              </button>
            </div>

            <div className={page.formGroup}>
              <label>Cover letter</label>
              <select
                className={page.input}
                value={preferences.coverLetterMode}
                onChange={(e) => setPreferences((p) => ({ ...p, coverLetterMode: e.target.value }))}
              >
                <option value="always">Always generate one</option>
                <option value="when_requested">Only when the job asks for one</option>
                <option value="off">Never</option>
              </select>
            </div>

            <div className={page.masterRow}>
              <div>
                <p className={page.masterTitle}>Review before submit</p>
                <p className={page.masterSubtitle}>
                  When on, Auto-Pilot applications wait in a Pending Review queue on the Applications page for you to
                  approve before they count as applied. Note: this governs HirePilot&apos;s own internal tracking only -
                  this app has never submitted real forms on external ATS platforms (Greenhouse, Workday, etc.) on your
                  behalf; &quot;applying&quot; here has always meant creating a tracked record with your tailored materials.
                </p>
              </div>
              <button
                type="button"
                className={preferences.reviewBeforeSubmit ? page.toggleOn : page.toggleOff}
                onClick={() => setPreferences((p) => ({ ...p, reviewBeforeSubmit: !p.reviewBeforeSubmit }))}
              >
                <span />
              </button>
            </div>

            <div className={page.formGroup} style={{ marginTop: '1rem' }}>
              <label>Blacklist companies</label>
              <ChipInput values={preferences.blacklistCompanies} onChange={(v) => setPreferences((p) => ({ ...p, blacklistCompanies: v }))} placeholder="Never apply to..." />
            </div>
            <div className={page.formGroup}>
              <label>Dream companies (require confirmation before applying)</label>
              <ChipInput values={preferences.dreamCompanies} onChange={(v) => setPreferences((p) => ({ ...p, dreamCompanies: v }))} placeholder="Always ask first for..." />
            </div>

            <button className={page.saveButton} onClick={() => savePreferences({})}>Save changes</button>
          </div>
        ) : tab === 'Integrations' ? (
          <div className={styles.card}>
            <div className={page.integrationRow}>
              <div style={{ minWidth: 0 }}>
                <p className={page.integrationName}>HirePilot Apply browser extension</p>
                <p className={page.integrationStatus}>
                  Submits your approved applications on employer sites, in your own
                  browser session. Load the extension, then paste this access token
                  into its Connect screen. The token is your login session
                  (valid 7 days) - treat it like your password.
                </p>
              </div>
              <button
                className={page.connectButton}
                onClick={() => {
                  navigator.clipboard.writeText(token).then(
                    () => flash('Access token copied - paste it in the extension popup.'),
                    () => flash('Could not copy. Copy it from your browser storage instead.')
                  );
                }}
              >
                Copy access token
              </button>
            </div>
            {/*
              * Disabled, not clickable-then-apologetic.
              *
              * These used to render live Connect buttons that only flashed "not
              * configured for this deployment" - a control that looks like it
              * works and silently does nothing, which is the same failure as the
              * preference toggles that returned 200 and saved nowhere. If it
              * cannot do the thing, it should not look like it can.
              */}
            {[
              ['LinkedIn', 'Sign-in and profile import'],
              ['Google Calendar', 'Interview scheduling'],
              ['Gmail / Outlook', 'Reading recruiter mail from your own inbox'],
            ].map(([name, what]) => (
              <div className={page.integrationRow} key={name}>
                <div>
                  <p className={page.integrationName}>{name}</p>
                  <p className={page.integrationStatus}>{what} &mdash; not built yet</p>
                </div>
                <button className={page.connectButton} disabled aria-disabled="true">
                  Coming soon
                </button>
              </div>
            ))}
            <p className={page.masterSubtitle} style={{ marginTop: 12 }}>
              Recruiter mail works today through your HirePilot address on the{' '}
              <a href="/inbox">Inbox</a> page. Connecting your own mailbox needs
              third-party sign-in, which is not built yet.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.card}>
              <p className={page.masterTitle}>Plan</p>
              <p className={page.masterSubtitle}>Free plan &middot; unlimited manual applications</p>
            </div>

            <div className={styles.card}>
              <p className={page.masterTitle}>Change password</p>
              <form onSubmit={handlePasswordChange} className={page.form}>
                <div className={page.formGroup}>
                  <label>Current password</label>
                  <input className={page.input} type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, currentPassword: e.target.value }))} />
                </div>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>New password</label>
                    <input className={page.input} type="password" minLength={8} value={passwordForm.newPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))} />
                  </div>
                  <div className={page.formGroup}>
                    <label>Confirm new password</label>
                    <input className={page.input} type="password" minLength={8} value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))} />
                  </div>
                </div>
                <button type="submit" className={page.saveButton}>Update password</button>
              </form>
            </div>

            <div className={styles.card} style={{ marginBottom: 0, borderColor: 'var(--error)' }}>
              <p className={page.masterTitle}>Delete account</p>
              <p className={page.masterSubtitle}>Permanently remove {user.email} and all associated data. This can&apos;t be undone.</p>
              <button className={page.deleteAccountButton} onClick={() => flash('Account deletion is disabled in this demo deployment.')}>Delete my account</button>
            </div>
          </>
        )}
      </DashboardLayout>
    </>
  );
}
