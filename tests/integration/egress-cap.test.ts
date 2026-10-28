// When the run's traffic cap is used up, testing ends but the run still finalizes (status `stopped`,
// reason `egress_cap`), instead of being aborted like a manual stop. Real worker pipeline with the local
// Chromium runtime; the cap hit is signalled through the runtime's own callback. SCRIPTED provider, not Meta.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { getPool, closePool } from '../../packages/core/db/pool.ts';
import { migrate } from '../../packages/core/db/migrate.ts';
import { admitRun } from '../../packages/core/ledger/runs.ts';
import { demoTargetContract } from '../../packages/core/contracts/contract.ts';
import { executeRun } from '../../packages/core/agent/execute-run.ts';
import { LocalBrowserRuntime, type BrowserRuntime, type ProvisionOptions } from '../../packages/core/browser/runtime.ts';
import type { ChatProvider, ChatRequest, ChatResult } from '../../packages/core/providers/types.ts';

const db = getPool();
let server: Server; let origin = ''; let port = 0;

beforeAll(async () => {
  await migrate(db);
  await db.query(`UPDATE settings SET value = 'false'::jsonb WHERE key = 'kill_switch'`);
  server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><body><main><h1>Home</h1></main></body></html>'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const a = server.address();
  port = typeof a === 'object' && a ? a.port : 0;
  origin = `http://127.0.0.1:${port}`;
});
afterAll(async () => { server?.close(); await closePool(); });

/** The local runtime, keeping hold of the run's "traffic cap used up" callback so the test can fire it. */
class CapturingRuntime implements BrowserRuntime {
  readonly inner = new LocalBrowserRuntime();
  exhaust: ((reason: string) => void) | undefined;
  readonly kind = 'local' as const;
  provision(opts: ProvisionOptions) { this.exhaust = opts.onEgressExhausted; return this.inner.provision(opts); }
}

/** SCRIPTED TEST PROVIDER — not Meta inference. Observes; on its second call the cap is used up. */
class Observer implements ChatProvider {
  readonly id = 'test-double';
  readonly model = 'heuristic-planner';
  readonly isMetaModel = false;
  readonly label = 'Scripted test provider (not Meta inference)';
  readonly capability = { tools: true, images: false, imagesInToolMessages: false, toolChoiceValues: ['auto'] as const, structuredOutput: false };
  calls = 0;
  readonly onSecond: () => void;
  constructor(onSecond: () => void) { this.onSecond = onSecond; }
  async chat(_req: ChatRequest): Promise<ChatResult> {
    if (++this.calls === 2) this.onSecond();
    return {
      message: { role: 'assistant', content: null, tool_calls: [{ id: `call_${this.calls}`, type: 'function', function: { name: 'observe', arguments: '{}' } }] },
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, finishReason: 'tool_calls', requestId: null, model: this.model,
    };
  }
}

describe('traffic cap', () => {
  it('ends testing at the next turn and still finalizes the run', async () => {
    await db.query('TRUNCATE runs CASCADE');
    const runtime = new CapturingRuntime();
    const provider = new Observer(() => runtime.exhaust?.('bytes'));
    const admitted = await admitRun(db, { principal: `test:egress:${Date.now()}`, ownerId: null, projectId: null, mode: 'demo_target', contract: demoTargetContract(origin), spendAccount: 'development' });
    if (!admitted.ok) throw new Error(admitted.reason);
    const deps = { db, runtime, providers: [provider], workerId: 'egress-test', allowOfflineTestDouble: true, agentMode: 'batch' as const, lab: { allowedEndpoints: new Set([`127.0.0.1:${port}`]) } };
    expect(await executeRun(deps, admitted.runId)).toBe('stopped');
    expect(provider.calls).toBe(2); // no model call after the cap was used up
    const run = (await db.query<{ stop_reason: string }>('SELECT stop_reason FROM runs WHERE id = $1', [admitted.runId])).rows[0]!;
    expect(run.stop_reason).toBe('egress_cap');
    const types = (await db.query<{ type: string }>('SELECT type FROM run_events WHERE run_id = $1 ORDER BY seq', [admitted.runId])).rows.map((e) => e.type);
    expect(types.filter((t) => t === 'egress.exhausted')).toHaveLength(1);
    // Finalization still ran: the verification phase and the browser teardown were recorded.
    expect(types).toEqual(expect.arrayContaining(['run.phase', 'browser.terminated', 'run.stopped']));
  }, 120_000);
});
