// A transient model error (HTTP 500) is retried as an explicit, budgeted attempt instead of ending the run.
// Real worker pipeline (local Chromium runtime, ledgers in oddhound_test); SCRIPTED provider, not Meta inference.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { getPool, closePool } from '../../packages/core/db/pool.ts';
import { migrate } from '../../packages/core/db/migrate.ts';
import { admitRun } from '../../packages/core/ledger/runs.ts';
import { demoTargetContract } from '../../packages/core/contracts/contract.ts';
import { executeRun } from '../../packages/core/agent/execute-run.ts';
import { LocalBrowserRuntime } from '../../packages/core/browser/runtime.ts';
import { ProviderError, type ChatProvider, type ChatRequest, type ChatResult } from '../../packages/core/providers/types.ts';

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

/** SCRIPTED TEST PROVIDER — not Meta inference. Fails its first call with a server error, then finishes. */
class FlakyOnce implements ChatProvider {
  readonly id = 'test-double';
  readonly model = 'heuristic-planner';
  readonly isMetaModel = false;
  readonly label = 'Scripted test provider (not Meta inference)';
  readonly capability = { tools: true, images: false, imagesInToolMessages: false, toolChoiceValues: ['auto'] as const, structuredOutput: false };
  calls = 0;
  async chat(_req: ChatRequest): Promise<ChatResult> {
    if (++this.calls === 1) throw new ProviderError('http', 'HTTP 500: internal server error', true, 500);
    return {
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_finish', type: 'function', function: { name: 'finish_run', arguments: JSON.stringify({ summary: 'Recovered after a server error.' }) } }] },
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, finishReason: 'tool_calls', requestId: null, model: this.model,
    };
  }
}

describe('transient model errors', () => {
  it('retries an HTTP 500 once, logged and budgeted, and the run completes', async () => {
    await db.query('TRUNCATE runs CASCADE');
    const provider = new FlakyOnce();
    const admitted = await admitRun(db, { principal: `test:retry:${Date.now()}`, ownerId: null, projectId: null, mode: 'demo_target', contract: demoTargetContract(origin), spendAccount: 'development' });
    if (!admitted.ok) throw new Error(admitted.reason);
    const deps = { db, runtime: new LocalBrowserRuntime(), providers: [provider], workerId: 'retry-test', allowOfflineTestDouble: true, agentMode: 'batch' as const, lab: { allowedEndpoints: new Set([`127.0.0.1:${port}`]) } };
    expect(await executeRun(deps, admitted.runId)).toBe('completed');
    expect(provider.calls).toBe(2);
    const events = (await db.query<{ type: string; payload: any }>('SELECT type, payload FROM run_events WHERE run_id = $1 ORDER BY seq', [admitted.runId])).rows;
    expect(events.find((e) => e.type === 'provider.retry')?.payload).toMatchObject({ reason: 'http_500', billed: true });
    expect(events.some((e) => e.type === 'provider.error')).toBe(false);
    // The failed attempt may have been billed, so it stays counted; the retry had its own reservation.
    const rows = (await db.query<{ request_key: string; state: string }>('SELECT request_key, state FROM spend_reservations WHERE run_id = $1 ORDER BY created_at', [admitted.runId])).rows;
    expect(rows.map((x) => [x.request_key.split(':').slice(1).join(':'), x.state])).toEqual([['turn:0', 'unknown'], ['turn:0:retry1', 'settled']]);
  }, 120_000);
});
