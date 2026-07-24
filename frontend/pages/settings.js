import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Settings.module.css';

const JOB_TYPES = ['full-time', 'part-time', 'contract'];
const WORK_ARRANGEMENTS = ['remote', 'hybrid', 'on-site'];

export default function Settings() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const [profileForm, setProfileForm] = useState({ fullName: '', location: '', profileSummary: '' });
  const [skills, setSkills] = useState([]);
  const [newSkill, setNewSkill] = useState({ skill: '', proficiencyLevel: 'intermediate', yearsOfExperience: '' });
  const [experience, setExperience] = useState([]);
  const [newExperience, setNewExperience] = useState({
    companyName: '', jobTitle: '', startDate: '', endDate: '', description: '', currentlyWorking: false,
  });
  const [preferences, setPreferences] = useState({
    minSalary: '', maxSalary: '', jobTypes: [], workArrangements: [],
    preferredLocations: '', autoApplyEnabled: false, autoApplyLimitPerDay: 5,
  });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  const base = process.env.NEXT_PUBLIC_API_URL;

  const loadProfile = useCallback(async (authToken) => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/profile`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setProfileForm({
          fullName: data.user.full_name || '',
          location: data.user.location || '',
          profileSummary: data.user.profile_summary || '',
        });
        setSkills(data.skills || []);
        setExperience(data.experience || []);
        if (data.preferences) {
          setPreferences({
            minSalary: data.preferences.min_salary || '',
            maxSalary: data.preferences.max_salary || '',
            jobTypes: data.preferences.job_types || [],
            workArrangements: data.preferences.work_arrangements || [],
            preferredLocations: (data.preferences.preferred_locations || []).join(', '),
            autoApplyEnabled: data.preferences.auto_apply_enabled || false,
            autoApplyLimitPerDay: data.preferences.auto_apply_limit_per_day || 5,
          });
        }
      }
    } catch (err) {
      console.error('Failed to load profile', err);
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
    loadProfile(authToken);
  }, [router, loadProfile]);

  const flash = (text) => {
    setMessage(text);
    setTimeout(() => setMessage(''), 4000);
  };

  const recalcMatches = (authToken) => {
    fetch(`${base}/api/matches/recalculate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    }).catch((err) => console.error('Recalculate matches failed', err));
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
    } else {
      flash('Failed to update profile.');
    }
  };

  const handleAddSkill = async (e) => {
    e.preventDefault();
    if (!newSkill.skill.trim()) return;
    const res = await fetch(`${base}/api/profile/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        skill: newSkill.skill,
        proficiencyLevel: newSkill.proficiencyLevel,
        yearsOfExperience: newSkill.yearsOfExperience ? parseFloat(newSkill.yearsOfExperience) : null,
      }),
    });
    if (res.ok) {
      setNewSkill({ skill: '', proficiencyLevel: 'intermediate', yearsOfExperience: '' });
      loadProfile(token);
      recalcMatches(token);
    }
  };

  const handleDeleteSkill = async (id) => {
    await fetch(`${base}/api/profile/skills/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    loadProfile(token);
    recalcMatches(token);
  };

  const handleAddExperience = async (e) => {
    e.preventDefault();
    if (!newExperience.companyName || !newExperience.jobTitle) return;
    const res = await fetch(`${base}/api/profile/experience`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(newExperience),
    });
    if (res.ok) {
      setNewExperience({ companyName: '', jobTitle: '', startDate: '', endDate: '', description: '', currentlyWorking: false });
      loadProfile(token);
      recalcMatches(token);
    }
  };

  const handleDeleteExperience = async (id) => {
    await fetch(`${base}/api/profile/experience/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    loadProfile(token);
    recalcMatches(token);
  };

  const togglePrefArray = (field, value) => {
    setPreferences((prev) => {
      const arr = prev[field];
      const exists = arr.includes(value);
      return { ...prev, [field]: exists ? arr.filter((v) => v !== value) : [...arr, value] };
    });
  };

  const handlePreferencesSave = async (e) => {
    e.preventDefault();
    const res = await fetch(`${base}/api/profile/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        minSalary: preferences.minSalary ? parseInt(preferences.minSalary, 10) : null,
        maxSalary: preferences.maxSalary ? parseInt(preferences.maxSalary, 10) : null,
        jobTypes: preferences.jobTypes,
        workArrangements: preferences.workArrangements,
        preferredLocations: preferences.preferredLocations.split(',').map((s) => s.trim()).filter(Boolean),
        autoApplyEnabled: preferences.autoApplyEnabled,
        autoApplyLimitPerDay: parseInt(preferences.autoApplyLimitPerDay, 10) || 5,
      }),
    });
    flash(res.ok ? 'Preferences saved.' : 'Failed to save preferences.');
    if (res.ok) recalcMatches(token);
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
      body: JSON.stringify({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      }),
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

        {message && <div className={page.message}>{message}</div>}

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : (
          <>
            <div className={styles.card}>
              <h2 className={styles.sectionTitle} style={{ marginBottom: '1rem' }}>Profile</h2>
              <form onSubmit={handleProfileSave} className={page.form}>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>Full name</label>
                    <input className={page.input} value={profileForm.fullName} onChange={(e) => setProfileForm((p) => ({ ...p, fullName: e.target.value }))} />
                  </div>
                  <div className={page.formGroup}>
                    <label>Location</label>
                    <input className={page.input} value={profileForm.location} onChange={(e) => setProfileForm((p) => ({ ...p, location: e.target.value }))} placeholder="San Francisco, CA" />
                  </div>
                </div>
                <div className={page.formGroup}>
                  <label>Summary</label>
                  <textarea className={page.textarea} rows={3} value={profileForm.profileSummary} onChange={(e) => setProfileForm((p) => ({ ...p, profileSummary: e.target.value }))} placeholder="A short summary about you" />
                </div>
                <button type="submit" className={page.saveButton}>Save profile</button>
              </form>
            </div>

            <div className={styles.card}>
              <h2 className={styles.sectionTitle} style={{ marginBottom: '1rem' }}>Skills</h2>
              <div className={page.skillsList}>
                {skills.length === 0 && <p className={styles.emptyState}>No skills added yet.</p>}
                {skills.map((s) => (
                  <span key={s.id} className={page.skillPill}>
                    {s.skill}
                    <button onClick={() => handleDeleteSkill(s.id)} aria-label={`Remove ${s.skill}`}>&times;</button>
                  </span>
                ))}
              </div>
              <form onSubmit={handleAddSkill} className={page.inlineForm}>
                <input
                  className={page.input}
                  value={newSkill.skill}
                  onChange={(e) => setNewSkill((p) => ({ ...p, skill: e.target.value }))}
                  placeholder="e.g. React"
                />
                <select className={page.input} value={newSkill.proficiencyLevel} onChange={(e) => setNewSkill((p) => ({ ...p, proficiencyLevel: e.target.value }))}>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="expert">Expert</option>
                </select>
                <input
                  className={page.inputSmall}
                  type="number"
                  step="0.5"
                  min="0"
                  value={newSkill.yearsOfExperience}
                  onChange={(e) => setNewSkill((p) => ({ ...p, yearsOfExperience: e.target.value }))}
                  placeholder="Yrs"
                />
                <button type="submit" className={page.addButton}>Add</button>
              </form>
            </div>

            <div className={styles.card}>
              <h2 className={styles.sectionTitle} style={{ marginBottom: '1rem' }}>Experience</h2>
              {experience.length === 0 && <p className={styles.emptyState}>No experience added yet.</p>}
              {experience.map((exp) => (
                <div key={exp.id} className={page.expRow}>
                  <div>
                    <p className={page.expTitle}>{exp.job_title} at {exp.company_name}</p>
                    <p className={page.expDates}>
                      {exp.start_date ? new Date(exp.start_date).getFullYear() : ''} &ndash; {exp.currently_working ? 'Present' : (exp.end_date ? new Date(exp.end_date).getFullYear() : '')}
                    </p>
                  </div>
                  <button className={page.deleteButton} onClick={() => handleDeleteExperience(exp.id)}>Remove</button>
                </div>
              ))}

              <form onSubmit={handleAddExperience} className={`${page.form} ${page.expForm}`}>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>Company</label>
                    <input className={page.input} value={newExperience.companyName} onChange={(e) => setNewExperience((p) => ({ ...p, companyName: e.target.value }))} />
                  </div>
                  <div className={page.formGroup}>
                    <label>Job title</label>
                    <input className={page.input} value={newExperience.jobTitle} onChange={(e) => setNewExperience((p) => ({ ...p, jobTitle: e.target.value }))} />
                  </div>
                </div>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>Start date</label>
                    <input className={page.input} type="date" value={newExperience.startDate} onChange={(e) => setNewExperience((p) => ({ ...p, startDate: e.target.value }))} />
                  </div>
                  <div className={page.formGroup}>
                    <label>End date</label>
                    <input className={page.input} type="date" value={newExperience.endDate} disabled={newExperience.currentlyWorking} onChange={(e) => setNewExperience((p) => ({ ...p, endDate: e.target.value }))} />
                  </div>
                </div>
                <label className={page.checkboxLabel}>
                  <input type="checkbox" checked={newExperience.currentlyWorking} onChange={(e) => setNewExperience((p) => ({ ...p, currentlyWorking: e.target.checked }))} />
                  I currently work here
                </label>
                <button type="submit" className={page.saveButton}>Add experience</button>
              </form>
            </div>

            <div className={styles.card}>
              <h2 className={styles.sectionTitle} style={{ marginBottom: '1rem' }}>Job preferences</h2>
              <form onSubmit={handlePreferencesSave} className={page.form}>
                <div className={page.formRow}>
                  <div className={page.formGroup}>
                    <label>Min salary</label>
                    <input className={page.input} type="number" value={preferences.minSalary} onChange={(e) => setPreferences((p) => ({ ...p, minSalary: e.target.value }))} />
                  </div>
                  <div className={page.formGroup}>
                    <label>Max salary</label>
                    <input className={page.input} type="number" value={preferences.maxSalary} onChange={(e) => setPreferences((p) => ({ ...p, maxSalary: e.target.value }))} />
                  </div>
                </div>

                <div className={page.formGroup}>
                  <label>Job types</label>
                  <div className={page.chipRow}>
                    {JOB_TYPES.map((t) => (
                      <button
                        type="button"
                        key={t}
                        className={preferences.jobTypes.includes(t) ? page.chipActive : page.chip}
                        onClick={() => togglePrefArray('jobTypes', t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={page.formGroup}>
                  <label>Work arrangement</label>
                  <div className={page.chipRow}>
                    {WORK_ARRANGEMENTS.map((t) => (
                      <button
                        type="button"
                        key={t}
                        className={preferences.workArrangements.includes(t) ? page.chipActive : page.chip}
                        onClick={() => togglePrefArray('workArrangements', t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={page.formGroup}>
                  <label>Preferred locations (comma separated)</label>
                  <input className={page.input} value={preferences.preferredLocations} onChange={(e) => setPreferences((p) => ({ ...p, preferredLocations: e.target.value }))} placeholder="Remote, New York, London" />
                </div>

                <label className={page.checkboxLabel}>
                  <input type="checkbox" checked={preferences.autoApplyEnabled} onChange={(e) => setPreferences((p) => ({ ...p, autoApplyEnabled: e.target.checked }))} />
                  Enable Auto-Pilot applications
                </label>

                {preferences.autoApplyEnabled && (
                  <div className={page.formGroup}>
                    <label>Max applications per day</label>
                    <input className={page.inputSmall} type="number" min="1" max="50" value={preferences.autoApplyLimitPerDay} onChange={(e) => setPreferences((p) => ({ ...p, autoApplyLimitPerDay: e.target.value }))} />
                  </div>
                )}

                <button type="submit" className={page.saveButton}>Save preferences</button>
              </form>
            </div>

            <div className={styles.card} style={{ marginBottom: 0 }}>
              <h2 className={styles.sectionTitle} style={{ marginBottom: '1rem' }}>Change password</h2>
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
          </>
        )}
      </DashboardLayout>
    </>
  );
}
