import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/apiBase';

/*
 * C1b — time to first match, before onboarding ends.
 *
 * The point is to prove the product works while the user is still deciding
 * whether to finish. So this shows ONE REAL scored row from the same query the
 * feed runs - never a sample, never a mock, never an illustrative number.
 *
 * Constraint 1 governs the empty case: if there is no match yet, it says so.
 * A fabricated "76% Senior Product Designer at X" here would be the single
 * most damaging lie in the product, because it is the first thing a new user
 * ever sees it claim.
 */
export default function FirstMatch({ title, location }) {
  const [state, setState] = useState({ job: null, loading: true, error: null });

  useEffect(() => {
    if (!String(title || '').trim()) { setState({ job: null, loading: false, error: null }); return undefined; }
    let live = true;

    (async () => {
      try {
        const token = localStorage.getItem('token');
        const qs = new URLSearchParams({ search: title, limit: '1', page: '1' });
        if (String(location || '').trim()) qs.set('location', location);
        const res = await fetch(`${API_BASE}/api/jobs?${qs.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        // Status before body: an error page is JSON too, and would otherwise
        // read as "no matches" - which is a different thing entirely.
        if (!res.ok) throw new Error(`search answered ${res.status}`);
        const data = await res.json();
        if (!live) return;
        setState({ job: (data.jobs || [])[0] || null, loading: false, error: null });
      } catch (err) {
        if (live) setState({ job: null, loading: false, error: err });
      }
    })();

    return () => { live = false; };
  }, [title, location]);

  if (!String(title || '').trim()) return null;

  if (state.loading) {
    return <p className="firstMatch firstMatch-loading" role="status">Looking for your first match…</p>;
  }
  if (state.error) {
    // Says what happened. It does not pretend there were no matches.
    return <p className="firstMatch firstMatch-failed" role="status">We could not check for matches just now — your feed will still be waiting.</p>;
  }
  if (!state.job) {
    return (
      <p className="firstMatch firstMatch-empty" role="status">
        Nothing matches that yet. Widening the title or location usually finds more.
      </p>
    );
  }

  const score = state.job.overall_score;
  const pct = score === null || score === undefined ? null : Math.round(Number(score) * 100);

  return (
    <div className="firstMatch firstMatch-ready" role="status">
      <p className="firstMatchLead">Here is one we found already</p>
      <p className="firstMatchRole">
        {/* The score is rendered only when the row actually carries one - an
            unscored row says so rather than showing a confident percentage. */}
        {pct !== null && <span className="firstMatchScore">{pct}%</span>}
        <span className="firstMatchTitle">{state.job.title}</span>
      </p>
      <p className="firstMatchCompany">
        {state.job.company_name || 'Company not stated'}
        {state.job.location ? ` · ${state.job.location}` : ''}
      </p>
      {pct === null && <p className="firstMatchNote">Not scored yet — it will be once your profile is saved.</p>}
    </div>
  );
}
