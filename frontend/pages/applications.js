import Head from 'next/head';
// Wave C - one reading of a status, shared, so the board and the queue cannot
// describe the same row differently.
import { statusWord } from '../lib/statusWords';
import SubmissionReceipt from '../components/SubmissionReceipt';
// A7.2 - a company that did not parse must never render as if it did.
import { parsedOr } from '../lib/renderState';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import NeedsYouDrawer from '../components/NeedsYouDrawer';
import styles from '../styles/Dashboard.module.css';
import page from '../styles/Applications.module.css';
import { API_BASE } from '../lib/apiBase';
import { formatDate, formatDateShort } from '../lib/format';

/*
 * Wave C — the columns read as stages of a conversation with an employer,
 * because that is what they are. Labels come from the shared status words so
 * this board and the queue cannot describe the same row differently.
 *
 * "Applied" became "Waiting for the company": the user knows they applied,
 * what they want to know is whether anyone has looked.
 */
/*
 * Stage columns, matching what the server can actually record. The old
 * columns (phone_screen, technical_interview, onsite, hired) were a status
 * vocabulary the live constraints refuse to store - they rendered forever
 * empty while every submitted row fell through the buckets and appeared
 * nowhere on this page.
 */
const COLUMNS = [
  { key: 'applied', label: statusWord('applied') },
  { key: 'interviewing', label: statusWord('interviewing') },
  { key: 'offer', label: statusWord('offer') },
  { key: 'ghosted', label: statusWord('ghosted') },
  { key: 'failed', label: statusWord('failed') },
  { key: 'rejected', label: statusWord('rejected') },
];

export default function Applications() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [kanban, setKanban] = useState(null);
  const [rejected, setRejected] = useState([]);
  const [failed, setFailed] = useState([]);
  const [pendingReview, setPendingReview] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [view, setView] = useState('grid');
  const [retrying, setRetrying] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  /*
   * A7.18 — a full page of drafts was twenty clicks, one per row. A queue that
   * costs twenty clicks to clear is a queue people stop clearing.
   */
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkWorking, setBulkWorking] = useState(false);

  const base = API_BASE;

  /*
   * A failed load must not render as an empty pipeline.
   *
   * This was `if (res.ok) { ...setState }` with no else, and a catch that only
   * logged. On a 401 or a 500 every piece of state kept its initial value and
   * `loading` still flipped to false - so the page rendered "0 total
   * applications" and eight empty columns, which is exactly what a user with
   * no applications sees. A request that never answered was displayed as a
   * fact about their account.
   *
   * `kanban` stays null on failure. Null means "not known", [] means "known to
   * be empty" - the render distinguishes them, so a zero can only ever appear
   * when a request actually returned one.
   */
  const loadApplications = useCallback(async (authToken) => {
    setLoading(true);
    setLoadError(null);
    // A request that never answers must not read as a spinner forever. Without
    // this the page sat on "Loading…" indefinitely, which tells the user
    // nothing and offers them nothing to do.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${base}/api/applications`, {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        setKanban(null);
        setLoadError(
          res.status === 401
            ? 'Your session has expired. Sign in again to see your applications.'
            : `Could not load your applications - the server answered ${res.status}.`
        );
        return;
      }
      const data = await res.json();
      setKanban(data.kanban || {});
      setRejected(data.rejected || []);
      setFailed(data.failed || []);
      setPendingReview(data.pendingReview || []);
    } catch (err) {
      setKanban(null);
      setLoadError(
        err && err.name === 'AbortError'
          ? 'Loading your applications timed out after 15 seconds.'
          : 'Could not reach HirePilot to load your applications. Check your connection and try again.'
      );
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, [base]);

  const handleRetry = async (applicationId) => {
    setRetrying(applicationId);
    try {
      const res = await fetch(`${base}/api/applications/${applicationId}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) await loadApplications(token);
    } catch (err) {
      console.error('Failed to retry application', err);
    } finally {
      setRetrying(null);
    }
  };

  const toggleOne = (id) => setSelectedIds((prev) => (
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
  ));

  const handleApproveSelected = async () => {
    if (!selectedIds.length) return;
    setBulkWorking(true);
    try {
      const res = await fetch(`${base}/api/applications/approve-bulk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (res.ok) {
        setSelectedIds([]);
        await loadApplications(token);
      }
    } catch (err) {
      console.error('Failed to approve applications', err);
    } finally {
      setBulkWorking(false);
    }
  };

  const handleApprove = async (applicationId) => {
    setReviewing(applicationId);
    try {
      const res = await fetch(`${base}/api/applications/${applicationId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) await loadApplications(token);
    } catch (err) {
      console.error('Failed to approve application', err);
    } finally {
      setReviewing(null);
    }
  };

  const handleDiscard = async (applicationId) => {
    setReviewing(applicationId);
    try {
      const res = await fetch(`${base}/api/applications/${applicationId}/discard`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) await loadApplications(token);
    } catch (err) {
      console.error('Failed to discard application', err);
    } finally {
      setReviewing(null);
    }
  };

  useEffect(() => {
    const authToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    setAuthChecked(true);
    if (!authToken) {
      router.replace('/login');
      return;
    }
    /*
     * A corrupt `user` blob must not cost the page its data. This used to
     * require BOTH keys and JSON.parse outside a try, so an unparseable value
     * either bounced a signed-in user to /login or threw inside the effect and
     * left the page on its blank branch forever.
     */
    try {
      const parsed = storedUser ? JSON.parse(storedUser) : null;
      if (parsed) setUser(parsed);
    } catch {
      /* stale or corrupt - the token is what authorises the request */
    }
    setToken(authToken);
    loadApplications(authToken);
    // Mount only. `router` changes identity on navigation, and with
    // `loadApplications` alongside it the effect's behaviour became dependent
    // on render timing rather than on mounting - the same defect already fixed
    // in auto-apply.js, where it left the shell rendered and nothing fetched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Moving a card moves the CONVERSATION (tracker_stage), through the same
   * endpoint the Tracker uses - one writer, one vocabulary. The old call, PUT
   * /:id/status with words like phone_screen, was refused by the database for
   * every manual and auto-pilot row (applied_at pins status to 'submitted'),
   * so the card snapped back with a 500 behind it.
   */
  const handleStatusChange = async (applicationId, newStage) => {
    try {
      const res = await fetch(`${base}/api/tracker/${applicationId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stage: newStage }),
      });
      if (res.ok) loadApplications(token);
    } catch (err) {
      console.error('Failed to update stage', err);
    }
  };

  /*
   * No blank branch.
   *
   * This was `if (!user) return null`, which rendered literally nothing - no
   * shell, no spinner, no empty state, no error. Server-side there is never a
   * `user`, so the page shipped an empty #__next and depended entirely on the
   * client to put something on screen; anything that disrupted hydration left
   * a permanently blank page with nothing on it to diagnose from. #45 was
   * filed against exactly that symptom.
   *
   * The shell now always renders. `user` only decorates the chrome, so it is
   * passed through as-is and the page is readable while it is still null.
   */
  /*
   * Wave C — derived from COLUMNS, not written out again. This was a second
   * copy of the same list with its own hand-written labels, so the board and
   * the status dropdown could describe the same stage differently. `failed` is
   * excluded because a user cannot move an application INTO "did not send" -
   * that is something that happened, not a stage they choose.
   */
  const allStatuses = COLUMNS.filter((c) => c.key !== 'failed');
  /*
   * The stage a card is actually at, for the select's value. A rejected
   * status is a rejection wherever the stage got to; a board row with no
   * stage yet is sent-and-waiting.
   */
  const cardStage = (app) => (app.status === 'rejected' ? 'rejected' : (app.tracker_stage || 'applied'));
  const columnsData = { ...(kanban || {}), rejected, failed };
  const allApps = kanban
    ? [...Object.values(kanban).flat(), ...rejected, ...failed].sort((a, b) => new Date(b.applied_at) - new Date(a.applied_at))
    : [];
  // `kanban === null` means the request never answered. Only a load that
  // actually returned may produce a count, so a failure cannot print "0".
  const countKnown = kanban !== null;
  const totalCount = allApps.length;
  const isEmpty = countKnown && !loading && totalCount === 0;

  return (
    <>
      <Head>
        <title>Applications - HirePilot</title>
      </Head>

      <DashboardLayout title="Applications" user={user}>
        {/*
          * The persistent, all-time list. Same component and same endpoint the
          * Auto Apply screen uses - it passes a runId, this does not. A blocker
          * from a run days ago is findable here without remembering which run
          * produced it, which is the whole reason this surface exists.
          */}
        <div style={{ marginBottom: 20 }}>
          <NeedsYouDrawer
            emptyText="Nothing is waiting on you. Parked applications show up here with the question that stopped them."
            onResolved={() => loadApplications(localStorage.getItem('token'))}
          />
        </div>

        {loadError && (
          <div className={page.loadError} role="alert">
            <p className={page.loadErrorTitle}>{loadError}</p>
            <button
              type="button"
              className={page.retryButton}
              onClick={() => {
                const t = localStorage.getItem('token');
                if (t) loadApplications(t); else router.replace('/login');
              }}
            >
              Try again
            </button>
          </div>
        )}

        <div className={page.headerRow}>
          <div>
            <p className={styles.dateLabel}>
              {loading && !countKnown
                ? 'Loading your applications…'
                : countKnown
                  ? `${totalCount} total applications`
                  : 'Application count unavailable'}
            </p>
            <h1 className={styles.greeting}>Application pipeline</h1>
          </div>
          <div className={page.viewToggle}>
            <button
              className={view === 'grid' ? page.viewButtonActive : page.viewButton}
              onClick={() => setView('grid')}
              aria-label="Grid view"
            >
              ▦
            </button>
            <button
              className={view === 'list' ? page.viewButtonActive : page.viewButton}
              onClick={() => setView('list')}
              aria-label="List view"
            >
              ☰
            </button>
          </div>
        </div>

        {pendingReview.length > 0 && (
          <div className={page.pendingReviewSection}>
            <p className={page.pendingReviewTitle}>
              {/* Was "approve to actually mark them applied". It never did that
                  and could not: the row carries no submission record, which is
                  exactly what the table refuses. Approving releases a draft to
                  be sent; "applied" arrives later, with a receipt behind it. */}
              Pending your review ({pendingReview.length}) - Auto-Pilot drafted these. Approving releases them to be sent; nothing is marked applied until an employer receipt comes back.
            </p>
            <div className={page.pendingReviewRow}>
              <label className={page.selectAllLabel}>
                <input
                  type="checkbox"
                  checked={selectedIds.length === pendingReview.length && pendingReview.length > 0}
                  /* Some-but-not-all reads as neither on nor off, so the box
                     shows it rather than rounding to one of them. */
                  ref={(el) => { if (el) el.indeterminate = selectedIds.length > 0 && selectedIds.length < pendingReview.length; }}
                  onChange={(e) => setSelectedIds(e.target.checked ? pendingReview.map((a) => a.id) : [])}
                />
                {' '}Select all {pendingReview.length} on this page
              </label>
              <button
                className={page.approveButton}
                onClick={handleApproveSelected}
                disabled={!selectedIds.length || bulkWorking}
              >
                {bulkWorking ? 'Working...' : `Approve selected (${selectedIds.length})`}
              </button>
            </div>
            {pendingReview.map((app) => (
              <div key={app.id} className={page.pendingReviewRow}>
                <div>
                  <label className={page.rowCheckbox}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(app.id)}
                      onChange={() => toggleOne(app.id)}
                      aria-label={`Select ${app.title}`}
                    />
                  </label>
                  <p className={page.roleCell} style={{ marginBottom: '0.125rem' }}>{app.title}</p>
                  <p className={styles.emptyState} style={{ margin: 0, fontSize: '0.75rem' }}>{parsedOr(app.company_name, 'Company not stated')}</p>
                </div>
                <div className={page.pendingReviewActions}>
                  <button
                    className={page.approveButton}
                    onClick={() => handleApprove(app.id)}
                    disabled={reviewing === app.id}
                  >
                    {reviewing === app.id ? 'Working...' : 'Approve'}
                  </button>
                  <button
                    className={page.discardButton}
                    onClick={() => handleDiscard(app.id)}
                    disabled={reviewing === app.id}
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : loadError ? (
          /*
           * The board is deliberately not rendered under an error. Eight
           * columns reading "No applications" is a statement about the
           * account, and we do not know it to be true - the error above is
           * the only honest thing to show.
           */
          null
        ) : isEmpty ? (
          <div className={page.zeroState}>
            <h2 className={page.zeroStateTitle}>No applications yet</h2>
            <p className={page.zeroStateBody}>
              Applications show up here once HirePilot prepares them and the employer confirms
              receipt. Nothing is marked applied before that.
            </p>
            <button
              type="button"
              className={page.zeroStateAction}
              onClick={() => router.push('/jobs')}
            >
              Find jobs to apply to
            </button>
          </div>
        ) : view === 'list' ? (
          <div className={styles.card} style={{ marginBottom: 0, padding: 0, overflowX: 'auto' }}>
            <table className={page.table}>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Applied</th>
                </tr>
              </thead>
              <tbody>
                {allApps.map((app) => (
                  <tr key={app.id}>
                    <td className={page.roleCell}>
                      {app.title}
                      {app.submitted_by === 'auto_pilot' && <span className={page.autoBadge}>Auto-Pilot</span>}
                    </td>
                    <td>{parsedOr(app.company_name, 'Company not stated')}</td>
                    <td>
                      {app.status === 'failed' ? (
                        <button
                          type="button"
                          className={page.retryButton}
                          onClick={() => handleRetry(app.id)}
                          disabled={retrying === app.id}
                          title={app.failure_reason || 'Application failed'}
                        >
                          {retrying === app.id ? 'Retrying…' : 'Retry'}
                        </button>
                      ) : (
                        <select
                          className={page.statusSelectInline}
                          value={cardStage(app)}
                          onChange={(e) => handleStatusChange(app.id, e.target.value)}
                        >
                          {allStatuses.map((c) => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>{formatDate(app.applied_at)}</td>
                  </tr>
                ))}
                {allApps.length === 0 && (
                  <tr><td colSpan={4} className={styles.emptyState}>No applications yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={page.board}>
            {COLUMNS.map((col) => {
              const items = columnsData[col.key] || [];
              return (
                <div key={col.key} className={page.column}>
                  <div className={page.columnHeader}>
                    <span>{col.label}</span>
                    <span className={page.columnCount}>{items.length}</span>
                  </div>

                  <div className={page.columnBody}>
                    {items.length === 0 ? (
                      <p className={page.emptyColumn}>No applications</p>
                    ) : (
                      items.map((app) => (
                        <div key={app.id} className={page.card}>
                          <p className={page.cardTitle}>
                            {app.title}
                            {app.submitted_by === 'auto_pilot' && <span className={page.autoBadge}>Auto-Pilot</span>}
                          </p>
                          <p className={page.cardSubtitle}>{parsedOr(app.company_name, 'Company not stated')}</p>
                          <p className={page.cardMeta}>
                            {formatDateShort(app.applied_at)}
                          </p>
                          {/* A4 — on EVERY card, not only failures. The receipt
                              has existed server-side since A4 and nothing
                              rendered it; for a product that submits
                              autonomously, being unable to read what went out
                              in your name is the defect that matters most,
                              because an application cannot be unsent. */}
                          <SubmissionReceipt applicationId={app.id} token={token} />
                          {app.status === 'failed' ? (
                            <>
                              <p className={page.failureReason}>{app.failure_reason}</p>
                              <button
                                type="button"
                                className={page.retryButton}
                                onClick={() => handleRetry(app.id)}
                                disabled={retrying === app.id}
                              >
                                {retrying === app.id ? 'Retrying…' : 'Retry'}
                              </button>
                            </>
                          ) : (
                            <select
                              className={page.statusSelect}
                              value={cardStage(app)}
                              onChange={(e) => handleStatusChange(app.id, e.target.value)}
                            >
                              {allStatuses.map((c) => (
                                <option key={c.key} value={c.key}>{c.label}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DashboardLayout>
    </>
  );
}
