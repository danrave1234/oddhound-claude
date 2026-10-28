'use client';
// The run "deck": a compact, visual summary of what the agent is doing right now (or did, for a
// finished run). Everything here is derived from saved records: run events, actions, page states,
// spend and the agent's own plan. Motion is driven by those records arriving, so the deck moves
// while the agent works and is still when it is not. A demo replay can be played back in time.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '@/ui/icons';
import { CountUp, Ring, prefersReducedMotion, useNow } from '@/ui/motion';
import { statusLabel } from '@/ui/status';
import { LIMITS } from '@core/contracts/limits.ts';
import { TrailMap } from './trail-map';

type Ev = { seq: number; at: string; type: string; payload: Record<string, any> };
type DeckSnap = {
  run: Record<string, any>;
  events: Ev[];
  actions: Record<string, any>[];
  graph: { states: { id: string; route: string; title: string; actor: string; device: string }[] };
  findings: Record<string, any>[];
  latestScreenshot: { id: string; label: string; created_at: string } | null;
  spend: { settled: number; outstanding: number };
  plan?: { status: string; risk: string }[];
  detectedSignals?: number;
};

const PHASES: { key: string; label: string }[] = [
  { key: 'queued', label: 'Queued' }, { key: 'provisioning', label: 'Starting browser' },
  { key: 'running', label: 'Exploring' }, { key: 'finalizing', label: 'Verifying & finalizing' }, { key: 'completed', label: 'Completed' },
];
const PHASE_INDEX: Record<string, number> = { queued: 0, provisioning: 1, running: 2, waiting_for_input: 2, stopping: 3, finalizing: 3, completed: 4, stopped: 4, failed: 4, blocked: 4 };
const TERMINAL_BAD = new Set(['stopped', 'failed', 'blocked']);
const TOAST_TYPES: Record<string, { icon: IconName; tone: string; title: string }> = {
  'finding.candidate': { icon: 'question', tone: 'warn', title: 'Candidate found' },
  'finding.verifying': { icon: 'replay', tone: 'info', title: 'Replaying independently' },
  'finding.verified': { icon: 'bug', tone: 'bad', title: 'Verified issue' },
  'finding.dismissed': { icon: 'skip', tone: 'muted', title: 'Not reproduced — dismissed' },
  'finding.observation': { icon: 'shield', tone: 'info', title: 'Configuration observation' },
  'signal.detected': { icon: 'sniff', tone: 'warn', title: 'Detector signal' },
  'handoff.started': { icon: 'pointer', tone: 'accent', title: 'Waiting for your sign-in' },
};

const fmtClock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const ts = (e: Ev) => new Date(e.at).getTime();

export function LiveDeck({ snap, active, replay, onOpenBrowser, onOpenFindings }: { snap: DeckSnap; active: boolean; replay: boolean; onOpenBrowser: () => void; onOpenFindings: () => void }) {
  const run = snap.run;
  const events = snap.events;
  const startMs = run.started_at ? new Date(run.started_at).getTime() : events[0] ? ts(events[0]) : Date.now();
  const endMs = run.finished_at ? new Date(run.finished_at).getTime() : events.length ? ts(events[events.length - 1]!) : startMs;

  // ── Replay playback (demo replays only) ────────────────────────────────────
  const canPlay = replay && events.length > 2 && endMs > startMs;
  const [cursor, setCursor] = useState<number>(Infinity);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  useEffect(() => {
    if (canPlay && !prefersReducedMotion()) { setCursor(startMs); setPlaying(true); }
  }, [canPlay, startMs]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const tick = (t: number) => {
      const dt = t - last; last = t;
      setCursor((c) => {
        const next = (Number.isFinite(c) ? c : startMs) + dt * speed;
        if (next >= endMs) { setPlaying(false); return Infinity; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, startMs, endMs]);
  const atEnd = !Number.isFinite(cursor);
  const t = atEnd ? Infinity : cursor;

  // ── Live clock ─────────────────────────────────────────────────────────────
  const now = useNow(active && !replay, 1000);
  // The testing clock restarts when the owner hands over after signing in (the run's expiry moves then).
  const clockStartMs = run.expires_at ? Math.max(startMs, new Date(run.expires_at).getTime() - LIMITS.runWallClockMs) : startMs;
  const elapsedMs = Math.max(0, atEnd ? ((run.finished_at ? endMs : active ? now : endMs) - clockStartMs) : t - clockStartMs);

  // ── Derived model at time t ────────────────────────────────────────────────
  const model = useMemo(() => {
    const seen = atEnd ? events : events.filter((e) => ts(e) <= t);
    const actionEvents = seen.filter((e) => e.type === 'action.finished');
    const lastAction = actionEvents[actionEvents.length - 1] ?? null;
    const statusEvents = seen.filter((e) => e.type.startsWith('run.') && e.payload?.status);
    const status = atEnd ? run.status : (statusEvents[statusEvents.length - 1]?.payload.status ?? 'queued');
    const discovered = seen.filter((e) => e.type === 'state.discovered').map((e) => ({ key: `${e.payload.route}|${e.payload.actor}|${e.payload.device}`, route: e.payload.route as string, title: e.payload.title as string, device: e.payload.device as string, seq: e.seq }));
    const uniq = [...new Map(discovered.map((d) => [d.key, d])).values()];
    const pages = atEnd && snap.graph.states.length ? snap.graph.states.map((s, i) => ({ key: s.id, route: s.route, title: s.title, device: s.device, seq: i })) : uniq;
    const planEvents = seen.filter((e) => e.type === 'plan.updated');
    const charters: { status: string; risk: string }[] = atEnd && snap.plan ? snap.plan : (planEvents[planEvents.length - 1]?.payload.charters ?? []);
    const count = (type: string) => seen.filter((e) => e.type === type).length;
    const actionsUsed = atEnd ? Math.max(snap.actions[0]?.seq ?? 0, actionEvents.length) : actionEvents.length;
    return {
      status, lastAction, pages, charters, actionsUsed,
      candidates: count('finding.candidate'), verified: atEnd ? snap.findings.filter((f) => f.category === 'verified_issue' && f.verification === 'verified').length : count('finding.verified'),
      signals: atEnd ? (snap.detectedSignals ?? count('signal.detected')) : count('signal.detected'),
      seen,
    };
  }, [events, t, atEnd, run.status, snap.graph.states, snap.plan, snap.actions, snap.findings, snap.detectedSignals]);

  // ── Activity sparkline (events per time bucket) ────────────────────────────
  const spark = useMemo(() => {
    const until = atEnd ? (active && !replay ? now : endMs) : t;
    const span = Math.max(30_000, until - startMs);
    const n = 32, w = span / n;
    const b = new Array(n).fill(0) as number[];
    for (const e of model.seen) { const i = Math.min(n - 1, Math.floor((ts(e) - startMs) / w)); if (i >= 0) b[i]++; }
    const max = Math.max(1, ...b);
    return b.map((v) => v / max);
  }, [model.seen, atEnd, active, replay, now, endMs, t, startMs]);

  // ── Toasts for findings and signals as they arrive ─────────────────────────
  const [toasts, setToasts] = useState<{ id: number; type: string; text: string }[]>([]);
  const seenSeq = useRef<number>(replay ? -1 : (events[events.length - 1]?.seq ?? 0));
  useEffect(() => {
    if (replay && atEnd && !playing) return;
    const fresh = model.seen.filter((e) => e.seq > seenSeq.current && TOAST_TYPES[e.type]);
    if (model.seen.length) seenSeq.current = Math.max(seenSeq.current, model.seen[model.seen.length - 1]!.seq);
    if (!fresh.length) return;
    const add = fresh.slice(-3).map((e) => ({ id: e.seq, type: e.type, text: String(e.payload.title ?? e.payload.detail ?? e.payload.startPath ?? '') }));
    setToasts((cur) => [...cur, ...add].slice(-3));
    const ids = add.map((a) => a.id);
    timers.current.push(setTimeout(() => setToasts((cur) => cur.filter((x) => !ids.includes(x.id))), 6000));
  }, [model.seen, replay, atEnd, playing]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const phaseIdx = PHASE_INDEX[model.status] ?? 0;
  const bad = TERMINAL_BAD.has(model.status);
  const spendMicros = snap.spend.settled + snap.spend.outstanding;
  const planDone = model.charters.filter((c) => c.status === 'completed').length;
  const showLiveMotion = active || (replay && !atEnd);
  const [failedFrame, setFailedFrame] = useState<string | null>(null);

  return (
    <section className={`deck${showLiveMotion ? ' deck-live' : ''}`} aria-label="Run overview">
      {/* Phase track */}
      <div className="deck-top">
        <ol className="phases" aria-label="Run phase">
          {PHASES.map((p, i) => {
            const state = i < phaseIdx ? 'done' : i === phaseIdx ? (i === 4 ? (bad ? 'bad' : 'done') : 'current') : 'todo';
            const label = i === 4 && bad ? statusLabel(model.status) : i === phaseIdx && model.status === 'waiting_for_input' ? 'Waiting for you' : i === phaseIdx && model.status === 'stopping' ? 'Stopping' : p.label;
            return (
              <li key={p.key} data-state={state} aria-current={i === phaseIdx ? 'step' : undefined}>
                <span className="ph-dot">{state === 'done' ? <Icon name="tick" /> : state === 'bad' ? <Icon name="stop" /> : null}</span>
                <span className="ph-label">{label}</span>
                {i < PHASES.length - 1 && <span className="ph-bar"><i style={{ transform: `scaleX(${i < phaseIdx ? 1 : 0})` }} /></span>}
              </li>
            );
          })}
        </ol>
        {canPlay && (
          <div className="player" role="group" aria-label="Replay playback">
            <button className="icon-btn" onClick={() => { if (atEnd) setCursor(startMs); setPlaying((p) => !p); }} aria-label={playing ? 'Pause replay' : atEnd ? 'Play replay from the start' : 'Play replay'}>
              <Icon name={playing ? 'pause' : atEnd ? 'retest' : 'play'} />
            </button>
            <input type="range" min={0} max={1000} value={atEnd ? 1000 : Math.round(((t - startMs) / (endMs - startMs)) * 1000)} aria-label="Replay position"
              onChange={(e) => { const v = Number(e.target.value); setPlaying(false); setCursor(v >= 1000 ? Infinity : startMs + (v / 1000) * (endMs - startMs)); }} />
            <span className="tabular player-time">{fmtClock(atEnd ? endMs - startMs : t - startMs)} / {fmtClock(endMs - startMs)}</span>
            <div className="segmented" role="group" aria-label="Replay speed">
              {[1, 4, 16].map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}
            </div>
          </div>
        )}
      </div>

      <div className="deck-main">
        {/* Latest frame */}
        <button type="button" className="deck-frame" onClick={onOpenBrowser} aria-label="Open the Browser view">
          {snap.latestScreenshot && failedFrame !== snap.latestScreenshot.id ? (
            <>
              <img key={snap.latestScreenshot.id} className="deck-frame-img" src={`/api/artifacts/${snap.latestScreenshot.id}`} alt="" onError={() => setFailedFrame(snap.latestScreenshot!.id)}
                ref={(el) => { if (el && el.complete && el.naturalWidth === 0) setFailedFrame(snap.latestScreenshot!.id); }} />
              {showLiveMotion && <span className="deck-sweep" key={`sw-${snap.latestScreenshot.id}`} aria-hidden />}
              <span className="deck-frame-cap"><Icon name="evidence" /> {replay && !atEnd ? 'Recorded final frame' : 'Latest sampled frame'}</span>
            </>
          ) : (
            <span className="deck-frame-empty"><Icon name="browser" size={24} /><span>{snap.latestScreenshot ? 'Frame unavailable' : active ? 'Waiting for the first frame…' : 'No frame captured'}</span></span>
          )}
        </button>

        <div className="deck-body">
          {/* Now doing */}
          <div className="now" aria-live="off">
            <span className={`now-badge${showLiveMotion ? ' on' : ''}`}><Icon name="paw" /> {showLiveMotion ? (replay ? 'Replaying' : 'Now') : 'Last action'}</span>
            <div className="now-text">
              {model.lastAction ? (
                <span key={model.lastAction.seq} className="now-line">
                  {model.lastAction.payload.ok === false && <span className="now-fail"><Icon name="fail" /></span>}
                  {String(model.lastAction.payload.description ?? model.lastAction.type)}
                </span>
              ) : <span className="muted">{active ? (model.status === 'queued' ? 'Waiting in the queue…' : 'Getting ready…') : 'No actions recorded.'}</span>}
            </div>
          </div>

          {/* Gauges with real denominators */}
          <div className="gauges">
            <Ring label="actions (no limit)" value={model.actionsUsed} max={Math.max(50, model.actionsUsed * 1.25)} display={<CountUp value={model.actionsUsed} />} spoken={String(model.actionsUsed)} />
            <Ring label={`of ${fmtClock(LIMITS.runWallClockMs)} time`} value={elapsedMs} max={LIMITS.runWallClockMs} display={fmtClock(elapsedMs)} spoken={fmtClock(elapsedMs)} tone="info" />
            <Ring label={model.charters.length ? `of ${model.charters.length} plan items` : 'no plan yet'} value={planDone} max={Math.max(1, model.charters.length)} display={<CountUp value={planDone} />} spoken={String(planDone)} tone="ok" />
            <Ring label={`of $${(LIMITS.modelSpendPerRunMicros / 1e6).toFixed(2)} model spend`} value={replay && !atEnd ? 0 : spendMicros} max={LIMITS.modelSpendPerRunMicros}
              display={replay && !atEnd ? '—' : `$${(spendMicros / 1e6).toFixed(2)}`} spoken={replay && !atEnd ? 'not shown during playback,' : `$${(spendMicros / 1e6).toFixed(2)}`} tone="warn" />
          </div>

          {/* Counters + sparkline */}
          <div className="deck-foot">
            <div className="counters">
              <span><Icon name="browser" /><CountUp value={new Set(model.pages.map((pg) => pg.route)).size} /> pages</span>
              <span><Icon name="question" /><CountUp value={model.candidates} /> candidates</span>
              <button type="button" className={model.verified ? 'hot' : ''} onClick={onOpenFindings}><Icon name="bug" /><CountUp value={model.verified} /> verified</button>
              <span><Icon name="sniff" /><CountUp value={model.signals} /> signals</span>
            </div>
            <div className="spark" role="img" aria-label="Recorded activity over the run">
              {spark.map((v, i) => <i key={i} style={{ transform: `scaleY(${Math.max(0.06, v)})` }} />)}
            </div>
          </div>
        </div>
      </div>

      {/* Discovered pages as a trail map */}
      <div className="trail-wrap">
        <div className="trail-head"><span className="trail-label">Trail</span><span className="muted" style={{ fontSize: 12.5 }}>{model.pages.length ? (() => { const n = new Set(model.pages.map((pg) => pg.route)).size; return `${n} ${n === 1 ? 'page' : 'pages'} reached, in order (${model.pages.length} page ${model.pages.length === 1 ? 'state' : 'states'})`; })() : ''}</span></div>
        {model.pages.length
          ? <TrailMap pages={model.pages} live={showLiveMotion} />
          : <p className="muted" style={{ fontSize: 13, margin: 0 }}>{active ? 'The trail grows as the agent reaches new pages.' : 'No pages recorded.'}</p>}
      </div>

      {/* Arrival toasts (polite, never take focus) */}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => {
          const m = TOAST_TYPES[x.type]!;
          return (
            <div key={x.id} className={`toast toast-${m.tone}`}>
              <span className="toast-icon"><Icon name={m.icon} /></span>
              <span className="toast-body"><strong>{m.title}</strong>{x.text && <span>{x.text}</span>}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
