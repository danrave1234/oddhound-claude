// Owner sign-in handoff against a real Chromium and a real PostgreSQL (oddhound_test):
// the owner's clicks and keystrokes reach the page, frames are published, typed text never lands in
// the event log or stays in the input queue, and the agent receives the signed-in session.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { getPool, closePool } from '../../packages/core/db/pool.ts';
import { migrate } from '../../packages/core/db/migrate.ts';
import { admitRun, claimRun, appendEvent } from '../../packages/core/ledger/runs.ts';
import { demoTargetContract } from '../../packages/core/contracts/contract.ts';
import { RunSession } from '../../packages/core/agent/session.ts';
import { policyFromContract } from '../../packages/core/browser/scope.ts';
import { runHandoff, queueHandoffInput, HandoffEnded } from '../../packages/core/agent/handoff.ts';

const db = getPool();
const SECRET = 'Owner-Pass-7731';
let server: Server; let origin = ''; let browser: Browser;

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;
beforeAll(async () => {
  await migrate(db);
  server = createServer((req, res) => {
    if (req.url === '/login' && req.method === 'POST') {
      let raw = ''; req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const f = new URLSearchParams(raw);
        if (f.get('email') === 'owner@example.test' && f.get('password') === SECRET) {
          res.writeHead(303, { location: '/account', 'set-cookie': 'sid=owner-session; Path=/; HttpOnly' }).end();
        } else res.writeHead(200, { 'content-type': 'text/html' }).end(page('<p>Wrong password</p>'));
      });
      return;
    }
    if (req.url === '/login') return void res.writeHead(200, { 'content-type': 'text/html' }).end(page(
      '<form method="post" action="/login"><label>Email <input id="email" name="email"></label><label>Password <input id="pw" name="password" type="password"></label><button>Sign in</button></form>'));
    if (req.url === '/account') {
      const ok = (req.headers.cookie ?? '').includes('sid=owner-session');
      return void res.writeHead(ok ? 200 : 401, { 'content-type': 'text/html' }).end(page(ok ? '<h1>Signed in as owner</h1>' : '<h1>Please sign in</h1>'));
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(page('<a href="/login">Log in</a>'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  browser = await chromium.launch({ channel: 'chromium', headless: true });
});
afterAll(async () => { await browser?.close(); server?.close(); await closePool(); });

let site = 0;
async function newClaimedRun() {
  // One run per site: give each test run its own site key (the browser still talks to the local server).
  const a = await admitRun(db, { principal: `test:handoff:${++site}`, ownerId: null, projectId: null, mode: 'verified_site', contract: demoTargetContract(`https://handoff${site}.example`), spendAccount: 'development' });
  if (!a.ok) throw new Error(a.reason);
  const generation = await claimRun(db, a.runId, 'test-worker');
  return { runId: a.runId, generation: generation! };
}

const waitFor = async <T>(fn: () => Promise<T | null | undefined>, ms = 15_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 100)); }
};

describe('owner sign-in handoff', () => {
  it('relays the owner\'s sign-in to the page and hands the session to the agent', async () => {
    await db.query('TRUNCATE runs CASCADE');
    const { runId, generation } = await newClaimedRun();
    const session = new RunSession(browser, policyFromContract(demoTargetContract(origin)), () => {});
    const ev = (t: string, p: Record<string, unknown> = {}) => appendEvent(db, runId, t, p);
    const result = runHandoff({ db, runId, generation, session, startPath: '/login', ev, signal: new AbortController().signal });

    // A live frame is published while the owner is signing in.
    await waitFor(async () => (await db.query('SELECT 1 FROM run_live_frames WHERE run_id = $1', [runId])).rowCount);
    const p = await session.page();
    const box = await waitFor(() => p.locator('#email').boundingBox());
    await queueHandoffInput(db, runId, { type: 'click', x: box.x + 5, y: box.y + 5 });
    await queueHandoffInput(db, runId, { type: 'type', text: 'owner@example.test' });
    await queueHandoffInput(db, runId, { type: 'key', key: 'Tab' });
    await queueHandoffInput(db, runId, { type: 'type', text: SECRET });
    await queueHandoffInput(db, runId, { type: 'key', key: 'Enter' });
    await waitFor(async () => (await session.page()).url().endsWith('/account'));
    await queueHandoffInput(db, runId, { type: 'done' });
    const state = await result;

    expect(state?.cookies.some((c) => c.name === 'sid' && c.value === 'owner-session')).toBe(true);
    expect(session.handoffActive).toBe(false);
    // Typed text never reaches the event log, and nothing stays queued or framed.
    const events = (await db.query<{ type: string; payload: unknown }>('SELECT type, payload FROM run_events WHERE run_id = $1 ORDER BY seq', [runId])).rows;
    const log = JSON.stringify(events);
    expect(log).not.toContain(SECRET);
    expect(log).not.toContain('owner@example.test');
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['handoff.started', 'handoff.input', 'handoff.completed']));
    expect((await db.query('SELECT 1 FROM run_handoff_inputs WHERE run_id = $1', [runId])).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM run_live_frames WHERE run_id = $1', [runId])).rowCount).toBe(0);
    // Queued input is stored encrypted, never as plain text.
    const ctx2 = await newClaimedRun();
    await queueHandoffInput(db, ctx2.runId, { type: 'type', text: SECRET });
    const stored = (await db.query<{ payload_enc: string }>('SELECT payload_enc FROM run_handoff_inputs WHERE run_id = $1', [ctx2.runId])).rows[0]!.payload_enc;
    expect(stored).not.toContain(SECRET);
    // The agent's later contexts (e.g. the phone) carry the owner's session.
    await session.setDevice('mobile');
    await (await session.page()).goto(`${origin}/account`);
    expect(await (await session.page()).locator('h1').innerText()).toBe('Signed in as owner');
    await session.close();
  });

  it('stops cleanly when the owner cancels', async () => {
    await db.query('TRUNCATE runs CASCADE');
    const { runId, generation } = await newClaimedRun();
    const session = new RunSession(browser, policyFromContract(demoTargetContract(origin)), () => {});
    const ev = (t: string, p: Record<string, unknown> = {}) => appendEvent(db, runId, t, p);
    const result = runHandoff({ db, runId, generation, session, startPath: '/login', ev, signal: new AbortController().signal });
    await queueHandoffInput(db, runId, { type: 'cancel' });
    await expect(result).rejects.toBeInstanceOf(HandoffEnded);
    expect(session.handoffActive).toBe(false);
    await session.close();
  });
});
