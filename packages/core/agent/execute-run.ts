// Executes one run end to end inside the trusted worker:
//   claim lease → re-verify ownership → select Meta provider → provision a fresh browser →
//   bounded model loop (budget reserved before every call, lease checked before every action) →
//   independent verification of candidates → deterministic configuration observations →
//   finalize, destroy the browser and record the truthful terminal status.

import type { Db } from '../db/pool.ts';
import { LIMITS } from '../contracts/limits.ts';
import { RunContractSchema, pathHasDeniedKeyword, BASELINE_IMPACT, BASELINE_RULES, type RunContract } from '../contracts/contract.ts';
import { describeSignal, signalKey, type Signal } from '../browser/sentinels.ts';
import type { RunStatus } from '../contracts/status.ts';
import { appendEvent, assertLease, claimRun, FencedError, setRunStatus, refundIfNeverStarted } from '../ledger/runs.ts';
import { reserveSpend, settleSpend, releaseSpend, markSpendUnknown } from '../ledger/spend.ts';
import { resolveCredential, storeCredential, syntheticIdentity } from '../ledger/credentials.ts';
import { saveArtifact } from '../artifacts/store.ts';
import type { BrowserRuntime, ProvisionedBrowser } from '../browser/runtime.ts';
import { newScopedContext } from '../browser/runtime.ts';
import { attachScope, policyFromContract, type ScopeDecision } from '../browser/scope.ts';
import { formatObservation, stateFingerprint, type Observation } from '../browser/snapshot.ts';
import { judgeExpectation, pageFacts, type Expectation } from '../verifier/expect.ts';
import { isBoundaryTemplate, resolveBoundary } from './boundary.ts';
import { CoverageTracker } from './coverage.ts';
import { runSpend } from '../ledger/spend.ts';
import type { LabProfile } from '../net/ip-policy.ts';
import { verifyOwnership, type VerificationMethod } from '../verification/ownership.ts';
import { ProviderError, type ChatMessage, type ChatProvider, type ToolCall } from '../providers/types.ts';
import { priceFor, inputTokenBound, reservationMicros, actualMicros } from '../providers/pricing.ts';
import { RunSession, SiteUnreachable } from './session.ts';
import { ToolArgs, BROWSER_TOOLS, boundaryValues, agentModeFromEnv, toolDefinitionsFor, toolOffered, type AgentMode, type BatchStep, type Charter, type ToolName } from './tools.ts';
import { systemPrompt } from './prompt.ts';
import { runHandoff, HandoffEnded } from './handoff.ts';
import { CLICK_ROLES, controlFor, newReplaySessions, replayScenario, scenarioDefect, scenarioHash, type AuthRecipe, type Oracle, type ReplayEnv, type Scenario, type TraceStep } from '../verifier/scenario.ts';

export type ExecuteDeps = {
  db: Db;
  runtime: BrowserRuntime;
  providers: ChatProvider[];
  workerId: string;
  lab?: LabProfile;
  hosted?: boolean; // hosted mode refuses a browser whose Chromium sandbox is not confirmed
  verify?: typeof verifyOwnership;
  allowOfflineTestDouble?: boolean; // local development and tests only; never in hosted mode
  /** How the model drives the browser (default from ODDHOUND_AGENT_MODE, else DEFAULT_AGENT_MODE). */
  agentMode?: AgentMode;
  /** Measurement harness only: end exploration (not verification) once settled model spend reaches this. */
  explorationSpendCapMicros?: number;
};

type Candidate = {
  title: string; ruleId: string; impact: 'high' | 'medium' | 'low'; observed: string;
  scenario: Scenario; controlValues?: Record<string, string>; actor: string; device: string;
  /** 'detector' = raised by Oddhound's own sentinels; 'agent' = reported by the model. */
  source?: 'detector' | 'agent';
  /** Page-stated rules the reproduction's boundary values came from (e.g. 'maxlength=50 on "Notes"'). */
  stated?: string;
};

/** One ledgered browser action converted to a replayable step (recorded by Oddhound, not the model). */
type StepRecord = { seq: number; ctx: string; device: 'desktop' | 'mobile'; actor: string; urlBefore: string; step: TraceStep | null };

type ClickRole = Extract<TraceStep, { op: 'click' }>['role'];

/** What the runner learned from one ledgered browser action (read by scenario batches). */
type StepInfo = { seq: number; error: string | null; notes: string[]; scopeBlocked: boolean; ownScopeBlocked: boolean; dialogs: string[]; newState: boolean; obs: Observation; stated?: string };

/** A scenario batch as Oddhound ran it: the ledgered action of each step and the model's expectation. */
type BatchRecord = { no: number; goal: string; steps: { seq: number; expect?: Expectation; ok?: boolean; stated?: string }[] };

/** At most this many automatic (detector) candidates per run, so verification fits in the run's time. */
const MAX_DETECTOR_CANDIDATES = 10;

type RunRow = {
  id: string; project_id: string | null; mode: string; origin: string; contract: unknown; spend_account: 'public' | 'judging' | 'development';
  parent_run_id: string | null; status: RunStatus;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type StorageState = Awaited<ReturnType<RunSession['storageState']>>;

export async function executeRun(deps: ExecuteDeps, runId: string): Promise<RunStatus | null> {
  const { db } = deps;
  const generation = await claimRun(db, runId, deps.workerId);
  if (generation === null) return null;
  const run = (await db.query<RunRow>('SELECT * FROM runs WHERE id = $1', [runId])).rows[0]!;
  const contract = RunContractSchema.parse(run.contract);
  const ev = (type: string, payload: Record<string, unknown> = {}) => appendEvent(db, runId, type, payload);
  await ev('run.status', { status: 'provisioning' });

  // Stop/expiry watcher: aborts in-flight inference as soon as the fence is persisted.
  const abort = new AbortController();
  const watcher = setInterval(async () => {
    try {
      const r = await db.query<{ stop_requested_at: Date | null; expires_at: Date | null }>('SELECT stop_requested_at, expires_at FROM runs WHERE id = $1', [runId]);
      const row = r.rows[0];
      if (row?.stop_requested_at || (row?.expires_at && row.expires_at.getTime() < Date.now())) abort.abort();
    } catch { /* keep polling */ }
  }, 500);

  let browser: ProvisionedBrowser | null = null;
  let session: RunSession | null = null;
  let finalStatus: RunStatus = 'completed';
  let stopReason: string | undefined;

  const finish = async (status: RunStatus, reason?: string) => {
    finalStatus = status; stopReason = reason;
  };

  try {
    // 1. Ownership is re-checked immediately before browser work (B16, SELF-14).
    if (contract.target.verification.kind === 'owner_verified') {
      const sv = (await db.query<{ id: string; token: string; method: VerificationMethod }>(
        `SELECT id, token, method FROM site_verifications WHERE project_id = $1 AND origin = $2 AND revision = $3 AND verified`,
        [run.project_id, contract.target.origin, contract.target.verification.revision])).rows[0];
      const result = sv
        ? await (deps.verify ?? verifyOwnership)(contract.target.origin, sv.token, contract.target.verification.method, { lab: deps.lab })
        : { verified: false, method: contract.target.verification.method, reason: 'no_current_verification', checkedAt: new Date().toISOString() };
      if (sv) await db.query('UPDATE site_verifications SET verified = $2, last_reason = $3, last_checked_at = now() WHERE id = $1', [sv.id, result.verified, result.reason]);
      await ev(result.verified ? 'site.verified' : 'site.verification_failed', { origin: contract.target.origin, method: result.method, reason: result.reason });
      if (!result.verified) { await refundIfNeverStarted(db, runId); await finish('blocked', `ownership_not_verified:${result.reason}`); return await done(); }
      // Each API origin in scope has its own proof, re-checked the same way. Any failure blocks the run
      // rather than silently dropping the origin, so the run never acts with authority it lacks.
      for (const api of contract.target.apiOrigins) {
        const row = (await db.query<{ id: string; token: string; method: VerificationMethod | null }>(
          `SELECT id, token, method FROM site_verifications WHERE project_id = $1 AND origin = $2 AND revision = $3 AND verified`,
          [run.project_id, api.origin, api.verificationRevision])).rows[0];
        const r = row?.method
          ? await (deps.verify ?? verifyOwnership)(api.origin, row.token, row.method, { lab: deps.lab }, sv?.token)
          : { verified: false, method: row?.method ?? 'dns_txt', reason: 'no_current_verification', checkedAt: new Date().toISOString() };
        if (row) await db.query('UPDATE site_verifications SET verified = $2, last_reason = $3, last_checked_at = now() WHERE id = $1', [row.id, r.verified, r.reason]);
        await ev(r.verified ? 'site.verified' : 'site.verification_failed', { origin: api.origin, method: r.method, reason: r.reason, api: true });
        if (!r.verified) { await refundIfNeverStarted(db, runId); await finish('blocked', `api_origin_not_verified:${r.reason}`); return await done(); }
      }
    }

    // The demo target is shared: reset it to a clean, known state before each demo run or retest.
    // The reset URL and token are operator configuration, never user input (SELF-11).
    if (run.mode === 'demo_target' || (run.mode === 'retest' && contract.target.verification.kind === 'demo_target')) {
      const resetUrl = contract.target.origin === process.env.DEMO_TARGET_FIXED_ORIGIN ? process.env.DEMO_TARGET_FIXED_RESET_URL : process.env.DEMO_TARGET_RESET_URL;
      if (resetUrl) {
        const ok = await fetch(resetUrl, { method: 'POST', headers: { 'x-lab-reset-token': process.env.ODDHOUND_FIXTURE_RESET_TOKEN ?? '' }, signal: AbortSignal.timeout(5_000) }).then((r) => r.ok, () => false);
        await ev(ok ? 'fixture.reset' : 'fixture.reset_failed', { target: 'demo' });
        if (!ok) { await finish('blocked', 'demo_target_reset_failed'); return await done(); }
      }
    }

    if (run.mode === 'retest') {
      await executeRetest(deps, run, contract, generation, ev, (b) => { browser = b; });
      return await done();
    }

    // 2. Provider and price must be known before any call (missing price = blocked, never free).
    const provider = deps.providers[0];
    if (!provider) { await finish('blocked', 'no_meta_provider_configured'); return await done(); }
    // The offline test double is only for local tests; hosted runs require a real Meta model.
    if (!provider.isMetaModel && (deps.hosted || !deps.allowOfflineTestDouble)) { await finish('blocked', 'provider_is_not_a_meta_model'); return await done(); }
    const price = priceFor(provider.id, provider.model);
    if (!price) { await finish('blocked', 'model_price_unknown'); return await done(); }
    await setRunStatus(db, runId, generation, 'provisioning', { provider: provider.id, model: provider.model, browserState: 'provisioning' });
    await ev('provider.selected', { provider: provider.id, model: provider.model, label: provider.label, priceSource: price.source });

    // 3. Fresh isolated browser for this run only.
    browser = await deps.runtime.provision({
      runId, lab: deps.lab,
      onEgress: (d) => { if (!d.allowed) void ev('egress.denied', { host: d.host, port: d.port, reason: d.reason }); },
      onEgressExhausted: (r) => { void ev('egress.exhausted', { reason: r }); abort.abort(); },
    });
    await setRunStatus(db, runId, generation, 'running', { browserState: 'ready', browserRef: browser.ref, sandboxVerdict: browser.sandboxVerdict });
    await ev('browser.ready', { runtime: browser.runtime, ref: browser.ref, sandbox: browser.sandboxVerdict });
    if (deps.hosted && browser.sandboxVerdict !== 'sandbox_on') { await finish('blocked', `chromium_sandbox_not_confirmed:${browser.sandboxVerdict}`); return await done(); }
    await ev('run.status', { status: 'running' });

    const onScope = (d: ScopeDecision) => { if (!d.allowed) void ev('scope.denied', { url: redactUrl(d.url), method: d.method, reason: d.reason }); };
    session = new RunSession(browser.browser, policyFromContract(contract), onScope);

    // 3b. Owner sign-in handoff: the owner signs in through the live view; the model sees none of it.
    let handoffState: StorageState | undefined;
    if (contract.handoff.enabled) {
      await setRunStatus(db, runId, generation, 'waiting_for_input');
      await ev('run.status', { status: 'waiting_for_input', reason: 'owner_sign_in' });
      handoffState = await runHandoff({ db, runId, generation, session, startPath: contract.handoff.startPath, ev, signal: abort.signal });
      await setRunStatus(db, runId, generation, 'running');
      await ev('run.status', { status: 'running' });
    }

    // 4. Exploration with the Meta model.
    const candidates: Candidate[] = [];
    const recorded: Recorded = { auth: handoffState ? { kind: 'handoff' } : null, labelsByPath: new Map(), controlsByPath: new Map() };
    const loop = await agentLoop({ deps, runId, generation, contract, run, provider, price, session, ev, abort, candidates, recorded });
    if (loop.stopReason) stopReason = loop.stopReason;

    // 5. Independent verification of every candidate (fresh contexts, fresh identities).
    await ev('run.phase', { phase: 'verifying', candidates: candidates.length });
    await verifyCandidates({ db, runId, generation, run, contract, candidates, browser, ev, handoffState });

    // 6. Deterministic configuration observations from captured responses (no model involvement).
    await recordConfigurationObservations(db, run, session, contract, ev);

    // Truthful status: a model provider failure is a failed run, not a completed one.
    const ended = loop.stopReason === 'provider_error' ? 'failed'
      : loop.stopReason?.startsWith('budget_') || loop.stopReason === 'limit_turns' || loop.stopReason === 'limit_actions' ? 'stopped' : 'completed';
    await finish(ended, stopReason);
    return await done();
  } catch (e) {
    if (e instanceof HandoffEnded) {
      await finish('stopped', e.reason);
    } else if (e instanceof SiteUnreachable) {
      await ev('site.unreachable', { url: e.url, detail: e.detail });
      await finish('failed', 'site_unreachable');
    } else if (e instanceof FencedError || abort.signal.aborted) {
      const r = (await db.query<{ stop_requested_at: Date | null }>('SELECT stop_requested_at FROM runs WHERE id = $1', [runId])).rows[0];
      await finish('stopped', r?.stop_requested_at ? 'user_stop' : e instanceof FencedError ? e.reason : 'expired_or_capped');
    } else {
      await ev('run.error', { message: (e as Error).message.slice(0, 300) });
      await finish('failed', 'internal_error');
    }
    return await done();
  }

  async function done(): Promise<RunStatus> {
    clearInterval(watcher);
    await db.query(`UPDATE runs SET status = 'finalizing' WHERE id = $1 AND lease_generation = $2 AND status NOT IN ('completed','stopped','failed','blocked')`, [runId, generation]);
    await ev('run.status', { status: 'finalizing' });
    await session?.close();
    if (browser) {
      await setRunStatus(db, runId, generation, 'finalizing', { browserState: 'terminating' });
      const d = await browser.destroy();
      await setRunStatus(db, runId, generation, 'finalizing', { browserState: d.confirmed ? 'terminated' : 'terminating' });
      await ev(d.confirmed ? 'browser.terminated' : 'browser.destroy_unconfirmed', { detail: d.detail, egress: browser.egressStats() });
    }
    await setRunStatus(db, runId, generation, finalStatus, { stopReason });
    await ev(`run.${finalStatus}`, { status: finalStatus, reason: stopReason ?? null });
    return finalStatus;
  }
}

function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) if (/token|session|sid|auth|password|secret|key|code/i.test(k)) u.searchParams.set(k, '[REDACTED]');
    return u.toString();
  } catch { return '[invalid url]'; }
}

// ---------------------------------------------------------------------------------------------
// Model loop

type LoopArgs = {
  deps: ExecuteDeps; runId: string; generation: number; contract: RunContract; run: RunRow; provider: ChatProvider;
  price: NonNullable<ReturnType<typeof priceFor>>; session: RunSession; ev: (t: string, p?: Record<string, unknown>) => Promise<number>;
  abort: AbortController; candidates: Candidate[]; recorded: Recorded;
};

/** What Oddhound itself observed during exploration, used to ground the model's scenario recipes. */
export type Recorded = { auth: AuthRecipe | null; labelsByPath: Map<string, Set<string>>; controlsByPath: Map<string, Set<string>> };

async function agentLoop(a: LoopArgs): Promise<{ stopReason?: string; summary?: string }> {
  const { deps: { db }, runId, generation, contract, provider, price, session, ev, abort, candidates, recorded } = a;
  const mode: AgentMode = a.deps.agentMode ?? agentModeFromEnv();
  const tools = toolDefinitionsFor(mode);
  await ev('agent.mode', { mode, tools: tools.map((t) => t.function.name) });
  let pendingAuth: { path: string; fields: Record<string, string> } | null = null;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(contract, mode) },
    { role: 'user', content: `Begin. You are actor A on desktop, on ${contract.target.origin}/. Start with observe.` },
  ];

  /** Oddhound's own record of the run so far, used when the conversation is compacted. */
  const notebook = () => {
    const pages = [...recorded.controlsByPath.keys()].slice(0, 40).map((p) => {
      const fields = [...(recorded.labelsByPath.get(p) ?? [])].slice(0, 10);
      return `- ${p}${fields.length ? ` (fields: ${fields.join(', ')})` : ''}`;
    });
    const charters = [...plan.values()].map((c) => `- ${c.id} [${c.risk}, ${c.status}] ${c.area}: ${c.technique}${c.note ? ` (${c.note})` : ''}`);
    const found = candidates.map((c) => `- ${c.ruleId} ${c.title} (${c.source ?? 'agent'})`);
    const ids = identities.map((i) => `- ${i.email} name="${i.name}" credential_ref=${i.ref}`);
    const last = session.lastObservation ? formatObservation(session.lastObservation) : 'No page observed yet.';
    const cov = coverage.summary();
    const todo = cov.unexercised.map((u) => `${u.route} ${u.kind} "${u.label}"`).join('; ');
    return [
      'NOTEBOOK (kept by Oddhound; the earlier conversation was compacted to save cost)',
      `Budget: turn ${turns}/${LIMITS.modelTurnsPerRun}, action ${actions}/${LIMITS.browserActionsPerRun}. Last action #${seq}. You are actor ${session.actor} on ${session.device}.`,
      recorded.auth ? `Sign-up recipe that worked: ${recorded.auth.kind === 'handoff' ? 'owner handoff session' : `${recorded.auth.path} -> "${recorded.auth.successText}"`}` : 'No sign-up recorded yet.',
      `Synthetic identities:\n${ids.join('\n') || '- none'}`,
      `Pages seen:\n${pages.join('\n') || '- none'}`,
      `Test plan:\n${charters.join('\n') || '- none yet: call plan_tests'}`,
      `Findings recorded so far:\n${found.join('\n') || '- none'}`,
      `Coverage: ${cov.exercised} of ${cov.total} controls on ${cov.pages} observed page(s) exercised; ${cov.blocked} blocked by policy.${todo ? ` Not yet exercised (sample): ${todo}.` : ''}`,
      `Current page (element refs are valid for your next call):\n${last}`,
      'Continue with the next open charter.',
    ].join('\n\n');
  };
  const toolsJson = JSON.stringify(tools);
  const identities: { ref: string; name: string; email: string }[] = [];
  const secrets = new Set<string>();
  let turns = 0, actions = 0, lastActionAt = 0, nudges = 0, seq = 0;
  let previousState: string | null = null;
  let finished: string | undefined;
  const stepLog: StepRecord[] = [];
  let quietSteps = false; // true while do_steps runs: intermediate steps return one line, not a page
  const seenSignals = new Set<string>();
  const plan = new Map<string, Charter>();
  let finishRefusals = 0;
  let detectorCandidates = 0;
  let lastStep: StepInfo | null = null;
  const batches = new Map<number, BatchRecord>();
  let lastCoverage = '';
  // Controls the run may not use count as blocked by policy, not as untested.
  const coverage = new CoverageTracker((el, pageUrl) => {
    if (el.kind !== 'link' || !el.href || el.href.startsWith('#') || /^javascript:/i.test(el.href)) return null;
    let u: URL;
    try { u = new URL(el.href, pageUrl); } catch { return null; }
    if (u.origin !== session.origin) return 'off_site';
    if (contract.deniedPathPrefixes.some((p) => u.pathname.startsWith(p)) || pathHasDeniedKeyword(u.pathname, contract.deniedPathKeywords)) return 'denied_by_contract';
    return null;
  });
  const emitCoverage = async () => {
    const cov = coverage.summary();
    const key = `${cov.total}/${cov.exercised}/${cov.blocked}/${cov.pages}`;
    if (key === lastCoverage) return;
    lastCoverage = key;
    await ev('coverage.updated', cov);
  };
  // Leave time at the end for independent verification (replays) before the run's hard expiry.
  const expiresAt = (await db.query<{ expires_at: Date | null }>('SELECT expires_at FROM runs WHERE id = $1', [runId])).rows[0]?.expires_at?.getTime() ?? Date.now() + LIMITS.runWallClockMs;
  const verificationReserveMs = () => Math.min(6 * 60_000, 90_000 + candidates.length * 35_000);

  /** Translate the action just executed into a replayable step, using what the model saw (labels, kinds). */
  const toStep = (tool: ToolName, args: Record<string, any>): TraceStep | null => {
    const asTemplate = (v: string) => {
      const ident = identities.find((i) => i.name === v || i.email === v);
      return ident ? (ident.name === v ? '{name}' : '{email}') : v;
    };
    switch (tool) {
      case 'navigate': return { op: 'goto', path: args.path };
      case 'go_back': return { op: 'back' };
      case 'press_key': return { op: 'press', key: args.key };
      case 'click': {
        const el = session.elementOf(args.ref);
        if (!el?.label) return null;
        const role: ClickRole = el.kind === 'link' ? 'link' : el.kind === 'button' ? 'button'
          : el.kind === 'checkbox' ? (el.type === 'radio' ? 'radio' : 'checkbox')
            : el.kind === 'widget' && el.role && (CLICK_ROLES as readonly string[]).includes(el.role) ? el.role as ClickRole : 'other';
        return { op: 'click', target: el.label.slice(0, 120), role };
      }
      case 'drag': {
        const from = session.labelOf(args.ref), to = session.labelOf(args.target);
        return from && to ? { op: 'drag', source: from.slice(0, 120), target: to.slice(0, 120) } : null;
      }
      case 'fill': { const label = session.labelOf(args.ref); return label ? { op: 'fill', field: label.slice(0, 80), value: asTemplate(args.value) } : null; }
      case 'fill_credential': { const label = session.labelOf(args.ref); return label ? { op: 'fill', field: label.slice(0, 80), value: args.field === 'password' ? '{password}' : '{email}' } : null; }
      case 'select_option': { const label = session.labelOf(args.ref); return label ? { op: 'select', field: label.slice(0, 80), value: args.value } : null; }
      default: return null;
    }
  };

  /** Steps for a trace ending at `toSeq`, starting at `fromSeq` (or at the last navigation before it). */
  const traceFor = (toSeq: number, fromSeq?: number): { start: string; steps: TraceStep[]; device: 'desktop' | 'mobile'; actor: string; usesPassword: boolean } | string => {
    const end = stepLog.find((s) => s.seq === toSeq);
    if (!end) return `Action #${toSeq} is not a recorded browser action.`;
    let window = stepLog.filter((s) => s.ctx === end.ctx && s.seq <= toSeq && (fromSeq === undefined || s.seq >= fromSeq));
    if (fromSeq === undefined) {
      window = window.slice(-10);
      const lastGoto = window.map((s) => s.step?.op).lastIndexOf('goto');
      if (lastGoto > 0) window = window.slice(lastGoto);
    }
    if (window.length > 14) return 'A trace can cover at most 14 actions; start closer to the problem.';
    if (window.some((s) => s.step === null)) return 'Some of those actions cannot be replayed (an element without a visible label, or a device/actor switch inside the range).';
    const first = window[0]!;
    const steps = window.map((s) => s.step!) as TraceStep[];
    // A leading goto becomes the start page itself.
    const start = steps[0]?.op === 'goto' ? (steps.shift() as Extract<TraceStep, { op: 'goto' }>).path : first.urlBefore;
    return { start, steps, device: first.device, actor: first.actor, usesPassword: steps.some((s) => s.op === 'fill' && s.value === '{password}') };
  };

  /** Turn new sentinel signals from the last action into verified-on-replay candidates. */
  const handleSignals = async (tool: ToolName, actionSeq: number, drained: { signals: Signal[]; scopeBlocked: boolean }): Promise<string[]> => {
    const notes: string[] = [];
    for (const sig of drained.signals) {
      // A 404 after the model typed a URL itself is not a broken link on the site.
      if (sig.kind === 'http_404' && tool === 'navigate') continue;
      const key = signalKey(sig);
      if (seenSignals.has(key)) continue;
      seenSignals.add(key);
      // A page error right after Oddhound blocked a request may be caused by that block, not by the site.
      if (sig.kind === 'page_error' && drained.scopeBlocked) {
        await ev('signal.suppressed', { rule: sig.rule, detail: describeSignal(sig), reason: 'a request was blocked by Oddhound in the same step' });
        continue;
      }
      await ev('signal.detected', { rule: sig.rule, kind: sig.kind, detail: describeSignal(sig), actionSeq });
      notes.push(`ODDHOUND DETECTED (${sig.rule}): ${describeSignal(sig)}. Recorded automatically for replay; do not report it again. Look for related problems nearby.`);
      if (detectorCandidates >= MAX_DETECTOR_CANDIDATES) continue;
      const t = traceFor(actionSeq);
      if (typeof t === 'string') { await ev('signal.not_replayable', { rule: sig.rule, reason: t }); continue; }
      const oracle: Oracle = sig.kind === 'http_5xx' ? { type: 'http_status', min: 500, max: 599, method: sig.method, route: sig.route }
        : sig.kind === 'http_404' ? { type: 'http_status', min: 404, max: 404, method: 'GET', route: sig.route }
        : sig.kind === 'page_error' ? { type: 'page_error', contains: sig.message.slice(0, 60) }
        : sig.kind === 'markup_rendered' ? { type: 'markup_rendered' }
        : sig.kind === 'error_text' ? { type: 'error_text', pattern: sig.pattern }
        : { type: 'mobile_overflow' };
      const auth = recorded.auth && !t.usesPassword ? recorded.auth : undefined;
      const scenario: Scenario = { kind: 'trace', device: t.device, ...(auth ? { auth } : {}), start: t.start, steps: t.steps, oracle };
      const rule = BASELINE_RULES.find((r) => r.id === sig.rule)!;
      candidates.push({ title: titleForSignal(sig), ruleId: sig.rule, impact: BASELINE_IMPACT[sig.rule] ?? 'medium', observed: describeSignal(sig), scenario, actor: t.actor, device: t.device, source: 'detector' });
      detectorCandidates++;
      await ev('finding.candidate', { title: titleForSignal(sig), ruleId: rule.id, kind: 'trace', source: 'detector' });
    }
    return notes;
  };

  const recordState = async (o: Observation, label: string, actionId: string | null): Promise<boolean> => {
    coverage.observe(o);
    const path = new URL(o.url).pathname;
    const labels = recorded.labelsByPath.get(path) ?? new Set<string>();
    for (const e of o.elements) if ((e.kind === 'input' || e.kind === 'textarea' || e.kind === 'select') && e.label) labels.add(e.label);
    recorded.labelsByPath.set(path, labels);
    const controls = recorded.controlsByPath.get(path) ?? new Set<string>();
    for (const e of o.elements) if ((e.kind === 'button' || e.kind === 'link') && e.label) controls.add(e.label);
    recorded.controlsByPath.set(path, controls);
    const { fingerprint, route } = stateFingerprint(o, session.actor, session.device);
    const ins = await db.query<{ id: string; inserted: boolean }>(
      `INSERT INTO graph_states (run_id, fingerprint, route, title, actor, device) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (run_id, fingerprint) DO UPDATE SET title = graph_states.title RETURNING id, (xmax = 0) AS inserted`,
      [runId, fingerprint, route, o.headings[0] ?? o.title, session.actor, session.device]);
    const stateId = ins.rows[0]!.id;
    if (ins.rows[0]!.inserted) await ev('state.discovered', { stateId, route, title: o.headings[0] ?? o.title, actor: session.actor, device: session.device });
    if (previousState && previousState !== stateId) {
      const t = await db.query(`INSERT INTO graph_transitions (run_id, from_state, to_state, action_id, label) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (run_id, from_state, to_state, label) DO NOTHING RETURNING id`, [runId, previousState, stateId, actionId, label.slice(0, 120)]);
      if (t.rowCount) await ev('transition.observed', { from: previousState, to: stateId, label: label.slice(0, 120) });
    }
    previousState = stateId;
    return ins.rows[0]!.inserted;
  };

  const runBrowserAction = async (tool: ToolName, args: Record<string, any>, describe: string, fn: () => Promise<void>, opts: { quiet?: boolean; stated?: string } = {}): Promise<string> => {
    if (actions >= LIMITS.browserActionsPerRun) throw new LimitReached('limit_actions');
    const wait = LIMITS.minActionIntervalMs - (Date.now() - lastActionAt);
    if (wait > 0) await sleep(wait);
    await assertLease(db, runId, generation); // fence check before dispatch
    const page = await session.page();
    const ledgerArgs = { ...args }; // values typed into fields are kept; secrets never reach this object
    const ins = await db.query<{ id: string }>(
      `INSERT INTO actions (run_id, seq, generation, actor, device, tool, args, state, url_before) VALUES ($1,$2,$3,$4,$5,$6,$7,'intended',$8) RETURNING id`,
      [runId, ++seq, generation, session.actor, session.device, tool, JSON.stringify(ledgerArgs), redactUrl(page.url())]);
    const actionId = ins.rows[0]!.id;
    await db.query(`UPDATE actions SET state = 'dispatched' WHERE id = $1`, [actionId]);
    await ev('action.started', { actionId, seq, tool, description: describe, actor: session.actor, device: session.device });
    actions++; lastActionAt = Date.now();
    const mySeq = seq;
    const step = toStep(tool, args);
    const urlBeforePath = (() => { try { const u = new URL(page.url()); return `${u.pathname}${u.search}`; } catch { return '/'; } })();
    const actedOn = session.turnObservation; // the snapshot whose refs this action used
    let error: string | null = null;
    try { await fn(); } catch (e) { error = (e as Error).message.split('\n')[0]!.slice(0, 240); }
    if (!error && actedOn) {
      const refs = [args.ref, args.target, ...(Array.isArray(args.fields) ? args.fields.map((f: { ref?: string }) => f.ref) : [])];
      for (const r of refs) if (typeof r === 'string') coverage.exercise(actedOn, r);
    }
    stepLog.push({ seq: mySeq, ctx: `${session.actor}:${session.device}`, device: session.device, actor: session.actor, urlBefore: urlBeforePath, step: error ? null : step });
    const left = await session.enforceMainFrameOrigin();
    if (left) await ev('scope.denied', { url: redactUrl(left), reason: 'main_frame_left_verified_origin', recovered: true });
    const after = (await session.page()).url();
    await db.query(`UPDATE actions SET state = $2, result = $3, url_after = $4, completed_at = now() WHERE id = $1`,
      [actionId, error ? 'failed' : 'succeeded', JSON.stringify({ error }), redactUrl(after)]);
    await ev('action.finished', { actionId, seq: mySeq, tool, description: describe, ok: !error, error, url: redactUrl(after) });
    const drained = await session.drainSignals();
    const notes = await handleSignals(tool, mySeq, drained);
    const dialogs = session.drainDialogs();
    if (dialogs.length) await ev('dialog.dismissed', { seq: mySeq, dialogs });
    const o = await session.observe();
    const newState = await recordState(o, describe, actionId);
    lastStep = { seq: mySeq, error, notes, scopeBlocked: drained.scopeBlocked, ownScopeBlocked: drained.ownScopeBlocked, dialogs, newState, obs: o, stated: opts.stated };
    const head = `${error ? `#${mySeq} FAILED: ${error}` : `#${mySeq} OK`}${notes.length ? `\n${notes.join('\n')}` : ''}${dialogs.length ? `\nDIALOG (dismissed by Oddhound): ${dialogs.join(' | ')}` : ''}`;
    if (opts.quiet ?? quietSteps) return head;
    return `${head}\n${formatObservation(o)}\n${statusLine()}`;
  };

  /** One line of budget and plan state, appended to each observation so the model can pace itself. */
  const statusLine = () => {
    const open = [...plan.values()].filter((c) => c.status === 'not_run' || c.status === 'testing');
    const urgent = open.filter((c) => c.risk === 'critical' || c.risk === 'high').length;
    const cov = coverage.summary(0);
    return `[budget: turn ${turns}/${LIMITS.modelTurnsPerRun}, action ${actions}/${LIMITS.browserActionsPerRun}; plan: ${plan.size ? `${plan.size - open.length}/${plan.size} charters done, ${urgent} critical/high open` : 'none yet - call plan_tests after recon'}; findings so far: ${candidates.length}; controls exercised: ${cov.exercised}/${cov.total}]`;
  };

  const dispatch = async (call: ToolCall): Promise<{ text: string; image?: Buffer }> => {
    const name = call.function.name as ToolName;
    const schema = ToolArgs[name];
    if (!schema) return { text: `Unknown tool "${call.function.name}".` };
    if (!toolOffered(mode, name)) return { text: `Tool "${name}" is not available in this run.` };
    let raw: unknown;
    try { raw = JSON.parse(call.function.arguments || '{}'); } catch { return { text: 'Invalid JSON arguments.' }; }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { text: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 400)}` };
    const args = parsed.data as Record<string, any>;

    switch (name) {
      case 'observe': {
        await assertLease(db, runId, generation);
        const o = await session.observe();
        await recordState(o, 'observe', null);
        if (args.screenshot) return { text: formatObservation(o), image: await session.screenshot() };
        return { text: formatObservation(o) };
      }
      case 'boundary_values':
        return { text: JSON.stringify(boundaryValues(args.kind, args.min, args.max)) };
      case 'create_identity': {
        if (!contract.registration.allowed || !contract.capabilities.register) return { text: 'Registration is not permitted by this run contract.' };
        if (identities.length >= contract.registration.maxIdentities) return { text: `Identity limit reached (${contract.registration.maxIdentities} per run). Reuse an existing identity.` };
        const ident = syntheticIdentity(runId, identities.length + 1, contract.registration.emailDomain);
        const ref = await storeCredential(db, { runId, label: `generated identity ${identities.length + 1}`, username: ident.email, secret: ident.password, generated: true });
        secrets.add(ident.password);
        identities.push({ ref, name: ident.name, email: ident.email });
        await ev('identity.created', { credentialRef: ref, email: ident.email });
        return { text: JSON.stringify({ credential_ref: ref, name: ident.name, email: ident.email, note: 'Use fill for name/email and fill_credential(field="password") for the password.' }) };
      }
      case 'update_workflow': {
        await db.query(`INSERT INTO workflows (run_id, name, status, summary) VALUES ($1,$2,$3,$4)
          ON CONFLICT (run_id, name) DO UPDATE SET status = EXCLUDED.status, summary = EXCLUDED.summary, updated_at = now()`, [runId, args.name, args.status, args.summary]);
        await ev('workflow.updated', { name: args.name, status: args.status, summary: args.summary });
        return { text: 'Workflow updated.' };
      }
      case 'plan_tests': {
        for (const c of args.charters as Charter[]) plan.set(c.id, { ...plan.get(c.id), ...c });
        const all = [...plan.values()];
        await ev('plan.updated', {
          charters: all.map((c) => ({ id: c.id, area: c.area, risk: c.risk, technique: c.technique, status: c.status, note: c.note ?? null })),
        });
        return { text: `Plan has ${all.length} charter(s): ${all.map((c) => `${c.id} ${c.risk} ${c.status}`).join(', ')}.` };
      }
      case 'do_steps': {
        const lines: string[] = [];
        quietSteps = true;
        try {
          for (const [i, st] of (args.steps as { tool: ToolName }[]).entries()) {
            const { tool, ...rest } = st as { tool: ToolName } & Record<string, unknown>;
            const out = await dispatch({ id: `${call.id}:${i}`, type: 'function', function: { name: tool, arguments: JSON.stringify(rest) } } as ToolCall);
            lines.push(`step ${i + 1} ${tool}: ${out.text.split('\n').join(' | ').slice(0, 400)}`);
            if (/FAILED|not |Invalid|denied|Unknown|no longer/i.test(out.text.split('\n')[0] ?? '')) { lines.push(`Stopped after step ${i + 1}.`); break; }
          }
        } finally { quietSteps = false; }
        await assertLease(db, runId, generation);
        const o = await session.observe();
        await recordState(o, 'do_steps', null);
        return { text: `${lines.join('\n')}\n${formatObservation(o)}\n${statusLine()}` };
      }
      case 'run_scenario_batch': {
        const modelObs = session.turnObservation;
        if (!modelObs) return { text: 'Observe the page first.' };
        const steps = args.steps as BatchStep[];
        const no = batches.size + 1;
        const rec: BatchRecord = { no, goal: args.goal, steps: [] };
        batches.set(no, rec);
        await ev('batch.started', { batch: no, goal: args.goal, steps: steps.length });
        let rebased = false;
        // Refs come from the observation the model planned from. After the page changes, the same
        // control is found again only when exactly one element has the same kind, label, name and type.
        const resolveRef = async (r: string): Promise<string | { error: string }> => {
          const want = modelObs.elements.find((e) => e.ref === r);
          if (!want) return { error: `${r} is not in the observation this batch was planned from` };
          if (!rebased && await session.hasRef(r)) return r;
          const cur = await session.observe();
          const same = cur.elements.filter((e) => e.kind === want.kind && e.label === want.label && (e.name ?? '') === (want.name ?? '') && (e.type ?? '') === (want.type ?? ''));
          if (same.length !== 1) return { error: `${want.kind} "${want.label}" is ${same.length ? 'ambiguous' : 'no longer on the page'} after the page changed` };
          session.beginTurn(); rebased = true;
          return same[0]!.ref;
        };
        const lines: string[] = [];
        let surprise: string | null = null;
        quietSteps = true;
        try {
          for (const [i, st] of steps.entries()) {
            if (actions >= LIMITS.browserActionsPerRun - 1 || Date.now() > expiresAt - verificationReserveMs()) {
              surprise = 'budget threshold reached'; lines.push(`step ${i + 1}: not run (${surprise})`); break;
            }
            const { tool, expect, ...rest } = st as BatchStep & Record<string, any>;
            const callArgs: Record<string, unknown> = { ...rest };
            let refError: string | null = null;
            for (const k of ['ref', 'target'] as const) {
              if (typeof rest[k] !== 'string') continue;
              const r = await resolveRef(rest[k]);
              if (typeof r !== 'string') { refError = r.error; break; }
              callArgs[k] = r;
            }
            if (refError) { surprise = 'stale element'; lines.push(`step ${i + 1} ${tool}: not run (${refError})`); break; }
            const pathBefore = new URL((await session.page()).url()).pathname;
            lastStep = null;
            const out = await dispatch({ id: `${call.id}:b${i}`, type: 'function', function: { name: tool, arguments: JSON.stringify(callArgs) } } as ToolCall);
            const info = lastStep as StepInfo | null;
            if (!info) { surprise = 'step refused'; lines.push(`step ${i + 1} ${tool}: refused: ${out.text.split('\n')[0]!.slice(0, 200)}`); break; }
            const recStep: BatchRecord['steps'][number] = { seq: info.seq, ...(expect ? { expect } : {}), ...(info.stated ? { stated: info.stated } : {}) };
            rec.steps.push(recStep);
            let line = `step ${i + 1} ${tool} #${info.seq}: ${info.error ? `FAILED: ${info.error}` : 'ok'}${info.stated ? ` (value from stated ${info.stated})` : ''}`;
            if (info.error) surprise = 'a step failed';
            if (info.notes.length) { line += ` | ${info.notes.join(' | ')}`; surprise ??= 'Oddhound detected a problem'; }
            if (info.dialogs.length) { line += ` | dialog dismissed: ${info.dialogs.join(' | ')}`; surprise ??= 'a dialog opened'; }
            // A blocked request to the verified site, or a blocked navigation, changes what the step did. Blocked
            // third-party writes (analytics beacons, injected scripts) are enforced and logged but routine.
            if (info.ownScopeBlocked) { line += ' | a request to the site was blocked by the scope policy'; surprise ??= 'policy block'; }
            else if (info.scopeBlocked) line += ' | a third-party request was blocked (logged; not a surprise)';
            if (expect && !info.error) {
              const v = judgeExpectation(expect, await pageFacts(await session.page(), pathBefore, info.obs));
              recStep.ok = v.ok;
              line += v.ok ? ` | expectation held: ${v.detail}` : ` | EXPECTATION ${v.unclear ? 'UNDECIDED' : 'FAILED'}: ${v.detail}`;
              if (!v.ok) surprise ??= v.unclear ? 'an expectation could not be judged' : 'an expectation failed';
              await ev('batch.expectation', { batch: no, step: i + 1, seq: info.seq, ok: v.ok, unclear: v.unclear, detail: v.detail.slice(0, 300) });
            } else if (!expect && info.newState && i < steps.length - 1) {
              line += ' | reached a page state not seen before';
              surprise ??= 'new page state without an expectation';
            }
            lines.push(line);
            if (surprise) break;
          }
        } finally { quietSteps = false; }
        await assertLease(db, runId, generation);
        const o = await session.observe();
        await recordState(o, `batch ${no}`, null);
        await ev('batch.finished', { batch: no, goal: args.goal, ran: rec.steps.length, planned: steps.length, surprise });
        const head = surprise
          ? `Batch ${no} stopped at a surprise (${surprise}) after ${rec.steps.length} of ${steps.length} step(s).`
          : `Batch ${no} ran all ${steps.length} step(s) as expected.`;
        const hint = rec.steps.some((x) => x.ok === false)
          ? `\nIf a failed expectation breaks an owner or baseline rule, report it: report_candidate with scenario {"kind":"batch","batch":${no},"step":<step number>}.` : '';
        return { text: `${head}\n${lines.join('\n')}${hint}\n${formatObservation(o)}\n${statusLine()}` };
      }
      case 'report_candidate': {
        if (args.scenario.kind === 'batch' && 'steps' in args.scenario) {
          return { text: 'Do not write batch steps yourself. Give {"kind":"batch","batch":N,"step":K}; Oddhound builds the steps from its own record.' };
        }
        if (args.scenario.kind === 'batch' && 'batch' in args.scenario) {
          const rec = batches.get(args.scenario.batch);
          if (!rec) return { text: `Candidate NOT recorded: there is no batch ${args.scenario.batch} in this run.` };
          const k = args.scenario.step as number;
          if (k > rec.steps.length) return { text: `Candidate NOT recorded: batch ${rec.no} ran only ${rec.steps.length} step(s).` };
          if (!rec.steps[k - 1]!.expect) return { text: `Candidate NOT recorded: step ${k} of batch ${rec.no} has no expectation to check. Report a trace instead.` };
          const logs = rec.steps.slice(0, k).map((st) => stepLog.find((l) => l.seq === st.seq));
          if (logs.some((l) => !l?.step)) return { text: 'Candidate NOT recorded: some of those steps cannot be replayed (an element without a visible label, or a failed step).' };
          if (new Set(logs.map((l) => l!.ctx)).size > 1) return { text: 'Candidate NOT recorded: the steps switch actor or device.' };
          let steps = logs.map((l, i) => ({ step: l!.step!, ...(rec.steps[i]!.expect ? { expect: rec.steps[i]!.expect } : {}) }));
          let start = logs[0]!.urlBefore;
          let oracleStep = k;
          const first = steps[0]!.step;
          if (steps.length > 1 && first.op === 'goto' && !steps[0]!.expect) { start = first.path; steps = steps.slice(1); oracleStep--; }
          const usesPassword = steps.some((x) => x.step.op === 'fill' && x.step.value === '{password}');
          const auth = recorded.auth && !usesPassword ? recorded.auth : undefined;
          const scenario: Scenario = { kind: 'batch', device: logs[0]!.device, ...(auth ? { auth } : {}), start, steps, oracleStep };
          const stated = [...new Set(rec.steps.slice(0, k).map((x) => x.stated).filter(Boolean))].join(', ') || undefined;
          const knownRule = contract.rules.some((r) => r.id === args.rule_id) || BASELINE_RULES.some((r) => r.id === args.rule_id);
          candidates.push({ title: args.title, ruleId: args.rule_id, impact: args.impact, observed: args.observed, scenario, actor: logs[0]!.actor, device: logs[0]!.device, source: 'agent', ...(stated ? { stated } : {}) });
          await ev('finding.candidate', { title: args.title, ruleId: args.rule_id, kind: 'batch', source: 'agent', steps: steps.length, batch: rec.no });
          return { text: knownRule ? `Candidate recorded (batch ${rec.no}, ${steps.length} replay steps from ${start}, step ${oracleStep} is the check). Oddhound will replay it in a fresh session.` : `Recorded as needs-review: "${args.rule_id}" is not an owner or baseline rule.` };
        }
        if (args.scenario.kind === 'trace' && 'steps' in args.scenario) {
          return { text: 'Do not write trace steps yourself. Give from_seq and to_seq (the #N action numbers) and an oracle; Oddhound builds the steps from its own record.' };
        }
        if (args.scenario.kind === 'trace') {
          const t = traceFor(args.scenario.to_seq, args.scenario.from_seq);
          if (typeof t === 'string') return { text: `Candidate NOT recorded: ${t}` };
          const auth = recorded.auth && !t.usesPassword ? recorded.auth : undefined;
          const scenario: Scenario = { kind: 'trace', device: t.device, ...(auth ? { auth } : {}), start: t.start, steps: t.steps, oracle: args.scenario.oracle };
          const knownRule = contract.rules.some((r) => r.id === args.rule_id) || BASELINE_RULES.some((r) => r.id === args.rule_id);
          candidates.push({ title: args.title, ruleId: args.rule_id, impact: args.impact, observed: args.observed, scenario, actor: t.actor, device: t.device, source: 'agent' });
          await ev('finding.candidate', { title: args.title, ruleId: args.rule_id, kind: 'trace', source: 'agent', steps: t.steps.length });
          return { text: knownRule ? `Candidate recorded (${t.steps.length} replay steps from ${t.start}). Oddhound will replay it in a fresh session.` : `Recorded as needs-review: "${args.rule_id}" is not an owner or baseline rule.` };
        }
        const known = contract.rules.some((r) => r.id === args.rule_id) || BASELINE_RULES.some((r) => r.id === args.rule_id);
        // Ground the scenario in what Oddhound actually observed, then reject anything still unknown,
        // telling the model the real labels so it can correct the report in its next turn.
        const grounded = groundCandidate({ title: args.title, ruleId: args.rule_id, impact: args.impact, observed: args.observed, scenario: args.scenario, controlValues: args.control_values, actor: session.actor, device: session.device }, recorded);
        const problems = scenarioProblems(grounded, recorded);
        if (problems.length) {
          await ev('finding.candidate_rejected', { title: args.title, problems });
          return { text: `Candidate NOT recorded. Fix and call report_candidate again:\n- ${problems.join('\n- ')}` };
        }
        candidates.push({ ...grounded, source: 'agent' });
        await ev('finding.candidate', { title: args.title, ruleId: args.rule_id, kind: args.scenario.kind, knownRule: known, source: 'agent' });
        return { text: known ? 'Candidate recorded. Oddhound will replay it independently after exploration.' : `Recorded as needs-review: "${args.rule_id}" is not an owner or baseline rule, so it cannot be verified against a rule.` };
      }
      case 'finish_run': {
        // A tester does not stop while high-risk charters are untested and budget remains.
        const open = [...plan.values()].filter((c) => (c.status === 'not_run' || c.status === 'testing') && (c.risk === 'critical' || c.risk === 'high'));
        const budgetLeft = turns < LIMITS.modelTurnsPerRun - 8 && actions < LIMITS.browserActionsPerRun - 30 && Date.now() < expiresAt - verificationReserveMs() - 60_000;
        if (open.length && budgetLeft && finishRefusals < 2) {
          finishRefusals++;
          await ev('finish.refused', { open: open.map((c) => c.id) });
          return { text: `Not yet: ${open.length} critical/high charter(s) are untested (${open.map((c) => `${c.id} ${c.area}`).join('; ')}) and budget remains. Test them, or mark them blocked with a reason via plan_tests.` };
        }
        finished = args.summary;
        return { text: 'Finishing.' };
      }
    }

    if (!BROWSER_TOOLS.has(name)) return { text: 'Tool not available.' };
    const writesOk = contract.testMode === 'active';
    switch (name) {
      case 'navigate': {
        const target = new URL(args.path, session.origin);
        if (target.origin !== session.origin) return { text: 'Navigation outside the verified site is not allowed.' };
        if (contract.deniedPathPrefixes.some((p) => target.pathname.startsWith(p))) return { text: 'That path is denied by the run contract.' };
        const word = pathHasDeniedKeyword(target.pathname, contract.deniedPathKeywords);
        if (word) return { text: `That path is denied by the run contract (blocked word "${word}").` };
        return { text: await runBrowserAction(name, args, `Opened ${target.pathname}`, async () => { await (await session.page()).goto(target.toString(), { waitUntil: 'domcontentloaded' }); }) };
      }
      case 'click': {
        const loc = await session.locate(args.ref).catch((e: Error) => e);
        if (loc instanceof Error) return { text: loc.message };
        const clickedLabel = session.labelOf(args.ref);
        const text = await runBrowserAction(name, args, `Clicked ${session.describe(args.ref)}`, async () => { await loc.click({ timeout: 5_000 }); await (await session.page()).waitForLoadState('domcontentloaded'); });
        if (pendingAuth && clickedLabel && Object.values(pendingAuth.fields).includes('{password}') && !recorded.auth) {
          const o = session.lastObservation;
          const landed = o ? new URL(o.url).pathname : pendingAuth.path;
          if (o && landed !== pendingAuth.path && !o.alerts.some((a) => /error|invalid|required|already/i.test(a))) {
            const signOut = o.elements.find((e) => /log ?out|sign ?out/i.test(e.label));
            recorded.auth = { kind: 'register', path: pendingAuth.path, fields: pendingAuth.fields, submit: clickedLabel, successText: signOut?.label ?? o.headings[0] ?? o.title };
            await ev('recipe.recorded', { kind: 'register', path: pendingAuth.path, fields: Object.keys(pendingAuth.fields), successText: recorded.auth.successText });
            // Oddhound itself observed a completed sign-up, so it records the workflow (not just the model's naming).
            await db.query(`INSERT INTO workflows (run_id, name, status, summary) VALUES ($1,'Registration','completed',$2)
              ON CONFLICT (run_id, name) DO UPDATE SET status = 'completed', updated_at = now()`, [runId, `Signed up a synthetic account at ${pendingAuth.path} and reached "${recorded.auth.successText}" (recorded by Oddhound).`]);
            await ev('workflow.updated', { name: 'Registration', status: 'completed', summary: `Sign-up at ${pendingAuth.path} recorded by Oddhound` });
          }
          pendingAuth = null;
        }
        return { text };
      }
      case 'fill': {
        if ([...secrets].some((s) => args.value.includes(s))) return { text: 'Use fill_credential for secrets.' };
        const loc = await session.locate(args.ref).catch((e: Error) => e);
        if (loc instanceof Error) return { text: loc.message };
        let stated: string | undefined;
        if (isBoundaryTemplate(args.value)) {
          // The value is computed in code from the rule this field states; nothing edits the page.
          const el = session.elementOf(args.ref);
          const b = el ? resolveBoundary(args.value, el) : { error: `${args.ref} is not in the latest observation` };
          if ('error' in b) return { text: `Cannot use ${args.value}: ${b.error}.` };
          if (b.stated) stated = `${b.stated} on ${JSON.stringify(el!.label || el!.name || args.ref)}`;
          args.template = args.value;
          args.value = b.value;
        }
        if ((await loc.getAttribute('type')) === 'password') return { text: 'Use fill_credential for password fields.' };
        const ident = identities.find((i) => i.name === args.value || i.email === args.value);
        const label = session.labelOf(args.ref);
        if (ident && label) {
          pendingAuth ??= { path: new URL((await session.page()).url()).pathname, fields: {} };
          pendingAuth.fields[label] = ident.name === args.value ? '{name}' : '{email}';
        }
        const shown = args.template ? `${args.template} (${args.value.length > 40 ? `${args.value.length} characters` : JSON.stringify(args.value)})` : JSON.stringify(args.value.slice(0, 40));
        return { text: await runBrowserAction(name, args, `Typed ${shown} into ${session.describe(args.ref)}`, async () => { await loc.fill(args.value, { timeout: 5_000 }); }, { stated }) };
      }
      case 'fill_credential': {
        const allowed = identities.some((i) => i.ref === args.credential_ref) || contract.accounts.some((acc) => acc.ref === args.credential_ref);
        if (!allowed) return { text: 'Unknown credential reference for this run.' };
        const cred = await resolveCredential(db, args.credential_ref);
        if (!cred) return { text: 'Credential not found.' };
        secrets.add(cred.secret);
        const loc = await session.locate(args.ref).catch((e: Error) => e);
        if (loc instanceof Error) return { text: loc.message };
        const value = args.field === 'password' ? cred.secret : cred.username;
        const credLabel = session.labelOf(args.ref);
        if (identities.some((i) => i.ref === args.credential_ref) && credLabel) {
          pendingAuth ??= { path: new URL((await session.page()).url()).pathname, fields: {} };
          pendingAuth.fields[credLabel] = args.field === 'password' ? '{password}' : '{email}';
        }
        return { text: await runBrowserAction(name, { ref: args.ref, credential_ref: args.credential_ref, field: args.field }, `Filled ${args.field} for ${cred.label} into ${session.describe(args.ref)}`, async () => { await loc.fill(value, { timeout: 5_000 }); }) };
      }
      case 'fill_form': {
        // Several fills as ONE ledgered action (spec §8: batch safe fills; the submit stays a separate click).
        const steps: { label: string | null; loc: Awaited<ReturnType<RunSession['locate']>>; value: string; shown: string }[] = [];
        const page = await session.page();
        for (const f of args.fields as ({ ref: string; value: string } | { ref: string; credential_ref: string; field: 'username' | 'password' })[]) {
          const loc = await session.locate(f.ref).catch((e: Error) => e);
          if (loc instanceof Error) return { text: loc.message };
          const label = session.labelOf(f.ref);
          if ('credential_ref' in f) {
            const allowed = identities.some((i) => i.ref === f.credential_ref) || contract.accounts.some((acc) => acc.ref === f.credential_ref);
            const cred = allowed ? await resolveCredential(db, f.credential_ref) : null;
            if (!cred) return { text: `Unknown credential reference ${f.credential_ref} for this run.` };
            secrets.add(cred.secret);
            if (identities.some((i) => i.ref === f.credential_ref) && label) {
              pendingAuth ??= { path: new URL(page.url()).pathname, fields: {} };
              pendingAuth.fields[label] = f.field === 'password' ? '{password}' : '{email}';
            }
            steps.push({ label, loc, value: f.field === 'password' ? cred.secret : cred.username, shown: `${label ?? f.ref}=[${f.field} from ${cred.label}]` });
          } else {
            if ([...secrets].some((x) => f.value.includes(x))) return { text: 'Use credential_ref entries for secrets.' };
            if ((await loc.getAttribute('type')) === 'password') return { text: 'Use a credential_ref entry for password fields.' };
            const ident = identities.find((i) => i.name === f.value || i.email === f.value);
            if (ident && label) {
              pendingAuth ??= { path: new URL(page.url()).pathname, fields: {} };
              pendingAuth.fields[label] = ident.name === f.value ? '{name}' : '{email}';
            }
            steps.push({ label, loc, value: f.value, shown: `${label ?? f.ref}=${JSON.stringify(f.value.slice(0, 30))}` });
          }
        }
        const ledgerArgs = { fields: (args.fields as Record<string, unknown>[]).map((f) => ('credential_ref' in f ? { ref: f.ref, credential_ref: f.credential_ref, field: f.field } : f)) };
        return { text: await runBrowserAction(name, ledgerArgs, `Filled ${steps.map((x) => x.shown).join(', ')}`.slice(0, 300), async () => {
          for (const st of steps) await st.loc.fill(st.value, { timeout: 5_000 });
        }) };
      }
      case 'drag': {
        const from = await session.locate(args.ref).catch((e: Error) => e);
        if (from instanceof Error) return { text: from.message };
        const to = await session.locate(args.target).catch((e: Error) => e);
        if (to instanceof Error) return { text: to.message };
        return { text: await runBrowserAction(name, args, `Dragged ${session.describe(args.ref)} onto ${session.describe(args.target)}`, async () => {
          await from.dragTo(to, { timeout: 5_000 });
          await (await session.page()).waitForLoadState('domcontentloaded');
        }) };
      }
      case 'select_option': {
        const loc = await session.locate(args.ref).catch((e: Error) => e);
        if (loc instanceof Error) return { text: loc.message };
        return { text: await runBrowserAction(name, args, `Selected ${JSON.stringify(args.value)} in ${session.describe(args.ref)}`, async () => { await loc.selectOption(args.value, { timeout: 5_000 }); }) };
      }
      case 'press_key':
        return { text: await runBrowserAction(name, args, `Pressed ${args.key}`, async () => { await (await session.page()).keyboard.press(args.key === 'Space' ? ' ' : args.key); }) };
      case 'scroll':
        return { text: await runBrowserAction(name, args, `Scrolled ${args.to}`, async () => {
          const page = await session.page();
          await page.evaluate((to) => {
            const y = to === 'top' ? 0 : to === 'bottom' ? document.documentElement.scrollHeight : window.scrollY + (to === 'down' ? 1 : -1) * window.innerHeight * 0.8;
            window.scrollTo(0, y);
          }, args.to);
        }) };
      case 'go_back':
        return { text: await runBrowserAction(name, args, 'Went back', async () => { await (await session.page()).goBack({ waitUntil: 'domcontentloaded' }); }) };
      case 'set_device': {
        if (!contract.devices.includes(args.device)) return { text: `Device ${args.device} is not enabled for this run.` };
        const text = await runBrowserAction(name, args, `Switched to ${args.device}`, async () => { await session.setDevice(args.device); });
        return args.device === 'mobile' ? { text, image: await session.screenshot() } : { text };
      }
      case 'use_actor': {
        if (args.actor === 'B' && !contract.capabilities.crossAccountRead) return { text: 'A second actor is not permitted by this run contract.' };
        return { text: await runBrowserAction(name, args, `Switched to actor ${args.actor}`, async () => { await session.useActor(args.actor); }) };
      }
    }
    void writesOk;
    return { text: 'Tool not available.' };
  };

  try {
    while (!finished) {
      if (turns >= LIMITS.modelTurnsPerRun) return { stopReason: 'limit_turns' };
      // Keep enough time for the independent replays of what was found.
      if (Date.now() > expiresAt - verificationReserveMs()) {
        await ev('run.time_reserved', { reason: 'exploration stopped to leave time for verification', candidates: candidates.length });
        return { stopReason: 'time_reserved_for_verification' };
      }
      await assertLease(db, runId, generation);
      // History is append-only so the provider's prompt cache keeps hitting (cached input costs ~8x
      // less). When it grows large, it is replaced once by a compact notebook built by Oddhound.
      if (inputTokenBound(messages, toolsJson) > NOTEBOOK_THRESHOLD_TOKENS) {
        const fresh = notebookMessages(contract, mode, notebook());
        messages.splice(0, messages.length, ...fresh);
        await ev('model.context_rebased', { turn: turns });
      }
      const bound = inputTokenBound(messages, toolsJson);
      const reserve = reservationMicros(price, bound, LIMITS.maxOutputTokens);
      const requestKey = `${runId}:turn:${turns}`;
      const r = await reserveSpend(db, { runId, account: a.run.spend_account, requestKey, micros: reserve, provider: provider.id, model: provider.model });
      if (!r.ok) { await ev('budget.denied', { reason: r.reason, attemptedMicros: reserve }); return { stopReason: `budget_${r.reason}` }; }
      let result;
      try {
        // Meta intermittently answers `model_not_found` (HTTP 404, not billed) from some cloud networks
        // while the same model works moments later. Retry only that answer, a bounded number of times,
        // and log every attempt (spec: retries are explicit, never hidden).
        for (let attempt = 1; ; attempt++) {
          try {
            result = await provider.chat({ messages, tools, maxOutputTokens: LIMITS.maxOutputTokens, temperature: 0.2, signal: abort.signal });
            break;
          } catch (e) {
            const transient = e instanceof ProviderError && e.status === 404 && !e.maybeBilled && /model_not_found/.test(e.message);
            if (!transient || attempt >= 8 || abort.signal.aborted) throw e;
            await ev('provider.retry', { provider: provider.id, attempt, reason: 'model_not_found', billed: false });
            await sleep(Math.min(4_000, 600 * attempt));
          }
        }
      } catch (e) {
        if (e instanceof ProviderError && e.maybeBilled) await markSpendUnknown(db, requestKey); else await releaseSpend(db, requestKey);
        if (abort.signal.aborted) throw new FencedError('stop_or_expiry_during_inference');
        await ev('provider.error', { provider: provider.id, kind: e instanceof ProviderError ? e.kind : 'unknown', message: (e as Error).message.slice(0, 200) });
        return { stopReason: 'provider_error' };
      }
      const cost = result.usage ? actualMicros(price, result.usage) : reserve; // unknown usage is charged at the reservation
      await settleSpend(db, requestKey, Math.min(cost, reserve), result.usage);
      if (cost > reserve) await ev('budget.overrun', { reservedMicros: reserve, actualMicros: cost });
      turns++;
      await ev('model.turn', { turn: turns, provider: provider.id, model: result.model, usage: result.usage, costMicros: cost, requestId: result.requestId, toolCalls: result.message.tool_calls?.map((t) => t.function.name) ?? [] });
      messages.push(result.message); // replay exactly as returned
      const calls = result.message.tool_calls ?? [];
      if (result.finishReason === 'length') await ev('model.truncated', { turn: turns, usage: result.usage });
      if (!calls.length) {
        if (++nudges > 2) return { stopReason: 'model_stopped_without_tools' };
        messages.push({ role: 'user', content: 'Continue by calling a tool: work on the next open charter in your test plan, or call finish_run if the plan is done.' });
        continue;
      }
      const images: Buffer[] = [];
      session.beginTurn();
      for (const call of calls) {
        if (finished) { messages.push({ role: 'tool', tool_call_id: call.id, content: 'Skipped: run is finishing.' }); continue; }
        let out: { text: string; image?: Buffer };
        try { out = await dispatch(call); }
        catch (e) {
          if (e instanceof LimitReached) { messages.push({ role: 'tool', tool_call_id: call.id, content: 'Action limit reached.' }); return { stopReason: e.reason }; }
          throw e;
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: out.text });
        if (out.image) images.push(out.image);
      }
      await emitCoverage();
      if (a.deps.explorationSpendCapMicros && !finished && (await runSpend(db, runId)).settled >= a.deps.explorationSpendCapMicros) {
        await ev('budget.denied', { reason: 'exploration_spend_cap', capMicros: a.deps.explorationSpendCapMicros });
        return { stopReason: 'budget_exploration_cap' };
      }
      const left = LIMITS.modelTurnsPerRun - turns;
      if (left <= 5 && !finished) {
        // Budget awareness: tell the model to report what it found and wrap up before the hard limit.
        messages.push({ role: 'user', content: `Only ${left} model turn(s) left. Report any rule violations now with report_candidate, then call finish_run with a factual summary of what you covered.` });
      }
      if (images.length) {
        messages.push({ role: 'user', content: [
          { type: 'text', text: 'Screenshot for the tool result above (current viewport).' },
          ...images.slice(0, 2).map((b) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${b.toString('base64')}` } })),
        ] });
        for (const img of images.slice(0, 2)) await saveArtifact(db, runId, 'screenshot', 'image/jpeg', img, 'model-requested screenshot').catch(() => {});
      }
    }
    await ev('run.summary', { summary: finished });
    return { summary: finished };
  } finally {
    // The caller destroys the browser. Record the final coverage of observed states.
    await emitCoverage().catch(() => {});
  }
}

class LimitReached extends Error { readonly reason: string; constructor(reason: string) { super(reason); this.reason = reason; } }

/** Above this many input tokens the conversation is replaced by Oddhound's notebook. */
const NOTEBOOK_THRESHOLD_TOKENS = 22_000;

/** A fresh conversation: the same system prompt (still cached) plus the notebook. */
function notebookMessages(contract: RunContract, mode: AgentMode, notebook: string): ChatMessage[] {
  return [{ role: 'system', content: systemPrompt(contract, mode) }, { role: 'user', content: notebook }];
}

function titleForSignal(s: Signal): string {
  switch (s.kind) {
    case 'http_5xx': return `Server error (HTTP ${s.status}) on ${s.method} ${s.route}`;
    case 'page_error': return `Uncaught JavaScript error: ${s.message.slice(0, 80)}`;
    case 'markup_rendered': return `Typed HTML is rendered as markup on ${s.path.split('?')[0]}`;
    case 'error_text': return `Internal error details shown on ${s.path.split('?')[0]}`;
    case 'mobile_overflow': return `Page scrolls sideways on a phone: ${s.path.split('?')[0]}`;
    case 'http_404': return `Broken link: ${s.route} does not exist`;
  }
}

// ---------------------------------------------------------------------------------------------
// Grounding: replace what the model remembered with what Oddhound actually recorded.

function closestLabel(key: string, observed: Set<string> | undefined): string {
  if (!observed || observed.has(key)) return key;
  const k = key.toLowerCase().trim();
  const hits = [...observed].filter((l) => { const x = l.toLowerCase(); return x === k || x.includes(k) || k.includes(x); });
  return hits.length === 1 ? hits[0]! : key; // only substitute when the match is unambiguous
}

function groundFields(fields: Record<string, string>, observed: Set<string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [closestLabel(k, observed), v]));
}

export function groundCandidate(c: Candidate, recorded: Recorded): Candidate {
  const s = structuredClone(c.scenario) as Scenario;
  // Use the registration that actually worked. If the model omitted sign-in but Oddhound recorded one,
  // the form was observed while signed in, so the replay must sign in too.
  if (recorded.auth && s.kind !== 'cross_account_read') s.auth = recorded.auth;
  else if (recorded.auth && s.auth) s.auth = recorded.auth;
  if (s.kind === 'form_rule') {
    const observed = recorded.labelsByPath.get(s.form.path);
    s.form.fields = groundFields(s.form.fields, observed);
    s.testedField = closestLabel(s.testedField, observed);
  }
  if (s.kind === 'cross_account_read') { s.create.fields = groundFields(s.create.fields, recorded.labelsByPath.get(s.create.path)); }
  const controlValues = c.controlValues && s.kind === 'form_rule' ? groundFields(c.controlValues, recorded.labelsByPath.get(s.form.path)) : c.controlValues;
  return { ...c, scenario: s, controlValues };
}

/** Field labels, controls and paths a scenario refers to must have been observed during this run. */
export function scenarioProblems(c: Candidate, recorded: Recorded): string[] {
  const s = c.scenario;
  const problems: string[] = [];
  const checkFields = (path: string, fields: Record<string, string>) => {
    const seen = recorded.labelsByPath.get(path);
    if (!seen) { problems.push(`Path ${path} was never observed in this run. Use the exact path you visited.`); return; }
    const unknown = Object.keys(fields).filter((k) => !seen.has(k));
    if (unknown.length) problems.push(`Field label(s) ${unknown.map((u) => JSON.stringify(u)).join(', ')} not seen on ${path}. Labels seen there: ${[...seen].map((l) => JSON.stringify(l)).join(', ')}.`);
  };
  const checkControl = (path: string, text: string) => {
    const seen = recorded.controlsByPath.get(path);
    if (seen && ![...seen].some((l) => l.toLowerCase().includes(text.toLowerCase()))) problems.push(`No button or link ${JSON.stringify(text)} seen on ${path}. Controls seen there: ${[...seen].slice(0, 15).map((l) => JSON.stringify(l)).join(', ')}.`);
  };
  if (s.kind === 'form_rule') {
    checkFields(s.form.path, s.form.fields); checkControl(s.form.path, s.form.submit);
    const d = scenarioDefect(s); if (d) problems.push(d);
    // A rejected-input rule needs a valid neighbouring case, so a form that rejects everything is not mistaken for a fix.
    if (s.expectation === 'rejected' && !c.controlValues?.[s.testedField]) problems.push(`Provide control_values with a VALID value for ${JSON.stringify(s.testedField)} that must still be accepted.`);
  }
  if (s.kind === 'cross_account_read') { checkFields(s.create.path, s.create.fields); checkControl(s.create.path, s.create.submit); }
  if (s.kind === 'mobile_reachability') { if (!recorded.controlsByPath.has(s.path)) problems.push(`Path ${s.path} was never observed in this run.`); else checkControl(s.path, s.control); }
  if ('auth' in s && s.auth && s.auth.kind !== 'handoff' && !recorded.auth) checkFields(s.auth.path, s.auth.fields);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Verification

function replayEnvFor(db: Db, runId: string, browser: ProvisionedBrowser, contract: RunContract, origin: string, ev: (t: string, p?: Record<string, unknown>) => Promise<number>, handoffState?: StorageState): ReplayEnv {
  let n = 0;
  const policy = { ...policyFromContract(contract), primaryOrigin: new URL(origin).origin };
  return {
    origin,
    sessions: newReplaySessions(),
    newContext: async (device, storageState) => {
      const ctx = await newScopedContext(browser.browser, device, storageState);
      await attachScope(ctx, policy, (d) => { if (!d.allowed) void ev('scope.denied', { url: redactUrl(d.url), method: d.method, reason: d.reason, phase: 'verification' }); });
      return ctx;
    },
    identity: () => syntheticIdentity(runId, 100 + ++n, contract.registration.emailDomain),
    onIdentityCreated: (role) => { void ev('identity.created', { role, phase: 'verification' }); },
    handoffState,
    inScope: (o) => o === policy.primaryOrigin || policy.apiOrigins.has(o),
  };
}

async function saveScenario(db: Db, runId: string, projectId: string | null, c: Candidate, s: Scenario, isControl: boolean, controlFor: string | null, ruleText: string, ruleSource: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO scenarios (project_id, run_id, title, rule_id, rule_text, rule_source, device, is_control, control_for, steps, assertion, assertion_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [projectId, runId, isControl ? `Control: ${c.title}` : c.title, c.ruleId, ruleText, ruleSource, s.device, isControl, controlFor,
      JSON.stringify({ recordedBy: 'agent', actor: c.actor, device: c.device }), JSON.stringify(s), scenarioHash(s)]);
  return r.rows[0]!.id;
}

async function recordExecution(db: Db, scenarioId: string, runId: string, kind: 'verify' | 'retest', hash: string, outcome: string, observed: unknown, evidence: string[]) {
  await db.query(`INSERT INTO scenario_executions (scenario_id, run_id, kind, assertion_hash, outcome, observed, evidence_ids) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [scenarioId, runId, kind, hash, outcome, JSON.stringify(observed), evidence]);
}

async function verifyCandidates(v: { db: Db; runId: string; generation: number; run: RunRow; contract: RunContract; candidates: Candidate[]; browser: ProvisionedBrowser; ev: (t: string, p?: Record<string, unknown>) => Promise<number>; handoffState?: StorageState }) {
  const { db, runId, run, contract, candidates, browser, ev } = v;
  const env = replayEnvFor(db, runId, browser, contract, contract.target.origin, ev, v.handoffState);
  const seen = new Set<string>();
  // Most serious first, so the important ones are verified even if time runs short.
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const ordered = [...candidates].sort((a, b) => rank[a.impact] - rank[b.impact]);
  for (const c of ordered) {
    const hash = scenarioHash(c.scenario);
    if (seen.has(hash)) continue;
    seen.add(hash);
    await assertLease(db, runId, v.generation);
    const rule = contract.rules.find((r) => r.id === c.ruleId) ?? BASELINE_RULES.find((r) => r.id === c.ruleId);
    const fingerprint = `${c.ruleId}|${c.scenario.kind}|${hash.slice(0, 16)}`;
    if (!rule) {
      await db.query(`INSERT INTO findings (project_id, run_id, title, category, verification, impact, confidence, rule_id, rule_source, expected, observed, device, actor, limitations, fingerprint)
        VALUES ($1,$2,$3,'needs_review','candidate',$4,'low',$5,'agent hypothesis','No owner rule covers this behaviour.',$6,$7,$8,'Not verified: no owner rule to judge against.',$9)`,
        [run.project_id, runId, c.title, c.impact, c.ruleId, c.observed, c.device, c.actor, fingerprint]);
      continue;
    }
    await ev('finding.verifying', { title: c.title, ruleId: c.ruleId });
    // Reproduce twice; a verified finding needs both replays to show the violation.
    const attempts = [await replayScenario(c.scenario, env), await replayScenario(c.scenario, env)];
    const scenarioId = await saveScenario(db, runId, run.project_id, c, c.scenario, false, null, rule.text, rule.source);
    const evidence: string[] = [];
    for (const [i, a] of attempts.entries()) {
      const ids: string[] = [];
      for (const s of a.screenshots) ids.push(await saveArtifact(db, runId, 'screenshot', 'image/jpeg', s.data, `verify ${i + 1}: ${s.label}`).catch(() => ''));
      evidence.push(...ids.filter(Boolean));
      await recordExecution(db, scenarioId, runId, 'verify', hash, a.outcome, { observed: a.observed, details: a.details }, ids.filter(Boolean));
    }
    let verification: 'verified' | 'dismissed' | 'inconclusive';
    let category: 'verified_issue' | 'needs_review' = 'needs_review';
    let limitations = '';
    let controlScenarioId: string | null = null;
    const outcomes = attempts.map((a) => a.outcome);
    if (outcomes.every((o) => o === 'failed')) {
      verification = 'verified'; category = 'verified_issue';
      const control = c.controlValues ? controlFor(c.scenario, c.controlValues) : null;
      if (control) {
        const ctl = await replayScenario(control, env);
        controlScenarioId = await saveScenario(db, runId, run.project_id, c, control, true, scenarioId, rule.text, rule.source);
        const ids: string[] = [];
        for (const s of ctl.screenshots) ids.push(await saveArtifact(db, runId, 'screenshot', 'image/jpeg', s.data, `control: ${s.label}`).catch(() => ''));
        await recordExecution(db, controlScenarioId, runId, 'verify', scenarioHash(control), ctl.outcome, { observed: ctl.observed }, ids.filter(Boolean));
        if (ctl.outcome !== 'passed') { verification = 'inconclusive'; category = 'needs_review'; limitations = `The valid neighbouring case did not pass either (${ctl.outcome}): ${ctl.observed}`; }
      }
    } else if (outcomes.every((o) => o === 'passed')) {
      verification = 'dismissed'; limitations = 'Not reproduced: the rule held in both independent replays.';
    } else {
      verification = 'inconclusive'; limitations = `Replays disagreed or could not run: ${attempts.map((a) => `${a.outcome} (${a.observed})`).join('; ')}`.slice(0, 600);
    }
    const observed = attempts.find((a) => a.outcome === 'failed')?.observed ?? attempts[0]!.observed;
    const f = await db.query<{ id: string }>(`INSERT INTO findings (project_id, run_id, scenario_id, control_scenario_id, title, category, verification, lifecycle, impact, confidence, rule_id, rule_source, expected, observed, device, actor, limitations, fingerprint, evidence_ids)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [run.project_id, runId, scenarioId, controlScenarioId, c.title, category, verification, verification === 'verified' ? 'open' : null, c.impact,
        verification === 'verified' ? 'reproduced 2/2' : 'low', c.ruleId, `${rule.source === 'owner' ? 'Owner rule' : rule.source === 'baseline' ? 'Oddhound baseline rule' : 'Demo target rule'} ${rule.id}${c.stated ? ` (page-stated: ${c.stated})` : ''}`.slice(0, 300),
        rule.text, observed, c.scenario.device, c.actor, limitations, fingerprint, evidence]);
    await ev(verification === 'verified' ? 'finding.verified' : verification === 'dismissed' ? 'finding.dismissed' : 'finding.inconclusive',
      { findingId: f.rows[0]!.id, title: c.title, ruleId: c.ruleId, outcomes });
  }
}

async function recordConfigurationObservations(db: Db, run: RunRow, session: RunSession, contract: RunContract, ev: (t: string, p?: Record<string, unknown>) => Promise<number>) {
  const isHttps = contract.target.origin.startsWith('https:');
  const add = async (title: string, observed: string, expected: string, fp: string) => {
    await db.query(`INSERT INTO findings (project_id, run_id, title, category, verification, impact, confidence, rule_source, expected, observed, device, actor, limitations, fingerprint)
      VALUES ($1,$2,$3,'configuration_observation','verified','low','observed in captured responses','OWASP HTTP headers guidance (contextual)',$4,$5,'desktop','A','A configuration observation, not a demonstrated exploit.',$6)`,
      [run.project_id, run.id, title, expected, observed, fp]);
    await ev('finding.observation', { title });
  };
  for (const c of session.cookies.values()) {
    if (!/sess|sid|auth|token/i.test(c.name)) continue;
    if (!c.httpOnly) await add(`Session cookie "${c.name}" is readable by page scripts`, `Set-Cookie for ${c.name} has no HttpOnly attribute.`, 'Session cookies are usually marked HttpOnly so injected scripts cannot read them.', `cookie-httponly|${c.name}`);
    if (isHttps && !c.secure) await add(`Session cookie "${c.name}" is not marked Secure`, `Set-Cookie for ${c.name} over HTTPS has no Secure attribute.`, 'Session cookies on HTTPS sites are usually marked Secure.', `cookie-secure|${c.name}`);
  }
  const pages = [...session.headers.values()];
  const noCsp = pages.filter((p) => !p.csp).map((p) => p.path);
  const noFrame = pages.filter((p) => !p.frameProtection).map((p) => p.path);
  if (noCsp.length) await add('No Content-Security-Policy on HTML pages', `No Content-Security-Policy header on ${noCsp.length} page route(s): ${noCsp.slice(0, 6).join(', ')}.`, 'A Content-Security-Policy limits the impact of injected scripts.', 'header-csp');
  if (noFrame.length) await add('Pages can be framed by other sites', `No X-Frame-Options or CSP frame-ancestors on ${noFrame.length} page route(s): ${noFrame.slice(0, 6).join(', ')}.`, 'Pages with sensitive actions usually restrict framing (clickjacking defence).', 'header-frame');
}

// ---------------------------------------------------------------------------------------------
// Retest: replay the saved, unchanged assertions of the parent run against the (fixed) deployment.

async function executeRetest(deps: ExecuteDeps, run: RunRow, contract: RunContract, generation: number, ev: (t: string, p?: Record<string, unknown>) => Promise<number>, setBrowser: (b: ProvisionedBrowser) => void) {
  const { db } = deps;
  const findings = (await db.query<{ id: string; title: string; lifecycle: string | null; scenario_id: string; control_scenario_id: string | null }>(
    `SELECT id, title, lifecycle, scenario_id, control_scenario_id FROM findings WHERE run_id = $1 AND verification = 'verified' AND category = 'verified_issue'`, [run.parent_run_id])).rows;
  const browser = await deps.runtime.provision({ runId: run.id, lab: deps.lab, onEgress: (d) => { if (!d.allowed) void ev('egress.denied', { host: d.host, reason: d.reason }); } });
  setBrowser(browser);
  await setRunStatus(db, run.id, generation, 'running', { browserState: 'ready', browserRef: browser.ref, sandboxVerdict: browser.sandboxVerdict });
  await ev('browser.ready', { runtime: browser.runtime, ref: browser.ref, sandbox: browser.sandboxVerdict });
  await ev('run.status', { status: 'running' });
  const env = replayEnvFor(db, run.id, browser, contract, contract.target.origin, ev);
  for (const f of findings) {
    await assertLease(db, run.id, generation);
    const s = (await db.query<{ assertion: Scenario; assertion_hash: string }>('SELECT assertion, assertion_hash FROM scenarios WHERE id = $1', [f.scenario_id])).rows[0]!;
    if (scenarioHash(s.assertion) !== s.assertion_hash) { // SELF-12: never replay a changed assertion
      await ev('retest.blocked', { findingId: f.id, reason: 'assertion_changed' });
      continue;
    }
    const original = await replayScenario(s.assertion, env);
    const ids: string[] = [];
    for (const shot of original.screenshots) ids.push(await saveArtifact(db, run.id, 'screenshot', 'image/jpeg', shot.data, `retest: ${shot.label}`).catch(() => ''));
    await recordExecution(db, f.scenario_id, run.id, 'retest', s.assertion_hash, original.outcome, { observed: original.observed }, ids.filter(Boolean));
    let controlOutcome = 'not_run';
    if (f.control_scenario_id) {
      const cs = (await db.query<{ assertion: Scenario; assertion_hash: string }>('SELECT assertion, assertion_hash FROM scenarios WHERE id = $1', [f.control_scenario_id])).rows[0]!;
      const ctl = await replayScenario(cs.assertion, env);
      controlOutcome = ctl.outcome;
      await recordExecution(db, f.control_scenario_id, run.id, 'retest', cs.assertion_hash, ctl.outcome, { observed: ctl.observed }, []);
    }
    let lifecycle = f.lifecycle;
    if (original.outcome === 'passed' && (controlOutcome === 'passed' || controlOutcome === 'not_run')) lifecycle = 'fixed';
    else if (original.outcome === 'failed') lifecycle = f.lifecycle === 'fixed' ? 'regressed' : 'open';
    await db.query('UPDATE findings SET lifecycle = $2, updated_at = now() WHERE id = $1', [f.id, lifecycle]);
    await ev('retest.finished', { findingId: f.id, title: f.title, outcome: original.outcome, control: controlOutcome, lifecycle, observed: original.observed });
  }
}
