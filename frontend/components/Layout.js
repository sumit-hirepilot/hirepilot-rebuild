import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import styles from './Layout.module.css';

export default function Layout({ children }) {
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isAuthenticated = typeof window !== 'undefined' && !!localStorage.getItem('token');

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/');
  };

  return (
    <>
      <header className={styles.header}>
        <div className="container">
          <div className={styles.headerContent}>
            <Link href="/" className={styles.logo}>
              <span>⚡ HirePilot</span>
            </Link>

            <nav className={`${styles.nav} ${isMenuOpen ? styles.navOpen : ''}`}>
              {isAuthenticated ? (
                <>
                  <Link href="/dashboard">Dashboard</Link>
                  <Link href="/applications">Applications</Link>
                  <button onClick={handleLogout} className="btn-secondary">
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <Link href="/#features">Features</Link>
                  <Link href="/login" className="btn-primary">
                    Sign In
                  </Link>
                  <Link href="/signup" className="btn-primary">
                    Start Free
                  </Link>
                </>
              )}
            </nav>

            <button
              className={styles.menuToggle}
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              aria-label="Toggle menu"
            >
              ☰
            </button>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className={styles.footer}>
        <div className="container">
          <p>HirePilot. Built for people who are good at their jobs, not job hunting.</p>
          <p style={{ fontSize: '0.875rem' }}>© 2024 HirePilot. All rights reserved.</p>
        </div>
      </footer>
    </>
  );
}
