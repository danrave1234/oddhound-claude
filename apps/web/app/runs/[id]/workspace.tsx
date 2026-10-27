'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HoundMark, Icon } from '@/ui/icons';
import { StatusBadge, statusLabel, findingStatus } from '@/ui/status';
import { WorkflowMap } from './workflow-map';

type Snapshot = {
  run: Record<string, any>;
  workflows: { name: string; status: string; summary: string; updated_at: string }[];
  graph: { states: { id: string; route: string; title: string; actor: string; device: string }[]; transitions: { id: string; from_state: string | null; to_state: string; label: string }[] };
  findings: Record<string, any>[];
  events: { seq: number; at: string; type: string; payload: Record<string, any> }[];
  actions: Record<string, any>[];
  latestScreenshot: { id: string; label: string; created_at: string } | null;
  spend: { settled: number; outstanding: number };
  retests: { id: string; status: string; created_at: string }[];
};

const ACTIVE = new Set(['queued', 'provisioning', 'running', 'waiting_for_input', 'stopping', 'finalizing']);
const GROUPS: { key: string; label: string }[] = [
  { key: 'verified_issue', label: 'Verified issues' }, { key: 'needs_review', label: 'Needs review' },
  { key: 'configuration_observation', label: 'Configuration observations' }, { key: 'suggestion', label: 'Suggestions' },
];

function describe(e: Snapshot['events'][number]): string | null {
  const p = e.payload;
  switch (e.type) {
    case 'action.finished': return `${p.description}${p.ok ? '' : ` — failed: ${p.error}`}`;
    case 'state.discovered': return `Reached ${p.route} (“${p.title}”) as actor ${p.actor} on ${p.device}`;
    case 'workflow.updated': return `Workflow “${p.name}”: ${statusLabel(p.status)} — ${p.summary}`;
    case 'finding.candidate': return `Candidate reported against ${p.ruleId}: ${p.title}`;
    case 'finding.verifying': return `Replaying candidate independently: ${p.title}`;
    case 'finding.verified': return `Verified (${(p.outcomes ?? []).length}/${(p.outcomes ?? []).length} replays failed the rule): ${p.title}`;
    case 'finding.dismissed': return `Dismissed — not reproduced: ${p.title}`;
    case 'finding.inconclusive': return `Inconclusive: ${p.title}`;
    case 'finding.observation': return `Configuration observation: ${p.title}`;
    case 'scope.denied': return `Blocked by scope policy (${String(p.reason).replace(/_/g, ' ')}): ${p.method ?? ''} ${p.url ?? ''}`;
    case 'egress.denied': return `Blocked by egress policy: ${p.host}:${p.port ?? ''} (${p.reason})`;
    case 'browser.ready': return `Fresh browser ready (${p.runtime}, Chromium sandbox: ${p.sandbox})`;
    case 'browser.terminated': return `Browser destroyed and confirmed (${p.detail})`;
    case 'browser.destroy_unconfirmed': return `Browser destruction NOT confirmed (${p.detail}); the reaper will retry`;
    case 'provider.selected': return `Model: ${p.label} · ${p.model}`;
    case 'identity.created': return p.phase === 'verification' ? `Verifier created synthetic account ${p.role}` : `Created synthetic identity ${p.email}`;
    case 'site.verified': return `Ownership re-checked before the run (${p.method}): verified`;
    case 'site.verification_failed': return `Ownership re-check failed (${p.reason}); run blocked`;
    case 'budget.denied': return `Budget limit reached (${String(p.reason).replace(/_/g, ' ')}); no further model calls`;
    case 'retest.finished': return `Retest “${p.title}”: original check ${p.outcome}, control ${p.control} → ${p.lifecycle}`;
    case 'run.summary': return `Agent summary: ${p.summary}`;
    case 'run.phase': return `Phase: ${p.phase}`;
    case 'run.error': return `Error: ${p.message}`;
    case 'model.truncated': return 'Model output hit the token limit';
    case 'provider.error': return `Model provider error (${p.kind})`;
    default: return e.type.startsWith('run.') && p.status ? `Run ${statusLabel(p.status)}${p.reason ? ` (${String(p.reason).replace(/_/g, ' ')})` : ''}` : null;
  }
}

export function RunWorkspace({ initial, controllable, replay, signedIn }: { initial: Snapshot; controllable: boolean; replay: boolean; signedIn: boolean }) {
  const [snap, setSnap] = useState<Snapshot>(initial);
  const [view, setView] = useState<'workflows' | 'browser' | 'findings' | 'activity'>(initial.findings.length && !ACTIVE.has(initial.run.status) ? 'findings' : 'workflows');
  const [wfMode, setWfMode] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<string | null>(initial.findings.find((f) => f.category === 'verified_issue')?.id ?? null);
  const [conn, setConn] = useState<'live' | 'reconnecting' | 'stale'>('live');
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [newEvents, setNewEvents] = useState(0);
  const run = snap.run;
  const active = ACTIVE.has(run.status);
  const runId = run.id as string;

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/runs/${runId}`, { cache: 'no-store' });
    if (r.ok) { setSnap(await r.json()); setLastUpdate(Date.now()); }
  }, [runId]);

  // Durable SSE: the browser's EventSource resends Last-Event-ID automatically on reconnect.
  useEffect(() => {
    if (replay) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource(`/api/runs/${runId}/events?after=${initial.events.at(-1)?.seq ?? 0}`);
    es.addEventListener('run', () => {
      setConn('live'); setNewEvents((n) => n + 1);
      if (!timer) timer = setTimeout(() => { timer = null; void refresh(); }, 800); // batch background changes
    });
    es.addEventListener('end', () => { es.close(); void refresh(); });
    es.onerror = () => setConn('reconnecting');
    const stale = setInterval(() => setConn((c) => (Date.now() - lastUpdateRef.current > 20_000 && ACTIVE.has(runRef.current) ? 'stale' : c)), 5_000);
    return () => { es.close(); clearInterval(stale); if (timer) clearTimeout(timer); };
  }, [runId, replay, refresh, initial.events]);
  const lastUpdateRef = useRef(lastUpdate); lastUpdateRef.current = lastUpdate;
  const runRef = useRef(run.status as string); runRef.current = run.status;

  // Resizable inspector, remembered per browser.
  const [inspectorW, setInspectorW] = useState(420);
  useEffect(() => { try { const w = Number(localStorage.getItem('oh.inspectorW')); if (w >= 300 && w <= 800) setInspectorW(w); } catch { /* storage unavailable */ } }, []);
  const startResize = (e: React.PointerEvent) => {
    const startX = e.clientX, startW = inspectorW;
    const move = (ev: PointerEvent) => setInspectorW(Math.min(800, Math.max(300, startW - (ev.clientX - startX))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); try { localStorage.setItem('oh.inspectorW', String(inspectorWRef.current)); } catch { /* ignore */ } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const inspectorWRef = useRef(inspectorW); inspectorWRef.current = inspectorW;

  const elapsed = useMemo(() => {
    if (!run.started_at) return null;
    const end = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();
    const s = Math.max(0, Math.round((end - new Date(run.started_at).getTime()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, [run.started_at, run.finished_at, lastUpdate]);

  async function stop() {
    const r = await fetch(`/api/runs/${runId}/stop`, { method: 'POST' });
    const b = await r.json().catch(() => ({}));
    setNotice(r.ok ? `Stop accepted. ${b.note}` : b.error ?? 'Could not stop.');
    void refresh();
  }
  async function retest() {
    const r = await fetch(`/api/runs/${runId}/retest`, { method: 'POST' });
    const b = await r.json().catch(() => ({}));
    if (r.ok) window.location.assign(`/runs/${b.runId}`); else setNotice(b.error ?? 'Could not start a retest.');
  }

  const verifiedCount = snap.findings.filter((f) => f.category === 'verified_issue' && f.verification === 'verified').length;
  const selectedFinding = snap.findings.find((f) => f.id === selected) ?? null;
  const log = snap.events.map((e) => ({ e, text: describe(e) })).filter((x) => x.text);

  return (
    <div>
      <header className="toolbar" style={{ flexWrap: 'wrap', paddingTop: 6, paddingBottom: 6 }}>
        <Link href={signedIn ? '/app' : '/'} aria-label="Oddhound home"><HoundMark size={22} /></Link>
        <strong>{run.mode === 'retest' ? 'Retest' : run.mode === 'demo_target' ? 'Demo target run' : 'Run'}</strong>
        <span className="mono muted">{run.origin}</span>
        {replay && <span className="badge badge-info"><Icon name="eye" />Demo replay — recorded run</span>}
        <StatusBadge value={run.status} />
        {run.stop_reason && <span className="muted">({String(run.stop_reason).replace(/_/g, ' ')})</span>}
        {elapsed && <span className="tabular muted" title="Elapsed">{elapsed}</span>}
        {!replay && <StatusBadge value={conn} />}
        <span className="muted" style={{ fontSize: 12 }}>Updated {new Date(lastUpdate).toLocaleTimeString()}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {controllable && active && <button className="btn btn-danger" onClick={stop} title="Blocks new actions immediately; cannot undo completed actions"><Icon name="stop" /> Stop run</button>}
          {controllable && !active && run.mode !== 'retest' && verifiedCount > 0 && <button className="btn btn-primary" onClick={retest}><Icon name="retest" /> {run.mode === 'demo_target' ? 'Retest on corrected build' : 'Retest after fix'}</button>}
          {run.parent_run_id && <Link className="btn" href={`/runs/${run.parent_run_id}`}>Original run</Link>}
        </span>
      </header>
      {notice && <p role="status" style={{ margin: 0, padding: '8px 16px', background: 'var(--warn-soft)', color: 'var(--warn)' }}>{notice}</p>}
      {run.provider === 'test-double' && <p role="note" style={{ margin: 0, padding: '8px 16px', background: 'var(--info-soft)', color: 'var(--info)' }}>This run used the offline test double, not Meta inference.</p>}

      <div className="workspace" style={{ ['--inspector-w' as string]: `${inspectorW}px` }}>
        <section className="pane" aria-label="Run views">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--separator)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 2 }}>
            <div className="segmented" role="group" aria-label="View">
              {(['workflows', 'browser', 'findings', 'activity'] as const).map((v) => (
                <button key={v} aria-pressed={view === v} onClick={() => { setView(v); if (v === 'activity') setNewEvents(0); }}>
                  {v === 'workflows' ? 'Workflows' : v === 'browser' ? 'Browser' : v === 'findings' ? `Findings (${snap.findings.length})` : `Activity${newEvents && view !== 'activity' ? ` · ${newEvents} new` : ''}`}
                </button>
              ))}
            </div>
            {view === 'workflows' && (
              <div className="segmented" role="group" aria-label="Workflow layout" style={{ marginLeft: 'auto' }}>
                <button aria-pressed={wfMode === 'list'} onClick={() => setWfMode('list')}>List</button>
                <button aria-pressed={wfMode === 'map'} onClick={() => setWfMode('map')}>Map</button>
              </div>
            )}
          </div>

          <div style={{ padding: 16 }}>
            {run.mode === 'retest' && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div style={{ padding: '10px 12px' }} className="section-title">Retest results — saved assertions replayed unchanged</div>
                <table className="grid"><thead><tr><th>Finding</th><th>Original check</th><th>Valid control</th><th>Result</th></tr></thead><tbody>
                  {snap.events.filter((e) => e.type === 'retest.finished' || e.type === 'retest.blocked').map((e) => (
                    <tr key={e.seq}><td>{e.payload.title ?? e.payload.findingId}</td><td><StatusBadge value={e.payload.outcome ?? 'blocked'} /></td>
                      <td><StatusBadge value={e.payload.control ?? 'not_run'} /></td><td><StatusBadge value={e.payload.lifecycle ?? 'blocked'} /></td></tr>))}
                  {!snap.events.some((e) => e.type === 'retest.finished') && <tr><td colSpan={4} className="muted">{active ? 'Replaying saved scenarios…' : 'No retest results recorded.'}</td></tr>}
                </tbody></table>
              </div>
            )}
            {view === 'workflows' && (wfMode === 'list' ? (
              <div style={{ display: 'grid', gap: 14 }}>
                <div className="card">
                  <table className="grid"><thead><tr><th>Workflow</th><th>Status</th><th>Summary</th></tr></thead><tbody>
                    {snap.workflows.length ? snap.workflows.map((w) => <tr key={w.name}><td>{w.name}</td><td><StatusBadge value={w.status} /></td><td className="muted">{w.summary}</td></tr>)
                      : <tr><td colSpan={3} className="muted">{active ? 'Discovering workflows…' : 'No workflows were named in this run.'}</td></tr>}
                  </tbody></table>
                </div>
                <div className="card">
                  <table className="grid"><thead><tr><th>Observed page state</th><th>Route</th><th>Actor</th><th>Device</th></tr></thead><tbody>
                    {snap.graph.states.map((s) => <tr key={s.id}><td>{s.title}</td><td className="mono">{s.route}</td><td>{s.actor}</td><td>{s.device}</td></tr>)}
                  </tbody></table>
                  <p className="muted" style={{ padding: '8px 12px', margin: 0 }}>{snap.graph.states.length} states and {snap.graph.transitions.length} observed transitions. Coverage means these observed states, not the whole site.</p>
                </div>
              </div>
            ) : <WorkflowMap states={snap.graph.states} transitions={snap.graph.transitions} />)}

            {view === 'browser' && (
              <div className="card" style={{ padding: 12 }}>
                {snap.latestScreenshot
                  ? <><img className="evidence-img" src={`/api/artifacts/${snap.latestScreenshot.id}`} alt={`Latest browser frame: ${snap.latestScreenshot.label}`} />
                      <p className="muted" style={{ margin: '8px 0 0' }}>Sampled frame from {new Date(snap.latestScreenshot.created_at).toLocaleTimeString()} ({snap.latestScreenshot.label}). This is a still frame, not live video.</p></>
                  : <p className="muted">No browser frame captured yet.</p>}
                <h3 className="section-title" style={{ marginTop: 16 }}>Recent actions</h3>
                <ul className="log" style={{ padding: 0 }}>{snap.actions.slice(0, 15).map((a) => (
                  <li key={a.seq}><span className="tabular muted">#{a.seq}</span> {a.tool} <span className="muted">· actor {a.actor} · {a.device} · {a.state}</span></li>))}</ul>
              </div>
            )}

            {view === 'findings' && (
              <div style={{ display: 'grid', gap: 14 }}>
                {GROUPS.map((g) => {
                  const items = snap.findings.filter((f) => f.category === g.key);
                  return (
                    <div className="card" key={g.key}>
                      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}><StatusBadge value={g.key} /><span className="muted tabular">{items.length}</span></div>
                      {items.length ? (
                        <table className="grid"><thead><tr><th>Title</th><th>Status</th><th>Impact</th><th>Device</th><th>Rule</th></tr></thead><tbody>
                          {items.map((f) => (
                            <tr key={f.id} aria-selected={f.id === selected} tabIndex={0} onClick={() => setSelected(f.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(f.id); } }}>
                              <td>{f.title}</td><td><StatusBadge value={findingStatus(f as never)} /></td><td>{f.impact}</td><td>{f.device}</td><td className="mono">{f.rule_id ?? '—'}</td>
                            </tr>))}
                        </tbody></table>
                      ) : <p className="muted" style={{ padding: '0 12px 10px', margin: 0 }}>None.</p>}
                    </div>
                  );
                })}
                {!active && <p className="muted">“No failures” only means none were found within the tested scope above, not that the site has no bugs.</p>}
              </div>
            )}

            {view === 'activity' && (
              <ol className="log" style={{ padding: 0 }} aria-live="off">
                {log.map(({ e, text }) => <li key={e.seq}><span className="tabular muted">{new Date(e.at).toLocaleTimeString()}</span> {text}</li>)}
              </ol>
            )}
          </div>
        </section>

        <div className="resizer" role="separator" aria-orientation="vertical" aria-label="Resize inspector" tabIndex={0} onPointerDown={startResize}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') setInspectorW((w) => Math.min(800, w + 20)); if (e.key === 'ArrowRight') setInspectorW((w) => Math.max(300, w - 20)); }} />

        <aside className="pane" aria-label="Inspector" style={{ background: 'var(--surface)', padding: 16 }}>
          {selectedFinding ? <FindingInspector finding={selectedFinding} controllable={controllable} onRetest={retest} runActive={active} runMode={run.mode} />
            : <RunDetails snap={snap} />}
        </aside>
      </div>
      <div aria-live="polite" className="sr-only">{`Run ${statusLabel(run.status)}. ${verifiedCount} verified issues.`}</div>
    </div>
  );
}

function RunDetails({ snap }: { snap: Snapshot }) {
  const r = snap.run;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Run details</h2>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', margin: 0 }}>
        <dt className="muted">Model</dt><dd style={{ margin: 0 }}>{r.provider ? `${r.provider === 'meta-direct' ? 'Meta (direct)' : r.provider} · ${r.model}` : 'Not selected yet'}</dd>
        <dt className="muted">Browser</dt><dd style={{ margin: 0 }} className="mono">{r.browser_ref ?? '—'} ({r.browser_state ?? '—'})</dd>
        <dt className="muted">Chromium sandbox</dt><dd style={{ margin: 0 }}>{r.sandbox_verdict ?? '—'}</dd>
        <dt className="muted">Environment</dt><dd style={{ margin: 0 }}>{r.environment} · {r.test_mode === 'active' ? 'active testing' : 'observation only'}</dd>
        <dt className="muted">Model spend</dt><dd style={{ margin: 0 }} className="tabular">${(snap.spend.settled / 1e6).toFixed(4)} settled{snap.spend.outstanding ? ` + $${(snap.spend.outstanding / 1e6).toFixed(4)} reserved` : ''}</dd>
      </dl>
      <div><div className="section-title">Goals</div><ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>{(r.goals ?? []).map((g: string) => <li key={g}>{g}</li>)}</ol></div>
      <div><div className="section-title">Rules (findings are judged only against these)</div><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{(r.rules ?? []).map((x: { id: string; text: string }) => <li key={x.id}><span className="mono">{x.id}</span> {x.text}</li>)}</ul></div>
      {snap.retests.length > 0 && <div><div className="section-title">Retests</div>{snap.retests.map((t) => <div key={t.id}><Link href={`/runs/${t.id}`}>{new Date(t.created_at).toLocaleString()}</Link> <StatusBadge value={t.status} /></div>)}</div>}
      <p className="muted" style={{ margin: 0 }}>Select a finding to see its evidence and fix brief.</p>
    </div>
  );
}

function FindingInspector({ finding: f, controllable, onRetest, runActive, runMode }: { finding: Record<string, any>; controllable: boolean; onRetest: () => void; runActive: boolean; runMode: string }) {
  const [brief, setBrief] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => { setBrief(null); setCopyState('idle'); }, [f.id]);
  async function copy() {
    const text: string = brief ?? await fetch(`/api/findings/${f.id}/brief`).then((r) => r.text());
    setBrief(text);
    try { await navigator.clipboard.writeText(text); setCopyState('copied'); } catch { setCopyState('failed'); }
  }
  return (
    <article style={{ display: 'grid', gap: 12 }} className="fade-in">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><StatusBadge value={f.category} />{f.category === 'configuration_observation' ? <StatusBadge value="observed" /> : <><StatusBadge value={f.verification} />{f.lifecycle && <StatusBadge value={f.lifecycle} />}</>}</div>
      <h2 style={{ margin: 0, fontSize: 17 }}>{f.title}</h2>
      <p className="muted" style={{ margin: 0 }}>Impact {f.impact} · confidence {f.confidence} · {f.device} · actor {f.actor} · {f.rule_source}</p>
      <section><div className="section-title">Expected</div><p style={{ margin: '4px 0 0' }}>{f.expected}</p></section>
      <section><div className="section-title">Observed</div><p style={{ margin: '4px 0 0' }}>{f.observed}</p></section>
      {f.limitations && <section><div className="section-title">Limits</div><p className="muted" style={{ margin: '4px 0 0' }}>{f.limitations}</p></section>}
      {f.scenario_id && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={copy}><Icon name="copy" /> Copy fix prompt</button>
          <a className="btn" href={`/api/findings/${f.id}/export`}><Icon name="download" /> Playwright test</a>
          {controllable && !runActive && runMode !== 'retest' && f.category === 'verified_issue' && <button className="btn" onClick={onRetest}><Icon name="retest" /> Retest</button>}
        </div>
      )}
      <span role="status" style={{ color: copyState === 'copied' ? 'var(--ok)' : 'var(--warn)' }}>{copyState === 'copied' ? 'Fix prompt copied.' : copyState === 'failed' ? 'Clipboard unavailable — select the text below.' : ''}</span>
      {brief && <pre className="brief" tabIndex={0} aria-label="Fix brief">{brief}</pre>}
      {(f.evidence_ids ?? []).length > 0 && (
        <section><div className="section-title">Evidence ({f.evidence_ids.length})</div>
          <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>{f.evidence_ids.slice(0, 6).map((id: string) => <img key={id} className="evidence-img" src={`/api/artifacts/${id}`} alt="Evidence screenshot from an independent replay" loading="lazy" />)}</div>
        </section>
      )}
    </article>
  );
}
