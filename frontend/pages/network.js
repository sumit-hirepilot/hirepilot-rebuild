import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Network.module.css';

export default function Network() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    jobId: '',
    companyName: '',
    firstName: '',
    lastName: '',
    email: '',
    linkedinUrl: '',
    jobTitle: '',
    relationshipType: 'employee',
    notes: '',
  });

  const base = process.env.NEXT_PUBLIC_API_URL;

  const loadData = useCallback(async (authToken) => {
    setLoading(true);
    try {
      const [contactsRes, jobsRes] = await Promise.all([
        fetch(`${base}/api/network`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/jobs?limit=50`),
      ]);

      if (contactsRes.ok) {
        const data = await contactsRes.json();
        setContacts(data.contacts || []);
      }
      if (jobsRes.ok) {
        const data = await jobsRes.json();
        setJobs(data.jobs || []);
      }
    } catch (err) {
      console.error('Failed to load network data', err);
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
    loadData(authToken);
  }, [router, loadData]);

  const handleChange = (field) => (e) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');

    if (!formData.jobId || !formData.companyName) {
      setMessage('Select a job and enter a company name.');
      return;
    }

    try {
      const res = await fetch(`${base}/api/network`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setFormData({
          jobId: '', companyName: '', firstName: '', lastName: '', email: '',
          linkedinUrl: '', jobTitle: '', relationshipType: 'employee', notes: '',
        });
        setShowForm(false);
        loadData(token);
      } else {
        const data = await res.json();
        setMessage(data.error || 'Failed to add contact');
      }
    } catch (err) {
      setMessage('Failed to add contact');
    }
  };

  const handleDelete = async (id) => {
    await fetch(`${base}/api/network/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    loadData(token);
  };

  if (!user) return null;

  return (
    <>
      <Head>
        <title>Network - HirePilot</title>
      </Head>

      <DashboardLayout title="Network" user={user}>
        <div className={page.headerRow}>
          <div>
            <p className={styles.dateLabel}>{contacts.length} contacts</p>
            <h1 className={styles.greeting}>Network</h1>
          </div>
          <button className={page.newButton} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ Add contact'}
          </button>
        </div>

        {message && <div className={page.message}>{message}</div>}

        {showForm && (
          <form onSubmit={handleSubmit} className={`${styles.card} ${page.form}`}>
            <div className={page.formRow}>
              <div className={page.formGroup}>
                <label>Job</label>
                <select className={page.input} value={formData.jobId} onChange={handleChange('jobId')}>
                  <option value="">Select a job&hellip;</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {(j.title.length > 50 ? `${j.title.slice(0, 50)}…` : j.title)} — {j.company_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={page.formGroup}>
                <label>Company name</label>
                <input className={page.input} value={formData.companyName} onChange={handleChange('companyName')} placeholder="Acme Inc." />
              </div>
            </div>
            <div className={page.formRow}>
              <div className={page.formGroup}>
                <label>First name</label>
                <input className={page.input} value={formData.firstName} onChange={handleChange('firstName')} />
              </div>
              <div className={page.formGroup}>
                <label>Last name</label>
                <input className={page.input} value={formData.lastName} onChange={handleChange('lastName')} />
              </div>
            </div>
            <div className={page.formRow}>
              <div className={page.formGroup}>
                <label>Email</label>
                <input className={page.input} type="email" value={formData.email} onChange={handleChange('email')} />
              </div>
              <div className={page.formGroup}>
                <label>LinkedIn URL</label>
                <input className={page.input} value={formData.linkedinUrl} onChange={handleChange('linkedinUrl')} placeholder="https://linkedin.com/in/..." />
              </div>
            </div>
            <div className={page.formRow}>
              <div className={page.formGroup}>
                <label>Their job title</label>
                <input className={page.input} value={formData.jobTitle} onChange={handleChange('jobTitle')} />
              </div>
              <div className={page.formGroup}>
                <label>Relationship</label>
                <select className={page.input} value={formData.relationshipType} onChange={handleChange('relationshipType')}>
                  <option value="employee">Current employee</option>
                  <option value="alumni">Alumni</option>
                  <option value="hiring_manager">Hiring manager</option>
                </select>
              </div>
            </div>
            <div className={page.formGroup}>
              <label>Notes</label>
              <textarea className={page.textarea} rows={3} value={formData.notes} onChange={handleChange('notes')} placeholder="How you know them, talking points..." />
            </div>
            <button type="submit" className={page.newButton}>Save contact</button>
          </form>
        )}

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : contacts.length === 0 ? (
          <div className={styles.card}>
            <p className={styles.emptyState}>
              No contacts yet. Add people at companies you&apos;re applying to so you can ask for a referral.
            </p>
          </div>
        ) : (
          <div className={page.list}>
            {contacts.map((c) => (
              <div key={c.id} className={styles.card} style={{ marginBottom: '1rem' }}>
                <div className={page.contactHeader}>
                  <div>
                    <p className={page.contactName}>
                      {c.first_name || c.last_name ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : 'Unnamed contact'}
                    </p>
                    <p className={page.contactMeta}>
                      {c.job_title ? `${c.job_title} at ` : ''}{c.company_name}
                    </p>
                    {c.target_job_title && (
                      <p className={page.contactMeta}>Re: {c.target_job_title}</p>
                    )}
                  </div>
                  <span className={page.relBadge}>{c.relationship_type?.replace('_', ' ')}</span>
                </div>

                {(c.email || c.linkedin_url) && (
                  <div className={page.contactLinks}>
                    {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                    {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}
                  </div>
                )}

                {c.notes && <p className={page.notes}>{c.notes}</p>}

                <button className={page.deleteButton} onClick={() => handleDelete(c.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </DashboardLayout>
    </>
  );
}
