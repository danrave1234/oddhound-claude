// Automatic detectors and trace replay against a real Chromium and a deliberately buggy local app.
// Each bug has a fixed twin, so every check is shown both firing and staying quiet.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { attachSentinels, checkPage, internalErrorIn, routeOf, MARKUP_PROBE, type Signal } from '../../packages/core/browser/sentinels.ts';
import { replayScenario, newReplaySessions, type ReplayEnv, type Scenario } from '../../packages/core/verifier/scenario.ts';

let server: Server; let origin = ''; let browser: Browser;
const notes: string[] = [];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const html = (body: string, head = '') => `<!doctype html><html><head><meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    const send = (status: number, body: string) => res.writeHead(status, { 'content-type': 'text/html' }).end(body);
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'POST' && url.pathname === '/notes') {
      let raw = ''; req.on('data', (c) => { raw += c; });
      req.on('end', () => { notes.push(new URLSearchParams(raw).get('note') ?? ''); res.writeHead(303, { location: '/notes' }).end(); });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/crash') return void send(500, 'boom');
    switch (url.pathname) {
      case '/': return void send(200, html('<h1>Home</h1><a href="/missing-page">Old link</a> <a href="/notes">Notes</a> <button onclick="fetch(\'/api/crash\',{method:\'POST\'})">Crash</button>'));
      case '/notes': return void send(200, html(`<form method="post" action="/notes"><label>Note <input name="note"></label><button>Save</button></form><ul>${notes.map((n) => `<li>${n}</li>`).join('')}</ul>`));
      case '/notes-safe': return void send(200, html(`<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`));
      case '/oops': return void send(200, html('<pre>Traceback (most recent call last):\n  File "app.py", line 3</pre>'));
      case '/fine-error': return void send(200, html('<p>Something went wrong. Please try again.</p>'));
      case '/wide': return void send(200, html('<div style="width:1200px">wide table</div>'));
      case '/narrow': return void send(200, html('<div style="max-width:100%">fits</div>'));
      case '/throw': return void send(200, html('<p>x</p>', '<script>window.addEventListener("load", () => { null.boom(); });</script>'));
      default: return void send(404, html('<h1>Not found</h1>'));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const a = server.address();
  origin = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  browser = await chromium.launch({ channel: 'chromium', headless: true });
});
afterAll(async () => { await browser?.close(); server?.close(); });

const env = (): ReplayEnv => ({
  origin,
  sessions: newReplaySessions(),
  newContext: (device) => browser.newContext(device === 'mobile' ? { viewport: { width: 390, height: 844 }, isMobile: true } : { viewport: { width: 1440, height: 900 } }),
  identity: () => ({ name: 'Oddhound Tester', email: 'tester@example.test', password: 'Pw-123456!' }),
  inScope: (o) => o === origin,
});

describe('detectors (pure checks)', () => {
  it('recognises leaked internals but not a friendly error message', () => {
    expect(internalErrorIn('Traceback (most recent call last):\n File "x.py"')?.name).toBe('python_traceback');
    expect(internalErrorIn('Error\n    at Object.<anonymous> (/srv/app/index.js:12:5)')?.name).toBe('js_stack_frame');
    expect(internalErrorIn('SQLSTATE[23000]: Integrity constraint violation')?.name).toBe('sql_error');
    expect(internalErrorIn('Something went wrong. Please try again.')).toBeNull();
  });
  it('folds ids out of routes so one bug is one signal', () => {
    expect(routeOf('https://a.example/notes/123/edit')).toBe('/notes/:id/edit');
    expect(routeOf('https://a.example/u/3f2b1c4e-1111-2222-3333-444455556666')).toBe('/u/:id');
  });
});

describe('detectors in a real browser', () => {
  it('catch a server error, a broken link and an uncaught script error', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const got: Signal[] = [];
    attachSentinels(page, (o) => o === origin, (s) => got.push(s));
    await page.goto(`${origin}/`);
    await page.getByRole('button', { name: 'Crash' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('link', { name: 'Old link' }).click();
    await page.goto(`${origin}/throw`);
    await page.waitForTimeout(300);
    expect(got.map((s) => s.kind).sort()).toEqual(['http_404', 'http_5xx', 'page_error']);
    expect(got.find((s) => s.kind === 'http_5xx')).toMatchObject({ method: 'POST', route: '/api/crash', status: 500 });
    await ctx.close();
  });
  it('find rendered markup, leaked internals and phone overflow, and stay quiet on the fixed pages', async () => {
    notes.length = 0; notes.push(MARKUP_PROBE);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await ctx.newPage();
    const kinds = async (path: string) => { await page.goto(`${origin}${path}`); return (await checkPage(page, true)).map((s) => s.kind); };
    expect(await kinds('/notes')).toContain('markup_rendered');
    expect(await kinds('/notes-safe')).not.toContain('markup_rendered');
    expect(await kinds('/oops')).toContain('error_text');
    expect(await kinds('/fine-error')).not.toContain('error_text');
    expect(await kinds('/wide')).toContain('mobile_overflow');
    expect(await kinds('/narrow')).not.toContain('mobile_overflow');
    await ctx.close();
  });
});

describe('trace replay in a fresh session', () => {
  it('reproduces unescaped input from recorded steps (B3) and passes when the page escapes it', async () => {
    notes.length = 0;
    const bug: Scenario = { kind: 'trace', device: 'desktop', start: '/notes', steps: [{ op: 'fill', field: 'Note', value: MARKUP_PROBE }, { op: 'click', target: 'Save', role: 'button' }], oracle: { type: 'markup_rendered' } };
    const r = await replayScenario(bug, env());
    expect(r.outcome).toBe('failed');
    expect(r.observed).toMatch(/Reproduced/);
    const fixed: Scenario = { ...bug, steps: [...bug.steps, { op: 'goto', path: '/notes-safe' }] };
    notes.length = 0;
    // Replaying against the escaped page: the probe stays text, so the rule holds.
    const ok = await replayScenario({ ...fixed, start: '/notes', steps: [{ op: 'goto', path: '/notes-safe' }] }, env());
    expect(ok.outcome).toBe('passed');
  });
  it('reproduces a server error from a button press (B1)', async () => {
    const s: Scenario = { kind: 'trace', device: 'desktop', start: '/', steps: [{ op: 'click', target: 'Crash', role: 'button' }], oracle: { type: 'http_status', min: 500, max: 599, method: 'POST', route: '/api/crash' } };
    expect((await replayScenario(s, env())).outcome).toBe('failed');
  });
  it('reports a step it cannot perform as blocked, never as passed', async () => {
    const s: Scenario = { kind: 'trace', device: 'desktop', start: '/', steps: [{ op: 'click', target: 'No such button', role: 'button' }], oracle: { type: 'page_error' } };
    expect((await replayScenario(s, env())).outcome).toBe('blocked');
  });
  it('judges "still visible" text with the text oracle', async () => {
    const s: Scenario = { kind: 'trace', device: 'desktop', start: '/', steps: [], oracle: { type: 'text_present', text: 'Home' } };
    expect((await replayScenario(s, env())).outcome).toBe('failed');
    const t: Scenario = { ...s, oracle: { type: 'text_present', text: 'Account balance' } };
    expect((await replayScenario(t, env())).outcome).toBe('passed');
  });
});
