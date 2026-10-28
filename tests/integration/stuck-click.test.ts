// Clicks that cannot happen, through the real worker pipeline (real Chromium, local runtime, egress proxy,
// scope policy, action ledger in oddhound_test). The model is a SCRIPTED test provider (not Meta inference).
// Checks: a disabled control and a control under a dialog say why they were not clicked; a batch that repeats a
// step which already failed twice is refused before it runs; the site's own sitemap reaches the first message.
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

const html = (body: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><main>${body}</main></body></html>`;

beforeAll(async () => {
  await migrate(db);
  await db.query(`UPDATE settings SET value = 'false'::jsonb WHERE key = 'kill_switch'`);
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status: number, body: string, type = 'text/html') => res.writeHead(status, { 'content-type': type }).end(body);
    if (url.pathname === '/robots.txt') return void send(200, `User-agent: *\nSitemap: ${origin}/sitemap.xml\n`, 'text/plain');
    if (url.pathname === '/sitemap.xml') return void send(200, `<?xml version="1.0"?><urlset><url><loc>${origin}/notes</loc></url><url><loc>${origin}/about?tab=team&amp;x=1</loc></url><url><loc>https://elsewhere.example/page</loc></url><url><loc>${origin}/brochure.pdf</loc></url></urlset>`, 'application/xml');
    if (url.pathname === '/notes') return void send(200, html(`<h1>Notes</h1>
      <label>New note <input name="note"></label> <button disabled>Pin note</button>
      <button>Save</button>
      <div role="dialog" aria-label="Library" style="position:fixed;inset:0;background:#fff"><h2>Library</h2><button>Close</button></div>`));
    return void send(200, html('<h1>Home</h1><a href="/notes">Notes</a> <a href="/contact">Contact</a>'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const a = server.address();
  port = typeof a === 'object' && a ? a.port : 0;
  origin = `http://127.0.0.1:${port}`;
});
afterAll(async () => { server?.close(); await closePool(); });

function lastTool(messages: ChatMessage[]): string { for (let i = messages.length - 1; i >= 0; i--) { const m = messages[i]!; if (m.role === 'tool') return m.content; } return ''; }

/** SCRIPTED TEST PROVIDER — not Meta inference. Uses the offline price entry (zero cost). */
class ScriptedPlanner implements ChatProvider {
  readonly id = 'test-double';
  readonly model = 'heuristic-planner';
  readonly isMetaModel = false;
  readonly label = 'Scripted test provider (not Meta inference)';
  readonly capability = { tools: true, images: false, imagesInToolMessages: false, toolChoiceValues: ['auto'] as const, structuredOutput: false };
  readonly seen: string[] = [];
  firstUser = '';
  #turn = 0;
  async chat(req: ChatRequest): Promise<ChatResult> {
    if (!this.firstUser) this.firstUser = String(req.messages.find((m) => m.role === 'user')?.content ?? '');
    this.seen.push(lastTool(req.messages));
    const call = (name: string, args: unknown) => ({ name, args });
    const pin = { goal: 'blank note is refused', steps: [{ tool: 'fill', label: 'New note', value: '' }, { tool: 'click', label: 'Pin note' }] };
    const steps: { name: string; args: unknown }[] = [
      call('observe', {}),
      call('navigate', { path: '/notes' }),
      call('run_scenario_batch', pin),
      call('run_scenario_batch', pin),
      call('run_scenario_batch', pin), // third try: refused before it runs
      call('run_scenario_batch', { goal: 'save under the dialog', steps: [{ tool: 'click', label: 'Save' }] }),
      call('finish_run', { summary: 'Tried the notes controls.' }),
    ];
    const next = steps[this.#turn++] ?? call('finish_run', { summary: 'done' });
    return {
      message: { role: 'assistant', content: null, tool_calls: [{ id: `call_${randomUUID().slice(0, 8)}`, type: 'function', function: { name: next.name, arguments: JSON.stringify(next.args) } }] },
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, finishReason: 'tool_calls', requestId: null, model: this.model,
    };
  }
}

describe('clicks that cannot happen', () => {
  it('says why, refuses a third identical try, and starts from the sitemap', async () => {
    await db.query('TRUNCATE runs CASCADE');
    const planner = new ScriptedPlanner();
    const admitted = await admitRun(db, { principal: `test:stuck:${Date.now()}`, ownerId: null, projectId: null, mode: 'demo_target', contract: demoTargetContract(origin), spendAccount: 'development' });
    if (!admitted.ok) throw new Error(admitted.reason);
    const deps = { db, runtime: new LocalBrowserRuntime(), providers: [planner], workerId: 'stuck-test', allowOfflineTestDouble: true, agentMode: 'batch' as const, lab: { allowedEndpoints: new Set([`127.0.0.1:${port}`]) } };
    expect(await executeRun(deps, admitted.runId)).toBe('completed');

    // The site's own page list: same-origin pages from the sitemap and first-page links; no other origin, no files.
    expect(planner.firstUser).toMatch(/Pages this site lists/);
    expect(planner.firstUser).toContain('/notes');
    expect(planner.firstUser).toContain('/about?tab=team&x=1');
    expect(planner.firstUser).toContain('/contact');
    expect(planner.firstUser).not.toMatch(/elsewhere\.example|brochure\.pdf/);

    // Disabled: answered at once, with the reason.
    expect(planner.seen[3]).toMatch(/not clicked: the control is disabled/);
    expect(planner.seen[4]).toMatch(/not clicked: the control is disabled/);
    // The same failing step a third time is refused, and no browser action is spent on it.
    expect(planner.seen[5]).toMatch(/Batch not run: step 2 \(click "Pin note"\) already failed 2 times/);
    // Covered by a dialog: named, so the agent knows to close it.
    expect(planner.seen[6]).toMatch(/another element is on top of it: a dialog "Library"/);

    const events = (await db.query<{ type: string; payload: any }>('SELECT type, payload FROM run_events WHERE run_id = $1 ORDER BY seq', [admitted.runId])).rows;
    expect(events.find((e) => e.type === 'site.mapped')?.payload).toMatchObject({ fromSitemap: 2 });
    expect(events.filter((e) => e.type === 'batch.refused')).toHaveLength(1);
    const actions = (await db.query<{ tool: string; state: string }>('SELECT tool, state FROM actions WHERE run_id = $1 ORDER BY seq', [admitted.runId])).rows;
    expect(actions.map((a) => `${a.tool}:${a.state}`)).toEqual(['navigate:succeeded', 'fill:succeeded', 'click:failed', 'fill:succeeded', 'click:failed', 'click:failed']);
  }, 120_000);
});
