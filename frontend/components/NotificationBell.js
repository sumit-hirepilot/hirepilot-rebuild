import { useEffect, useState, useRef, useCallback } from 'react';
import styles from '../styles/Dashboard.module.css';
import { timeAgo } from '../lib/format';


export default function NotificationBell({ token, base }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  // A2c: null means "not fetched yet". The badge already renders only on a
  // positive count, so this changes no pixels - it stops the component
  // *claiming* zero unread when it simply has not asked.
  const [unreadCount, setUnreadCount] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${base}/api/notifications?limit=15`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : null);
      }
    } catch (err) {
      /*
       * Item 5 — this was try/finally with no catch, and load() is called
       * unawaited from an effect AND on a 60-second interval. A dropped
       * connection therefore threw an unhandled rejection every minute:
       * invisible to the user, but it is the kind of noise that buries a real
       * error in a crash reporter, and it failed any test that broke fetch.
       *
       * Quiet is right for a header counter - it must not block the page it
       * sits on - but quiet has to be deliberate.
       */
      console.warn('Notifications could not be loaded:', err.message);
    } finally {
      setLoaded(true);
    }
  }, [token, base]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleToggle = () => setOpen((v) => !v);

  const handleMarkAllRead = async () => {
    await fetch(`${base}/api/notifications/read-all`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0); // real-zero: everything was just marked read
  };

  const handleItemClick = async (n) => {
    if (!n.isRead) {
      await fetch(`${base}/api/notifications/${n.id}/read`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
  };

  return (
    <div className={styles.notifWrap} ref={ref}>
      <button className={styles.iconButton} aria-label="Notifications" type="button" onClick={handleToggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.268 21a2 2 0 0 0 3.464 0" />
          <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
        </svg>
        {unreadCount > 0 && <span className={styles.notifBadge}>{unreadCount > 9 ? '9+' : unreadCount} {/* derived-figure: a cap on the real unread count, not a stand-in for one */}</span>}
      </button>

      {open && (
        <div className={styles.notifDropdown}>
          <div className={styles.notifHeader}>
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button className={styles.notifMarkAll} onClick={handleMarkAllRead}>Mark all read</button>
            )}
          </div>
          <div className={styles.notifList}>
            {!loaded ? (
              <p className={styles.notifEmpty}>Loading&hellip;</p>
            ) : notifications.length === 0 ? (
              <p className={styles.notifEmpty}>No notifications yet. You&apos;ll see match alerts, application updates, and Auto-Pilot activity here.</p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={n.isRead ? styles.notifItem : styles.notifItemUnread}
                  onClick={() => handleItemClick(n)}
                >
                  <p className={styles.notifText}>{n.text}</p>
                  <p className={styles.notifTime}>{timeAgo(n.createdAt)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
