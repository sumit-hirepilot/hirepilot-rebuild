import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import styles from '../styles/Auth.module.css';

export default function Signup() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!formData.fullName || !formData.email || !formData.password) {
        throw new Error('All fields are required');
      }

      if (formData.password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/auth/signup`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
            fullName: formData.fullName,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Signup failed');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      router.push('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Sign Up - HirePilot</title>
        <meta name="description" content="Create your HirePilot account" />
      </Head>

      <div className={styles.authContainer}>
        <div className={styles.authCard}>
          <Link href="/" className={styles.logo}>
            <svg
              width="28"
              height="28"
              viewBox="0 0 32 32"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="16" cy="16" r="12.5" />
              <path d="M16 4v3M16 25v3M28 16h-3M7 16H4M23.5 8.5l-2 2M10.5 21.5l-2 2M23.5 23.5l-2-2M10.5 10.5l-2-2" />
              <path d="M16 3.2 17.4 6.6 14.6 6.6Z" fill="currentColor" stroke="none" />
              <text
                x="16"
                y="20.5"
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill="currentColor"
                stroke="none"
              >
                H
              </text>
            </svg>
            <span className={styles.logoText}>HirePilot</span>
          </Link>

          <h1>Create your account</h1>

          <form onSubmit={handleSubmit} className={styles.form}>
            <input
              type="text"
              name="fullName"
              value={formData.fullName}
              onChange={handleChange}
              placeholder="Full name"
              className={styles.input}
              required
            />

            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="Email"
              className={styles.input}
              required
            />

            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Password (min 8 characters)"
              className={styles.input}
              minLength={8}
              required
            />

            {error && <div className={styles.error}>{error}</div>}

            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Creating account...' : 'Start free'}
            </button>
          </form>

          <p className={styles.footerText}>
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </>
  );
}
