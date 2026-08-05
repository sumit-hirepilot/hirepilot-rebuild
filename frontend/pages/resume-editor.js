import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState, useCallback, useRef } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import page from '../styles/ResumeEditor.module.css';
import { API_BASE } from '../lib/apiBase';
import Link from 'next/link';

/*
 * Resume editor: instruction panel left, live document right.
 *
 * The preview is an iframe holding the server-rendered template HTML - the
 * exact markup, not a React approximation of it. That is what makes "what you
 * see is what downloads" true rather than aspirational: printing calls
 * print() on this same iframe, so the PDF is the identical DOM the user has
 * been looking at. A second renderer was tried server-side and produced an
 * outage and a silently corrupt download before being abandoned.
 *
 * Proposed changes arrive as pending nodes and are highlighted by the template
 * itself, so they are visible in the document rather than in a separate diff
 * view - and @media print hides them, so an unaccepted suggestion cannot reach
 * a PDF even if the user prints mid-review.
 */

const BASE = API_BASE;

const FONT_SIZES = [9, 9.5, 10, 10.5, 11, 11.5, 12];

export default function ResumeEditor() {
  const router = useRouter();
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [resumes, setResumes] = useState([]);
  const [resumeId, setResumeId] = useState(null);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('resume');
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState([]);
  const [draft, setDraft] = useState('');
  const [rules, setRules] = useState([]);
  const [ruleDraft, setRuleDraft] = useState('');
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [asking, setAsking] = useState([]);
  const [showSections, setShowSections] = useState(false);
  const frameRef = useRef(null);

  const authed = useCallback((path, opts = {}) => fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${localStorage.getItem('token')}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  }), []);

  const loadDoc = useCallback(async (id) => {
    const res = await authed(`/api/resume/${id}/document`).catch(() => null);
    if (!res || !res.ok) return;
    setData(await res.json());
  }, [authed]);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { router.replace('/login'); return; }
    setToken(t);
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch { /* stale */ }

    (async () => {
      const [rs, rl, mt] = await Promise.all([
        authed('/api/resume').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        authed('/api/resume/edit-rules').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        authed('/api/matches?limit=12&minScore=0.5').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const list = rs?.resumes || rs || [];
      setResumes(list);
      setRules(rl?.rules || []);
      setJobs(mt?.matches || []);
      if (list.length) {
        const first = list.find((r) => r.is_default) || list[0];
        setResumeId(first.id);
        loadDoc(first.id);
      }
    })();
  }, [router, authed, loadDoc]);

  const applyResult = (d) => {
    if (!d) return;
    setData((prev) => (prev ? { ...prev, ...d } : prev));
  };

  const setStyle = async (patch) => {
    if (!data) return;
    const style = { ...data.style, ...patch };
    setData({ ...data, style });
    const res = await authed(`/api/resume/${resumeId}/document`, {
      method: 'PUT',
      body: JSON.stringify({ doc: data.doc, style: patch }),
    }).catch(() => null);
    if (res && res.ok) applyResult(await res.json());
  };

  const nodeAction = async (nodeId, action) => {
    setBusy(true);
    const res = await authed(`/api/resume/${resumeId}/nodes/${nodeId}/${action}`, { method: 'POST' }).catch(() => null);
    if (res && res.ok) applyResult(await res.json());
    setBusy(false);
  };

  const bulk = async (action) => {
    setBusy(true);
    const res = await authed(`/api/resume/${resumeId}/nodes/${action}-all`, { method: 'POST' }).catch(() => null);
    if (res && res.ok) { await loadDoc(resumeId); }
    setBusy(false);
  };

  const tailor = async () => {
    if (!jobId) return;
    setBusy(true);
    const res = await authed(`/api/resume/${resumeId}/tailor-live`, {
      method: 'POST',
      body: JSON.stringify({ jobId: Number(jobId) }),
    }).catch(() => null);
    if (res && res.ok) {
      const d = await res.json();
      applyResult(d);
      setAsking(d.needsConfirmation || []);
      setChat((c) => [...c, {
        from: 'system',
        text: d.proposed.length
          ? `Proposed ${d.proposed.length} skill${d.proposed.length === 1 ? '' : 's'} you already have. Accept them in the document.`
          : 'Nothing to add from your existing material.',
      }]);
    }
    setBusy(false);
  };

  const confirmSkill = async (skill, have) => {
    const res = await authed(`/api/resume/${resumeId}/confirm-skill`, {
      method: 'POST',
      body: JSON.stringify({ skill, have }),
    }).catch(() => null);
    setAsking((a) => a.filter((x) => x.skill !== skill));
    if (res && res.ok) {
      const d = await res.json();
      applyResult(d);
      setChat((c) => [...c, { from: 'system', text: d.reply }]);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setChat((c) => [...c, { from: 'you', text }]);
    setDraft('');
    setBusy(true);
    const res = await authed(`/api/resume/${resumeId}/instruct`, {
      method: 'POST',
      body: JSON.stringify({ instruction: text }),
    }).catch(() => null);
    if (res && res.ok) {
      const d = await res.json();
      setChat((c) => [...c, { from: 'system', text: d.reply }]);
      applyResult(d);
    } else {
      setChat((c) => [...c, { from: 'system', text: 'Could not reach the editor.' }]);
    }
    setBusy(false);
  };

  const addRule = async () => {
    const rule = ruleDraft.trim();
    if (!rule) return;
    const res = await authed('/api/resume/edit-rules', { method: 'POST', body: JSON.stringify({ rule }) }).catch(() => null);
    if (res && res.ok) { const d = await res.json(); setRules((r) => [d.rule, ...r]); setRuleDraft(''); }
  };

  const removeRule = async (id) => {
    await authed(`/api/resume/edit-rules/${id}`, { method: 'DELETE' }).catch(() => null);
    setRules((r) => r.filter((x) => x.id !== id));
  };

  const newVersion = async () => {
    const name = window.prompt('Name this version', 'Tailored copy');
    if (!name) return;
    const res = await authed(`/api/resume/${resumeId}/duplicate`, { method: 'POST', body: JSON.stringify({ name }) }).catch(() => null);
    if (res && res.ok) {
      const d = await res.json();
      const rs = await authed('/api/resume').then((r) => r.json()).catch(() => null);
      setResumes(rs?.resumes || rs || []);
      setResumeId(d.resume.id);
      loadDoc(d.resume.id);
    }
  };

  /*
   * Print the preview iframe itself.
   *
   * Not a server render of the same data - the actual frame on screen, so the
   * PDF cannot differ from it. The iframe's document.title becomes the
   * suggested filename in Chrome and Safari's Save-as-PDF dialog, which is the
   * closest thing to naming the file without a server in the path.
   */
  const print = () => {
    const frame = frameRef.current;
    if (!frame || !frame.contentWindow) return;
    const name = (data?.doc?.meta?.name || 'Resume').replace(/\s+/g, ' ').trim();
    const version = data?.versionName && data.versionName !== 'Default' ? ` - ${data.versionName}` : '';
    try {
      frame.contentWindow.document.title = `${name}${version} Resume`;
    } catch { /* same-origin srcDoc, but never let a title break the print */ }
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };

  const reorder = async (fromIdx, toIdx) => {
    const ids = data.doc.sections.map((s) => s.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    setBusy(true);
    const res = await authed(`/api/resume/${resumeId}/sections/reorder`, {
      method: 'POST', body: JSON.stringify({ order: ids }),
    }).catch(() => null);
    if (res && res.ok) applyResult(await res.json());
    setBusy(false);
  };

  if (!data) {
    return (
      <DashboardLayout user={user}>
        <Head><title>Resume editor - HirePilot</title></Head>
        <div className={page.loading}>Loading your resume…</div>
      </DashboardLayout>
    );
  }

  const pending = data.pendingCount || 0;

  return (
    <DashboardLayout user={user}>
      <Head><title>Resume editor - HirePilot</title></Head>

      <div className={page.shell}>
        {/* ---------------- left: instructions ---------------- */}
        <aside className={page.left}>
          <div className={page.leftHead}>
            <select
              className={page.versionSel}
              value={resumeId || ''}
              onChange={(e) => { setResumeId(Number(e.target.value)); loadDoc(Number(e.target.value)); }}
            >
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.version_name || r.label || `Resume ${r.id}`}{r.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <button className={page.ghostBtn} onClick={newVersion}>New version</button>
          </div>

          <div className={page.tailorBox}>
            <div className={page.boxTitle}>Tailor to a job</div>
            <select className={page.input} value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Pick one of your matches…</option>
              {jobs.map((j) => (
                <option key={j.job_id || j.id} value={j.job_id || j.id}>
                  {j.title} — {j.company_name}
                </option>
              ))}
            </select>
            <button className={page.primaryBtn} onClick={tailor} disabled={!jobId || busy}>
              {busy ? 'Working…' : 'Tailor'}
            </button>
            <p className={page.note}>
              Only ever adds. Nothing is removed, and nothing is added that is
              not already true of your profile.
            </p>
          </div>

          {/* Untraceable skills are asked about, never guessed either way. */}
          {asking.length > 0 && (
            <div className={page.askBox}>
              <div className={page.boxTitle}>{asking.length} to confirm</div>
              {asking.map((a) => (
                <div className={page.askRow} key={a.skill}>
                  <div className={page.askQ}>Do you have <strong>{a.skill}</strong>?</div>
                  <div className={page.askWhy}>{a.askedBecause}</div>
                  <div className={page.askBtns}>
                    <button className={page.smallPrimary} onClick={() => confirmSkill(a.skill, true)}>Yes, add it</button>
                    <button className={page.smallGhost} onClick={() => confirmSkill(a.skill, false)}>No</button>
                  </div>
                </div>
              ))}
              <p className={page.note}>
                Answering yes saves it to your profile first, so it is reused on
                every future application.
              </p>
            </div>
          )}

          <div className={page.chat}>
            <div className={page.boxTitle}>Edit by instruction</div>
            <div className={page.chatLog}>
              {chat.length === 0 && (
                <p className={page.note}>
                  Instruction-based, not conversational — an AI model is not
                  connected yet. Try &ldquo;add Figma to skills&rdquo; or
                  &ldquo;shorten my bullets&rdquo;.
                </p>
              )}
              {chat.map((m, i) => (
                <div key={i} className={m.from === 'you' ? page.msgYou : page.msgSys}>{m.text}</div>
              ))}
            </div>
            <div className={page.chatInput}>
              <input
                className={page.input}
                value={draft}
                placeholder="add Python to skills"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
              />
              <button className={page.primaryBtn} onClick={send} disabled={busy}>Send</button>
            </div>
          </div>

          <div className={page.rules}>
            <div className={page.boxTitle}>Your edit rules</div>
            {rules.length === 0 && <p className={page.note}>None set.</p>}
            {rules.map((r) => (
              <div className={page.ruleRow} key={r.id}>
                <span>{r.rule}</span>
                <button className={page.linkBtn} onClick={() => removeRule(r.id)}>Remove</button>
              </div>
            ))}
            <div className={page.chatInput}>
              <input
                className={page.input}
                value={ruleDraft}
                placeholder="keep bullets under two lines"
                onChange={(e) => setRuleDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addRule()}
              />
              <button className={page.ghostBtn} onClick={addRule}>Add</button>
            </div>
          </div>
        </aside>

        {/* ---------------- right: live document ---------------- */}
        <section className={page.right}>
          <div className={page.toolbar}>
            <div className={page.tabs}>
              <button className={tab === 'resume' ? page.tabOn : page.tab} onClick={() => setTab('resume')}>Resume</button>
              <button className={tab === 'cover' ? page.tabOn : page.tab} onClick={() => setTab('cover')}>Cover Letter</button>
            </div>

            <select className={page.tool} value={data.style.template} onChange={(e) => setStyle({ template: e.target.value })}>
              {(data.templates || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>

            <select
              className={page.tool}
              value={(data.fonts || []).find((f) => f.stack === data.style.fontFamily)?.id || ''}
              onChange={(e) => setStyle({ fontFamily: e.target.value })}
            >
              {(data.fonts || []).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>

            <div className={page.stepper}>
              <button onClick={() => setStyle({ fontSize: Math.max(9, data.style.fontSize - 0.5) })}>−</button>
              <span>{data.style.fontSize}pt</span>
              <button onClick={() => setStyle({ fontSize: Math.min(12, data.style.fontSize + 0.5) })}>+</button>
            </div>

            <select className={page.tool} value={data.style.align} onChange={(e) => setStyle({ align: e.target.value })}>
              <option value="left">Left</option>
              <option value="justify">Justified</option>
            </select>

            <label className={page.check}>
              <input
                type="checkbox"
                checked={Boolean(data.style.fitOnePage)}
                onChange={(e) => setStyle({ fitOnePage: e.target.checked })}
              />
              Fit to one page
            </label>

            <button className={page.tool} onClick={() => setShowSections((v) => !v)}>Sections</button>
            <span className={page.spacer} />
            <button className={page.primaryBtn} onClick={print}>Download PDF</button>
          </div>

          {showSections && (
            <div className={page.sectionBar}>
              {data.doc.sections.map((s, i) => (
                <span className={page.sectionChip} key={s.id}>
                  {s.title}
                  <button disabled={i === 0} onClick={() => reorder(i, i - 1)} aria-label="Move up">↑</button>
                  <button disabled={i === data.doc.sections.length - 1} onClick={() => reorder(i, i + 1)} aria-label="Move down">↓</button>
                </span>
              ))}
            </div>
          )}

          {pending > 0 && (
            <div className={page.pendingBar}>
              <span>
                <strong>{pending} proposed change{pending === 1 ? '' : 's'}</strong> — highlighted in the
                document. They are not in your resume until you accept them, and they
                are left out of anything you print or send.
              </span>
              <span className={page.pendingBtns}>
                <button className={page.smallPrimary} onClick={() => bulk('accept')} disabled={busy}>Accept all</button>
                <button className={page.smallGhost} onClick={() => bulk('reject')} disabled={busy}>Reject all</button>
              </span>
            </div>
          )}

          {tab === 'resume' ? (
            <div className={page.previewWrap}>
              {/* srcDoc, not a src: the markup is already in hand, and this keeps
                  the frame same-origin so print() and the title are reachable. */}
              <iframe
                ref={frameRef}
                className={page.preview}
                title="Resume preview"
                srcDoc={data.html}
              />
            </div>
          ) : (
            <div className={page.previewWrap}>
              <div className={page.coverPlaceholder}>
                Cover letters are generated per application, from the job you are
                applying to. Open one from the <Link href="/apply-queue">apply queue</Link>{' '}
                to see and edit it there.
              </div>
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
