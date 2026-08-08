import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import page from '../styles/Onboarding.module.css';
import { API_BASE } from '../lib/apiBase';
import LiveIndexCount from '../components/LiveIndexCount';
import ChipSelect from '../components/ChipSelect';
import SuggestSelect from '../components/SuggestSelect';
import FirstMatch from '../components/FirstMatch';
import { EXPERIENCE_BANDS, bandForYears } from '../lib/experienceBands';
import { NOTICE_PERIODS } from '../lib/noticePeriods';
import { humanise } from '../lib/labels';

const STEPS = ['Basics', 'Skills & Resume', 'Preferences', 'Auto-Pilot'];

/*
 * L? — the chip input merged three fast-typed skills into one chip.
 *
 * The old addChip closed over `draft` and `values` from the render that
 * created it. Typed fast, two Enters could fire inside one React batch before
 * either setState committed: the second addChip read the SAME stale `values`
 * as the first and overwrote it, while the DOM input — controlled by a `draft`
 * that had not been cleared yet — kept accumulating characters, so a whole
 * run of skills collapsed into a single chip. A Playwright paste of a
 * newline-separated list reproduced the collapse deterministically; jest never
 * could, because it lacks real key timing.
 *
 * The fix removes both stale reads. commit() takes the live value straight off
 * the DOM event (never the possibly-behind `draft` state) and folds new tokens
 * onto a ref that always holds the latest committed list, so a second commit
 * in the same tick sees what the first just added instead of the render-time
 * snapshot. Splitting on comma/newline means a pasted or fast-typed run of
 * separators becomes several chips, never one merged blob.
 */
export function ChipInput({ values, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  // Always the latest committed list, even between a setState and its commit.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const commit = (raw) => {
    const parts = String(raw).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    setDraft('');
    if (!parts.length) return;
    const current = valuesRef.current;
    const next = [...current];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    if (next.length === current.length) return;
    // Advance the ref before the parent re-renders, so a second commit fired
    // in the same batch folds onto this list rather than the stale snapshot.
    valuesRef.current = next;
    onChange(next);
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
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(e.currentTarget.value); } }}
        onBlur={(e) => commit(e.currentTarget.value)}
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
  /*
   * Notice period. Asked here because nearly every Indian application form
   * asks it, and answering once is the point - it prefills the screening
   * question later rather than being asked again per application.
   */
  const [noticePeriod, setNoticePeriod] = useState(null);
  const [skills, setSkills] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  /*
   * C1b — the parse is the first time the product proves it did work, so what
   * it found is shown as removable chips rather than announced in a sentence.
   * Roles and years sit beside the skills: all three are things a parse gets
   * wrong sometimes, and all three must be correctable in one tap.
   */
  const [parsedRoles, setParsedRoles] = useState([]);
  const [parsedYears, setParsedYears] = useState(null);
  const [parseFailed, setParseFailed] = useState(false);
  // Real values from the index, so a suggestion is never one the feed cannot
  // then match. /api/jobs/facets already returns per-value counts for region.
  const [citySuggestions, setCitySuggestions] = useState([]);
  /*
   * ABANDONMENT RECOVERY. Answers already save server-side per step in
   * goNext; only the step itself was lost on reload, which sent people back
   * to the beginning of something they had half finished. Restored below, and
   * deliberately without a percentage-complete bar - that is pressure, not
   * help.
   */
  const [restoredStep, setRestoredStep] = useState(false);
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

    /*
     * Return the user to the step they left. Nothing is re-entered: the
     * answers were already written server-side by goNext at each step, so all
     * that was ever lost was WHERE they were - which is enough to make someone
     * abandon a flow they had half finished.
     */
    const saved = Number(localStorage.getItem('onboardingStep'));
    if (Number.isFinite(saved) && saved > 0 && saved < STEPS.length) {
      setStep(saved);
      setRestoredStep(true);
    }
  }, [router]);

  /*
   * City suggestions from the index itself, so the field is never empty with
   * only a placeholder. A suggested city the feed cannot match would be a
   * promise the next screen breaks, which is why these are read rather than
   * hand-listed.
   */
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${base}/api/jobs/facets`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;               // status before body
        const data = await res.json();
        /*
         * These are REGIONS, not cities - it is the only place-facet the index
         * has. Caught on production offering "north_america" and
         * "unspecified" as places to work: raw bucket keys, the wrong
         * granularity, and one of them meaningless to anyone.
         *
         * So: humanised through the shared helper rather than shown raw, the
         * "unspecified" bucket dropped because it is not somewhere a person
         * can want to work, and the field's own hint now says these are
         * regions and that a city can be typed. Offering a region while
         * calling it a city would be the label lying about the data again.
         */
        setCitySuggestions((data.region || [])
          .filter((r) => r.value && !/^(unspecified|not[ _-]?specified)$/i.test(r.value))
          .sort((a, b) => (b.count || 0) - (a.count || 0))
          .map((r) => humanise(r.value)));
      } catch (err) {
        // No suggestions is a smaller failure than a wrong suggestion.
      }
    })();
  }, [token, base]);

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
        // A failed parse is a designed path, not an error: the fallback is on
        // this screen, one tap away, and never a restart.
        setParseFailed(true);
        return;
      }
      /*
       * C1b — the parse pre-answers the question rather than leaving it blank.
       * A suggestion, never a decision: it renders as selected and one tap
       * changes it. Only set when nothing has been chosen yet, so a parse can
       * never overwrite the user's own answer.
       */
      const years = data.parsed.yearsExperience ?? data.parsed.years_experience;
      if (years !== undefined && years !== null) {
        setParsedYears(years);
        if (!experienceBand) {
          const suggested = bandForYears(years);
          if (suggested) setExperienceBand(suggested.id);
        }
      }
      setParsedRoles((data.parsed.experience || [])
        .map((e) => e.jobTitle || e.job_title)
        .filter(Boolean));
      setParseFailed(false);

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
      setUploadMessage('We could not read that file.');
      setParseFailed(true);
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (step > 0) localStorage.setItem('onboardingStep', String(step));
  }, [step]);

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
      /*
       * Notice period lives on the screening profile, not on preferences -
       * that is the record the extension prefills an employer form from. Sent
       * as the plain string the field already holds, so a screening question
       * asking the same thing reuses this answer rather than asking again.
       */
      if (noticePeriod) {
        const chosen = NOTICE_PERIODS.find((n) => n.id === noticePeriod);
        if (chosen) {
          await fetch(`${base}/api/apply/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ notice_period: chosen.value }),
          });
        }
      }
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
      // Finished: nothing left to return to.
      localStorage.removeItem('onboardingStep');
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
      // Finished: nothing left to return to.
      localStorage.removeItem('onboardingStep');
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
          {restoredStep && (
            <p className={page.parsedSummary} role="status">
              Picking up where you left off — everything you had already entered is saved.
            </p>
          )}

          {step === 0 && (
            <>
              <h1 className={page.stepTitle}>Welcome, {(user.fullName || user.email).split(' ')[0]}</h1>
              <p className={page.stepSubtitle}>Let&apos;s set up your profile so Auto-Pilot can start finding and scoring jobs for you. This takes about a minute.</p>

              <div className={page.formGroup}>
                <SuggestSelect
                  label="What kind of role are you looking for?"
                  value={basics.title}
                  onChange={(v) => setBasics((p) => ({ ...p, title: v }))}
                  /* Real roles off the user's own resume - the best guess
                     available, and never invented. */
                  suggestions={parsedRoles}
                  placeholder="e.g. Senior Product Designer"
                  hint={parsedRoles.length ? 'From your resume — tap one or type your own.' : undefined}
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
                <SuggestSelect
                  label="Where do you want to work?"
                  value={basics.location}
                  onChange={(v) => setBasics((p) => ({ ...p, location: v }))}
                  suggestions={citySuggestions}
                  placeholder="e.g. Bengaluru"
                  hint={citySuggestions.length
                    ? 'Regions where the jobs in our index are — or type a city.'
                    : undefined}
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

                {/*
                  * C1b — what the parse found, as removable chips, the moment
                  * it is read. Not behind Continue: this is the first time the
                  * product proves it did work, and anything it got wrong has to
                  * be correctable in one tap rather than argued with later.
                  */}
                {parsedRoles.length > 0 && (
                  <div className={page.formGroup}>
                    <label>Roles we found</label>
                    <ChipInput values={parsedRoles} onChange={setParsedRoles} placeholder="Add a role" />
                  </div>
                )}
                {parsedYears !== null && (
                  <p className={page.parsedSummary}>
                    Looks like about {parsedYears} years of experience — we have selected a level for you, change it any time.
                  </p>
                )}

                {/*
                  * The single most likely drop-off point in the flow, so the
                  * fallback is a TAP on this screen rather than a sentence
                  * telling the user to scroll and figure it out.
                  */}
                {parseFailed && (
                  <button
                    type="button"
                    className={page.secondaryAction}
                    onClick={() => { setParseFailed(false); setUploadMessage('No problem — add your skills below and carry on.'); }}
                  >
                    Fill it in myself instead
                  </button>
                )}
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
              {/*
                * C1b — one REAL scored job before onboarding ends, from the
                * same query the feed runs. Placed here, at the third screen,
                * so it lands while the user is still deciding whether to
                * finish. Never a sample: if nothing matches yet it says so.
                */}
              <FirstMatch title={basics.title} location={basics.location} />

              {/*
                * Tap, do not type. The answer set is short and known, and it
                * is the question every Indian application form asks.
                */}
              <ChipSelect
                legend="What is your notice period?"
                options={NOTICE_PERIODS}
                value={noticePeriod}
                onChange={setNoticePeriod}
              />

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
