// Executes one run end to end inside the trusted worker:
//   claim lease → re-verify ownership → select Meta provider → provision a fresh browser →
//   bounded model loop (budget reserved before every call, lease checked before every action) →
//   independent verification of candidates → deterministic configuration observations →
//   finalize, destroy the browser and record the truthful terminal status.

import type { Db } from '../db/pool.ts';
import { LIMITS } from '../contracts/limits.ts';
import { RunContractSchema, pathHasDeniedKeyword, writesPermitted, BASELINE_IMPACT, BASELINE_RULES, type RunContract } from '../contracts/contract.ts';
import { describeSignal, signalKey, type Signal } from '../browser/sentinels.ts';
import type { RunStatus } from '../contracts/status.ts';
import { appendEvent, assertLease, claimRun, FencedError, setRunStatus, refundIfNeverStarted } from '../ledger/runs.ts';
import { reserveSpend, settleSpend, releaseSpend, markSpendUnknown } from '../ledger/spend.ts';
import { resolveCredential, storeCredential, syntheticIdentity } from '../ledger/credentials.ts';
import { saveArtifact } from '../artifacts/store.ts';
import type { BrowserRuntime, ProvisionedBrowser } from '../browser/runtime.ts';
import { newScopedContext } from '../browser/runtime.ts';
import { attachScope, policyFromContract, type ScopeDecision } from '../browser/scope.ts';
import { formatObservation, routePattern, stateFingerprint, type Observation } from '../browser/snapshot.ts';
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
import { findByLabel, usesRef } from './by-label.ts';
import { blockedReason, disabledReason } from '../browser/click-check.ts';
import { readSiteMap } from '../browser/site-map.ts';
import { runHandoff, HandoffEnded } from './handoff.ts';
import { CLICK_ROLES, controlFor, fieldValue, fillAndSubmit, saveField, submitWithInterruption, newReplaySessions, recordIdsInUrl, replayScenario, scenarioDefect, scenarioHash, type Setup, type AuthRecipe, type Oracle, type ReplayEnv, type Scenario, type TraceStep } from '../verifier/scenario.ts';
import { CLAIM_RETRY_DELAYS_MS, CLAIM_WINDOW_MS, NUMBER_ASSUMPTIONS, claimVisible, distinctiveValues, judgeCrossActor, judgeDifferential, judgeInterruption, judgeInvariant, occurrences, judgePersistence, judgeTwoTabs, readTables, readView, swapId, type ContextControls, type Family, type Interruption, type Invariant, type InvariantVerdict, type PageView } from '../verifier/behavior.ts';

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
  /** Behavioral family (MVP §9) that produced the candidate. */
  family?: Family;
  /** Set when no explicit or owner-approved rule backs the check: the expectation the model inferred.
   *  The candidate is still replayed, but it can only ever be needs_review, never verified. */
  hypothesis?: string;
  /** Contexts used, as reported (e.g. "actor A and actor B, desktop"). */
  contexts?: string;
  /** Family-specific limits of what the check shows. */
  limitations?: string;
  /** How many times exploration hit this same family problem (repeats are merged into one candidate). */
  repeats?: number;
};

/**
 * Two family candidates are the same problem when family, rule (or hypothesis id), check kind and page
 * (record numbers folded) match, e.g. two lost-update checks on /bookings/:id/edit.
 */
export function familyCandidateKey(c: { family?: string; ruleId: string; scenario: Scenario }): string {
  const s = c.scenario;
  const page = s.kind === 'interruption' ? s.form.path : 'path' in s ? s.path : 'start' in s ? s.start : '';
  return `${c.family}|${c.ruleId}|${s.kind}|${page.split('?')[0]!.replace(/\{\w+\}|\d+/g, ':id')}`;
}

/** The last form submit of the run, as Oddhound observed it (family 1 reads it). */
type LastWrite = {
  submitSeq: number; path: string; submit: string; values: Map<string, string>; landedUrl: string; bodyText: string;
  actor: string; device: 'desktop' | 'mobile'; checked: boolean;
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
  /** For callbacks nobody awaits: a failed event write must never become an unhandled rejection. */
  const evQuiet = (type: string, payload: Record<string, unknown> = {}) => { ev(type, payload).catch(() => {}); };
  await ev('run.status', { status: 'provisioning' });

  // Stop/expiry watcher: aborts in-flight inference as soon as the fence is persisted.
  const abort = new AbortController();
  const watcher = setInterval(async () => {
    try {
      // The watcher also keeps the run's heartbeat fresh, so long model retries or slow replays (no lease
      // check for minutes) are never mistaken for a lost worker by the stale-run reaper.
      const r = await db.query<{ stop_requested_at: Date | null; expires_at: Date | null }>(
        'UPDATE runs SET heartbeat_at = now() WHERE id = $1 AND lease_generation = $2 RETURNING stop_requested_at, expires_at', [runId, generation]);
      if (!r.rowCount) { abort.abort(); return; } // the lease moved on: this worker no longer owns the run
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
        // A scale-to-zero host may take several seconds to wake, so allow 30 s and one retry. The failure records why.
        let ok = false; let why = '';
        for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
          const r = await fetch(resetUrl, { method: 'POST', headers: { 'x-lab-reset-token': process.env.ODDHOUND_FIXTURE_RESET_TOKEN ?? '' }, signal: AbortSignal.timeout(30_000) })
            .then((res) => ({ ok: res.ok, why: `HTTP ${res.status}` }), (e: Error) => ({ ok: false, why: e.name === 'TimeoutError' ? 'timed out after 30 s' : 'unreachable' }));
          ok = r.ok; why = r.why;
          if (!ok && why.startsWith('HTTP 4')) break; // a wrong token will not fix itself
        }
        await ev(ok ? 'fixture.reset' : 'fixture.reset_failed', ok ? { target: 'demo' } : { target: 'demo', reason: why });
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
    const egress: { exhausted: string | null } = { exhausted: null };
    browser = await deps.runtime.provision({
      runId, lab: deps.lab,
      onEgress: (d) => { if (!d.allowed) evQuiet('egress.denied', { host: d.host, port: d.port, reason: d.reason }); },
      // The traffic cap ends testing, not the run: the agent loop stops at its next turn and the run still
      // finalizes (replays that need the network then come back inconclusive, which is recorded as such).
      onEgressExhausted: (r) => { if (!egress.exhausted) { egress.exhausted = r; evQuiet('egress.exhausted', { reason: r }); } },
    });
    await setRunStatus(db, runId, generation, 'running', { browserState: 'ready', browserRef: browser.ref, sandboxVerdict: browser.sandboxVerdict });
    await ev('browser.ready', { runtime: browser.runtime, ref: browser.ref, sandbox: browser.sandboxVerdict });
    if (deps.hosted && browser.sandboxVerdict !== 'sandbox_on') { await finish('blocked', `chromium_sandbox_not_confirmed:${browser.sandboxVerdict}`); return await done(); }
    await ev('run.status', { status: 'running' });

    const onScope = (d: ScopeDecision) => { if (!d.allowed) evQuiet('scope.denied', { url: redactUrl(d.url), method: d.method, reason: d.reason }); };
    session = new RunSession(browser.browser, policyFromContract(contract), onScope);

    // 3b. Owner sign-in handoff: the owner signs in through the live view; the model sees none of it.
    let handoffState: StorageState | undefined;
    if (contract.handoff.enabled) {
      await setRunStatus(db, runId, generation, 'waiting_for_input');
      await ev('run.status', { status: 'waiting_for_input', reason: 'owner_sign_in' });
      handoffState = await runHandoff({ db, runId, generation, session, startPath: contract.handoff.startPath, ev, signal: abort.signal });
      // Time spent waiting for the owner to sign in is not testing time: the run's clock starts again at handover.
      await db.query(`UPDATE runs SET expires_at = now() + ($3::int * interval '1 millisecond') WHERE id = $1 AND lease_generation = $2`, [runId, generation, LIMITS.runWallClockMs]);
      await ev('run.clock_started', { minutes: LIMITS.runWallClockMs / 60_000, after: 'owner_handover' });
      await setRunStatus(db, runId, generation, 'running');
      await ev('run.status', { status: 'running' });
    }

    // 4. Exploration with the Meta model.
    const candidates: Candidate[] = [];
    const recorded: Recorded = { auth: handoffState ? { kind: 'handoff' } : null, labelsByPath: new Map(), controlsByPath: new Map(), submitByPath: new Map(), acceptedByPath: new Map(), createdBy: new Map(), creators: new Map() };
    const loop = await agentLoop({ deps, runId, generation, contract, run, provider, price, session, ev, abort, candidates, recorded, egress });
    if (loop.stopReason) stopReason = loop.stopReason;

    // 5. Deterministic configuration observations from captured responses (no model involvement). Recorded
    //    first, so they survive however verification ends.
    await recordConfigurationObservations(db, run, session, contract, ev);

    // 6. Independent verification of every candidate (fresh contexts, fresh identities), until a minute before
    //    the run's expiry; candidates left over are recorded as not verified, never dropped.
    await ev('run.phase', { phase: 'verifying', candidates: candidates.length });
    const expiry = (await db.query<{ expires_at: Date | null }>('SELECT expires_at FROM runs WHERE id = $1', [runId])).rows[0]?.expires_at?.getTime() ?? Date.now() + 5 * 60_000;
    await verifyCandidates({ db, runId, generation, run, contract, candidates, browser, ev, handoffState, deadline: expiry - 60_000 });

    // Truthful status: a model provider failure is a failed run, not a completed one.
    const ended = loop.stopReason === 'provider_error' ? 'failed'
      : loop.stopReason?.startsWith('budget_') || loop.stopReason === 'limit_turns' || loop.stopReason === 'limit_actions' || loop.stopReason === 'egress_cap' ? 'stopped' : 'completed';
    await finish(ended, stopReason);
    return await done();
  } catch (e) {
    if (e instanceof HandoffEnded) {
      await finish('stopped', e.reason);
    } else if (e instanceof SiteUnreachable && e.kind === 'bot_challenge') {
      // The owner's bot protection challenged the run's browser: a compatibility block, not a crash.
      await ev('site.bot_challenge', { url: e.url, detail: e.detail });
      await finish('blocked', 'site_bot_challenge');
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
  /** Set when the run's traffic cap is used up: the loop stops at its next turn. */
  egress?: { exhausted: string | null };
};

/** What Oddhound itself observed during exploration, used to ground the model's scenario recipes. */
export type Recorded = {
  auth: AuthRecipe | null; labelsByPath: Map<string, Set<string>>; controlsByPath: Map<string, Set<string>>;
  /** Button the agent clicked to submit a filled form on each path (observed, not remembered by the model). */
  submitByPath?: Map<string, string>;
  /** Field values a form on each path accepted: the page moved on with no error message after submit. */
  acceptedByPath?: Map<string, Map<string, Set<string>>>;
  /** Record number -> the form submit that created it (the number was in the URL the form landed on). */
  createdBy?: Map<string, Setup>;
  /** Record number -> which actor created it and the page the create landed on (its list, if any). */
  creators?: Map<string, { actor: string; landed: string }>;
};

async function agentLoop(a: LoopArgs): Promise<{ stopReason?: string; summary?: string }> {
  const { deps: { db }, runId, generation, contract, provider, price, session, ev, abort, candidates, recorded } = a;
  const mode: AgentMode = a.deps.agentMode ?? agentModeFromEnv();
  const tools = toolDefinitionsFor(mode);
  await ev('agent.mode', { mode, tools: tools.map((t) => t.function.name) });
  let pendingAuth: { path: string; fields: Record<string, string> } | null = null;
  // The pages the site lists about itself, so the plan starts from the whole site, not only what one page links to.
  const allowedPath = (p: string) => {
    const path = new URL(p, contract.target.origin).pathname;
    return !contract.deniedPathPrefixes.some((d) => path.startsWith(d)) && !pathHasDeniedKeyword(path, contract.deniedPathKeywords);
  };
  const siteMap = await readSiteMap(await session.page(), contract.target.origin, allowedPath).catch(() => null);
  const knownPaths = siteMap?.paths ?? [];
  if (siteMap) await ev('site.mapped', { pages: knownPaths.length, fromSitemap: siteMap.sources.sitemap, fromLinks: siteMap.sources.links, sitemaps: siteMap.sitemaps, sample: knownPaths.slice(0, 30) });
  const listed = knownPaths.length
    ? `\nPages this site lists (sitemap.xml, robots.txt and links on the first page; ${knownPaths.length}${knownPaths.length > 80 ? ', first 80 shown' : ''}): ${knownPaths.slice(0, 80).join(', ')}. Use them to plan and to reach pages directly with navigate.`
    : '';
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(contract, mode) },
    { role: 'user', content: `Begin. You are actor A on desktop, on ${contract.target.origin}/. Start with observe.${listed}` },
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
    const unvisited = knownPaths.filter((p) => !recorded.controlsByPath.has(new URL(p, contract.target.origin).pathname));
    return [
      'NOTEBOOK (kept by Oddhound; the earlier conversation was compacted to save cost)',
      `Budget: ${budgetText()}. Turn ${turns}, last action #${seq}. You are actor ${session.actor} on ${session.device}.`,
      recorded.auth ? `Sign-up recipe that worked: ${recorded.auth.kind === 'handoff' ? 'owner handoff session' : `${recorded.auth.path} -> "${recorded.auth.successText}"`}` : 'No sign-up recorded yet.',
      `Synthetic identities:\n${ids.join('\n') || '- none'}`,
      `Pages seen:\n${pages.join('\n') || '- none'}`,
      ...(unvisited.length ? [`Pages the site lists that you have not visited (${unvisited.length}): ${unvisited.slice(0, 40).join(', ')}`] : []),
      `Test plan:\n${charters.join('\n') || '- none yet: call plan_tests'}`,
      `Findings recorded so far:\n${found.join('\n') || '- none'}`,
      `Coverage: ${cov.exercised} of ${cov.total} controls on ${cov.pages} observed page(s) exercised; ${cov.blocked} blocked by policy.${todo ? ` Not yet exercised (sample): ${todo}.` : ''}`,
      `Current page (element refs are valid for your next call):\n${last}`,
      'Continue with the next open charter, or add a charter for anything new you found that is worth testing.',
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
  // Values typed into forms on the current path, so a later submit can be recorded as accepted or not.
  const typed = new Map<string, Map<string, string>>();
  const noteTyped = async (label: string | null, value: string) => {
    if (!label || [...secrets].some((x) => value.includes(x))) return;
    const path = new URL((await session.page()).url()).pathname;
    const m = typed.get(path) ?? new Map<string, string>(); m.set(label, value); typed.set(path, m);
  };
  let lastWrite: LastWrite | null = null;
  // Family 3 invariants registered by check_invariant, re-checked after each later action on their page.
  const watched = new Map<string, Watched>();
  const noteSubmit = async (path: string, label: string | null, submitSeq: number | undefined) => {
    const values = typed.get(path);
    if (!label || !values?.size) return;
    recorded.submitByPath?.set(path, label);
    const o = session.lastObservation;
    if (o && submitSeq !== undefined) {
      const bodyText = await (await session.page()).locator('body').innerText({ timeout: 5_000 }).catch(() => o.text);
      lastWrite = { submitSeq, path, submit: label, values: new Map(values), landedUrl: o.url, bodyText, actor: session.actor, device: session.device, checked: false };
    }
    const landed = o ? new URL(o.url).pathname : path;
    if (o && landed !== path && !o.alerts.some((a) => /error|invalid|required|must|cannot|already/i.test(a))) {
      const acc = recorded.acceptedByPath?.get(path) ?? new Map<string, Set<string>>();
      for (const [k, v] of values) { const s = acc.get(k) ?? new Set<string>(); s.add(v); acc.set(k, s); }
      recorded.acceptedByPath?.set(path, acc);
      // Only a form on a record-free path (e.g. /bookings/new) creates records; saving /bookings/4/edit does not,
      // and neither does a sign-up or sign-in form (its landing page may carry a flag such as ?welcome=1).
      const authForm = pendingAuth?.path === path || (recorded.auth && 'path' in recorded.auth && recorded.auth.path === path);
      if (!authForm && !/\/\d{1,12}(\/|$)/.test(path)) {
        for (const id of recordIdsInUrl(o.url)) {
          if (recorded.createdBy?.has(id)) continue;
          recorded.createdBy?.set(id, { path, fields: Object.fromEntries(values), submit: label });
          recorded.creators?.set(id, { actor: session.actor, landed });
        }
      }
      typed.delete(path);
    }
  };
  /** One line after a save that reported success, so the model can check the claim (family 1). */
  const claimHint = (): string => {
    const w = lastWrite as LastWrite | null;
    const o = session.lastObservation;
    if (!w || w.checked || !o || !o.notices.length) return '';
    return `\nSAVE REPORTED: the page says ${JSON.stringify(o.notices[0]!.slice(0, 80))} after submitting ${[...w.values.keys()].slice(0, 6).map((k) => JSON.stringify(k)).join(', ')}. To confirm it is true, call check_claim.`;
  };
  let lastStep: StepInfo | null = null;
  const batches = new Map<number, BatchRecord>();
  // Batch steps that failed, by page state (route, headings, controls such as an open dialog, and field values) +
  // tool + control label. A step that already failed twice in the same state is not run again, so the agent changes
  // the page (closes the dialog, fills the field) or moves on instead of looping. A different state may retry it.
  const failedSteps = new Map<string, { count: number; seq: number; error: string }>();
  const stepKey = (o: Observation, tool: string, label: string | undefined) => {
    const values = o.elements.filter((e) => e.value !== undefined).map((e) => `${e.label}=${e.value}`).sort().join('&');
    return `${stateFingerprint(o, session.actor, session.device).fingerprint}|${values}|${tool}|${(label ?? '').trim().toLowerCase()}`;
  };
  // Pages first reached after the latest plan update, shown in the status line so the plan grows with what is found.
  const pagesSincePlan = new Set<string>();
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
  let spentMicros = 0;
  let wrapUpSent = false;
  const expiresAt = (await db.query<{ expires_at: Date | null }>('SELECT expires_at FROM runs WHERE id = $1', [runId])).rows[0]?.expires_at?.getTime() ?? Date.now() + LIMITS.runWallClockMs;
  const verificationReserveMs = () => Math.min(6 * 60_000, 90_000 + candidates.length * 35_000);

  /** Translate the action just executed into a replayable step, using what the model saw (labels, kinds). */
  const toStep = (tool: ToolName | InternalTool, args: Record<string, any>): TraceStep | null => {
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
  const handleSignals = async (tool: ToolName | InternalTool, actionSeq: number, drained: { signals: Signal[]; scopeBlocked: boolean }): Promise<string[]> => {
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
    if (plan.size && !recorded.controlsByPath.has(path)) pagesSincePlan.add(path);
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

  const runBrowserAction = async (tool: ToolName | InternalTool, args: Record<string, any>, describe: string, fn: () => Promise<void>, opts: { quiet?: boolean; stated?: string } = {}): Promise<string> => {
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
    if (watched.size) notes.push(...await recheckInvariants(o));
    lastStep = { seq: mySeq, error, notes, scopeBlocked: drained.scopeBlocked, ownScopeBlocked: drained.ownScopeBlocked, dialogs, newState, obs: o, stated: opts.stated };
    const head = `${error ? `#${mySeq} FAILED: ${error}` : `#${mySeq} OK`}${notes.length ? `\n${notes.join('\n')}` : ''}${dialogs.length ? `\nDIALOG (dismissed by Oddhound): ${dialogs.join(' | ')}` : ''}`;
    if (opts.quiet ?? quietSteps) return head;
    return `${head}\n${formatObservation(o)}\n${statusLine()}`;
  };

  /** Money and time left: the only budgets (turns and actions are not capped). */
  const budgetText = () => `$${(spentMicros / 1e6).toFixed(3)} of $${(LIMITS.modelSpendPerRunMicros / 1e6).toFixed(2)} spent, ${Math.max(0, Math.round((expiresAt - Date.now()) / 60_000))} min left`;
  /** One line of budget and plan state, appended to each observation so the model can pace itself. */
  const statusLine = () => {
    const open = [...plan.values()].filter((c) => c.status === 'not_run' || c.status === 'testing');
    const urgent = open.filter((c) => c.risk === 'critical' || c.risk === 'high').length;
    const cov = coverage.summary(0);
    return `[budget: ${budgetText()}; plan: ${plan.size ? `${plan.size - open.length}/${plan.size} charters done, ${urgent} critical/high open` : 'none yet - call plan_tests after recon'}; findings so far: ${candidates.length}; controls exercised: ${cov.exercised}/${cov.total}${pagesSincePlan.size ? `; new pages since your last plan update: ${[...pagesSincePlan].slice(0, 8).join(', ')} (add charters for any worth testing)` : ''}]`;
  };

  // ---- Behavioral families (MVP §9). The model names what to check; Oddhound acts, looks and decides.

  /** File a family candidate, or merge it into an earlier one for the same family, rule, check and page.
   *  Returns the earlier candidate when merged (the repeat is counted on it, not filed again). */
  const addFamilyCandidate = async (c: Candidate): Promise<Candidate | null> => {
    const key = familyCandidateKey(c);
    const prior = candidates.find((x) => x.family && familyCandidateKey(x) === key);
    if (prior) {
      prior.repeats = (prior.repeats ?? 1) + 1;
      await ev('finding.candidate_merged', { title: c.title, into: prior.title, ruleId: prior.ruleId, kind: c.scenario.kind, family: c.family, repeats: prior.repeats });
      return prior;
    }
    candidates.push(c);
    await ev('finding.candidate', { title: c.title, ruleId: c.hypothesis ? null : c.ruleId, kind: c.scenario.kind, source: 'agent', family: c.family });
    return null;
  };
  const mergedText = (prior: Candidate) => `This is the same problem as an earlier candidate ("${prior.title}"), so it was counted there (seen ${prior.repeats} times) and not filed again. Move on to another charter.`;

  /** Why the run may not open a path on the verified site, or null when it may. */
  const pathRefusal = (p: string): string | null => {
    let u: URL;
    try { u = new URL(p, session.origin); } catch { return 'not a valid path'; }
    if (u.origin !== session.origin) return 'outside the verified site';
    if (contract.deniedPathPrefixes.some((x) => u.pathname.startsWith(x))) return 'denied by the run contract';
    const w = pathHasDeniedKeyword(u.pathname, contract.deniedPathKeywords);
    return w ? `denied by the run contract (blocked word "${w}")` : null;
  };
  /** Ledgered navigation taken by Oddhound for a check (same limits, fences and evidence as the model's). */
  const openPath = (p: string, why: string) => runBrowserAction('navigate', { path: p }, `${why}: opened ${p.split('?')[0]}`,
    async () => { await (await session.page()).goto(new URL(p, session.origin).toString(), { waitUntil: 'domcontentloaded' }); }, { quiet: true });
  const switchActor = async (actor: 'A' | 'B') => {
    if (session.actor !== actor) await runBrowserAction('use_actor', { actor }, `Switched to actor ${actor}`, async () => { await session.useActor(actor); }, { quiet: true });
  };
  const view = async (): Promise<PageView> => readView(await session.page());
  const asTemplateValue = (v: string) => { const i = identities.find((x) => x.name === v || x.email === v); return i ? (i.name === v ? '{name}' : '{email}') : v; };
  const afterCheck = () => `${session.lastObservation ? `\n${formatObservation(session.lastObservation)}` : ''}\n${statusLine()}`;

  /** Family 1: compare what the page claimed after the last save with what reloading and reopening show. */
  const checkClaim = async (args: { claim?: string; fields: string[]; revisit_path?: string }): Promise<string> => {
    const w = lastWrite as LastWrite | null;
    if (!w) return 'No save recorded yet in this run: fill a form, submit it, then call check_claim.';
    if (w.actor !== session.actor || w.device !== session.device) return `The last save was made as actor ${w.actor} on ${w.device}; switch back to it first.`;
    const filled = new Set(w.values.keys());
    const checks: { field: string; value: string }[] = [];
    for (const f of args.fields) {
      const label = closestLabel(f, filled);
      const value = w.values.get(label);
      if (value === undefined) return `"${f}" was not filled in the last submitted form (${w.path}). Fields filled there: ${[...filled].map((x) => JSON.stringify(x)).join(', ')}.`;
      if (value.trim()) checks.push({ field: label, value });
    }
    if (!checks.length) return 'Those fields were left blank, so there is nothing to look for.';
    if (args.claim !== undefined && !claimVisible(args.claim, w.bodyText)) return `The page did not show ${JSON.stringify(args.claim)} after the save. Give the success message exactly as shown, or omit claim if there was none.`;
    if (args.revisit_path) { const r = pathRefusal(args.revisit_path); if (r) return `revisit_path ${args.revisit_path} is ${r}.`; }
    w.checked = true;
    const landedUrl = new URL(w.landedUrl);
    const paths = [...new Set([`${landedUrl.pathname}${landedUrl.search}`, ...(args.revisit_path ? [args.revisit_path] : [])])];
    await ev('scenario.started', { family: 'claim_vs_truth', claim: args.claim ?? null, fields: checks.map((c) => c.field), paths });
    const started = Date.now();
    let verdict = judgePersistence(checks, []);
    let looks = 0;
    for (const delay of CLAIM_RETRY_DELAYS_MS) {
      if (delay) await sleep(delay);
      looks++;
      const views: PageView[] = [];
      for (const p of paths) { await openPath(p, 'Checking the save'); views.push(await view()); }
      verdict = judgePersistence(checks, views);
      if (!verdict.missing.length) break;
    }
    const windowUsedMs = Date.now() - started;
    await ev('scenario.finished', { family: 'claim_vs_truth', outcome: verdict.missing.length ? 'failed' : 'passed', claim: args.claim ?? null, missing: verdict.missing.map((m) => m.field), found: verdict.found, looks, windowUsedMs, windowMs: CLAIM_WINDOW_MS });
    if (!verdict.missing.length) return `Claim held: ${verdict.found.map((f) => `"${f.field}" is on ${f.path}`).join('; ')} (looked ${looks} time(s)). No finding.${afterCheck()}`;

    const missingText = verdict.missing.map((m) => `"${m.field}" = ${JSON.stringify(m.value.slice(0, 60))}`).join(', ');
    const observedText = `${args.claim ? `After the save the page said "${args.claim}", but` : 'The page showed no success message, and'} after reloading and reopening (${paths.join(', ')}) over ${(windowUsedMs / 1000).toFixed(1)} s, ${missingText} ${verdict.missing.length === 1 ? 'was' : 'were'} not there.`;
    // The replay is built from Oddhound's own record of the save, never from the model's description.
    const t = traceFor(w.submitSeq);
    if (typeof t === 'string') {
      await ev('signal.not_replayable', { family: 'claim_vs_truth', reason: t });
      return `Mismatch seen, but it cannot be replayed (${t}): ${observedText}${afterCheck()}`;
    }
    const auth = recorded.auth && !t.usesPassword ? recorded.auth : undefined;
    const rp = withRecordSetup(t.start, t.steps.map((step) => ({ step })), recorded);
    const landedIds = recordIdsInUrl(w.landedUrl);
    const revisit = (args.revisit_path ? [args.revisit_path] : []).map((p) => {
      let out = rp.id ? swapId(p, rp.id, '{id}') : p;
      for (const id of landedIds) if (id !== rp.id) out = swapId(out, id, '{landed_id}');
      return out;
    });
    const scenario: Scenario = {
      kind: 'claim_check', device: t.device, ...(auth ? { auth } : {}), ...(rp.setup ? { setup: rp.setup } : {}), start: rp.start, steps: rp.steps.map((x) => x.step),
      claim: args.claim ?? null, checks: verdict.missing.map((m) => ({ field: m.field, value: asTemplateValue(m.value) })), revisit, windowMs: CLAIM_WINDOW_MS,
    };
    const names = verdict.missing.map((m) => `"${m.field}"`).join(', ');
    const title = args.claim ? `The page says "${args.claim.slice(0, 40)}", but ${names} ${verdict.missing.length === 1 ? 'is' : 'are'} not saved` : `${names} not saved after submitting ${w.path}`;
    const prior = await addFamilyCandidate({
      title: title.slice(0, 140), ruleId: args.claim ? 'B11' : 'claim_unstated', impact: 'high', observed: observedText.slice(0, 500), scenario, actor: t.actor, device: t.device, source: 'agent', family: 'claim_vs_truth',
      ...(args.claim ? {} : { hypothesis: 'The form was accepted without an error, so its values were expected to be saved. The page showed no success message, so no explicit rule says this save should have kept them.' }),
      contexts: `actor ${t.actor}, ${t.device}; exploration reloaded and reopened in the same session, replays use fresh sessions`,
      limitations: `Saved values were looked for on the page the save landed on${revisit.length ? ' and on the reopened record' : ''} within a ${CLAIM_WINDOW_MS / 1000} s window (exploration used ${(windowUsedMs / 1000).toFixed(1)} s over ${looks} looks). A value the site shows in another format (e.g. a reformatted date) would also look missing.`,
    });
    if (prior) return `${mergedText(prior)}${afterCheck()}`;
    return `Claim did NOT hold: ${observedText} Recorded as a candidate${args.claim ? '' : ' for review only (no success message, so no rule to verify against)'}; Oddhound will replay it in fresh sessions.${afterCheck()}`;
  };

  let actorB: { ref: string } | null = null;
  /** Actor B is a separate fresh account, signed up by Oddhound with the sign-up actor A used. */
  const ensureActorB = async (): Promise<string | null> => {
    if (actorB) return null;
    const auth = recorded.auth;
    if (!contract.capabilities.crossAccountRead) return 'a second actor is not permitted by this run contract';
    if (!auth || auth.kind !== 'register') return auth?.kind === 'handoff' ? 'this run uses the owner\'s own sign-in, so no second account exists' : 'no sign-up has been recorded yet (sign up as actor A first, so Oddhound can repeat it for actor B)';
    if (!contract.registration.allowed || !contract.capabilities.register) return 'registration is not permitted by this run contract';
    if (identities.length >= contract.registration.maxIdentities) return `the identity limit (${contract.registration.maxIdentities} per run) is used up`;
    const ident = syntheticIdentity(runId, identities.length + 1, contract.registration.emailDomain);
    const ref = await storeCredential(db, { runId, label: `generated identity ${identities.length + 1} (actor B)`, username: ident.email, secret: ident.password, generated: true });
    secrets.add(ident.password);
    identities.push({ ref, name: ident.name, email: ident.email });
    await ev('identity.created', { credentialRef: ref, email: ident.email, actor: 'B' });
    await switchActor('B');
    let reached = false;
    await runBrowserAction('sign_up_actor', { actor: 'B', path: auth.path, credential_ref: ref }, `Signed up actor B at ${auth.path} with the recorded sign-up`, async () => {
      const page = await session.page();
      await fillAndSubmit(page, session.origin, auth, ident);
      reached = (await page.locator('body').innerText().catch(() => '')).includes(auth.successText);
    }, { quiet: true });
    const step = lastStep as StepInfo | null;
    if (step?.error) return `signing up actor B failed: ${step.error}`;
    if (!reached) return `the recorded sign-up did not reach "${auth.successText}" for actor B`;
    actorB = { ref };
    return null;
  };

  /** Family 2 (cross-actor): actor B opens exactly a record actor A created in this run. */
  const checkCrossActor = async (args: { path: string; try_controls?: string[] }): Promise<string> => {
    const refusal = pathRefusal(args.path);
    if (refusal) return `${args.path} is ${refusal}.`;
    const ownIds = [...(recorded.creators?.entries() ?? [])].filter(([, c]) => c.actor === 'A').map(([id]) => id);
    const ownList = ownIds.slice(0, 8).join(', ') || 'none yet';
    const ids = recordIdsInUrl(new URL(args.path, session.origin).toString());
    if (!ids.length) return `${args.path} names no record. Give the page of a record actor A created in this run (records: ${ownList}).`;
    const foreign = ids.filter((id) => recorded.creators?.get(id)?.actor !== 'A');
    if (foreign.length) return `Only records Oddhound saw actor A create in this run can be used; ids are never guessed. Not created by actor A here: ${foreign.join(', ')} (records actor A created: ${ownList}).`;
    const id = ids[0]!;
    const setup = recorded.createdBy!.get(id)!;
    const protect = distinctiveValues(setup.fields);
    if (!protect.length) return `The form that created record ${id} held no distinctive text (only short values, numbers, dates or emails), so a leak could not be told apart from chance. Create a record with a distinctive free-text value first.`;
    const blocked = await ensureActorB();
    if (blocked) {
      await ev('scenario.blocked', { family: 'two_actors', check: 'cross_actor', reason: blocked });
      return `Cannot run the cross-actor check: ${blocked}. Scenario outcome: blocked.${afterCheck()}`;
    }
    // The page the create landed on lists actor A's records when it names no record itself.
    const landed = recorded.creators!.get(id)!.landed;
    const listPath = recordIdsInUrl(new URL(landed, session.origin).toString()).length ? undefined : landed;
    await ev('scenario.started', { family: 'two_actors', check: 'cross_actor', path: args.path, protect: protect.map((p) => p.field) });
    await switchActor('A');
    await openPath(args.path, 'Cross-actor check, actor A (owner)');
    const ownerView = await view();
    await switchActor('B');
    await openPath('/', 'Cross-actor check, actor B on its own home page');
    const otherHome = await view();
    let otherList: PageView | undefined;
    if (listPath) { await openPath(listPath, 'Cross-actor check, actor B on its own list'); otherList = await view(); }
    await openPath(args.path, 'Cross-actor check, actor B opens actor A\'s record');
    const otherView = await view();
    const afterControls: { control: string; clicked: boolean; ownerAfter: PageView }[] = [];
    const tried: { target: string; role: 'button' | 'link' }[] = [];
    const notOffered: string[] = [];
    for (const label of (writesPermitted(contract) ? args.try_controls ?? [] : [])) {
      if (afterControls.length) { await switchActor('B'); await openPath(args.path, 'Cross-actor check, actor B reopens the record'); }
      const obs = session.lastObservation!;
      const hit = findByLabel(obs.elements, 'click', label);
      const el = 'ref' in hit ? obs.elements.find((e) => e.ref === hit.ref) : undefined;
      if (!el || (el.kind !== 'button' && el.kind !== 'link')) { notOffered.push(label); continue; }
      session.beginTurn();
      const loc = await session.locate(el.ref).catch((e: Error) => e);
      if (loc instanceof Error) { notOffered.push(label); continue; }
      await runBrowserAction('click', { ref: el.ref }, `Actor B pressed ${el.kind} "${el.label}" on actor A's record`, async () => {
        await loc.click({ timeout: 5_000 }); await (await session.page()).waitForLoadState('domcontentloaded');
      }, { quiet: true });
      const clicked = !(lastStep as StepInfo | null)?.error;
      tried.push({ target: el.label, role: el.kind });
      await switchActor('A');
      await openPath(args.path, 'Cross-actor check, actor A reopens its record');
      afterControls.push({ control: el.label, clicked, ownerAfter: await view() });
    }
    await switchActor('A');
    const v = judgeCrossActor(protect, { ownerView, otherHome, otherList, otherView, afterControls });
    await ev('scenario.finished', { family: 'two_actors', check: 'cross_actor', outcome: v.outcome, path: args.path, privacyEstablished: v.privacyEstablished, leaked: v.leaked, changedBy: v.changedBy, notOffered });
    const offered = notOffered.length ? ` Not offered to actor B: ${notOffered.map((c) => JSON.stringify(c)).join(', ')}.` : '';
    if (v.outcome !== 'failed') return `Cross-actor check ${v.outcome}: ${v.detail}.${offered}${v.outcome === 'passed' ? ' No finding.' : ''} You are actor A again.${afterCheck()}`;
    const auth = recorded.auth as Extract<AuthRecipe, { kind: 'register' }>;
    const scenario: Scenario = {
      kind: 'cross_actor', device: session.device, auth, setup, path: swapId(args.path, id, '{id}'), ...(listPath ? { listPath } : {}),
      protect: protect.map((p) => p.field), controls: tried.filter((c) => v.changedBy.includes(c.target)), expectation: 'denied',
    };
    const route = args.path.split('?')[0]!.replace(/\/\d+(?=\/|$)/g, '/:id');
    const title = `Another account can ${[v.leaked.length ? 'see' : '', v.changedBy.length ? 'change' : ''].filter(Boolean).join(' and ')} a user's record at ${route}`;
    const prior = await addFamilyCandidate({
      title, ruleId: 'B7', impact: 'high', observed: `${v.detail}.`.slice(0, 500), scenario, actor: 'A+B', device: session.device, source: 'agent', family: 'two_actors',
      ...(v.privacyEstablished ? {} : { hypothesis: listPath ? `Actor B's own ${listPath} also showed this record, so the site may show it to everyone on purpose.` : 'The create did not land on a list of actor A\'s records, so Oddhound could not show that the site treats this record as private.' }),
      contexts: `actor A (creator) and actor B (a separate fresh account), ${session.device}`,
      limitations: 'Only a record created in this run was opened, by its exact URL through the UI as a normal user; no ids were guessed and no direct API request was made (that is the separate authorized request mode).',
    });
    if (prior) return `${mergedText(prior)}${afterCheck()}`;
    return `Cross-actor check FAILED: ${v.detail}.${offered} Recorded as a candidate${v.privacyEstablished ? '' : ' for review (privacy not established)'}; Oddhound will replay it with two fresh accounts. You are actor A again.${afterCheck()}`;
  };

  /** Family 4: the form the model just filled, submitted by Oddhound with an ordinary interruption; code counts the records. */
  const checkInterruption = async (args: { kind: Exclude<Interruption, 'none'>; submit: string; field: string; list_path: string; rule_id?: string }): Promise<string> => {
    if (!writesPermitted(contract) || !contract.capabilities.repeatSubmission) return 'Repeated or interrupted submits are not permitted by this run contract.';
    const o = session.lastObservation;
    if (!o) return 'Observe the page first.';
    const formUrl = new URL(o.url);
    const values = typed.get(formUrl.pathname);
    if (!values?.size) return 'Fill the form on this page first (do not submit it), then call check_interruption.';
    const label = closestLabel(args.field, new Set(values.keys()));
    const value = values.get(label);
    if (value === undefined) return `"${args.field}" was not filled on this page. Filled here: ${[...values.keys()].map((k) => JSON.stringify(k)).join(', ')}.`;
    if (!distinctiveValues({ [label]: value }).length) return `"${label}" must hold distinctive free text (e.g. "Retry check 4K"), so Oddhound can count the records it creates.`;
    const refusal = pathRefusal(args.list_path);
    if (refusal) return `list_path ${args.list_path} is ${refusal}.`;
    const hit = findByLabel(o.elements, 'click', args.submit);
    const button = 'ref' in hit ? o.elements.find((e) => e.ref === hit.ref) : undefined;
    if (!button || button.kind !== 'button') return `No submit button "${args.submit}" on this page.`;
    const form = { path: `${formUrl.pathname}${formUrl.search}`, fields: Object.fromEntries(values), submit: button.label };
    const count = async (why: string) => { await openPath(args.list_path, why); return occurrences((await view()).text, value); };
    await ev('scenario.started', { family: 'interruption', kind: args.kind, form: form.path, list: args.list_path });
    const before = await count('Interruption check, records before');
    await openPath(form.path, 'Interruption check, reopened the form');
    let claimedWhileOffline = false;
    await runBrowserAction('interrupt', { kind: args.kind, fields: Object.keys(form.fields), submit: form.submit }, `Filled the form and submitted it with an interruption (${args.kind.replace(/_/g, ' ')})`,
      async () => { claimedWhileOffline = (await submitWithInterruption(await session.page(), form, {}, args.kind)).claimedWhileOffline; }, { quiet: true });
    const failure = (lastStep as StepInfo | null)?.error;
    if (failure) return `The interrupted submit could not run: ${failure}.${afterCheck()}`;
    const afterInterruption = await count('Interruption check, records after');
    let afterRetry: number | undefined;
    if (afterInterruption === before) {
      await openPath(form.path, 'Interruption check, back to the form to retry');
      await runBrowserAction('interrupt', { kind: 'none', fields: Object.keys(form.fields), submit: form.submit }, 'Submitted the form again normally (one retry)',
        async () => { await submitWithInterruption(await session.page(), form, {}, 'none'); }, { quiet: true });
      afterRetry = await count('Interruption check, records after the retry');
    }
    const v = judgeInterruption({ kind: args.kind, before, afterInterruption, afterRetry, claimedWhileOffline });
    await ev('scenario.finished', { family: 'interruption', kind: args.kind, outcome: v.outcome, before, afterInterruption, afterRetry: afterRetry ?? null, claimedWhileOffline, created: v.created });
    if (v.outcome !== 'failed') return `Interruption check ${v.outcome}: ${v.detail}.${v.outcome === 'passed' ? ' No finding.' : ''}${afterCheck()}`;
    const explicit = contract.rules.find((r) => r.id === args.rule_id && r.source !== 'baseline');
    const scenario: Scenario = {
      kind: 'interruption', device: session.device, ...(recorded.auth ? { auth: recorded.auth } : {}),
      form: { path: form.path, fields: Object.fromEntries(Object.entries(form.fields).map(([k, x]) => [k, asTemplateValue(x)])), submit: form.submit },
      listPath: args.list_path, value: asTemplateValue(value), interruption: args.kind,
    };
    const title = v.created > 1
      ? `${args.kind === 'double_submit' ? `Pressing "${form.submit}" twice` : `Interrupting "${form.submit}" (${args.kind.replace(/_/g, ' ')})`} creates ${v.created} records`
      : `The page reports success offline, but nothing is saved (${formUrl.pathname})`;
    const prior = await addFamilyCandidate({
      title: title.slice(0, 140), ruleId: explicit?.id ?? 'interruption', impact: 'medium', observed: `${v.detail}.`.slice(0, 500), scenario, actor: session.actor, device: session.device, source: 'agent', family: 'interruption',
      ...(explicit ? {} : { hypothesis: 'One user\'s interrupted submit was expected to create at most one record and never to report a save that did not happen; no explicit or owner-approved rule says so.' }),
      contexts: `actor ${session.actor}, ${session.device}; control: the same form submitted once, normally`,
      limitations: `Records were counted by how often the submitted "${label}" text appears on ${args.list_path}.${args.kind === 'offline_submit' ? ' Offline was simulated in the browser (context.setOffline): a client condition, not proof of server behaviour under a real network failure.' : ''}`,
    });
    if (prior) return `${mergedText(prior)}${afterCheck()}`;
    return `Interruption check FAILED: ${v.detail}. Recorded as a candidate${explicit ? ` against ${explicit.id}` : ' for review (no explicit rule)'}; Oddhound will replay it next to a normal single submit.${afterCheck()}`;
  };

  /** Family 5: the same page for the same account on desktop and on a phone; code compares the page's own actions. */
  const checkDifferential = async (args: { path: string; controls?: string[]; rule_id?: string }): Promise<string> => {
    const refusal = pathRefusal(args.path);
    if (refusal) return `${args.path} is ${refusal}.`;
    if (!contract.devices.includes('mobile') || !contract.devices.includes('desktop')) return 'This run does not enable both the desktop and the mobile profile.';
    const startDevice = session.device;
    const read = async (device: 'desktop' | 'mobile'): Promise<ContextControls> => {
      if (session.device !== device) await runBrowserAction('set_device', { device }, `Switched to ${device}`, async () => { await session.setDevice(device); }, { quiet: true });
      await openPath(args.path, `Differential check on ${device}`);
      const o = session.lastObservation!;
      const controls = o.elements
        .filter((e) => !e.region && (e.kind === 'button' || e.kind === 'link') && !e.disabled && e.label)
        .map((e) => ({ label: e.label, role: e.kind as 'button' | 'link', covered: Boolean(e.coveredBy) }));
      return { context: device === 'mobile' ? 'a 390x844 phone' : 'desktop', controls, errors: o.errors };
    };
    await ev('scenario.started', { family: 'differential', compare: 'desktop_vs_mobile', path: args.path });
    const desk = await read('desktop');
    const phone = await read('mobile');
    if (session.device !== startDevice) await runBrowserAction('set_device', { device: startDevice }, `Switched to ${startDevice}`, async () => { await session.setDevice(startDevice); }, { quiet: true });
    const v = judgeDifferential(desk, phone, args.controls);
    await ev('scenario.finished', { family: 'differential', compare: 'desktop_vs_mobile', outcome: v.outcome, path: args.path, missing: v.missing, errorsOnlyIn: v.errorsOnlyIn });
    if (v.outcome !== 'failed') return `Differential check ${v.outcome}: ${v.detail}.${v.outcome === 'passed' ? ' No finding.' : ''}${afterCheck()}`;
    const absent = v.missing.filter((m) => m.why === 'absent');
    const others = [...v.missing.filter((m) => m.why === 'covered').map((m) => `"${m.label}" is covered on the phone (report it as mobile_reachability)`), ...v.errorsOnlyIn.map((e) => `an error only the phone shows: ${JSON.stringify(e.slice(0, 80))}`)];
    if (!absent.length) return `Differences seen, but none is a missing control: ${others.join('; ')}. No candidate recorded.${afterCheck()}`;
    const mine = [...(recorded.creators?.entries() ?? [])].filter(([, c]) => c.actor === session.actor).map(([id]) => id);
    const id = recordIdsInUrl(new URL(args.path, session.origin).toString()).find((x) => mine.includes(x));
    const explicit = contract.rules.find((r) => r.id === args.rule_id && r.source !== 'baseline');
    const scenario: Scenario = {
      kind: 'differential', device: 'desktop', ...(recorded.auth ? { auth: recorded.auth } : {}), ...(id ? { setup: recorded.createdBy!.get(id)! } : {}),
      path: id ? swapId(args.path, id, '{id}') : args.path, compare: 'desktop_vs_mobile', controls: absent.slice(0, 6).map((m) => ({ label: m.label, role: m.role })),
    };
    const route = routePattern(new URL(args.path, session.origin).toString());
    const title = `${absent.map((m) => `"${m.label}"`).join(', ')} ${absent.length === 1 ? 'is' : 'are'} missing on a phone at ${route}`;
    const prior = await addFamilyCandidate({
      title: title.slice(0, 140), ruleId: explicit?.id ?? 'differential', impact: 'medium', observed: `${v.detail}.`.slice(0, 500), scenario, actor: session.actor, device: 'desktop+mobile', source: 'agent', family: 'differential',
      ...(explicit ? {} : { hypothesis: 'The phone layout was expected to offer the same actions as desktop. A phone layout may move an action into a menu on purpose; no explicit or owner-approved rule says they must match.' }),
      contexts: `actor ${session.actor} on desktop (1440x900) and on a phone (390x844), same account`,
      limitations: 'Only controls in the page\'s main content were compared (menus and headers legitimately collapse on phones); digits in labels were ignored. A control moved into a menu on the phone counts as missing.',
    });
    if (prior) return `${mergedText(prior)}${afterCheck()}`;
    return `Differential check FAILED: ${v.detail}.${others.length ? ` Also: ${others.join('; ')}.` : ''} Recorded as a candidate${explicit ? ` against ${explicit.id}` : ' for review (no explicit rule says the layouts must match)'}.${afterCheck()}`;
  };

  /** Family 3: invariants the model proposed, re-checked by code after every later step on their page. */
  type Watched = { route: string; path: string; actor: string; device: 'desktop' | 'mobile'; inv: Invariant; evidence: string; explicit?: { id: string }; failed: boolean };
  const judgeHere = async (w: Watched): Promise<InvariantVerdict> => judgeInvariant(w.inv, { text: (await view()).text, tables: await readTables(await session.page()) });
  const invariantCandidate = async (w: Watched, v: InvariantVerdict, when: string): Promise<Candidate | null> => {
    w.failed = true;
    const mine = [...(recorded.creators?.entries() ?? [])].filter(([, c]) => c.actor === w.actor).map(([id]) => id);
    const inPath = recordIdsInUrl(new URL(w.path, session.origin).toString()).find((id) => mine.includes(id));
    // Recreate the run's own records the page summarises, from the first one and in creation order, so the
    // page looks as it did (keeping only the last few once hid a skipped first row behind a party of 0).
    // A record named in the path is created last, as {id}.
    const ids = [...mine.filter((id) => id !== inPath).slice(0, inPath ? 3 : 4), ...(inPath ? [inPath] : [])];
    const scenario: Scenario = {
      kind: 'invariant', device: w.device, ...(recorded.auth ? { auth: recorded.auth } : {}), setups: ids.map((id) => recorded.createdBy!.get(id)!),
      path: inPath ? swapId(w.path, inPath, '{id}') : w.path, invariant: w.inv,
    };
    const title = w.inv.kind === 'sum' ? `"${w.inv.total}" does not equal the sum of the "${w.inv.column}" values on ${w.route}` : `"${w.inv.total}" does not match the number of rows on ${w.route}`;
    const prior = await addFamilyCandidate({
      title: title.slice(0, 140), ruleId: w.explicit?.id ?? 'invariant', impact: 'medium', observed: `${when}: ${v.detail}.`.slice(0, 500), scenario, actor: w.actor, device: w.device, source: 'agent', family: 'invariant',
      ...(w.explicit ? {} : { hypothesis: `An invariant the model proposed from the page, not stated by the page or the owner: ${w.evidence}` }),
      contexts: `actor ${w.actor}, ${w.device}; numbers parsed by Oddhound from the page`,
      limitations: `${NUMBER_ASSUMPTIONS} Only what the page displays was compared; a charge, discount or row the page does not show would change the expected value. The replay recreates up to ${ids.length} of this run's own records first.`,
    });
    return prior;
  };
  /** After each action: re-check the invariants registered for the page it ended on. Returns notes for the model. */
  const recheckInvariants = async (o: Observation): Promise<string[]> => {
    const notes: string[] = [];
    for (const w of watched.values()) {
      if (w.failed || w.actor !== session.actor || w.device !== session.device || routePattern(o.url) !== w.route) continue;
      const v = await judgeHere(w);
      if (v.outcome !== 'failed') continue;
      await ev('scenario.finished', { family: 'invariant', outcome: 'failed', route: w.route, invariant: w.inv, values: v.values, after: 'a later step' });
      const prior = await invariantCandidate(w, v, 'After a later step');
      notes.push(prior ? `ODDHOUND INVARIANT BROKEN on ${w.route}: ${v.detail}. ${mergedText(prior)}` : `ODDHOUND INVARIANT BROKEN on ${w.route}: ${v.detail}. Recorded for replay${w.explicit ? '' : ' (for review: no explicit rule)'}.`);
    }
    return notes;
  };
  const checkInvariant = async (args: { kind: 'sum' | 'count'; total_label: string; column?: string; evidence: string; rule_id?: string }): Promise<string> => {
    const o = session.lastObservation;
    if (!o) return 'Observe the page first.';
    if (args.kind === 'sum' && !args.column) return 'A sum needs column: the table column whose values should add up to the total.';
    const inv: Invariant = args.kind === 'sum' ? { kind: 'sum', total: args.total_label, column: args.column! } : { kind: 'count', total: args.total_label, ...(args.column ? { column: args.column } : {}) };
    const explicit = contract.rules.find((r) => r.id === args.rule_id && r.source !== 'baseline');
    const u = new URL(o.url);
    const w: Watched = { route: routePattern(o.url), path: `${u.pathname}${u.search}`, actor: session.actor, device: session.device, inv, evidence: args.evidence, ...(explicit ? { explicit: { id: explicit.id } } : {}), failed: false };
    const v = await judgeHere(w);
    await ev('scenario.finished', { family: 'invariant', outcome: v.outcome, route: w.route, invariant: inv, values: v.values, rule: explicit?.id ?? null });
    if (v.outcome === 'inconclusive') return `Cannot check that invariant here: ${v.detail}. Not registered.`;
    watched.set(`${w.route}|${JSON.stringify(inv)}|${w.actor}|${w.device}`, w);
    if (v.outcome === 'passed') return `Invariant holds: ${v.detail}. Oddhound re-checks it after every later step on ${w.route}.${afterCheck()}`;
    const prior = await invariantCandidate(w, v, 'When first checked');
    if (prior) return `Invariant BROKEN: ${v.detail}. ${mergedText(prior)}${afterCheck()}`;
    return `Invariant BROKEN: ${v.detail}. Recorded as a candidate${explicit ? ` against ${explicit.id}` : ' for review (no explicit rule; cite an owner rule in rule_id when one states it)'}.${afterCheck()}`;
  };

  /** Family 2 (same actor, two tabs): a save from an out-of-date tab must not silently undo the other tab's. */
  const checkTwoTabs = async (args: { path: string; first: { field: string; value: string }; second: { field: string; value: string }; rule_id?: string }): Promise<string> => {
    const refusal = pathRefusal(args.path);
    if (refusal) return `${args.path} is ${refusal}.`;
    const ids = recordIdsInUrl(new URL(args.path, session.origin).toString());
    const mine = [...(recorded.creators?.entries() ?? [])].filter(([, c]) => c.actor === session.actor).map(([id]) => id);
    if (!ids.length || ids.some((id) => !mine.includes(id))) return `Use the edit page of a record actor ${session.actor} created in this run (records: ${mine.slice(0, 8).join(', ') || 'none yet'}); ids are never guessed.`;
    if (!writesPermitted(contract) || !contract.capabilities.editRecords) return 'Editing records is not permitted by this run contract.';
    const id = ids[0]!;
    await ev('scenario.started', { family: 'two_actors', check: 'two_tabs', path: args.path });
    await openPath(args.path, 'Two-tab check, first tab');
    const tab1 = await session.page();
    const labels = new Set(session.lastObservation?.elements.filter((e) => e.kind === 'input' || e.kind === 'textarea' || e.kind === 'select').map((e) => e.label) ?? []);
    const first = { field: closestLabel(args.first.field, labels), value: args.first.value };
    const second = { field: closestLabel(args.second.field, labels), value: args.second.value };
    const unknown = [first.field, second.field].filter((f) => !labels.has(f));
    if (unknown.length || first.field === second.field) return `Give two different field labels of the form on ${args.path}. Labels there: ${[...labels].map((l) => JSON.stringify(l)).join(', ')}.`;
    const tab2 = await tab1.context().newPage();
    tab2.on('dialog', (d) => { void d.dismiss().catch(() => {}); });
    try {
      let failure: string | null = null;
      const step = async (desc: string, args2: Record<string, unknown>, fn: () => Promise<void>) => {
        await runBrowserAction('second_tab', args2, desc, fn, { quiet: true });
        failure ??= (lastStep as StepInfo | null)?.error ?? null;
      };
      await step('Opened the same page in a second tab', { tab: 2, path: args.path }, async () => { await tab2.goto(new URL(args.path, session.origin).toString(), { waitUntil: 'domcontentloaded' }); });
      const original = { first: await fieldValue(tab1, first.field), second: await fieldValue(tab1, second.field) };
      let firstRejected = false, staleRejected = false;
      await step(`First tab: changed "${first.field}" and saved`, { tab: 1, field: first.field, value: first.value }, async () => { firstRejected = await saveField(tab1, first.field, first.value); });
      await step(`Second (out-of-date) tab: changed "${second.field}" and saved`, { tab: 2, field: second.field, value: second.value }, async () => { staleRejected = await saveField(tab2, second.field, second.value); });
      await openPath(args.path, 'Two-tab check, reopened the record');
      const final = { first: await fieldValue(await session.page(), first.field), second: await fieldValue(await session.page(), second.field) };
      if (failure) {
        await ev('scenario.finished', { family: 'two_actors', check: 'two_tabs', outcome: 'inconclusive', reason: failure });
        return `Two-tab check could not run: ${failure}.${afterCheck()}`;
      }
      const v = judgeTwoTabs({ original, wanted: { first: first.value, second: second.value }, firstRejected, staleRejected, final });
      await ev('scenario.finished', { family: 'two_actors', check: 'two_tabs', outcome: v.outcome, path: args.path, original, final, staleRejected });
      if (v.outcome !== 'failed') return `Two-tab check ${v.outcome}: ${v.detail}.${v.outcome === 'passed' ? ' No finding.' : ''}${afterCheck()}`;
      const explicit = contract.rules.find((r) => r.id === args.rule_id && r.source !== 'baseline');
      const scenario: Scenario = {
        kind: 'two_tab', device: session.device, ...(recorded.auth ? { auth: recorded.auth } : {}), setup: recorded.createdBy!.get(id)!, path: swapId(args.path, id, '{id}'),
        first: { field: first.field, value: asTemplateValue(first.value) }, second: { field: second.field, value: asTemplateValue(second.value) }, sequential: false, expectation: 'no_lost_update',
      };
      const title = `Saving from an out-of-date tab silently undoes "${first.field}" saved in another tab`;
      const prior = await addFamilyCandidate({
        title: title.slice(0, 140), ruleId: explicit?.id ?? 'lost_update', impact: 'medium', observed: `Two tabs on ${args.path}: ${v.detail}.`.slice(0, 500), scenario, actor: session.actor, device: session.device, source: 'agent', family: 'two_actors',
        ...(explicit ? {} : { hypothesis: 'A save from an out-of-date page should be refused or merged rather than silently undo a change saved from another tab. Last-write-wins may be intended; no explicit or owner-approved rule says otherwise.' }),
        contexts: `actor ${session.actor}, two tabs of one ${session.device} session; control: the same two edits one after the other in one tab`,
        limitations: 'Two tabs of one browser session on a record created in this run. Two separate devices or accounts editing at the same moment were not tested.',
      });
      if (prior) return `${mergedText(prior)}${afterCheck()}`;
      return `Two-tab check FAILED: ${v.detail}. Recorded as a candidate${explicit ? ` against ${explicit.id}` : ' for review (no explicit rule; give rule_id when an owner rule covers it)'}; Oddhound will replay it with a one-tab control.${afterCheck()}`;
    } finally {
      await tab2.close().catch(() => {});
    }
  };

  const dispatch = async (call: ToolCall): Promise<{ text: string; image?: Buffer }> => {
    const name = call.function.name as ToolName;
    const schema = ToolArgs[name];
    if (!schema) return { text: `Unknown tool "${call.function.name}".` };
    if (!toolOffered(mode, name)) return { text: `Tool "${name}" is not available in this run.` };
    let raw: unknown;
    try { raw = JSON.parse(call.function.arguments || '{}'); } catch { return { text: 'Invalid JSON arguments.' }; }
    // R4 run 1: the model repeatedly nested control_values inside the scenario, where validation dropped
    // them and the report was refused 7 times. Accept them there too.
    if (name === 'report_candidate' && raw && typeof raw === 'object') {
      const r = raw as { scenario?: { control_values?: unknown }; control_values?: unknown };
      if (r.control_values === undefined && r.scenario && typeof r.scenario === 'object' && r.scenario.control_values !== undefined) r.control_values = r.scenario.control_values;
    }
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
        pagesSincePlan.clear();
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
        const labelOfStep = (st: Record<string, any>) => typeof st.label === 'string' ? st.label : modelObs.elements.find((e) => e.ref === st.ref)?.label;
        const no = batches.size + 1;
        const rec: BatchRecord = { no, goal: args.goal, steps: [] };
        batches.set(no, rec);
        await ev('batch.started', { batch: no, goal: args.goal, steps: steps.length });
        let rebased = false;
        // Refs come from the observation the model planned from. After the page changes, the same
        // control is found again only when exactly one element has the same kind, label, name and type.
        const resolveRef = async (r: string, tool: string): Promise<string | { error: string }> => {
          const want = modelObs.elements.find((e) => e.ref === r);
          if (!want) return { error: `${r} is not in the observation this batch was planned from; name controls on later pages by label` };
          if (!rebased && await session.hasRef(r)) return r;
          const cur = await session.observe();
          const same = cur.elements.filter((e) => e.kind === want.kind && e.label === want.label && (e.name ?? '') === (want.name ?? '') && (e.type ?? '') === (want.type ?? ''));
          if (same.length === 1) { session.beginTurn(); rebased = true; return same[0]!.ref; }
          // The page re-rendered the control differently (another kind, name or type): fall back to its label.
          const byText = want.label ? findByLabel(cur.elements, tool, want.label) : { error: '' };
          if ('ref' in byText) { session.beginTurn(); rebased = true; return byText.ref; }
          return { error: `${want.kind} "${want.label}" is ${same.length ? 'ambiguous' : 'no longer on the page'} after the page changed` };
        };
        // A control named by its label is found on the page as it is now, so it works after any navigation.
        const resolveLabel = async (label: string, tool: string): Promise<string | { error: string }> => {
          const cur = await session.observe();
          const hit = findByLabel(cur.elements, tool, label);
          if ('error' in hit) return hit;
          session.beginTurn(); rebased = true;
          return hit.ref;
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
            const { label: byLabelText, ...restNoLabel } = rest as Record<string, any>;
            const callArgs: Record<string, unknown> = { ...restNoLabel };
            let refError: string | null = null;
            if (['click', 'fill', 'fill_credential', 'select_option'].includes(tool) && typeof rest.ref !== 'string') {
              if (typeof byLabelText !== 'string') refError = 'give a ref or a label';
              else { const r = await resolveLabel(byLabelText, tool); if (typeof r !== 'string') refError = r.error; else callArgs.ref = r; }
            }
            for (const k of ['ref', 'target'] as const) {
              if (refError || typeof rest[k] !== 'string') continue;
              const r = await resolveRef(rest[k], k === 'target' ? 'click' : tool);
              if (typeof r !== 'string') { refError = r.error; break; }
              callArgs[k] = r;
            }
            if (refError) { surprise = 'stale element'; lines.push(`step ${i + 1} ${tool}: not run (${refError})`); break; }
            const pathBefore = new URL((await session.page()).url()).pathname;
            const ident = labelOfStep(st as Record<string, any>) ?? ['path', 'key', 'to', 'direction', 'value', 'ref'].map((k) => (st as Record<string, any>)[k]).filter((x) => x !== undefined).join(' ');
            const failKey = stepKey(session.lastObservation ?? modelObs, tool, ident);
            const prior = failedSteps.get(failKey);
            if (prior && prior.count >= 2) {
              surprise = 'a step that keeps failing here';
              await ev('batch.refused', { batch: no, step: i + 1, tool, label: labelOfStep(st as Record<string, any>) ?? null, failures: prior.count });
              lines.push(`step ${i + 1} ${tool} "${labelOfStep(st as Record<string, any>) ?? ''}": not run: it already failed ${prior.count} times with the page exactly like this (last #${prior.seq}: ${prior.error}). Change the page first (close the dialog, fill the required field) or test something else.`);
              break;
            }
            lastStep = null;
            const out = await dispatch({ id: `${call.id}:b${i}`, type: 'function', function: { name: tool, arguments: JSON.stringify(callArgs) } } as ToolCall);
            const info = lastStep as StepInfo | null;
            if (!info) { surprise = 'step refused'; lines.push(`step ${i + 1} ${tool}: refused: ${out.text.split('\n')[0]!.slice(0, 200)}`); break; }
            const recStep: BatchRecord['steps'][number] = { seq: info.seq, ...(expect ? { expect } : {}), ...(info.stated ? { stated: info.stated } : {}) };
            rec.steps.push(recStep);
            let line = `step ${i + 1} ${tool} #${info.seq}: ${info.error ? `FAILED: ${info.error}` : 'ok'}${info.stated ? ` (value from stated ${info.stated})` : ''}`;
            if (info.error) {
              surprise = 'a step failed';
              failedSteps.set(failKey, { count: (failedSteps.get(failKey)?.count ?? 0) + 1, seq: info.seq, error: info.error });
            }
            if (info.notes.length) { line += ` | ${info.notes.join(' | ')}`; surprise ??= 'Oddhound detected a problem'; }
            if (info.dialogs.length) { line += ` | dialog dismissed: ${info.dialogs.join(' | ')}`; surprise ??= 'a dialog opened'; }
            const saved = /SAVE REPORTED: .*/.exec(out.text)?.[0];
            if (saved) line += ` | ${saved}`;
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
              // Refs were planned on the old page, so the model must look first; steps that name controls by
              // label (or need no control) are found on the new page and the batch carries on.
              if (usesRef(steps[i + 1]!)) surprise ??= 'new page state without an expectation';
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
      case 'check_claim':
        return { text: await checkClaim(args as { claim?: string; fields: string[]; revisit_path?: string }) };
      case 'check_cross_actor':
        return { text: await checkCrossActor(args as { path: string; try_controls?: string[] }) };
      case 'check_two_tabs':
        return { text: await checkTwoTabs(args as Parameters<typeof checkTwoTabs>[0]) };
      case 'check_invariant':
        return { text: await checkInvariant(args as Parameters<typeof checkInvariant>[0]) };
      case 'check_differential':
        return { text: await checkDifferential(args as Parameters<typeof checkDifferential>[0]) };
      case 'check_interruption':
        return { text: await checkInterruption(args as Parameters<typeof checkInterruption>[0]) };
      case 'report_candidate': {
        if (args.scenario.kind === 'claim_check' || args.scenario.kind === 'cross_actor' || args.scenario.kind === 'two_tab' || args.scenario.kind === 'invariant' || args.scenario.kind === 'differential' || args.scenario.kind === 'interruption') {
          const tool = ({ claim_check: 'check_claim', cross_actor: 'check_cross_actor', two_tab: 'check_two_tabs', invariant: 'check_invariant', differential: 'check_differential', interruption: 'check_interruption' } as Record<string, string>)[args.scenario.kind as string];
          return { text: `Do not write ${args.scenario.kind} scenarios yourself: call ${tool}; Oddhound records the candidate from what it observes.` };
        }
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
          const rp = withRecordSetup(start, steps, recorded);
          const scenario: Scenario = { kind: 'batch', device: logs[0]!.device, ...(auth ? { auth } : {}), ...(rp.setup ? { setup: rp.setup } : {}), start: rp.start, steps: rp.steps, oracleStep };
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
          const rp = withRecordSetup(t.start, t.steps.map((step) => ({ step })), recorded);
          const scenario: Scenario = { kind: 'trace', device: t.device, ...(auth ? { auth } : {}), ...(rp.setup ? { setup: rp.setup } : {}), start: rp.start, steps: rp.steps.map((x) => x.step), oracle: args.scenario.oracle };
          const knownRule = contract.rules.some((r) => r.id === args.rule_id) || BASELINE_RULES.some((r) => r.id === args.rule_id);
          candidates.push({ title: args.title, ruleId: args.rule_id, impact: args.impact, observed: args.observed, scenario, actor: t.actor, device: t.device, source: 'agent' });
          await ev('finding.candidate', { title: args.title, ruleId: args.rule_id, kind: 'trace', source: 'agent', steps: t.steps.length });
          return { text: knownRule ? `Candidate recorded (${t.steps.length} replay steps from ${t.start}). Oddhound will replay it in a fresh session.` : `Recorded as needs-review: "${args.rule_id}" is not an owner or baseline rule.` };
        }
        const known = contract.rules.some((r) => r.id === args.rule_id) || BASELINE_RULES.some((r) => r.id === args.rule_id);
        // One verified reproduction per rule and scenario kind is enough; repeated reports only cost turns.
        const same = candidates.find((c) => c.source === 'agent' && c.ruleId === args.rule_id && c.scenario.kind === args.scenario.kind);
        if (same) return { text: `Already recorded: "${same.title}" (${same.ruleId}, ${same.scenario.kind}). Oddhound will verify it; move on to the next charter.` };
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
        const budgetLeft = spentMicros < LIMITS.modelSpendPerRunMicros * 0.85 && Date.now() < expiresAt - verificationReserveMs() - 60_000;
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
        const clickPath = new URL((await session.page()).url()).pathname;
        let text = await runBrowserAction(name, args, `Clicked ${session.describe(args.ref)}`, async () => {
          const off = await disabledReason(loc);
          if (off) throw new Error(off);
          try { await loc.click({ timeout: 5_000 }); } catch (e) { throw new Error((await blockedReason(loc)) ?? (e as Error).message); }
          await (await session.page()).waitForLoadState('domcontentloaded');
        });
        await noteSubmit(clickPath, clickedLabel, (lastStep as StepInfo | null)?.seq);
        text += claimHint();
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
        await noteTyped(label, args.value);
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
            await noteTyped(label, f.value);
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
        await noteTyped(session.labelOf(args.ref), args.value);
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
      if (a.egress?.exhausted) return { stopReason: 'egress_cap' };
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
      let requestKey = `${runId}:turn:${turns}`;
      const r = await reserveSpend(db, { runId, account: a.run.spend_account, requestKey, micros: reserve, provider: provider.id, model: provider.model });
      if (!r.ok) { await ev('budget.denied', { reason: r.reason, attemptedMicros: reserve }); return { stopReason: `budget_${r.reason}` }; }
      let result;
      try {
        // Retries are explicit and budgeted (spec): every attempt is logged. Meta intermittently answers
        // `model_not_found` (HTTP 404, not billed) from some cloud networks, and occasionally a server error,
        // rate limit or timeout that clears moments later. An attempt that may have been billed keeps its
        // reservation counted as unknown spend, and the retry reserves again, so the per-run cap still holds.
        let serverRetries = 0;
        for (let attempt = 1; ; attempt++) {
          try {
            result = await provider.chat({ messages, tools, maxOutputTokens: LIMITS.maxOutputTokens, temperature: 0.2, signal: abort.signal });
            break;
          } catch (e) {
            if (!(e instanceof ProviderError) || abort.signal.aborted) throw e;
            const notFound = e.status === 404 && !e.maybeBilled && /model_not_found/.test(e.message);
            const passing = (e.kind === 'http' && (e.status === 429 || (e.status ?? 0) >= 500)) || e.kind === 'timeout' || e.kind === 'network';
            if (notFound ? attempt >= 8 : !passing || serverRetries >= 3) throw e;
            if (passing) serverRetries++;
            await ev('provider.retry', { provider: provider.id, attempt, reason: notFound ? 'model_not_found' : e.status ? `http_${e.status}` : e.kind, billed: e.maybeBilled });
            if (e.maybeBilled) {
              await markSpendUnknown(db, requestKey);
              requestKey = `${runId}:turn:${turns}:retry${attempt}`;
              const again = await reserveSpend(db, { runId, account: a.run.spend_account, requestKey, micros: reserve, provider: provider.id, model: provider.model });
              if (!again.ok) { await ev('budget.denied', { reason: again.reason, attemptedMicros: reserve }); return { stopReason: `budget_${again.reason}` }; }
            }
            await sleep(notFound ? Math.min(4_000, 600 * attempt) : [2_000, 5_000, 10_000][serverRetries - 1]!);
            if (abort.signal.aborted) { await releaseSpend(db, requestKey); throw new FencedError('stop_or_expiry_during_inference'); }
            await assertLease(db, runId, generation);
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
        messages.push({ role: 'user', content: 'Continue by calling a tool: work on the next open charter in your test plan, add charters for anything new you found, or call finish_run if nothing worth testing is left.' });
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
      { const sp = await runSpend(db, runId); spentMicros = sp.settled + sp.outstanding; }
      const nearEnd = spentMicros >= LIMITS.modelSpendPerRunMicros * 0.9 || Date.now() > expiresAt - verificationReserveMs() - 90_000;
      if (nearEnd && !wrapUpSent && !finished) {
        // Budget awareness: tell the model to report what it found and wrap up before the hard limit.
        wrapUpSent = true;
        messages.push({ role: 'user', content: `The run is close to its money or time limit (${budgetText()}). Report any rule violations now with report_candidate, then call finish_run with a factual summary of what you covered.` });
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

/** Browser actions Oddhound takes itself for a behavioral check (ledgered like the model's own). */
type InternalTool = 'sign_up_actor' | 'second_tab' | 'interrupt';

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

/** A scenario that starts on (or opens) a record this run created gets a setup that creates its own record,
 *  and the record number in its paths becomes {id}; a fresh replay account cannot open the original. */
export function withRecordSetup<T extends { step: TraceStep; expect?: { path?: string } }>(start: string, steps: T[], recorded: Recorded): { start: string; steps: T[]; setup?: Setup; id?: string } {
  const pathIds = (p: string) => p.split('?')[0]!.split('/').filter((x) => /^\d{1,12}$/.test(x));
  const paths = [start, ...steps.flatMap((x) => (x.step.op === 'goto' ? [x.step.path] : []))];
  const id = paths.flatMap(pathIds).find((x) => recorded.createdBy?.has(x));
  if (!id) return { start, steps };
  const swap = (p: string, to: string) => p.replace(new RegExp(`/${id}(?=/|\\?|$)`, 'g'), `/${to}`);
  return {
    setup: recorded.createdBy!.get(id)!, id,
    start: swap(start, '{id}'),
    steps: steps.map((x) => ({
      ...x,
      step: x.step.op === 'goto' ? { ...x.step, path: swap(x.step.path, '{id}') } : x.step,
      ...(x.expect?.path ? { expect: { ...x.expect, path: swap(x.expect.path, ':id') } } : {}),
    })),
  };
}

export function groundCandidate(c: Candidate, recorded: Recorded): Candidate {
  const s = structuredClone(c.scenario) as Scenario;
  // Use the registration that actually worked. If the model omitted sign-in but Oddhound recorded one,
  // the form was observed while signed in, so the replay must sign in too.
  if (recorded.auth && s.kind !== 'cross_account_read') s.auth = recorded.auth;
  else if (recorded.auth && s.auth) s.auth = recorded.auth;
  // A submit label the model misremembered is replaced by the button Oddhound saw it click on that path.
  const groundSubmit = (path: string, submit: string) => {
    const seen = recorded.controlsByPath.get(path);
    const clicked = recorded.submitByPath?.get(path);
    const known = seen && [...seen].some((l) => l.toLowerCase().includes(submit.toLowerCase()));
    return !known && clicked ? clicked : submit;
  };
  let controlValues = c.controlValues;
  if (s.kind === 'form_rule') {
    const observed = recorded.labelsByPath.get(s.form.path);
    s.form.fields = groundFields(s.form.fields, observed);
    s.testedField = closestLabel(s.testedField, observed);
    s.form.submit = groundSubmit(s.form.path, s.form.submit);
    controlValues = controlValues ? groundFields(controlValues, observed) : undefined;
    // No valid neighbour given: use a value this form actually accepted for the tested field.
    if (s.expectation === 'rejected' && !controlValues?.[s.testedField]) {
      const bad = s.form.fields[s.testedField];
      const accepted = [...(recorded.acceptedByPath?.get(s.form.path)?.get(s.testedField) ?? [])].find((v) => v !== bad && v.trim() !== '');
      if (accepted !== undefined) controlValues = { ...controlValues, [s.testedField]: accepted };
    }
  }
  if (s.kind === 'cross_account_read') {
    s.create.fields = groundFields(s.create.fields, recorded.labelsByPath.get(s.create.path));
    s.create.submit = groundSubmit(s.create.path, s.create.submit);
  }
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
    if (s.expectation === 'rejected' && !c.controlValues?.[s.testedField]) problems.push(`Provide control_values (a top-level argument next to scenario) with a VALID value for ${JSON.stringify(s.testedField)} that must still be accepted, e.g. "control_values": {${JSON.stringify(s.testedField)}: "<valid value>"}.`);
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
      await attachScope(ctx, policy, (d) => { if (!d.allowed) ev('scope.denied', { url: redactUrl(d.url), method: d.method, reason: d.reason, phase: 'verification' }).catch(() => {}); });
      return ctx;
    },
    identity: () => syntheticIdentity(runId, 100 + ++n, contract.registration.emailDomain),
    onIdentityCreated: (role) => { ev('identity.created', { role, phase: 'verification' }).catch(() => {}); },
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

async function verifyCandidates(v: { db: Db; runId: string; generation: number; run: RunRow; contract: RunContract; candidates: Candidate[]; browser: ProvisionedBrowser; ev: (t: string, p?: Record<string, unknown>) => Promise<number>; handoffState?: StorageState; deadline?: number }) {
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
    const known = contract.rules.find((r) => r.id === c.ruleId) ?? BASELINE_RULES.find((r) => r.id === c.ruleId);
    const fingerprint = `${c.ruleId}|${c.scenario.kind}|${hash.slice(0, 16)}`;
    // A family check without an explicit rule is still replayed for evidence, against its stated hypothesis.
    const rule = known ?? (c.hypothesis ? { id: c.ruleId, text: c.hypothesis, source: 'hypothesis' as const } : undefined);
    if (v.deadline && Date.now() > v.deadline) {
      await db.query(`INSERT INTO findings (project_id, run_id, title, category, verification, impact, confidence, rule_id, rule_source, expected, observed, device, actor, limitations, fingerprint)
        VALUES ($1,$2,$3,'needs_review','candidate',$4,'low',$5,$6,$7,$8,$9,$10,'Not verified: the run ran out of time before Oddhound could replay it.',$11)`,
        [run.project_id, runId, c.title, c.impact, c.ruleId, rule?.source ?? 'agent hypothesis', rule?.text ?? 'No owner rule covers this behaviour.', c.observed, c.device, c.actor, fingerprint]);
      await ev('finding.not_verified', { title: c.title, reason: 'time' });
      continue;
    }
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
    // A cross-actor replay only shows a leak of private data when the site itself keeps the record off
    // the other account's list; otherwise the record may be public by design.
    const privacyUnproven = c.scenario.kind === 'cross_actor' && attempts.some((a) => a.outcome === 'failed' && a.details.privacyEstablished === false);
    const hypothesisOnly = Boolean(c.hypothesis) || privacyUnproven;
    if (hypothesisOnly && outcomes.every((o) => o === 'failed')) {
      verification = 'inconclusive'; category = 'needs_review';
      limitations = `Reproduced 2/2, but no explicit or owner-approved rule covers it, so it is for review, not a verified issue: ${c.hypothesis ?? 'actor B\'s own list also showed the record, so it may be public by design.'}`;
    } else if (outcomes.every((o) => o === 'failed')) {
      verification = 'verified'; category = 'verified_issue';
      const control = controlFor(c.scenario, c.controlValues);
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
    const ruleSource = rule.source === 'hypothesis' ? 'Agent hypothesis (no explicit or owner-approved rule)'
      : `${rule.source === 'owner' ? 'Owner rule' : rule.source === 'baseline' ? 'Oddhound baseline rule' : 'Demo target rule'} ${rule.id}${c.stated ? ` (page-stated: ${c.stated})` : ''}`;
    // Family findings say which contexts were used and what the check cannot show.
    const fullLimitations = [limitations, c.contexts ? `Contexts: ${c.contexts}.` : '', c.limitations ?? '', c.repeats && c.repeats > 1 ? `Exploration hit this same problem ${c.repeats} times; it is filed once.` : ''].filter(Boolean).join(' ').slice(0, 1500);
    const f = await db.query<{ id: string }>(`INSERT INTO findings (project_id, run_id, scenario_id, control_scenario_id, title, category, verification, lifecycle, impact, confidence, rule_id, rule_source, expected, observed, device, actor, limitations, fingerprint, evidence_ids, family)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
      [run.project_id, runId, scenarioId, controlScenarioId, c.title, category, verification, verification === 'verified' ? 'open' : null, c.impact,
        verification === 'verified' ? 'reproduced 2/2' : 'low', known ? c.ruleId : null, ruleSource.slice(0, 300),
        rule.text, observed, c.scenario.device, c.actor, fullLimitations, fingerprint, evidence, c.family ?? null]);
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
  const browser = await deps.runtime.provision({ runId: run.id, lab: deps.lab, onEgress: (d) => { if (!d.allowed) ev('egress.denied', { host: d.host, reason: d.reason }).catch(() => {}); } });
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
