// Scenario batches through the real worker pipeline: a real Chromium (local runtime, egress proxy,
// scope policy), the real action/spend ledgers in PostgreSQL (oddhound_test) and independent
// verification and retest. The model is a SCRIPTED test provider (not Meta inference): it plans the
// batches a model would plan, using only the refs and labels in the observations it receives.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { getPool, closePool } from '../../packages/core/db/pool.ts';
import { migrate } from '../../packages/core/db/migrate.ts';
import { admitRun } from '../../packages/core/ledger/runs.ts';
import { demoTargetContract } from '../../packages/core/contracts/contract.ts';
import { executeRun } from '../../packages/core/agent/execute-run.ts';
import { LocalBrowserRuntime } from '../../packages/core/browser/runtime.ts';
import type { ChatMessage, ChatProvider, ChatRequest, ChatResult } from '../../packages/core/providers/types.ts';

const db = getPool();
let server: Server; let origin = ''; let port = 0;
let strict = false; // false = the server trusts the page's stated limit (bug); true = it enforces it (fixed)

const html = (body: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><main>${body}</main></body></html>`;
const form = (action: string, error = '') => html(`<h1>Book</h1><p>Tables for up to 8 guests.</p>${error ? `<p role="alert" class="error">${error}</p>` : ''}
<form method="post" action="${action}" novalidate>
  <label>Guest name <input name="guest" required></label>
  <label>Party size <input name="party" type="number" min="1" max="8" required></label>
  <button>Save</button>
</form>`);

beforeAll(async () => {
  await migrate(db);
  await db.query(`UPDATE settings SET value = 'false'::jsonb WHERE key = 'kill_switch'`);
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status: number, body: string) => res.writeHead(status, { 'content-type': 'text/html' }).end(body);
    if (req.method === 'POST') {
      let raw = ''; req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const party = Number(new URLSearchParams(raw).get('party'));
        const enforce = strict || url.pathname === '/book-strict';
        if (enforce && !(party >= 1 && party <= 8)) return void send(422, form(url.pathname, 'Party size must be between 1 and 8.'));
        res.writeHead(303, { location: `/saved?party=${party}` }).end();
      });
      return;
    }
    if (url.pathname === '/book') return void send(200, form('/book'));
    if (url.pathname === '/book-strict') return void send(200, form('/book-strict'));
    if (url.pathname === '/saved') return void send(200, html(`<p role="status" class="notice">Saved: party ${url.searchParams.get('party')}</p>`));
    return void send(200, html('<h1>Home</h1><a href="/book">Book</a> <a href="https://elsewhere.example/">Partner site</a>'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const a = server.address();
  port = typeof a === 'object' && a ? a.port : 0;
  origin = `http://127.0.0.1:${port}`;
});
afterAll(async () => { server?.close(); await closePool(); });

/** Latest observation the provider received: element refs by label. */
function refs(messages: ChatMessage[]): Map<string, string> {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'tool' || !m.content.includes('PAGE v')) continue;
    const out = new Map<string, string>();
    for (const line of m.content.split('\n')) { const mm = /^\[(e\d+)\] \w+ "([^"]*)"/.exec(line); if (mm) out.set(mm[2]!, mm[1]!); }
    return out;
  }
  return new Map();
}
function lastTool(messages: ChatMessage[]): string { for (let i = messages.length - 1; i >= 0; i--) { const m = messages[i]!; if (m.role === 'tool') return m.content; } return ''; }

/** SCRIPTED TEST PROVIDER — not Meta inference. Uses the offline price entry (zero cost). */
class ScriptedPlanner implements ChatProvider {
  readonly id = 'test-double';
  readonly model = 'heuristic-planner';
  readonly isMetaModel = false;
  readonly label = 'Scripted test provider (not Meta inference)';
  readonly capability = { tools: true, images: false, imagesInToolMessages: false, toolChoiceValues: ['auto'] as const, structuredOutput: false };
  readonly seen: string[] = [];
  #turn = 0;
  async chat(req: ChatRequest): Promise<ChatResult> {
    const r = refs(req.messages);
    this.seen.push(lastTool(req.messages));
    const call = (name: string, args: unknown) => ({ name, args });
    const steps: { name: string; args: unknown }[] = [
      call('observe', {}),
      call('navigate', { path: '/book' }),
      // A stated limit, tested like a user: type past it and submit; the page said max 8.
      call('run_scenario_batch', { goal: 'party size past the stated max is rejected', steps: [
        { tool: 'fill', ref: r.get('Guest name'), value: 'Ann' },
        { tool: 'fill', ref: r.get('Party size'), value: '{past:max}' },
        { tool: 'click', ref: r.get('Save'), expect: { outcome: 'rejected' } },
      ] }),
      call('report_candidate', { title: 'A party size above the stated maximum of 8 is saved', rule_id: 'B10', impact: 'medium', observed: 'Typed 9 into Party size (max=8) and pressed Save; the booking was saved.', scenario: { kind: 'batch', batch: 1, step: 3 } }),
      call('navigate', { path: '/book-strict' }),
      // The re-rendered form after a rejection has new refs: the runner re-finds the same controls by label.
      call('run_scenario_batch', { goal: 'rejection then a valid value on a strict form', steps: [
        { tool: 'fill', ref: r.get('Guest name'), value: 'Ann' },
        { tool: 'fill', ref: r.get('Party size'), value: '{past:max}' },
        { tool: 'click', ref: r.get('Save'), expect: { outcome: 'rejected', text_visible: 'between 1 and 8' } },
        { tool: 'fill', ref: r.get('Party size'), value: '{on:max}' },
        { tool: 'click', ref: r.get('Save'), expect: { outcome: 'accepted', path: '/saved' } },
      ] }),
      call('finish_run', { summary: 'Tested the stated party-size limit on two forms.' }),
    ];
    const next = steps[this.#turn++] ?? call('finish_run', { summary: 'done' });
    return {
      message: { role: 'assistant', content: null, tool_calls: [{ id: `call_${randomUUID().slice(0, 8)}`, type: 'function', function: { name: next.name, arguments: JSON.stringify(next.args) } }] },
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, finishReason: 'tool_calls', requestId: null, model: this.model,
    };
  }
}

const deps = (provider: ChatProvider) => ({
  db, runtime: new LocalBrowserRuntime(), providers: [provider], workerId: 'batch-test', allowOfflineTestDouble: true, agentMode: 'batch' as const,
  lab: { allowedEndpoints: new Set([`127.0.0.1:${port}`]) },
});

describe('scenario batches in the worker pipeline', () => {
  it('runs batches, stops on a surprise, verifies the page-stated rule and replays it unchanged on retest', async () => {
    await db.query('TRUNCATE runs CASCADE');
    strict = false;
    const planner = new ScriptedPlanner();
    const principal = `test:batch:${Date.now()}`;
    const admitted = await admitRun(db, { principal, ownerId: null, projectId: null, mode: 'demo_target', contract: demoTargetContract(origin), spendAccount: 'development' });
    if (!admitted.ok) throw new Error(admitted.reason);
    const status = await executeRun(deps(planner), admitted.runId);
    expect(status).toBe('completed');

    // Batch 1 stopped at the failed expectation; batch 2 ran all five steps, re-finding stale refs by label.
    expect(planner.seen[3]).toMatch(/Batch 1 stopped at a surprise \(an expectation failed\) after 3 of 3/);
    expect(planner.seen[3]).toMatch(/value from stated max=8 on "Party size"/);
    expect(planner.seen[6]).toMatch(/Batch 2 ran all 5 step\(s\) as expected/);
    const events = (await db.query<{ type: string; payload: any }>('SELECT type, payload FROM run_events WHERE run_id = $1 ORDER BY seq', [admitted.runId])).rows;
    expect(events.find((e) => e.type === 'agent.mode')?.payload.mode).toBe('batch');
    expect(events.filter((e) => e.type === 'batch.finished').map((e) => e.payload.surprise)).toEqual(['an expectation failed', null]);

    // Every batch step went through the action ledger; the template and the computed value are both recorded.
    const actions = (await db.query<{ tool: string; args: any; state: string }>('SELECT tool, args, state FROM actions WHERE run_id = $1 ORDER BY seq', [admitted.runId])).rows;
    expect(actions.map((a) => a.tool)).toEqual(['navigate', 'fill', 'fill', 'click', 'navigate', 'fill', 'fill', 'click', 'fill', 'click']);
    expect(actions.every((a) => a.state === 'succeeded')).toBe(true);
    expect(actions[2]!.args).toMatchObject({ template: '{past:max}', value: '9' });
    expect(actions[8]!.args).toMatchObject({ template: '{on:max}', value: '8' });

    // Honest coverage: only controls a browser action used; the off-site link is blocked by policy.
    const cov = events.filter((e) => e.type === 'coverage.updated').at(-1)!.payload;
    expect(cov.exercised).toBe(6); // Guest name, Party size, Save on /book and on /book-strict
    expect(cov.blocked).toBe(1);
    expect(cov.total).toBeGreaterThan(cov.exercised);

    // The candidate was replayed twice in fresh sessions and verified against B10 with page-stated provenance.
    const f = (await db.query<{ id: string; verification: string; category: string; rule_id: string; rule_source: string; scenario_id: string; lifecycle: string }>(
      `SELECT id, verification, category, rule_id, rule_source, scenario_id, lifecycle FROM findings WHERE run_id = $1 AND rule_id = 'B10'`, [admitted.runId])).rows[0]!;
    expect(f).toMatchObject({ verification: 'verified', category: 'verified_issue', lifecycle: 'open' });
    expect(f.rule_source).toMatch(/page-stated: max=8 on "Party size"/);
    const sc = (await db.query<{ assertion: any; assertion_hash: string }>('SELECT assertion, assertion_hash FROM scenarios WHERE id = $1', [f.scenario_id])).rows[0]!;
    expect(sc.assertion).toMatchObject({ kind: 'batch', start: '/book', oracleStep: 3 });
    expect(sc.assertion.steps[1].step).toEqual({ op: 'fill', field: 'Party size', value: '9' });

    // Retest on the fixed server: the unchanged batch now holds -> fixed.
    strict = true;
    const retest = await admitRun(db, { principal: `${principal}:retest`, ownerId: null, projectId: null, mode: 'retest', contract: demoTargetContract(origin), spendAccount: 'development', parentRunId: admitted.runId });
    if (!retest.ok) throw new Error(retest.reason);
    expect(await executeRun(deps(new ScriptedPlanner()), retest.runId)).toBe('completed');
    expect((await db.query('SELECT lifecycle FROM findings WHERE id = $1', [f.id])).rows[0].lifecycle).toBe('fixed');
    const exec = (await db.query<{ assertion_hash: string; outcome: string }>(`SELECT assertion_hash, outcome FROM scenario_executions WHERE scenario_id = $1 AND kind = 'retest'`, [f.scenario_id])).rows;
    expect(exec).toEqual([{ assertion_hash: sc.assertion_hash, outcome: 'passed' }]);

    // Retest on the unfixed server keeps it open (no false "fixed").
    strict = false;
    await db.query(`UPDATE findings SET lifecycle = 'open' WHERE id = $1`, [f.id]);
    const negative = await admitRun(db, { principal: `${principal}:negative`, ownerId: null, projectId: null, mode: 'retest', contract: demoTargetContract(origin), spendAccount: 'development', parentRunId: admitted.runId });
    if (!negative.ok) throw new Error(negative.reason);
    await executeRun(deps(new ScriptedPlanner()), negative.runId);
    expect((await db.query('SELECT lifecycle FROM findings WHERE id = $1', [f.id])).rows[0].lifecycle).toBe('open');
  }, 180_000);
});
