import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import page from '../styles/Onboarding.module.css';
import { API_BASE } from '../lib/apiBase';
import LiveIndexCount from '../components/LiveIndexCount';
import ChipSelect from '../components/ChipSelect';
import { EXPERIENCE_BANDS, bandForYears } from '../lib/experienceBands';

const STEPS = ['Basics', 'Skills & Resume', 'Preferences', 'Auto-Pilot'];

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

export default function Onboarding() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [basics, setBasics] = useState({ title: '', location: '' });
  // The band the user tapped. Stored as years on save - see lib/experienceBands.
  const [experienceBand, setExperienceBand] = useState(null);
  const [skills, setSkills] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [preferences, setPreferences] = useState({
    defaultRoles: [], preferredLocations: [], workArrangements: ['remote'],
  });
  const [autoApplyEnabled, setAutoApplyEnabled] = useState(false);

  const base = API_BASE;

  useEffect(() => {
    const authToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!authToken || !storedUser) {
      router.push('/login');
      return;
    }
    setUser(JSON.parse(storedUser));
    setToken(authToken);
  }, [router]);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('saveAsDefault', 'true');
      const res = await fetch(`${base}/api/resume/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadMessage(data.error || 'Failed to process resume file');
        return;
      }
      /*
       * C1b — the parse pre-answers the question rather than leaving it blank.
       * A suggestion, never a decision: it renders as selected and one tap
       * changes it. Only set when nothing has been chosen yet, so a parse can
       * never overwrite the user's own answer.
       */
      const parsedYears = data.parsed.yearsExperience ?? data.parsed.years_experience;
      if (parsedYears !== undefined && parsedYears !== null && !experienceBand) {
        const suggested = bandForYears(parsedYears);
        if (suggested) setExperienceBand(suggested.id);
      }

      const newSkills = (data.parsed.skills || []).filter((s) => !skills.includes(s));
      setSkills((prev) => [...prev, ...newSkills]);
      if (data.parsed.experience?.length) {
        await fetch(`${base}/api/resume/apply-parsed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ skills: [], experience: data.parsed.experience }),
        });
      }
      setUploadMessage(`Resume uploaded - added ${newSkills.length} skills and ${data.parsed.experience?.length || 0} work history entries.`);
    } catch (err) {
      setUploadMessage('Failed to upload resume. You can skip this and add skills manually below.');
    } finally {
      setUploading(false);
    }
  };

  const goNext = async () => {
    if (step === 0) {
      await fetch(`${base}/api/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fullName: user.fullName, title: basics.title, location: basics.location }),
      });
    }
    if (step === 1) {
      for (const skill of skills) {
        // eslint-disable-next-line no-await-in-loop
        await fetch(`${base}/api/profile/skills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ skill }),
        });
      }
    }
    if (step === 2) {
      await fetch(`${base}/api/profile/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        /*
         * The band travels as YEARS, because that is what scoring compares
         * against. The label never reaches the database - it would have to be
         * re-derived on every read and re-labelled the day the bands move.
         */
        body: JSON.stringify({
          ...preferences,
          ...(experienceBand
            ? (() => {
              const b = EXPERIENCE_BANDS.find((x) => x.id === experienceBand);
              return b ? { experienceMinYears: b.minYears, experienceMaxYears: b.maxYears } : {};
            })()
            : {}),
        }),
      });
    }

    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }

    setSaving(true);
    try {
      await fetch(`${base}/api/profile/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ autoApplyEnabled }),
      });
      await fetch(`${base}/api/matches/recalculate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetch(`${base}/api/profile/complete-onboarding`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push('/dashboard');
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      await fetch(`${base}/api/profile/complete-onboarding`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push('/dashboard');
    } finally {
      setSaving(false);
    }
  };

  const toggleWorkArrangement = (t) => {
    setPreferences((prev) => {
      const arr = prev.workArrangements;
      const exists = arr.includes(t);
      return { ...prev, workArrangements: exists ? arr.filter((v) => v !== t) : [...arr, t] };
    });
  };

  if (!user) return null;

  return (
    <>
      <Head>
        <title>Welcome to HirePilot</title>
      </Head>

      <div className={page.container}>
        <div className={page.logo}>
          <svg width="26" height="26" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="16" cy="16" r="12.5" />
            <path d="M16 4v3M16 25v3M28 16h-3M7 16H4M23.5 8.5l-2 2M10.5 21.5l-2 2M23.5 23.5l-2-2M10.5 10.5l-2-2" />
          </svg>
          <span className={page.logoText}>HirePilot</span>
        </div>

        <div className={page.progress}>
          {STEPS.map((s, i) => (
            <span key={s} className={i <= step ? page.progressDotActive : page.progressDot} />
          ))}
        </div>

        <div className={page.card}>
          {step === 0 && (
            <>
              <h1 className={page.stepTitle}>Welcome, {(user.fullName || user.email).split(' ')[0]}</h1>
              <p className={page.stepSubtitle}>Let&apos;s set up your profile so Auto-Pilot can start finding and scoring jobs for you. This takes about a minute.</p>

              <div className={page.formGroup}>
                <label>Current or target job title</label>
                <input
                  className={page.input}
                  value={basics.title}
                  onChange={(e) => setBasics((p) => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Senior Product Designer"
                />
                {/*
                  * C1a — a real query behind the number. Asked of the same
                  * endpoint the feed uses, so the screen and the API cannot
                  * disagree. A zero says so and offers to widen rather than
                  * becoming an encouraging figure.
                  */}
                <LiveIndexCount
                  params={{ search: basics.title }}
                  unit="jobs in our index"
                  zeroText="No jobs match that title yet"
                />
              </div>

              {/*
                * Tap, do not type. The answer set is known and short, so every
                * option is visible at once and the user is choosing rather
                * than recalling. The label is the word people use about
                * themselves; the years are the hint, and only the years are
                * stored - see lib/experienceBands.
                */}
              <ChipSelect
                legend="How much experience do you have?"
                options={EXPERIENCE_BANDS}
                value={experienceBand}
                onChange={setExperienceBand}
              />
              <div className={page.formGroup}>
                <label>Location</label>
                <input
                  className={page.input}
                  value={basics.location}
                  onChange={(e) => setBasics((p) => ({ ...p, location: e.target.value }))}
                  placeholder="e.g. Austin, TX"
                />
                {/*
                  * Only once a LOCATION has actually been given.
                  *
                  * Caught on screen at 375px: with the field empty this
                  * rendered "253 of those are near you" - the same count as
                  * the line above it, wearing words that claim a narrowing
                  * nobody asked for. The number was right and the sentence was
                  * a lie, which is the shape Constraint 1 exists to catch.
                  */}
                {basics.location.trim() && (
                  <LiveIndexCount
                    params={{ search: basics.title, location: basics.location }}
                    unit={basics.title ? 'of those are near you' : 'jobs near you'}
                    zeroText="None near that location yet"
                  />
                )}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className={page.stepTitle}>Add your skills</h1>
              <p className={page.stepSubtitle}>Upload your resume and we&apos;ll pull out your skills and work history automatically, or add skills manually below.</p>

              <div className={page.formGroup}>
                <label>Upload resume (optional)</label>
                <label className={page.uploadDropzone}>
                  <input type="file" accept=".pdf,.docx,.txt,.md" onChange={handleFileUpload} disabled={uploading} style={{ display: 'none' }} />
                  {uploading ? 'Uploading & parsing…' : 'Click to choose a file (.pdf, .docx, .txt)'}
                </label>
                {uploadMessage && <p className={page.parsedSummary}>{uploadMessage}</p>}
              </div>

              <div className={page.formGroup}>
                <label>Skills</label>
                <ChipInput values={skills} onChange={setSkills} placeholder="Add a skill and press Enter" />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className={page.stepTitle}>Job preferences</h1>
              <p className={page.stepSubtitle}>Tell us what you&apos;re looking for so we only match you with relevant roles.</p>

              <div className={page.formGroup}>
                <label>Target roles</label>
                <ChipInput values={preferences.defaultRoles} onChange={(v) => setPreferences((p) => ({ ...p, defaultRoles: v }))} placeholder="e.g. Product Designer" />
              </div>
              <div className={page.formGroup}>
                <label>Preferred locations</label>
                <ChipInput values={preferences.preferredLocations} onChange={(v) => setPreferences((p) => ({ ...p, preferredLocations: v }))} placeholder="e.g. Remote, New York" />
              </div>
              <div className={page.formGroup}>
                <label>Work arrangement</label>
                <div className={page.chipRow}>
                  {['remote', 'hybrid', 'onsite'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={preferences.workArrangements.includes(t) ? page.toggleChipActive : page.toggleChip}
                      onClick={() => toggleWorkArrangement(t)}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className={page.stepTitle}>Turn on Auto-Pilot?</h1>
              <p className={page.stepSubtitle}>
                When enabled, HirePilot automatically applies to your best-matching jobs every few hours, respecting the daily limit and rules you set in Settings. You can change this anytime.
              </p>

              <div className={page.masterRow}>
                <div>
                  <p className={page.masterTitle}>Auto-Pilot</p>
                  <p className={page.masterSubtitle}>{autoApplyEnabled ? 'On - will start applying automatically' : 'Off - you can turn this on later in Settings'}</p>
                </div>
                <button
                  type="button"
                  className={autoApplyEnabled ? page.toggleOn : page.toggleOff}
                  onClick={() => setAutoApplyEnabled((v) => !v)}
                >
                  <span />
                </button>
              </div>
            </>
          )}

          <div className={page.actions}>
            {step > 0 ? (
              <button className={page.backButton} onClick={() => setStep(step - 1)}>Back</button>
            ) : (
              <button className={page.skipButton} onClick={handleSkip} disabled={saving}>Skip for now</button>
            )}
            <button className={page.nextButton} onClick={goNext} disabled={saving}>
              {saving ? 'Saving...' : step === STEPS.length - 1 ? 'Finish setup' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
