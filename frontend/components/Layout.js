import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import styles from './Layout.module.css';

export default function Layout({ children }) {
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  /*
   * A3 / H2 — the auth-dependent nav may not be decided during the first
   * render.
   *
   * This read localStorage inline, so the server rendered "Features / Sign In"
   * and the client rendered "Dashboard / Applications" for the same markup.
   * React 18 discards the server HTML on that mismatch and re-renders the
   * whole tree, which is why no page hydrated cleanly and the dev environment
   * could not verify anything.
   *
   * The first client render must match the server's exactly, so it renders the
   * signed-out shell - what the server always produces - and swaps after mount.
   */
  const [mounted, setMounted] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    setHasToken(!!localStorage.getItem('token'));
    setMounted(true);
  }, []);

  const isAuthenticated = mounted && hasToken;

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
                  {/* A7.25 — this pointed at /#features and the landing page
                      has no such id; the only nav link on the site scrolled
                      nowhere. The section it means is "Four honest stages",
                      whose own CTA already reads "See how it works" - so the
                      label matches the destination now instead of inventing a
                      second name for it. */}
                  <Link href="/#pipeline">How it works</Link>
                  <Link href="/pricing">Pricing</Link>
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
          {/* A7.25 — a product that asks for money and holds a resume needs
              these reachable from every page, not filed somewhere. */}
          <nav className={styles.footerLinks} aria-label="Footer">
            <Link href="/pricing">Pricing</Link>
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/terms">Terms of service</Link>
            <Link href="/refund-policy">Refunds &amp; cancellation</Link>
            <Link href="/contact">Contact</Link>
          </nav>
          {/* Computed, not typed. A stale year is a small lie on a page arguing
              that none of its numbers are invented. */}
          <p style={{ fontSize: '0.875rem' }}>
            © {new Date().getFullYear()} HirePilot. All rights reserved.
          </p>
        </div>
      </footer>
    </>
  );
}
