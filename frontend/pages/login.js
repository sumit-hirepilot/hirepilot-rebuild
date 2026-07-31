import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import styles from '../styles/Auth.module.css';
import { API_BASE } from '../lib/apiBase';

export default function Login() {
  const router = useRouter();
  const [formData, setFormData] = useState({
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
      if (!formData.email || !formData.password) {
        throw new Error('Email and password are required');
      }

      const response = await fetch(
        `${API_BASE}/api/auth/login`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(formData),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
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
        <title>Sign In - HirePilot</title>
        <meta name="description" content="Sign in to your HirePilot account" />
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

          <h1>Welcome back</h1>

          <form onSubmit={handleSubmit} className={styles.form}>
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
              placeholder="Password"
              className={styles.input}
              required
            />

            {error && <div className={styles.error}>{error}</div>}

            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className={styles.footerText}>
            New to HirePilot? <Link href="/signup">Create an account</Link>
          </p>
        </div>
      </div>
    </>
  );
}
