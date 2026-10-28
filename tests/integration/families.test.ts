// Behavioral families 1 and 2 through the real worker pipeline against the Harbor demo target:
// a real Chromium (local runtime, scope policy), the real action/spend ledgers in PostgreSQL
// (oddhound_test), independent verification and retest on the corrected build.
// The model is a SCRIPTED test provider replaying recorded tool calls (not Meta inference): it
// names what to check, using only labels from the observations it receives; Oddhound decides.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getPool, closePool } from '../../packages/core/db/pool.ts';
import { migrate } from '../../packages/core/db/migrate.ts';
import { admitRun } from '../../packages/core/ledger/runs.ts';
import { demoTargetContract } from '../../packages/core/contracts/contract.ts';
import { executeRun } from '../../packages/core/agent/execute-run.ts';
import { LocalBrowserRuntime } from '../../packages/core/browser/runtime.ts';
import type { ChatMessage, ChatProvider, ChatRequest, ChatResult } from '../../packages/core/providers/types.ts';

const db = getPool();
const PORTS = { vulnerable: 4391, fixed: 4392 };
const origin = (b: keyof typeof PORTS) => `http://127.0.0.1:${PORTS[b]}`;
const children: ChildProcess[] = [];

async function startFixture(build: keyof typeof PORTS) {
  const child = spawn(process.execPath, ['apps/fixture/server.ts', ...(build === 'fixed' ? ['--fixed'] : [])], { env: { ...process.env, FIXTURE_PORT: String(PORTS[build]), FIXTURE_HOST: '127.0.0.1' }, stdio: 'ignore' });
  children.push(child);
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${origin(build)}/__lab/health`).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`fixture ${build} did not start`);
}

beforeAll(async () => {
  await migrate(db);
  await db.query(`UPDATE settings SET value = 'false'::jsonb WHERE key = 'kill_switch'`);
  await startFixture('vulnerable');
  await startFixture('fixed');
});
afterAll(async () => { for (const c of children) c.kill(); await closePool(); });

function lastTool(messages: ChatMessage[]): string { for (let i = messages.length - 1; i >= 0; i--) { const m = messages[i]!; if (m.role === 'tool') return m.content; } return ''; }

const inDays = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** SCRIPTED TEST PROVIDER: recorded tool calls, not Meta inference (offline price entry, zero cost). */
class ScriptedPlanner implements ChatProvider {
  readonly id = 'test-double';
  readonly model = 'heuristic-planner';
  readonly isMetaModel = false;
  readonly label = 'Scripted test provider (not Meta inference)';
  readonly capability = { tools: true, images: false, imagesInToolMessages: false, toolChoiceValues: ['auto'] as const, structuredOutput: false };
  readonly seen: string[] = [];
  #turn = 0;
  #ident: { name: string; email: string; credential_ref: string } | null = null;
  async chat(req: ChatRequest): Promise<ChatResult> {
    const last = lastTool(req.messages);
    this.seen.push(last);
    if (last.startsWith('{') && last.includes('credential_ref')) this.#ident = JSON.parse(last);
    const id = this.#ident;
    const call = (name: string, args: unknown) => ({ name, args });
    const steps: { name: string; args: unknown }[] = [
      call('observe', {}),
      call('create_identity', {}),
      call('navigate', { path: '/register' }),
      call('run_scenario_batch', { goal: 'sign up', steps: [
        { tool: 'fill', label: 'Full name', value: id?.name },
        { tool: 'fill', label: 'Email', value: id?.email },
        { tool: 'fill_credential', label: 'Password', credential_ref: id?.credential_ref, field: 'password' },
        { tool: 'click', label: 'Create account', expect: { path: '/bookings' } },
      ] }),
      call('navigate', { path: '/bookings/new' }),
      call('run_scenario_batch', { goal: 'create a booking with distinctive notes', steps: [
        { tool: 'fill', label: 'Guest name', value: 'Harbor Guest Q7' },
        { tool: 'fill', label: 'Party size', value: '2' },
        { tool: 'fill', label: 'Date', value: inDays(7) },
        { tool: 'fill', label: 'Notes (optional)', value: 'Window seat Q7 please' },
        { tool: 'click', label: 'Book table', expect: { outcome: 'accepted' } },
      ] }),
      // Family 3 on the list the create landed on: the total (defect, demo rule R7) and the count (control).
      call('check_invariant', { kind: 'sum', total_label: 'Total guests', column: 'Party', evidence: 'My bookings lists each party and a Total guests line', rule_id: 'R7' }),
      call('check_invariant', { kind: 'count', total_label: 'Bookings', evidence: 'My bookings shows a Bookings count above the table' }),
      // Control for family 1: the create's claim is true (notes are on the booking page).
      call('check_claim', { claim: 'Booking #1 confirmed.', fields: ['Guest name', 'Notes'], revisit_path: '/bookings/1' }),
      call('navigate', { path: '/bookings/1/edit' }),
      call('run_scenario_batch', { goal: 'edit notes and name', steps: [
        { tool: 'fill', label: 'Notes (optional)', value: 'Edited note Z9 quiet table' },
        { tool: 'fill', label: 'Guest name', value: 'Harbor Guest Q7 Edited' },
        { tool: 'click', label: 'Save changes', expect: { text_visible: 'Changes saved.' } },
      ] }),
      // Family 1 defect: the edit says "Changes saved." but the notes are not.
      call('check_claim', { claim: 'Changes saved.', fields: ['Notes (optional)', 'Guest name'], revisit_path: '/bookings/1/edit' }),
      // A claim the page never showed is refused, not recorded.
      call('check_claim', { claim: 'Profile updated', fields: ['Guest name'] }),
      // Family 2 defect and its control; a guessed id is refused.
      call('check_cross_actor', { path: '/bookings/1', try_controls: ['Cancel booking'] }),
      call('check_cross_actor', { path: '/bookings/1/edit' }),
      call('check_cross_actor', { path: '/bookings/2' }),
      // Family 2, two tabs: once against demo rule R6, once with no rule (it can only be needs_review).
      call('check_two_tabs', { path: '/bookings/1/edit', first: { field: 'Guest name', value: 'Two Tab Guest A1' }, second: { field: 'Party size', value: '5' }, rule_id: 'R6' }),
      call('check_two_tabs', { path: '/bookings/1/edit', first: { field: 'Guest name', value: 'Second Tab Guest B2' }, second: { field: 'Party size', value: '6' } }),
      // Family 5: the booking page on desktop vs. a phone (defect, demo rule R8), and its Cancel button (control).
      call('check_differential', { path: '/bookings/1', rule_id: 'R8' }),
      call('check_differential', { path: '/bookings/1', controls: ['Cancel booking'] }),
      // Family 4: fill the create form (no submit); Oddhound double-presses it (defect, demo rule R9), then
      // submits a fresh copy while offline (held: nothing is sent, one normal retry saves one booking).
      call('navigate', { path: '/bookings/new' }),
      call('run_scenario_batch', { goal: 'fill a booking to submit with interruptions', steps: [
        { tool: 'fill', label: 'Guest name', value: 'Double Press Guest K4' },
        { tool: 'fill', label: 'Party size', value: '2' },
        { tool: 'fill', label: 'Date', value: inDays(9) },
      ] }),
      call('check_interruption', { kind: 'double_submit', submit: 'Book table', field: 'Guest name', list_path: '/bookings', rule_id: 'R9' }),
      call('navigate', { path: '/bookings/new' }),
      call('run_scenario_batch', { goal: 'fill a booking to submit offline', steps: [
        { tool: 'fill', label: 'Guest name', value: 'Offline Guest M2' },
        { tool: 'fill', label: 'Party size', value: '3' },
        { tool: 'fill', label: 'Date', value: inDays(9) },
      ] }),
      call('check_interruption', { kind: 'offline_submit', submit: 'Book table', field: 'Guest name', list_path: '/bookings', rule_id: 'R9' }),
      call('finish_run', { summary: 'Checked two save claims and cross-account access to a booking.' }),
    ];
    const next = steps[this.#turn++] ?? call('finish_run', { summary: 'done' });
    return {
      message: { role: 'assistant', content: null, tool_calls: [{ id: `call_${randomUUID().slice(0, 8)}`, type: 'function', function: { name: next.name, arguments: JSON.stringify(next.args) } }] },
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, finishReason: 'tool_calls', requestId: null, model: this.model,
    };
  }
}

const deps = (provider: ChatProvider) => ({
  db, runtime: new LocalBrowserRuntime(), providers: [provider], workerId: 'families-test', allowOfflineTestDouble: true, agentMode: 'batch' as const,
  lab: { allowedEndpoints: new Set([`127.0.0.1:${PORTS.vulnerable}`, `127.0.0.1:${PORTS.fixed}`]) },
});

describe('behavioral families 1-5 on the Harbor demo target', () => {
  it('finds the lying save toast, the cross-account gap, the lost update, the broken total, the double submit and the phone-only gap, leaves the controls alone, and retests them unchanged', async () => {
    await db.query('TRUNCATE runs CASCADE');
    const planner = new ScriptedPlanner();
    const principal = `test:families:${Date.now()}`;
    const admitted = await admitRun(db, { principal, ownerId: null, projectId: null, mode: 'demo_target', contract: demoTargetContract(origin('vulnerable')), spendAccount: 'development' });
    if (!admitted.ok) throw new Error(admitted.reason);
    expect(await executeRun(deps(planner), admitted.runId)).toBe('completed');
    const runId = admitted.runId;
    const reply = (s: RegExp) => planner.seen.find((t) => s.test(t)) ?? '';
    if (process.env.FAMILIES_DEBUG) console.log(planner.seen.map((t) => (t.split('\n')[0] || t.slice(0, 600))).join('\n---\n'));

    // Family 1: the create's claim held (control), the edit's did not, the invented claim was refused.
    expect(reply(/^Claim held/)).toMatch(/"Notes \(optional\)" is on \/bookings\/1/);
    expect(reply(/^Claim did NOT hold/)).toMatch(/"Notes \(optional\)" = "Edited note Z9 quiet table" was not there/);
    expect(reply(/^Claim did NOT hold/)).not.toMatch(/"Guest name" =/); // the edited name was saved
    expect(reply(/did not show "Profile updated"/)).not.toBe('');
    // Family 2: B opened A's booking and saw it; the edit page refused B; an id A never created was refused.
    expect(reply(/^Cross-actor check FAILED/)).toMatch(/actor B opened \/bookings\/1 and saw actor A's Guest name, Notes/);
    expect(reply(/^Cross-actor check FAILED/)).toMatch(/Not offered to actor B: "Cancel booking"/);
    expect(reply(/^Cross-actor check passed/)).toMatch(/\/bookings\/1\/edit/);
    expect(reply(/ids are never guessed/)).toMatch(/Not created by actor A here: 2/);

    const events = (await db.query<{ type: string; payload: any }>('SELECT type, payload FROM run_events WHERE run_id = $1 ORDER BY seq', [runId])).rows;
    const finished = events.filter((e) => e.type === 'scenario.finished').map((e) => `${e.payload.family}:${e.payload.outcome}`);
    expect(finished).toEqual(['invariant:failed', 'invariant:passed', 'claim_vs_truth:passed', 'claim_vs_truth:failed', 'two_actors:failed', 'two_actors:passed', 'two_actors:failed', 'two_actors:failed', 'differential:failed', 'differential:passed', 'interruption:failed', 'interruption:passed']);
    // (The conversation may be compacted into Oddhound's notebook around here, so read the recorded event.)
    expect(events.find((e) => e.type === 'scenario.finished' && e.payload.kind === 'double_submit')!.payload).toMatchObject({ outcome: 'failed', before: 0, afterInterruption: 2, created: 2 });
    expect(reply(/^Interruption check passed/)).toMatch(/submitting while offline, then coming back online and one normal retry created exactly one record/);
    expect(reply(/^Differential check FAILED/)).toMatch(/link "Edit booking" is missing in a 390x844 phone but usable in desktop/);
    expect(reply(/^Differential check passed/)).toMatch(/the 1 control\(s\) usable in desktop are usable in a 390x844 phone too/);
    expect(reply(/^Invariant BROKEN/)).toMatch(/"Total guests" shows 0, but the 1 "Party" value\(s\) \(2\) add up to 2/);
    expect(reply(/^Invariant holds/)).toMatch(/"Bookings" shows 1 and the table has 1 row/);
    expect(reply(/^Two-tab check FAILED/)).toMatch(/the change saved in the first tab was silently undone: the save from the out-of-date tab put back "Harbor Guest Q7 Edited"/);
    const window = events.find((e) => e.type === 'scenario.finished' && e.payload.outcome === 'failed' && e.payload.family === 'claim_vs_truth')!.payload;
    expect(window).toMatchObject({ looks: 3, windowMs: 4_500 });
    expect(window.windowUsedMs).toBeGreaterThanOrEqual(4_500);
    // Actor B was signed up by Oddhound with the recorded sign-up, through the action ledger.
    const actions = (await db.query<{ tool: string; actor: string; args: any }>('SELECT tool, actor, args FROM actions WHERE run_id = $1 ORDER BY seq', [runId])).rows;
    const signUp = actions.find((a) => a.tool === 'sign_up_actor')!;
    expect(signUp).toMatchObject({ actor: 'B' });
    expect(JSON.stringify(actions)).not.toMatch(/Oh!|password":"[^{]/); // no secrets in the ledger

    // Verification: both replayed twice in fresh sessions and verified; nothing else was flagged.
    const findings = (await db.query<{ id: string; rule_id: string | null; family: string; verification: string; category: string; lifecycle: string; scenario_id: string; limitations: string; actor: string }>(
      `SELECT id, rule_id, family, verification, category, lifecycle, scenario_id, limitations, actor FROM findings WHERE run_id = $1 AND category <> 'configuration_observation' ORDER BY rule_id`, [runId])).rows;
    expect(findings.map((f) => `${f.rule_id ?? 'null'}:${f.family}:${f.verification}:${f.category}`)).toEqual([
      'B11:claim_vs_truth:verified:verified_issue', 'B7:two_actors:verified:verified_issue', 'R6:two_actors:verified:verified_issue', 'R7:invariant:verified:verified_issue', 'R8:differential:verified:verified_issue', 'R9:interruption:verified:verified_issue', 'null:two_actors:inconclusive:needs_review',
    ]);
    // The rule-less two-tab check reproduced, but no explicit rule backs it: review only, never verified.
    expect(findings.find((f) => f.rule_id === null)!.limitations).toMatch(/Reproduced 2\/2, but no explicit or owner-approved rule/);
    // The one-tab control ran next to the verified two-tab finding and passed.
    const r6 = (await db.query<{ control_scenario_id: string | null }>(`SELECT control_scenario_id FROM findings WHERE run_id = $1 AND rule_id = 'R6'`, [runId])).rows[0]!;
    const ctl = (await db.query<{ assertion: any; outcome: string }>(`SELECT s.assertion, e.outcome FROM scenarios s JOIN scenario_executions e ON e.scenario_id = s.id WHERE s.id = $1`, [r6.control_scenario_id])).rows;
    expect(ctl.map((c) => [c.assertion.sequential, c.outcome])).toEqual([[true, 'passed']]);
    const b11 = findings.find((f) => f.rule_id === 'B11')!;
    expect(b11.limitations).toMatch(/4\.5 s window \(exploration used \d+\.\d s over 3 looks\)/);
    expect(findings.find((f) => f.rule_id === 'B7')!).toMatchObject({ actor: 'A+B' });
    const sc = (await db.query<{ assertion: any }>('SELECT assertion FROM scenarios WHERE id = $1', [b11.scenario_id])).rows[0]!.assertion;
    expect(sc).toMatchObject({ kind: 'claim_check', start: '/bookings/{id}/edit', claim: 'Changes saved.', revisit: ['/bookings/{id}/edit'], checks: [{ field: 'Notes (optional)', value: 'Edited note Z9 quiet table' }] });
    expect(sc.setup).toMatchObject({ path: '/bookings/new', submit: 'Book table' });

    // Retest on the corrected build: the unchanged assertions now hold.
    const retest = await admitRun(db, { principal: `${principal}:retest`, ownerId: null, projectId: null, mode: 'retest', contract: demoTargetContract(origin('fixed')), spendAccount: 'development', parentRunId: runId });
    if (!retest.ok) throw new Error(retest.reason);
    expect(await executeRun(deps(new ScriptedPlanner()), retest.runId)).toBe('completed');
    const after = (await db.query<{ rule_id: string; lifecycle: string }>(`SELECT rule_id, lifecycle FROM findings WHERE run_id = $1 AND category = 'verified_issue' ORDER BY rule_id`, [runId])).rows;
    expect(after).toEqual([{ rule_id: 'B11', lifecycle: 'fixed' }, { rule_id: 'B7', lifecycle: 'fixed' }, { rule_id: 'R6', lifecycle: 'fixed' }, { rule_id: 'R7', lifecycle: 'fixed' }, { rule_id: 'R8', lifecycle: 'fixed' }, { rule_id: 'R9', lifecycle: 'fixed' }]);

    // Retest on the still-vulnerable build keeps both open (no false "fixed").
    await db.query(`UPDATE findings SET lifecycle = 'open' WHERE run_id = $1 AND category = 'verified_issue'`, [runId]);
    const negative = await admitRun(db, { principal: `${principal}:negative`, ownerId: null, projectId: null, mode: 'retest', contract: demoTargetContract(origin('vulnerable')), spendAccount: 'development', parentRunId: runId });
    if (!negative.ok) throw new Error(negative.reason);
    await executeRun(deps(new ScriptedPlanner()), negative.runId);
    const still = (await db.query<{ lifecycle: string }>(`SELECT lifecycle FROM findings WHERE run_id = $1 AND category = 'verified_issue'`, [runId])).rows;
    expect(still.every((f) => f.lifecycle === 'open')).toBe(true);
  }, 300_000);
});
