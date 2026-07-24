import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import styles from '../styles/Home.module.css';

export default function Home() {
  const router = useRouter();
  const [apiStatus, setApiStatus] = useState('checking');

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health`);
        setApiStatus(response.ok ? 'connected' : 'error');
      } catch (error) {
        setApiStatus('disconnected');
      }
    };
    checkHealth();
  }, []);

  return (
    <>
      <Head>
        <title>HirePilot - Job Search on Autopilot</title>
        <meta name="description" content="Instrument-grade job search. Agents that scan the market, score every match against your profile, and apply while you focus on interviews." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <Layout>
        {/* Hero Section */}
        <section className={styles.hero}>
          <div className="container">
            <div className={styles.heroContent}>
              <div>
                <p className={styles.label}>INSTRUMENT-GRADE JOB SEARCH</p>
                <h1>Your job search, on autopilot.</h1>
                <p className={styles.subtitle}>
                  Agents that scan the market, score every match against your profile, and apply while you focus on the interviews that matter.
                </p>
                <div className={styles.ctaButtons}>
                  <Link href="/signup" className="btn-primary">
                    Start Free
                  </Link>
                  <a href="#how-it-works" className="btn-secondary">
                    See how it works →
                  </a>
                </div>
              </div>
              <div className={styles.heroDashboard}>
                <div className={styles.dashboardCard}>
                  <div className={styles.badge}>✓ Auto-Pilot Active</div>
                  <div className={styles.stats}>
                    <div className={styles.stat}>
                      <span className={styles.number}>14</span>
                      <span>jobs scanned today</span>
                    </div>
                    <div className={styles.stat}>
                      <span className={styles.number}>7/10</span>
                      <span>applied</span>
                    </div>
                    <div className={styles.stat}>
                      <span className={styles.number}>3</span>
                      <span>interviews</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className={styles.features}>
          <div className="container">
            <p className={styles.label} style={{ textAlign: 'center' }}>WHY HIREPILOT</p>
            <h2 style={{ textAlign: 'center' }}>Great candidates lose to fast applicants.</h2>

            <div className={styles.featureGrid}>
              <div className={styles.featureCard}>
                <h3>⚙️ How it works</h3>
                <div className={styles.featureSteps}>
                  <div className={styles.step}>
                    <h4>Connect your resume</h4>
                    <p>We parse your skills and experience in seconds.</p>
                  </div>
                  <div className={styles.step}>
                    <h4>Agents scan and match</h4>
                    <p>Every posting is scored against your real profile.</p>
                  </div>
                  <div className={styles.step}>
                    <h4>Auto-pilot applies</h4>
                    <p>Applications go out within the limits you set.</p>
                  </div>
                </div>
              </div>

              <div className={styles.featureCard}>
                <h3>🎯 Match scoring</h3>
                <p>Every job ranked on skills, experience and location fit.</p>
              </div>

              <div className={styles.featureCard}>
                <h3>📊 Kanban tracker</h3>
                <p>Watch applications move from applied to offer.</p>
                <div className={styles.kanbanPreview}>
                  {['Applied', 'Interview', 'Offer'].map((status) => (
                    <div key={status} className={styles.kanbanColumn}>{status}</div>
                  ))}
                </div>
              </div>

              <div className={styles.featureCard}>
                <h3>📄 Resume tailoring</h3>
                <p>A version of your resume built for each role, in seconds.</p>
              </div>

              <div className={styles.featureCard}>
                <h3>🔗 Referral finder</h3>
                <p>Surface hiring managers and alumni at every company.</p>
              </div>

              <div className={styles.featureCard}>
                <h3>🤖 Search agents</h3>
                <p>Standing searches that keep working after you log off.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Dashboard Preview Section */}
        <section className={styles.dashboard}>
          <div className="container">
            <h2 style={{ textAlign: 'center' }}>One dashboard for every application.</h2>
            <div className={styles.dashboardPreview}>
              <div className={styles.kanbanBoard}>
                {['Applied', 'Phone Screen', 'Interview', 'Offer', 'Hired'].map((status) => (
                  <div key={status} className={styles.column}>
                    <h4>{status}</h4>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ textAlign: 'center', marginTop: '2rem' }}>
              <Link href="/signup" className="btn-primary">
                Explore the dashboard
              </Link>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className={styles.cta}>
          <div className="container">
            <h2>Ready for lift-off.</h2>
            <Link href="/signup" className="btn-primary">
              Start Free
            </Link>
          </div>
        </section>

        {/* API Status Debug */}
        {process.env.NODE_ENV === 'development' && (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            API Status: {apiStatus}
          </div>
        )}
      </Layout>
    </>
  );
}
