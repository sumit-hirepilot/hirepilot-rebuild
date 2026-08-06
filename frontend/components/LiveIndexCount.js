import { useEffect, useRef, useState } from 'react';
import { countText } from '../lib/renderState';
import { API_BASE } from '../lib/apiBase';

/*
 * C1a — live feedback after every answer, and every number a real query.
 *
 * "1,240 Product Designer jobs in our index" has to BE 1,240. The count comes
 * from GET /api/jobs?limit=1, which returns an honest `total` for whatever
 * filter combination is passed and whose COUNT is cached 60s server-side, so
 * asking on every keystroke is cheap.
 *
 * Constraint 1 applies INSIDE onboarding, which is the whole reason this
 * routes through renderState.countText rather than rendering a number
 * directly: a count that is loading, that failed, or that is genuinely zero
 * are three different things and none of them may render as an encouraging
 * figure. A real zero says so and offers to widen; it never becomes "plenty of
 * matches".
 */
export default function LiveIndexCount({ params, unit, zeroText, onCount }) {
  const [state, setState] = useState({ value: null, loading: false, error: null });
  const seq = useRef(0);

  const query = new URLSearchParams({ ...params, limit: '1', page: '1' }).toString();
  const hasInput = Object.values(params || {}).some((v) => String(v || '').trim());

  useEffect(() => {
    if (!hasInput) { setState({ value: null, loading: false, error: null }); return undefined; }

    // Debounced: a count per keystroke is a query per keystroke.
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/api/jobs?${query}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        // Status before body: an error page is still JSON and would parse into
        // a null that reads like a real zero.
        if (!res.ok) throw new Error(`search answered ${res.status}`);
        const data = await res.json();
        if (mine !== seq.current) return; // a later answer already superseded this
        const total = typeof data.total === 'number' ? data.total : null;
        setState({ value: total, loading: false, error: total === null ? new Error('no total') : null });
        if (onCount) onCount(total);
      } catch (err) {
        if (mine !== seq.current) return;
        setState({ value: null, loading: false, error: err });
      }
    }, 350);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, hasInput]);

  if (!hasInput) return null;

  const { state: kind, text } = countText({
    value: state.value,
    loading: state.loading,
    error: state.error,
    unit,
    zeroText: zeroText || `No ${unit} yet`,
  });

  return (
    <p className={`liveCount liveCount-${kind}`} role="status" aria-live="polite" data-state={kind}>
      {text}
      {kind === 'ready' && state.value === 0 && (
        <span className="liveCountHint"> — try a broader title, or leave it blank to see everything.</span>
      )}
    </p>
  );
}
