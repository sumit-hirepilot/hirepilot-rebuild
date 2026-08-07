import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback, useRef } from 'react';
import styles from '../styles/Dashboard.module.css';
import NotificationBell from './NotificationBell';
import ExtensionInstallModal, { useExtensionDetected, extensionPrompt, DISMISS_KEY } from './ExtensionInstallModal';
import { canInstallExtension, DESKTOP_ONLY_NOTE } from '../lib/extensionCapable';
import { API_BASE } from '../lib/apiBase';

/*
 * Wave C — plain words.
 *
 * "Apply Queue", "Search Agents", "Auto-Pilot", "Tracker" and "Analytics" are
 * this product's internal vocabulary, and a first-time user cannot parse any
 * of them. Every destination is unchanged; only the word the user reads is.
 *
 *   Auto Apply     -> Apply for me        (says who does the work)
 *   Apply Queue    -> Ready to send       (says what state these are in)
 *   Tracker        -> My applications     (says whose they are)
 *   Applications   -> Progress            (the pipeline view, not the list)
 *   Search Agents  -> Saved searches      (a search that keeps running)
 *   Analytics      -> How it is going     (a question, not a discipline)
 *   Network        -> People
 *
 * Kept as-is: Jobs, Inbox, Resume, Profile, Settings - already plain.
 * Recorded in DECISIONS.md so the set is a decision, not an accident.
 */
const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="13" r="8" />
        <path d="M12 13l3.5-3.5" />
        <path d="M8.5 5.5 7 3M15.5 5.5 17 3" />
      </svg>
    ),
  },
  {
    href: '/jobs',
    label: 'Jobs',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="7" width="17" height="12" rx="2" />
        <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" />
        <path d="M3.5 12.5h17" />
      </svg>
    ),
  },
  {
    href: '/auto-apply',
    label: 'Apply for me',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" />
      </svg>
    ),
  },
  {
    href: '/apply-queue',
    label: 'Ready to send',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 2 11 13" />
        <path d="M22 2 15 22l-4-9-9-4 20-7z" />
      </svg>
    ),
  },
  {
    href: '/inbox',
    label: 'Inbox',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5h16v14H4z" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    ),
  },
  {
    href: '/tracker',
    label: 'My applications',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="5" height="16" rx="1.4" />
        <rect x="9.5" y="4" width="5" height="11" rx="1.4" />
        <rect x="16" y="4" width="5" height="7" rx="1.4" />
      </svg>
    ),
  },
  {
    href: '/applications',
    label: 'Progress',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="4" width="6" height="16" rx="1.5" />
        <rect x="9.5" y="4" width="6" height="10" rx="1.5" />
        <rect x="15.5" y="4" width="5" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/agents',
    label: 'Saved searches',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.25" />
        <circle cx="12" cy="12" r="2.25" />
        <path d="M12 3.75V6M12 18v2.25M20.25 12H18M6 12H3.75" />
      </svg>
    ),
  },
  {
    href: '/resume-editor',
    label: 'Resume',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 3.5h8L18.5 8v12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15.5a1 1 0 0 1 1-1Z" />
        <path d="M14 3.5V8h4.5" />
        <path d="M8.5 12.5h7M8.5 15.5h7M8.5 18h4" />
      </svg>
    ),
  },
  {
    href: '/analytics',
    label: 'How it is going',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V10M12 20V4M20 20v-7" />
      </svg>
    ),
  },
  {
    href: '/network',
    label: 'People',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="7" r="2.25" />
        <circle cx="18" cy="7" r="2.25" />
        <circle cx="12" cy="18" r="2.25" />
        <path d="M7.75 8.5 10.5 16M16.25 8.5 13.5 16M8.25 7h7.5" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.6" />
        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3.75v2M12 18.25v2M20.25 12h-2M5.75 12h-2M17.66 6.34l-1.42 1.42M7.76 16.24l-1.42 1.42M17.66 17.66l-1.42-1.42M7.76 7.76 6.34 6.34" />
      </svg>
    ),
  },
];

export default function DashboardLayout({ children, title, user }) {
  const router = useRouter();
  const [autoPilotOn, setAutoPilotOn] = useState(false);
  const [autoPilotLoaded, setAutoPilotLoaded] = useState(false);
  /*
   * The extension modal lives here rather than on one page, so the top-bar CTA
   * can open it from anywhere and the one-time prompt is not tied to the
   * dashboard route.
   */
  const extensionDetected = useExtensionDetected();
  // Credit counter (PRD 6). Read-only here; the meaning of a credit is defined
  // server-side and shown in the tooltip so the number is never just a number.
  const [credits, setCredits] = useState(null);
  /*
   * Nothing that depends on client-only state may render on the first pass.
   *
   * The credits pill rendered a <button> as soon as its fetch resolved, but the
   * server rendered none - React reported "Expected server HTML to contain a
   * matching <button> in <header>", replaced the tree, and effects stopped
   * running throughout the app. Every page then sat in its loading state
   * forever with no error and no failed request, because no effect ever fired
   * to make one.
   *
   * Same fix as useExtensionDetected: first render matches the server, and
   * client-only content appears on the pass after mount.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [extModalOpen, setExtModalOpen] = useState(false);
  /*
   * Whether this browser can install the extension at all. Read after mount,
   * never during render: navigator does not exist on the server, and a value
   * that differs between the two renders is a hydration mismatch. Starts true
   * so the first client render matches the server's, then narrows.
   */
  const [canInstall, setCanInstall] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const base = API_BASE;

  useEffect(() => {
    setMobileNavOpen(false);
  }, [router.pathname]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  useEffect(() => {
    if (!token) return;
    fetch(`${base}/api/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.preferences) setAutoPilotOn(!!data.preferences.auto_apply_enabled);
        setAutoPilotLoaded(true);
      })
      .catch(() => setAutoPilotLoaded(true));
  }, [token, base]);

  useEffect(() => {
    if (!token) return;
    // Failing quietly is right here: a header counter that cannot load must not
    // block the page it sits on.
    fetch(`${base}/api/plans/credits`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => d && setCredits(d))
      .catch(() => {});
  }, [token, base]);

  useEffect(() => { setCanInstall(canInstallExtension()); }, []);

  useEffect(() => {
    // Only once detection has concluded (false, not null). The once-per-session
    // guard lives in extensionPrompt rather than component state, because this
    // layout remounts on every route change.
    if (extensionDetected !== false) return;
    /*
     * Never prompt a phone to install a Chrome extension. Chrome on Android
     * and every iOS browser simply cannot, so the prompt was an instruction
     * that could not be followed - shown to exactly the users the landing page
     * invites with "runs in your mobile browser".
     */
    if (!canInstall) return;
    if (!extensionPrompt.shouldShow()) return;
    extensionPrompt.markShown();
    setExtModalOpen(true);
  }, [extensionDetected, canInstall]);

  const handleToggleAutoPilot = async () => {
    if (!token || toggling) return;
    setToggling(true);
    const next = !autoPilotOn;
    try {
      const res = await fetch(`${base}/api/profile/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ autoApplyEnabled: next }),
      });
      if (res.ok) setAutoPilotOn(next);
    } finally {
      setToggling(false);
    }
  };

  const initial = (user?.fullName || user?.email || '?').charAt(0).toUpperCase();
  const name = user?.fullName || user?.email?.split('@')[0] || 'there';

  return (
    <div className={styles.shell}>
      {mobileNavOpen && (
        <div
          className={styles.navOverlay}
          onClick={() => setMobileNavOpen(false)}
          role="presentation"
        />
      )}

      <aside className={`${styles.sidebar} ${mobileNavOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarLogoIcon}>
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="16" cy="16" r="12.5" />
              <path d="M16 4v3M16 25v3M28 16h-3M7 16H4M23.5 8.5l-2 2M10.5 21.5l-2 2M23.5 23.5l-2-2M10.5 10.5l-2-2" />
              <path d="M16 3.2 17.4 6.6 14.6 6.6Z" fill="currentColor" stroke="none" />
              <text x="16" y="20.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor" stroke="none">H</text>
            </svg>
          </span>
          <span className={styles.sidebarLogoText}>HirePilot</span>
          <button
            type="button"
            className={styles.navCloseButton}
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const active = router.pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
              >
                {active && <span className={styles.navActiveBar} />}
                <span className={active ? styles.navIconActive : styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.userRow}>
            <div className={styles.userAvatar}>{initial}</div>
            <span className={styles.userName}>{name}</span>
            <button onClick={handleLogout} aria-label="Sign out" className={styles.logoutButton}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m16 17 5-5-5-5" />
                <path d="M21 12H9" />
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.header}>
          <button
            type="button"
            className={styles.navMenuButton}
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <p className={styles.headerTitle}>{title}</p>
          <HeaderSearch router={router} />
          <div className={styles.headerSpacer} />
          {/* Hidden once the extension is present - it would be dead weight in
              the bar. Also hidden while detection is still pending (null) so it
              does not flash in and out on every page load. */}
          {/*
            * On a phone this is NOT hidden - it is relabelled. Removing it
            * would silently drop the only place the desktop-only requirement
            * is stated, and a user who never learns why applying does nothing
            * is worse off than one told plainly. The modal carries the full
            * sentence, because the header has no room for it.
            */}
          {extensionDetected === false && (
            <button
              type="button"
              className={styles.extensionCta}
              onClick={() => setExtModalOpen(true)}
              title={canInstall
                ? 'Install the browser extension that submits your applications'
                : DESKTOP_ONLY_NOTE}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12" />
                <path d="m7 11 5 5 5-5" />
                <path d="M4 19h16" />
              </svg>
              <span className={styles.extensionCtaLabel}>
                {canInstall ? (
                  <><span className={styles.extensionCtaLabelLong}>Download </span>Extension</>
                ) : (
                  /*
                   * Two whole labels, not one with a hidden word.
                   *
                   * "Applying needs a desktop" minus its hidden span is still
                   * "Applying needs desktop" - 22 characters - and at 375 that
                   * pushed the header 155px wide and CLIPPED the credits pill
                   * to "45". Page overflow read 0 the whole time, because the
                   * header clips internally rather than scrolling the page.
                   * Only the screenshot showed it.
                   *
                   * The short form still says the thing that matters; the
                   * modal carries the full sentence, which is where there is
                   * room to read it.
                   */
                  <>
                    <span className={styles.extensionCtaLabelLong}>Applying needs a desktop</span>
                    <span className={styles.extensionCtaLabelShort}>Desktop only</span>
                  </>
                )}
              </span>
            </button>
          )}
          {mounted && credits && (
            <Link
              href="/settings?tab=Plans"
              className={credits.nearLimit ? styles.creditsPillLow : styles.creditsPill}
              title={`${credits.remaining} of ${credits.total} applications left on ${credits.tierName}. One credit is spent per application the employer confirms.`}
            >
              <span className={styles.creditsNum}>{credits.remaining}</span> left
            </Link>
          )}
          <NotificationBell token={token} base={base} />
          <button
            type="button"
            className={styles.autoPilotPill}
            onClick={handleToggleAutoPilot}
            disabled={!autoPilotLoaded || toggling}
            title={autoPilotOn ? 'Auto-Pilot is on - click to pause' : 'Auto-Pilot is off - click to activate'}
          >
            <span>Auto-Pilot</span>
            <span className={autoPilotOn ? styles.toggleOn : styles.toggleOff} />
          </button>
        </header>

        <ExtensionInstallModal
          token={token}
          apiBase={base}
          open={extModalOpen}
          canInstall={canInstall}
          onClose={() => setExtModalOpen(false)}
          onDismiss={() => localStorage.setItem(DISMISS_KEY, '1')}
        />

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}

function HeaderSearch({ router }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    router.push(`/jobs?search=${encodeURIComponent(value.trim())}`);
  };

  return (
    <form className={styles.searchButton} onSubmit={handleSubmit}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21 21-4.34-4.34" />
        <circle cx="11" cy="11" r="8" />
      </svg>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search jobs..."
        className={styles.headerSearchInput}
      />
      <kbd className={styles.kbd}>&#8984;K</kbd>
    </form>
  );
}
