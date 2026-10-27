'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HoundMark, Icon, type IconName } from '@/ui/icons';
import { StatusBadge, statusLabel, findingStatus } from '@/ui/status';
import { WorkflowMap } from './workflow-map';
import { LiveDeck } from './live-deck';

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
  plan?: { id: string; area: string; risk: string; technique: string; status: string; note: string | null }[];
  detectedSignals?: number;
};

const RISK_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** The agent's own risk-ranked test plan, as it last saved it. */
function TestPlan({ plan, active }: { plan: NonNullable<Snapshot['plan']>; active: boolean }) {
  const sorted = [...plan].sort((a, b) => (RISK_ORDER[a.risk] ?? 9) - (RISK_ORDER[b.risk] ?? 9));
  const done = plan.filter((c) => c.status === 'completed').length;
  return (
    <div className="card fade-in">
      <div className="card-header">
        <h2 className="h3"><Icon name="workflow" /> Test plan</h2>
        <span className="muted" style={{ fontSize: 12.5 }}>Written and prioritised by the agent</span>
        <span className="muted tabular" style={{ marginLeft: 'auto', fontSize: 12.5 }}>{done}/{plan.length} completed</span>
      </div>
      {plan.length ? (
        <div className="table-wrap"><table className="grid"><thead><tr><th>Risk</th><th>Area</th><th className="hide-sm">What it tests</th><th>Status</th></tr></thead><tbody>
          {sorted.map((c) => (
            <tr key={c.id}>
              <td><span className={`chip risk-${c.risk}`}>{c.risk}</span></td>
              <td style={{ fontWeight: 550 }}>{c.area}</td>
              <td className="muted hide-sm">{c.technique}{c.note ? <><br /><span style={{ fontSize: 12.5 }}>{c.note}</span></> : null}</td>
              <td><StatusBadge value={c.status} /></td>
            </tr>
          ))}
        </tbody></table></div>
      ) : <Empty icon="paw" text={active ? 'Mapping the site before writing a test plan…' : 'No test plan was written in this run.'} />}
    </div>
  );
}

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
    case 'finding.candidate': return p.source === 'detector' ? `Recorded for replay (${p.ruleId}): ${p.title}` : `Candidate reported against ${p.ruleId}: ${p.title}`;
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
    case 'site.verified': return `Ownership${p.api ? ` of ${p.origin}` : ''} re-checked before the run (${p.method}): verified`;
    case 'site.unreachable': return `The site did not load in the run's browser after a retry (${p.detail}); run ended`;
    case 'site.verification_failed': return `Ownership re-check failed (${p.reason}); run blocked`;
    case 'budget.denied': return `Budget limit reached (${String(p.reason).replace(/_/g, ' ')}); no further model calls`;
    case 'retest.finished': return `Retest “${p.title}”: original check ${p.outcome}, control ${p.control} → ${p.lifecycle}`;
    case 'run.summary': return `Agent summary: ${p.summary}`;
    case 'handoff.started': return `Waiting for the owner to sign in through the live view (starts at ${p.startPath}, up to ${p.limitMinutes} minutes)`;
    case 'handoff.input': return p.type === 'type' ? `Owner typed ${p.characters} character(s)` : p.type === 'navigate' ? `Owner opened ${p.path}` : `Owner ${p.type === 'key' ? `pressed ${p.key}` : p.type === 'click' ? 'clicked' : p.type}`;
    case 'handoff.completed': return `Owner handed over at ${p.landedPath}; the agent continues with that session${(p.otherOriginsContacted ?? []).length ? ` (sign-in also contacted ${p.otherOriginsContacted.join(', ')})` : ''}`;
    case 'handoff.cancelled': return 'Owner cancelled the sign-in; run stopped';
    case 'handoff.timed_out': return 'Sign-in time limit reached; run stopped';
    case 'run.phase': return `Phase: ${p.phase}`;
    case 'plan.updated': {
      const cs = (p.charters ?? []) as { risk: string; status: string }[];
      return `Test plan updated: ${cs.length} charter(s), ${cs.filter((c) => c.risk === 'critical' || c.risk === 'high').length} critical/high, ${cs.filter((c) => c.status === 'completed').length} completed`;
    }
    case 'signal.detected': return `Oddhound detected (${p.rule}): ${p.detail}`;
    case 'signal.suppressed': return `Ignored a possible ${p.rule} signal: ${p.reason}`;
    case 'signal.not_replayable': return `Detected ${p.rule} but could not build a replay (${p.reason})`;
    case 'finish.refused': return `Agent tried to finish with high-risk charters still open (${(p.open ?? []).join(', ')}); asked to continue`;
    case 'model.context_rebased': return 'Conversation compacted into Oddhound\'s notebook to save cost';
    case 'run.time_reserved': return `Exploration stopped to leave time for verifying ${p.candidates} candidate(s)`;
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
  const inspectorRef = useRef<HTMLElement>(null);
  const viewsRef = useRef<HTMLElement>(null);
  function selectFinding(id: string) {
    setSelected(id);
    // On narrow screens the inspector sits below the list: bring it into view after a user selection.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
      requestAnimationFrame(() => inspectorRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    }
  }
  const VIEWS: { key: typeof view; label: string; icon: IconName }[] = [
    { key: 'workflows', label: 'Workflows', icon: 'trail' }, { key: 'browser', label: 'Browser', icon: 'browser' },
    { key: 'findings', label: 'Findings', icon: 'bug' }, { key: 'activity', label: 'Activity', icon: 'pulse' },
  ];

  return (
    <div>
      <header className="toolbar run-toolbar">
        <Link href={signedIn ? '/app' : '/'} aria-label="Oddhound home" className="brand"><HoundMark size={26} /></Link>
        <div className="run-title">
          <span className="name">{run.mode === 'retest' ? 'Retest' : run.mode === 'demo_target' ? 'Demo target run' : 'Run'}</span>
          <span className="origin truncate">{run.origin}</span>
        </div>
        <span className="vsep" aria-hidden />
        {replay && <span className="badge badge-info"><Icon name="eye" />Demo replay — recorded run</span>}
        <StatusBadge value={run.status} />
        {run.stop_reason && <span className="muted" style={{ fontSize: 12.5 }}>{String(run.stop_reason).replace(/_/g, ' ')}</span>}
        {elapsed && <span className="pill-stat tabular" title="Elapsed time"><Icon name="clock" /><span className="sr-only">Elapsed </span><span suppressHydrationWarning>{elapsed}</span></span>}
        <span className="toolbar-spacer" />
        <span className="conn">
          {/* Connection state only matters while the run can still change; a finished run is never "Live". */}
          {!replay && active && <StatusBadge value={conn} />}
          <span className="tabular" suppressHydrationWarning>Updated {new Date(lastUpdate).toLocaleTimeString()}</span>
        </span>
        <span className="row" style={{ gap: 8 }}>
          {controllable && active && <button className="btn btn-danger" onClick={stop} title="Blocks new actions immediately; cannot undo completed actions"><Icon name="stop" /> Stop run</button>}
          {controllable && !active && run.mode !== 'retest' && verifiedCount > 0 && <button className="btn btn-primary" onClick={retest}><Icon name="retest" /> {run.mode === 'demo_target' ? 'Retest on corrected build' : 'Retest after fix'}</button>}
          {run.parent_run_id && <Link className="btn" href={`/runs/${run.parent_run_id}`}><Icon name="back" /> Original run</Link>}
        </span>
      </header>
      {notice && <p role="status" className="banner banner-warn fade-in"><Icon name="info" /> {notice}</p>}
      {run.provider === 'test-double' && <p role="note" className="banner banner-info"><Icon name="info" /> This run used the offline test double, not Meta inference.</p>}

      <div className="workspace" style={{ ['--inspector-w' as string]: `${inspectorW}px` }}>
        <section className="pane" aria-label="Run views" ref={viewsRef}>
          <div className="pane-head">
            <div className="segmented" role="group" aria-label="View">
              {VIEWS.map((v) => (
                <button key={v.key} aria-pressed={view === v.key} onClick={() => { setView(v.key); if (v.key === 'activity') setNewEvents(0); }}>
                  <Icon name={v.icon} /> {v.label}
                  {v.key === 'findings' && <span className="count tabular">{snap.findings.length}</span>}
                  {v.key === 'activity' && newEvents > 0 && view !== 'activity' && <span className="count count-new tabular pop-in">{newEvents}<span className="sr-only"> new</span></span>}
                </button>
              ))}
            </div>
            {view === 'workflows' && (
              <div className="segmented" role="group" aria-label="Workflow layout" style={{ marginLeft: 'auto' }}>
                <button aria-pressed={wfMode === 'list'} onClick={() => setWfMode('list')}><Icon name="list" /> List</button>
                <button aria-pressed={wfMode === 'map'} onClick={() => setWfMode('map')}><Icon name="map" /> Map</button>
              </div>
            )}
          </div>

          <div className="pane-body">
            {controllable && run.status === 'waiting_for_input' && run.handoff_enabled && <HandoffPanel runId={runId} onStop={stop} />}
            <LiveDeck snap={snap} active={active} replay={replay} onOpenBrowser={() => setView('browser')} onOpenFindings={() => setView('findings')} />
            {run.mode === 'retest' && (
              <div className="card">
                <div className="card-header"><h2 className="h3"><Icon name="replay" /> Retest results</h2><span className="muted" style={{ fontSize: 12.5 }}>Saved assertions replayed unchanged</span></div>
                <div className="table-wrap"><table className="grid"><thead><tr><th>Finding</th><th>Original check</th><th>Valid control</th><th>Result</th></tr></thead><tbody>
                  {snap.events.filter((e) => e.type === 'retest.finished' || e.type === 'retest.blocked').map((e) => (
                    <tr key={e.seq}><td>{e.payload.title ?? e.payload.findingId}</td><td><StatusBadge value={e.payload.outcome ?? 'blocked'} /></td>
                      <td><StatusBadge value={e.payload.control ?? 'not_run'} /></td><td><StatusBadge value={e.payload.lifecycle ?? 'blocked'} /></td></tr>))}
                  {!snap.events.some((e) => e.type === 'retest.finished') && <tr><td colSpan={4} className="empty-cell">{active ? 'Replaying saved scenarios…' : 'No retest results recorded.'}</td></tr>}
                </tbody></table></div>
              </div>
            )}

            {view === 'workflows' && (wfMode === 'list' ? (
              <>
                {(snap.plan?.length || run.mode !== 'retest') && <TestPlan plan={snap.plan ?? []} active={active} />}
                <div className="card fade-in">
                  <div className="card-header"><h2 className="h3"><Icon name="trail" /> Workflows</h2><span className="muted tabular" style={{ marginLeft: 'auto', fontSize: 12.5 }}>{snap.workflows.length}</span></div>
                  {snap.workflows.length ? (
                    <div className="table-wrap"><table className="grid"><thead><tr><th>Workflow</th><th>Status</th><th className="hide-sm">Summary</th></tr></thead><tbody>
                      {snap.workflows.map((w) => <tr key={w.name}><td style={{ fontWeight: 550 }}>{w.name}</td><td><StatusBadge value={w.status} /></td><td className="muted hide-sm">{w.summary}</td></tr>)}
                    </tbody></table></div>
                  ) : <Empty icon="paw" text={active ? 'Discovering workflows…' : 'No workflows were named in this run.'} />}
                </div>
                <div className="card fade-in">
                  <div className="card-header"><h2 className="h3"><Icon name="browser" /> Observed page states</h2></div>
                  {snap.graph.states.length ? (
                    <div className="table-wrap"><table className="grid"><thead><tr><th>Page</th><th>Route</th><th className="hide-sm">Actor</th><th>Device</th></tr></thead><tbody>
                      {snap.graph.states.map((s) => <tr key={s.id}><td>{s.title}</td><td className="mono break">{s.route}</td><td className="hide-sm">{s.actor}</td><td><span className="chip"><Icon name={s.device === 'mobile' ? 'mobile' : 'desktop'} />{s.device}</span></td></tr>)}
                    </tbody></table></div>
                  ) : <Empty icon="browser" text={active ? 'No page states recorded yet.' : 'No page states were recorded.'} />}
                  <div className="card-footer"><span className="muted" style={{ fontSize: 12.5 }}><span className="tabular">{snap.graph.states.length}</span> states and <span className="tabular">{snap.graph.transitions.length}</span> observed transitions. Coverage means these observed states, not the whole site.</span></div>
                </div>
              </>
            ) : <WorkflowMap states={snap.graph.states} transitions={snap.graph.transitions} />)}

            {view === 'browser' && (
              <>
                <div className="frame fade-in">
                  <div className="frame-bar">
                    <Icon name="evidence" />
                    <span className="frame-addr"><span>{snap.latestScreenshot ? snap.latestScreenshot.label : 'No frame yet'}</span></span>
                    {snap.latestScreenshot && <span className="muted tabular" style={{ fontSize: 12 }}>{new Date(snap.latestScreenshot.created_at).toLocaleTimeString()}</span>}
                  </div>
                  {snap.latestScreenshot
                    ? <div className="frame-body"><img src={`/api/artifacts/${snap.latestScreenshot.id}`} alt={`Latest browser frame: ${snap.latestScreenshot.label}`} /></div>
                    : <Empty icon="browser" text="No browser frame captured yet." />}
                </div>
                {snap.latestScreenshot && <p className="muted" style={{ margin: '-6px 0 0', fontSize: 12.5 }}>A sampled still frame, not live video.</p>}
                <div className="card">
                  <div className="card-header"><h2 className="h3"><Icon name="list" /> Recent actions</h2></div>
                  {snap.actions.length ? (
                    <ol className="list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {snap.actions.slice(0, 15).map((a) => (
                        <li key={a.seq} className="list-row" style={{ gridTemplateColumns: 'auto minmax(0,1fr)', padding: '10px 16px' }}>
                          <span className="chip tabular">#{a.seq}</span>
                          <span style={{ minWidth: 0 }}><span className="mono" style={{ fontWeight: 600 }}>{a.tool}</span>
                            <span className="meta" style={{ marginTop: 2 }}>actor {a.actor} · {a.device} · {a.state}</span></span>
                        </li>))}
                    </ol>
                  ) : <Empty icon="list" text="No actions recorded yet." />}
                </div>
              </>
            )}

            {view === 'findings' && (
              <>
                {GROUPS.map((g) => {
                  const items = snap.findings.filter((f) => f.category === g.key);
                  return (
                    <div className="card fade-in" key={g.key}>
                      <div className="card-header"><div className="group-head"><StatusBadge value={g.key} /><span className="count">{items.length}</span></div></div>
                      {items.length ? (
                        <div className="table-wrap"><table className="grid selectable"><thead><tr><th>Title</th><th>Status</th><th className="hide-sm">Impact</th><th className="hide-sm">Device</th><th className="hide-sm">Rule</th></tr></thead><tbody>
                          {items.map((f) => (
                            <tr key={f.id} aria-selected={f.id === selected} tabIndex={0} onClick={() => selectFinding(f.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectFinding(f.id); } }}>
                              <td style={{ fontWeight: 550, minWidth: 160 }}>{f.title}</td><td><StatusBadge value={findingStatus(f as never)} /></td><td className="hide-sm">{f.impact}</td><td className="hide-sm">{f.device}</td><td className="mono hide-sm">{f.rule_id ?? '—'}</td>
                            </tr>))}
                        </tbody></table></div>
                      ) : <p className="muted" style={{ padding: '12px 16px', margin: 0, fontSize: 13 }}>None in this run.</p>}
                    </div>
                  );
                })}
                {!active && <p className="muted" style={{ margin: 0, fontSize: 12.5, display: 'flex', gap: 6 }}><Icon name="info" /> “No failures” only means none were found within the tested scope above, not that the site has no bugs.</p>}
              </>
            )}

            {view === 'activity' && (
              <div className="card fade-in" style={{ padding: '10px 16px' }}>
                {log.length ? (
                  <ol className="timeline" aria-live="off">
                    {log.map(({ e, text }) => <li key={e.seq} className={`k-${kindOf(e.type)}`}><span className="t">{new Date(e.at).toLocaleTimeString()}</span><span className="d" aria-hidden /><span className="break">{text}</span></li>)}
                  </ol>
                ) : <Empty icon="pulse" text="No activity recorded yet." />}
              </div>
            )}
          </div>
        </section>

        <div className="resizer" role="separator" aria-orientation="vertical" aria-label="Resize inspector" tabIndex={0} onPointerDown={startResize}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') setInspectorW((w) => Math.min(800, w + 20)); if (e.key === 'ArrowRight') setInspectorW((w) => Math.max(300, w - 20)); }} />

        <aside className="pane inspector" aria-label="Inspector" ref={inspectorRef}>
          <div className="inspector-body">
            {selectedFinding ? <FindingInspector finding={selectedFinding} controllable={controllable} onRetest={retest} runActive={active} runMode={run.mode}
                onBack={() => viewsRef.current?.scrollIntoView({ block: 'start' })} />
              : <RunDetails snap={snap} />}
          </div>
        </aside>
      </div>
      <div aria-live="polite" className="sr-only">{`Run ${statusLabel(run.status)}. ${verifiedCount} verified issues.`}</div>
    </div>
  );
}

function kindOf(type: string): 'bad' | 'ok' | 'warn' | 'accent' | 'plain' {
  if (['finding.verified', 'run.error', 'provider.error', 'browser.destroy_unconfirmed', 'site.verification_failed', 'site.unreachable', 'budget.denied', 'signal.detected'].includes(type)) return 'bad';
  if (['site.verified', 'browser.ready', 'browser.terminated', 'handoff.completed'].includes(type)) return 'ok';
  if (['finding.candidate', 'finding.inconclusive', 'scope.denied', 'egress.denied', 'handoff.timed_out', 'handoff.cancelled', 'model.truncated'].includes(type)) return 'warn';
  if (['state.discovered', 'workflow.updated', 'handoff.started', 'finding.verifying'].includes(type)) return 'accent';
  return 'plain';
}

function Empty({ icon, text }: { icon: IconName; text: string }) {
  return <div className="empty empty-sm"><span className="tile tile-neutral"><Icon name={icon} /></span><p>{text}</p></div>;
}

function RunDetails({ snap }: { snap: Snapshot }) {
  const r = snap.run;
  return (
    <div style={{ display: 'grid', gap: 20 }} className="fade-in">
      <div className="row" style={{ gap: 10 }}><span className="tile"><Icon name="info" /></span><h2 className="h2">Run details</h2></div>
      <dl className="props">
        <dt>Model</dt><dd>{r.provider ? `${r.provider === 'meta-direct' ? 'Meta (direct)' : r.provider} · ${r.model}` : 'Not selected yet'}</dd>
        <dt>Browser</dt><dd className="mono">{r.browser_ref ?? '—'} ({r.browser_state ?? '—'})</dd>
        <dt>Chromium sandbox</dt><dd>{r.sandbox_verdict ?? '—'}</dd>
        <dt>Environment</dt><dd>{r.environment} · {r.test_mode === 'active' ? 'active testing' : 'observation only'}</dd>
        <dt>Model spend</dt><dd className="tabular">${(snap.spend.settled / 1e6).toFixed(4)} settled{snap.spend.outstanding ? ` + $${(snap.spend.outstanding / 1e6).toFixed(4)} reserved` : ''}</dd>
      </dl>
      <section className="section"><h3 className="section-title">Owner focus areas</h3>
        {(r.goals ?? []).length
          ? <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, listStyle: 'decimal' }}>{(r.goals ?? []).map((g: string) => <li key={g}>{g}</li>)}</ol>
          : <p className="muted" style={{ margin: 0, fontSize: 13 }}>None. The agent set its own priorities by risk.</p>}</section>
      <section className="section"><h3 className="section-title">Rules — findings are judged only against these</h3>
        {(r.rules ?? []).length ? <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>{(r.rules ?? []).map((x: { id: string; text: string }) => <li key={x.id} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 8 }}><span className="chip mono">{x.id}</span><span>{x.text}</span></li>)}</ul>
          : <p className="muted">No explicit rules were given.</p>}</section>
      {snap.retests.length > 0 && <section className="section"><h3 className="section-title">Retests</h3>{snap.retests.map((t) => <div key={t.id} className="row" style={{ gap: 8 }}><Link href={`/runs/${t.id}`} className="tabular">{new Date(t.created_at).toLocaleString()}</Link> <StatusBadge value={t.status} /></div>)}</section>}
      <div className="well row" style={{ gap: 10, flexWrap: 'nowrap' }}><Icon name="bug" /><span className="muted" style={{ fontSize: 13 }}>Select a finding to see its evidence and fix prompt.</span></div>
    </div>
  );
}

function FindingInspector({ finding: f, controllable, onRetest, runActive, runMode, onBack }: { finding: Record<string, any>; controllable: boolean; onRetest: () => void; runActive: boolean; runMode: string; onBack: () => void }) {
  const [brief, setBrief] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => { setBrief(null); setCopyState('idle'); }, [f.id]);
  async function copy() {
    const text: string = brief ?? await fetch(`/api/findings/${f.id}/brief`).then((r) => r.text());
    setBrief(text);
    try { await navigator.clipboard.writeText(text); setCopyState('copied'); } catch { setCopyState('failed'); }
  }
  return (
    <article style={{ display: 'grid', gap: 16 }} className="fade-in" key={f.id}>
      <button className="btn btn-ghost btn-sm mobile-only" onClick={onBack} style={{ justifySelf: 'start' }}><Icon name="back" /> Back to findings</button>
      <div className="kv-strip"><StatusBadge value={f.category} />{f.category === 'configuration_observation' ? <StatusBadge value="observed" /> : <><StatusBadge value={f.verification} />{f.lifecycle && <StatusBadge value={f.lifecycle} />}</>}</div>
      <h2 className="finding-title">{f.title}</h2>
      <div className="kv-strip">
        <span className="chip">Impact {f.impact}</span><span className="chip">Confidence {f.confidence}</span>
        <span className="chip"><Icon name={f.device === 'mobile' ? 'mobile' : 'desktop'} />{f.device}</span><span className="chip"><Icon name="person" />{f.actor}</span>
        {f.rule_source && <span className="chip">{f.rule_source}</span>}
      </div>
      <div className="compare">
        <div className="exp"><div className="lbl"><Icon name="check" /> Expected</div><p style={{ margin: 0 }}>{f.expected}</p></div>
        <div className="obs"><div className="lbl"><Icon name="fail" /> Observed</div><p style={{ margin: 0 }}>{f.observed}</p></div>
      </div>
      {f.limitations && <section className="section"><h3 className="section-title">Limits</h3><p className="muted">{f.limitations}</p></section>}
      {f.scenario_id && (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary" onClick={copy}>{copyState === 'copied' ? <span className="pop-in" style={{ display: 'inline-flex' }}><Icon name="tick" /></span> : <Icon name="brief" />} {copyState === 'copied' ? 'Copied' : 'Copy fix prompt'}</button>
          <a className="btn" href={`/api/findings/${f.id}/export`}><Icon name="download" /> Playwright test</a>
          {controllable && !runActive && runMode !== 'retest' && f.category === 'verified_issue' && <button className="btn" onClick={onRetest}><Icon name="retest" /> Retest</button>}
        </div>
      )}
      <span role="status" className="status-line" style={{ color: copyState === 'copied' ? 'var(--ok)' : 'var(--warn)', minHeight: copyState === 'idle' ? 0 : undefined }}>
        {copyState === 'copied' ? <><Icon name="check" /> Fix prompt copied — paste it into your coding AI.</> : copyState === 'failed' ? <><Icon name="alert" /> Clipboard unavailable — select the text below.</> : ''}</span>
      {brief && <pre className="brief fade-in" tabIndex={0} aria-label="Fix brief">{brief}</pre>}
      {(f.evidence_ids ?? []).length > 0 && (
        <section className="section"><h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="evidence" /> Evidence ({f.evidence_ids.length})</h3>
          <div style={{ display: 'grid', gap: 10, marginTop: 4 }}>{f.evidence_ids.slice(0, 6).map((id: string) => <img key={id} className="evidence-img" src={`/api/artifacts/${id}`} alt="Evidence screenshot from an independent replay" loading="lazy" />)}</div>
        </section>
      )}
    </article>
  );
}

/** Live view of the run's browser while the owner signs in. Clicks and keys go to that browser. */
function HandoffPanel({ runId, onStop }: { runId: string; onStop: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [handing, setHanding] = useState(false);
  const [focused, setFocused] = useState(false);
  const buffer = useRef('');
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const send = useCallback(async (input: Record<string, unknown>) => {
    const r = await fetch(`/api/runs/${runId}/handoff`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (!r.ok) setMsg((await r.json().catch(() => ({}))).error ?? 'Input not accepted.');
  }, [runId]);
  const flush = useCallback(() => {
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
    const text = buffer.current; buffer.current = '';
    if (text) void send({ type: 'type', text });
  }, [send]);

  useEffect(() => {
    let alive = true; let url: string | null = null;
    const tick = async () => {
      const r = await fetch(`/api/runs/${runId}/live`, { cache: 'no-store' }).catch(() => null);
      if (r?.ok) {
        const next = URL.createObjectURL(await r.blob());
        if (!alive) { URL.revokeObjectURL(next); return; }
        setSrc(next); if (url) URL.revokeObjectURL(url); url = next;
        setPath(decodeURIComponent(r.headers.get('x-frame-path') ?? ''));
      }
    };
    void tick();
    const t = setInterval(tick, 700);
    return () => { alive = false; clearInterval(t); if (url) URL.revokeObjectURL(url); };
  }, [runId]);

  const SPECIAL: Record<string, string> = { Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Escape: 'Escape', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Home: 'Home', End: 'End' };
  function onKey(e: React.KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const special = e.key === 'Tab' && e.shiftKey ? 'Shift+Tab' : SPECIAL[e.key];
    if (special) { e.preventDefault(); flush(); void send({ type: 'key', key: special }); return; }
    if (e.key.length === 1) {
      e.preventDefault();
      buffer.current += e.key;
      if (!flushTimer.current) flushTimer.current = setTimeout(flush, 200);
    }
  }
  function onClick(e: React.MouseEvent<HTMLImageElement>) {
    const img = imgRef.current; if (!img) return;
    flush();
    const rect = img.getBoundingClientRect();
    void send({ type: 'click', x: Math.round((e.clientX - rect.left) * (img.naturalWidth / rect.width)), y: Math.round((e.clientY - rect.top) * (img.naturalHeight / rect.height)) });
  }
  async function done() { flush(); setHanding(true); await send({ type: 'done' }); }

  return (
    <section className="handoff fade-in" aria-labelledby="handoff-title">
      <div className="handoff-head">
        <span className="tile"><Icon name="pointer" /></span>
        <div style={{ minWidth: 0, flex: '1 1 200px' }}>
          <h2 id="handoff-title" className="h3">Sign in, then hand over</h2>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>The agent is waiting. It starts only after you hand over.</p>
        </div>
        <span className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary" onClick={done} disabled={handing} aria-busy={handing || undefined}><Icon name="play" /> {handing ? 'Handing over…' : 'I’m signed in — start testing'}</button>
          <button className="btn btn-danger" onClick={onStop}>Cancel</button>
        </span>
      </div>
      <div className="handoff-body">
        <p className="text-2" style={{ margin: 0, fontSize: 13.5 }}>This is the run&apos;s own fresh browser. Click into the picture, then type — sign in the way you normally do. What you type goes to the site through Oddhound and is not saved or shown to the AI model.</p>
        <div className="live-surface" tabIndex={0} onKeyDown={onKey} onFocus={() => setFocused(true)} onBlur={() => { flush(); setFocused(false); }}
          onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); flush(); void send({ type: 'type', text: t.slice(0, 500) }); } }}
          onWheel={(e) => { void send({ type: 'scroll', dy: Math.max(-1500, Math.min(1500, Math.round(e.deltaY))) }); }}
          aria-label="Live view of the run's browser. Click to focus, then type.">
          <div className="frame-bar">
            <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onKeyDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); flush(); void send({ type: 'back' }); }} aria-label="Back" title="Back"><Icon name="back" /></button>
            <span className="frame-addr"><Icon name="lock" /><span>{path || '…'}</span></span>
            <span className="conn" style={{ color: focused ? 'var(--ok)' : 'var(--text-3)' }}><Icon name={focused ? 'tick' : 'pointer'} /> {focused ? 'Typing goes to the site' : 'Click to control'}</span>
          </div>
          <div className="frame-body">
            {src ? <img ref={imgRef} src={src} alt="Live view of the run's browser" onClick={onClick} draggable={false} />
              : <div className="empty empty-sm" style={{ background: 'var(--surface)' }}><span className="tile tile-neutral"><Icon name="browser" /></span><p>Starting the browser…</p></div>}
          </div>
        </div>
        {msg && <p role="alert" className="status-line" style={{ color: 'var(--warn)' }}><Icon name="alert" /> {msg}</p>}
      </div>
    </section>
  );
}
