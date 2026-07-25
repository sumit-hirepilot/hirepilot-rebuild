import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../../components/DashboardLayout';
import styles from '../../styles/Dashboard.module.css';
import page from '../../styles/AgentMatches.module.css';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AgentMatches() {
  const router = useRouter();
  const { id } = router.query;
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [agent, setAgent] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const base = process.env.NEXT_PUBLIC_API_URL;

  const loadData = useCallback(async (authToken) => {
    if (!id) return;
    setLoading(true);
    try {
      const [agentRes, matchesRes] = await Promise.all([
        fetch(`${base}/api/agents/${id}`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${base}/api/agents/${id}/matches`, { headers: { Authorization: `Bearer ${authToken}` } }),
      ]);
      if (agentRes.ok) setAgent(await agentRes.json());
      if (matchesRes.ok) {
        const data = await matchesRes.json();
        setMatches(data.matches || []);
      }
    } catch (err) {
      console.error('Failed to load agent matches', err);
    } finally {
      setLoading(false);
    }
  }, [base, id]);

  useEffect(() => {
    const authToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!authToken || !storedUser) {
      router.push('/login');
      return;
    }
    setUser(JSON.parse(storedUser));
    setToken(authToken);
  }, [router]);

  useEffect(() => {
    if (token && id) loadData(token);
  }, [token, id, loadData]);

  const applicableMatches = matches.filter((m) => !m.application_id);

  const toggleSelect = (jobId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === applicableMatches.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(applicableMatches.map((m) => m.id)));
    }
  };

  if (!user) return null;

  return (
    <>
      <Head>
        <title>{agent ? `${agent.name} matches` : 'Search agent matches'} - HirePilot</title>
      </Head>

      <DashboardLayout title="Search Agents" user={user}>
        <a href="/agents" className={page.backLink}>&larr; All search agents</a>

        {loading ? (
          <p className={styles.emptyState}>Loading&hellip;</p>
        ) : !agent ? (
          <p className={styles.emptyState}>Search agent not found.</p>
        ) : (
          <>
            <div className={page.headerRow}>
              <div>
                <h1 className={styles.greeting} style={{ margin: 0 }}>{agent.name}</h1>
                <p className={page.headerSubtitle}>
                  {(agent.preferred_locations || []).join(', ') || 'World'} &middot; min match {Math.round((agent.min_match_score || 0.75) * 100)}%
                  &middot; {matches.length} matches &middot; {agent.applied_count} applied
                </p>
              </div>
            </div>

            {matches.length === 0 ? (
              <div className={styles.card}>
                <p className={styles.emptyState}>
                  No matches yet. Click &quot;Run Now&quot; on this agent from the Search Agents page to scan for jobs.
                </p>
              </div>
            ) : (
              <>
                <div className={page.list}>
                  {matches.map((m) => (
                    <MatchRow
                      key={m.id}
                      match={m}
                      selected={selectedIds.has(m.id)}
                      onToggle={() => toggleSelect(m.id)}
                      expanded={expandedId === m.id}
                      onExpandToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
                    />
                  ))}
                </div>

                {selectedIds.size > 0 && (
                  <div className={page.bulkBar}>
                    <span>{selectedIds.size} job{selectedIds.size === 1 ? '' : 's'} selected</span>
                    <div className={page.bulkBarActions}>
                      <button className={page.bulkBarSecondary} onClick={() => setSelectedIds(new Set())}>
                        Clear
                      </button>
                      <button className={page.bulkBarPrimary} onClick={() => setReviewOpen(true)}>
                        Auto Apply Selected
                      </button>
                    </div>
                  </div>
                )}

                {applicableMatches.length > 0 && (
                  <button className={page.selectAllLink} onClick={toggleSelectAll}>
                    {selectedIds.size === applicableMatches.length ? 'Deselect all' : `Select all ${applicableMatches.length} unapplied matches`}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </DashboardLayout>

      {reviewOpen && (
        <BulkApplyReview
          jobs={matches.filter((m) => selectedIds.has(m.id))}
          token={token}
          base={base}
          onClose={() => setReviewOpen(false)}
          onDone={() => {
            setReviewOpen(false);
            setSelectedIds(new Set());
            loadData(token);
          }}
        />
      )}
    </>
  );
}

function MatchRow({ match, selected, onToggle, expanded, onExpandToggle }) {
  const score = match.overall_score != null ? Math.round(parseFloat(match.overall_score) * 100) : null;
  const applied = !!match.application_id;
  const matchedSkills = match.match_details?.matched_skills || [];

  return (
    <div className={page.row}>
      <div className={page.rowMain}>
        {applied ? (
          <span className={page.appliedCheckSlot} title="Already applied">&#10003;</span>
        ) : (
          <input type="checkbox" checked={selected} onChange={onToggle} className={page.checkbox} />
        )}
        {score !== null && <div className={page.scoreRing}>{score}</div>}
        <div className={page.rowInfo}>
          <p className={page.rowTitle}>{match.title}</p>
          <p className={page.rowSubtitle}>
            {match.company_name} &middot; {match.location || 'Remote'}
            {match.salary_min ? ` · $${Math.round(match.salary_min / 1000)}K${match.salary_max ? `-${Math.round(match.salary_max / 1000)}K` : '+'}` : ''}
            {' · '}{timeAgo(match.matched_at)}
          </p>
        </div>
        <div className={page.rowActions}>
          {applied && <span className={page.appliedBadge}>{match.application_status || 'Applied'}</span>}
          <button className={page.expandButton} onClick={onExpandToggle}>
            {expanded ? 'Hide details' : 'Why this matches'}
          </button>
          <a href={match.job_url} target="_blank" rel="noreferrer" className={page.originalLink}>Original posting</a>
        </div>
      </div>

      {expanded && (
        <div className={page.rowDetails}>
          {score !== null ? (
            <div className={page.fitBreakdown}>
              <FitBar label="Skills" value={match.skills_match_score} />
              <FitBar label="Experience" value={match.experience_match_score} />
              <FitBar label="Location" value={match.location_match_score} />
              {matchedSkills.length > 0 && (
                <p className={page.matchedSkillsLine}>
                  Matched skills: {matchedSkills.join(', ')}
                </p>
              )}
            </div>
          ) : (
            <p className={page.noScoreNote}>
              Match score not calculated yet - visit the Jobs page or Dashboard to trigger a recalculation.
            </p>
          )}
          {match.description && (
            <p className={page.descriptionPreview}>{match.description.slice(0, 400)}{match.description.length > 400 ? '…' : ''}</p>
          )}
        </div>
      )}
    </div>
  );
}

function FitBar({ label, value }) {
  const pct = value != null ? Math.round(parseFloat(value) * 100) : 0;
  return (
    <div className={page.fitRow}>
      <span>{label}</span>
      <div className={page.fitTrack}><div className={page.fitFill} style={{ width: `${pct}%` }} /></div>
      <span>{pct}%</span>
    </div>
  );
}

function BulkApplyReview({ jobs, token, base, onClose, onDone }) {
  const [items, setItems] = useState(() => jobs.map((j) => ({
    jobId: j.id,
    title: j.title,
    company: j.company_name,
    status: 'generating', // generating | ready | skipped | applying | applied | failed
    tailoredResume: '',
    coverLetter: '',
    error: null,
  })));
  const [phase, setPhase] = useState('review'); // review | applying | done
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function generateFor(item) {
      try {
        const [tailorRes, coverRes] = await Promise.all([
          fetch(`${base}/api/resume/tailor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ jobId: item.jobId }),
          }),
          fetch(`${base}/api/resume/cover-letter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ jobId: item.jobId }),
          }),
        ]);
        const tailorData = tailorRes.ok ? await tailorRes.json() : null;
        const coverData = coverRes.ok ? await coverRes.json() : null;

        if (cancelled) return;
        setItems((prev) => prev.map((it) => it.jobId === item.jobId ? {
          ...it,
          status: 'ready',
          tailoredResume: tailorData?.tailored || '',
          coverLetter: coverData?.content || '',
        } : it));
      } catch (err) {
        if (cancelled) return;
        setItems((prev) => prev.map((it) => it.jobId === item.jobId ? { ...it, status: 'ready', error: 'Could not generate a draft - you can still apply without one.' } : it));
      }
    }

    // Generate with limited concurrency so we don't fire 20 tailor+cover-letter
    // requests at once for a large batch.
    const CONCURRENCY = 3;
    let index = 0;
    const runNext = async () => {
      if (index >= items.length) return;
      const item = items[index];
      index++;
      await generateFor(item);
      await runNext();
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, runNext);
    Promise.all(workers);

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateItem = (jobId, patch) => {
    setItems((prev) => prev.map((it) => it.jobId === jobId ? { ...it, ...patch } : it));
  };

  const readyCount = items.filter((it) => it.status === 'ready').length;
  const allGenerated = items.every((it) => it.status !== 'generating');

  const handleConfirm = async () => {
    setPhase('applying');
    setApplying(true);

    for (const item of items) {
      if (item.status !== 'ready') continue;
      updateItem(item.jobId, { status: 'applying' });
      try {
        const res = await fetch(`${base}/api/applications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ jobId: item.jobId, coverLetter: item.coverLetter }),
        });
        const data = await res.json();
        if (res.ok) {
          updateItem(item.jobId, { status: 'applied' });
        } else {
          updateItem(item.jobId, { status: 'failed', error: data.error || 'Failed to apply' });
        }
      } catch (err) {
        updateItem(item.jobId, { status: 'failed', error: 'Network error' });
      }
    }

    setApplying(false);
    setPhase('done');
  };

  const appliedCount = items.filter((it) => it.status === 'applied').length;
  const failedCount = items.filter((it) => it.status === 'failed').length;

  return (
    <div className={page.reviewOverlay} onClick={phase === 'review' ? onClose : undefined}>
      <div className={page.reviewPanel} onClick={(e) => e.stopPropagation()}>
        <div className={page.reviewHeader}>
          <h2>{phase === 'done' ? 'Auto Apply complete' : `Review ${items.length} application${items.length === 1 ? '' : 's'}`}</h2>
          {phase !== 'applying' && <button className={page.reviewClose} onClick={onClose}>&times;</button>}
        </div>

        {phase === 'done' ? (
          <div className={page.doneSummary}>
            <p>{appliedCount} application{appliedCount === 1 ? '' : 's'} sent{failedCount > 0 ? `, ${failedCount} failed` : ''}.</p>
            <button className={page.bulkBarPrimary} onClick={onDone}>Done</button>
          </div>
        ) : (
          <>
            <p className={page.reviewSubtitle}>
              We&apos;ve drafted a tailored resume summary and cover letter for each job - review, edit, or skip before applying.
            </p>

            <div className={page.reviewList}>
              {items.map((item) => (
                <ReviewItem
                  key={item.jobId}
                  item={item}
                  disabled={phase === 'applying'}
                  onChange={(patch) => updateItem(item.jobId, patch)}
                  onSkip={() => updateItem(item.jobId, { status: item.status === 'skipped' ? 'ready' : 'skipped' })}
                />
              ))}
            </div>

            <div className={page.reviewFooter}>
              <button className={page.bulkBarSecondary} onClick={onClose} disabled={applying}>Cancel</button>
              <button
                className={page.bulkBarPrimary}
                onClick={handleConfirm}
                disabled={!allGenerated || readyCount === 0 || applying}
              >
                {applying ? 'Applying...' : `Confirm & Apply to ${readyCount} job${readyCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewItem({ item, disabled, onChange, onSkip }) {
  const skipped = item.status === 'skipped';

  return (
    <div className={`${page.reviewItem} ${skipped ? page.reviewItemSkipped : ''}`}>
      <div className={page.reviewItemHeader}>
        <div>
          <p className={page.reviewItemTitle}>{item.title}</p>
          <p className={page.reviewItemCompany}>{item.company}</p>
        </div>
        <div className={page.reviewItemStatus}>
          {item.status === 'generating' && <span className={page.statusGenerating}>Generating draft…</span>}
          {item.status === 'ready' && <button className={page.skipButton} onClick={onSkip} disabled={disabled}>Skip</button>}
          {skipped && <button className={page.skipButton} onClick={onSkip} disabled={disabled}>Undo skip</button>}
          {item.status === 'applying' && <span className={page.statusApplying}>Applying…</span>}
          {item.status === 'applied' && <span className={page.statusApplied}>Applied ✓</span>}
          {item.status === 'failed' && <span className={page.statusFailed}>Failed{item.error ? `: ${item.error}` : ''}</span>}
        </div>
      </div>

      {!skipped && item.status !== 'generating' && (
        <>
          {item.error && <p className={page.reviewItemNote}>{item.error}</p>}
          <label className={page.reviewLabel}>Tailored resume summary</label>
          <textarea
            className={page.reviewTextarea}
            rows={3}
            value={item.tailoredResume}
            onChange={(e) => onChange({ tailoredResume: e.target.value })}
            disabled={disabled}
          />
          <label className={page.reviewLabel}>Cover letter</label>
          <textarea
            className={page.reviewTextarea}
            rows={6}
            value={item.coverLetter}
            onChange={(e) => onChange({ coverLetter: e.target.value })}
            disabled={disabled}
          />
        </>
      )}
    </div>
  );
}
