// Executes one run end to end inside the trusted worker:
//   claim lease → re-verify ownership → select Meta provider → provision a fresh browser →
//   bounded model loop (budget reserved before every call, lease checked before every action) →
//   independent verification of candidates → deterministic configuration observations →
//   finalize, destroy the browser and record the truthful terminal status.

import type { Db } from '../db/pool.ts';
import { LIMITS } from '../contracts/limits.ts';
import { RunContractSchema, type RunContract } from '../contracts/contract.ts';
import type { RunStatus } from '../contracts/status.ts';
import { appendEvent, assertLease, claimRun, FencedError, setRunStatus, refundIfNeverStarted } from '../ledger/runs.ts';
import { reserveSpend, settleSpend, releaseSpend, markSpendUnknown } from '../ledger/spend.ts';
import { resolveCredential, storeCredential, syntheticIdentity } from '../ledger/credentials.ts';
import { saveArtifact } from '../artifacts/store.ts';
import type { BrowserRuntime, ProvisionedBrowser } from '../browser/runtime.ts';
import { newScopedContext } from '../browser/runtime.ts';
import { attachScope, policyFromContract, type ScopeDecision } from '../browser/scope.ts';
import { formatObservation, stateFingerprint, type Observation } from '../browser/snapshot.ts';
import type { LabProfile } from '../net/ip-policy.ts';
import { verifyOwnership, type VerificationMethod } from '../verification/ownership.ts';
import { ProviderError, type ChatMessage, type ChatProvider, type ToolCall } from '../providers/types.ts';
import { priceFor, inputTokenBound, reservationMicros, actualMicros } from '../providers/pricing.ts';
import { RunSession } from './session.ts';
import { TOOL_DEFINITIONS, ToolArgs, BROWSER_TOOLS, boundaryValues, type ToolName } from './tools.ts';
import { systemPrompt } from './prompt.ts';
import { controlFor, newReplaySessions, replayScenario, scenarioDefect, scenarioHash, type AuthRecipe, type ReplayEnv, type Scenario } from '../verifier/scenario.ts';

export type ExecuteDeps = {
  db: Db;
  runtime: BrowserRuntime;
  providers: ChatProvider[];
  workerId: string;
  lab?: LabProfile;
  hosted?: boolean; // hosted mode refuses a browser whose Chromium sandbox is not confirmed
  verify?: typeof verifyOwnership;
  allowOfflineTestDouble?: boolean; // local development and tests only; never in hosted mode
};

type Candidate = {
  title: string; ruleId: string; impact: 'high' | 'medium' | 'low'; observed: string;
  scenario: Scenario; controlValues?: Record<string, string>; actor: string; device: string;
};

type RunRow = {
  id: string; project_id: string | null; mode: string; origin: string; contract: unknown; spend_account: 'public' | 'judging' | 'development';
  parent_run_id: string | null; status: RunStatus;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

    // 4. Exploration with the Meta model.
    const candidates: Candidate[] = [];
    const recorded: Recorded = { auth: null, labelsByPath: new Map(), controlsByPath: new Map() };
    const loop = await agentLoop({ deps, runId, generation, contract, run, provider, price, session, ev, abort, candidates, recorded });
    if (loop.stopReason) stopReason = loop.stopReason;

    // 5. Independent verification of every candidate (fresh contexts, fresh identities).
    await ev('run.phase', { phase: 'verifying', candidates: candidates.length });
    await verifyCandidates({ db, runId, generation, run, contract, candidates, browser, ev });

    // 6. Deterministic configuration observations from captured responses (no model involvement).
    await recordConfigurationObservations(db, run, session, contract, ev);

    await finish(loop.stopReason?.startsWith('budget_') || loop.stopReason === 'limit_turns' || loop.stopReason === 'limit_actions' ? 'stopped' : 'completed', stopReason);
    return await done();
  } catch (e) {
    if (e instanceof FencedError || abort.signal.aborted) {
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
  let pendingAuth: { path: string; fields: Record<string, string> } | null = null;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(contract) },
    { role: 'user', content: `Begin. You are actor A on desktop, on ${contract.target.origin}/. Start with observe.` },
  ];
  const toolsJson = JSON.stringify(TOOL_DEFINITIONS);
  const identities: { ref: string; name: string; email: string }[] = [];
  const secrets = new Set<string>();
  let turns = 0, actions = 0, lastActionAt = 0, nudges = 0, seq = 0;
  let previousState: string | null = null;
  let finished: string | undefined;

  const recordState = async (o: Observation, label: string, actionId: string | null) => {
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
  };

  const runBrowserAction = async (tool: ToolName, args: Record<string, unknown>, describe: string, fn: () => Promise<void>): Promise<string> => {
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
    let error: string | null = null;
    try { await fn(); } catch (e) { error = (e as Error).message.split('\n')[0]!.slice(0, 240); }
    const left = await session.enforceMainFrameOrigin();
    if (left) await ev('scope.denied', { url: redactUrl(left), reason: 'main_frame_left_verified_origin', recovered: true });
    const after = (await session.page()).url();
    await db.query(`UPDATE actions SET state = $2, result = $3, url_after = $4, completed_at = now() WHERE id = $1`,
      [actionId, error ? 'failed' : 'succeeded', JSON.stringify({ error }), redactUrl(after)]);
    await ev('action.finished', { actionId, seq, tool, description: describe, ok: !error, error, url: redactUrl(after) });
    const o = await session.observe();
    await recordState(o, describe, actionId);
    return `${error ? `ACTION FAILED: ${error}\n` : 'OK\n'}${formatObservation(o)}`;
  };

  const dispatch = async (call: ToolCall): Promise<{ text: string; image?: Buffer }> => {
    const name = call.function.name as ToolName;
    const schema = ToolArgs[name];
    if (!schema) return { text: `Unknown tool "${call.function.name}".` };
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
      case 'report_candidate': {
        const known = contract.rules.some((r) => r.id === args.rule_id);
        // Ground the scenario in what Oddhound actually observed, then reject anything still unknown,
        // telling the model the real labels so it can correct the report in its next turn.
        const grounded = groundCandidate({ title: args.title, ruleId: args.rule_id, impact: args.impact, observed: args.observed, scenario: args.scenario, controlValues: args.control_values, actor: session.actor, device: session.device }, recorded);
        const problems = scenarioProblems(grounded, recorded);
        if (problems.length) {
          await ev('finding.candidate_rejected', { title: args.title, problems });
          return { text: `Candidate NOT recorded. Fix and call report_candidate again:\n- ${problems.join('\n- ')}` };
        }
        candidates.push(grounded);
        await ev('finding.candidate', { title: args.title, ruleId: args.rule_id, kind: args.scenario.kind, knownRule: known });
        return { text: known ? 'Candidate recorded. Oddhound will replay it independently after exploration.' : `Recorded as needs-review: "${args.rule_id}" is not one of the owner rules, so it cannot be verified against a rule.` };
      }
      case 'finish_run':
        finished = args.summary;
        return { text: 'Finishing.' };
    }

    if (!BROWSER_TOOLS.has(name)) return { text: 'Tool not available.' };
    const writesOk = contract.testMode === 'active';
    switch (name) {
      case 'navigate': {
        const target = new URL(args.path, session.origin);
        if (target.origin !== session.origin) return { text: 'Navigation outside the verified site is not allowed.' };
        if (contract.deniedPathPrefixes.some((p) => target.pathname.startsWith(p))) return { text: 'That path is denied by the run contract.' };
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
        if ((await loc.getAttribute('type')) === 'password') return { text: 'Use fill_credential for password fields.' };
        const ident = identities.find((i) => i.name === args.value || i.email === args.value);
        const label = session.labelOf(args.ref);
        if (ident && label) {
          pendingAuth ??= { path: new URL((await session.page()).url()).pathname, fields: {} };
          pendingAuth.fields[label] = ident.name === args.value ? '{name}' : '{email}';
        }
        return { text: await runBrowserAction(name, args, `Typed ${JSON.stringify(args.value.slice(0, 40))} into ${session.describe(args.ref)}`, async () => { await loc.fill(args.value, { timeout: 5_000 }); }) };
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
      await assertLease(db, runId, generation);
      compactHistory(messages);
      const bound = inputTokenBound(messages, toolsJson);
      const reserve = reservationMicros(price, bound, LIMITS.maxOutputTokens);
      const requestKey = `${runId}:turn:${turns}`;
      const r = await reserveSpend(db, { runId, account: a.run.spend_account, requestKey, micros: reserve, provider: provider.id, model: provider.model });
      if (!r.ok) { await ev('budget.denied', { reason: r.reason, attemptedMicros: reserve }); return { stopReason: `budget_${r.reason}` }; }
      let result;
      try {
        result = await provider.chat({ messages, tools: TOOL_DEFINITIONS, maxOutputTokens: LIMITS.maxOutputTokens, temperature: 0.2, signal: abort.signal });
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
        messages.push({ role: 'user', content: 'Continue by calling a tool, or call finish_run if the goals are covered.' });
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
    // nothing to release here; the caller destroys the browser
  }
}

class LimitReached extends Error { readonly reason: string; constructor(reason: string) { super(reason); this.reason = reason; } }

/** Keep the conversation compact: older page observations are replaced by a one-line stub. */
function compactHistory(messages: ChatMessage[]): void {
  const toolIdx = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
  for (const i of toolIdx.slice(0, -4)) {
    const m = messages[i] as { role: 'tool'; content: string; tool_call_id: string };
    if (m.content.length > 300 && m.content.includes('PAGE v')) {
      const first = m.content.split('\n').find((l) => l.startsWith('PAGE v')) ?? '';
      m.content = `[older observation omitted] ${first}`;
    }
  }
  // Older screenshots are dropped entirely (they are stored as artifacts).
  const userImgs = messages.map((m, i) => (m.role === 'user' && Array.isArray(m.content) ? i : -1)).filter((i) => i >= 0);
  for (const i of userImgs.slice(0, -1)) messages[i] = { role: 'user', content: '[older screenshot omitted]' };
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
  if ('auth' in s && s.auth && !recorded.auth) checkFields(s.auth.path, s.auth.fields);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Verification

function replayEnvFor(db: Db, runId: string, browser: ProvisionedBrowser, contract: RunContract, origin: string, ev: (t: string, p?: Record<string, unknown>) => Promise<number>): ReplayEnv {
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

async function verifyCandidates(v: { db: Db; runId: string; generation: number; run: RunRow; contract: RunContract; candidates: Candidate[]; browser: ProvisionedBrowser; ev: (t: string, p?: Record<string, unknown>) => Promise<number> }) {
  const { db, runId, run, contract, candidates, browser, ev } = v;
  const env = replayEnvFor(db, runId, browser, contract, contract.target.origin, ev);
  const seen = new Set<string>();
  for (const c of candidates) {
    const hash = scenarioHash(c.scenario);
    if (seen.has(hash)) continue;
    seen.add(hash);
    await assertLease(db, runId, v.generation);
    const rule = contract.rules.find((r) => r.id === c.ruleId);
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
        verification === 'verified' ? 'reproduced 2/2' : 'low', c.ruleId, `${rule.source === 'owner' ? 'Owner rule' : 'Demo target rule'} ${rule.id}`,
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
