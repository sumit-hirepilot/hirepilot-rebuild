import Link from 'next/link';
import { useRouter } from 'next/router';
import styles from '../styles/Dashboard.module.css';

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
    href: '/applications',
    label: 'Applications',
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
    label: 'Search Agents',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.25" />
        <circle cx="12" cy="12" r="2.25" />
        <path d="M12 3.75V6M12 18v2.25M20.25 12H18M6 12H3.75" />
      </svg>
    ),
  },
  {
    href: '/resume',
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
    href: '/network',
    label: 'Network',
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

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  const initial = (user?.fullName || user?.email || '?').charAt(0).toUpperCase();
  const name = user?.fullName || user?.email?.split('@')[0] || 'there';

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
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
          <p className={styles.headerTitle}>{title}</p>
          <button className={styles.searchButton} type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21 21-4.34-4.34" />
              <circle cx="11" cy="11" r="8" />
            </svg>
            <span>Search</span>
          </button>
          <div className={styles.headerSpacer} />
          <button className={styles.iconButton} aria-label="Notifications" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.268 21a2 2 0 0 0 3.464 0" />
              <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
            </svg>
          </button>
          <div className={styles.autoPilotPill}>
            <span>Auto-Pilot</span>
            <span className={styles.toggleOn} />
          </div>
        </header>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
