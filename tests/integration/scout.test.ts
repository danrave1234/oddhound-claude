// Scout, stated rules and scenario-batch replay against a real Chromium and a local app.
// Each rule-breaking page has a twin that keeps the rule, so every check is shown both firing and
// staying quiet. Nothing here edits the page's HTML: values are typed like a user types them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { observe, statedRules } from '../../packages/core/browser/snapshot.ts';
import { resolveBoundary } from '../../packages/core/agent/boundary.ts';
import { judgeExpectation, pageFacts } from '../../packages/core/verifier/expect.ts';
import { replayScenario, newReplaySessions, scenarioHash, type ReplayEnv, type Scenario } from '../../packages/core/verifier/scenario.ts';

let server: Server; let origin = ''; let browser: Browser;
const html = (body: string, head = '') => `<!doctype html><html><head><meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`;

const widgets = (broken: boolean) => html(`
<nav><a href="/">Home</a></nav>
<main>
  <div role="tablist"><button role="tab" aria-selected="true">Overview</button><div role="tab" tabindex="0" aria-selected="false">Details</div></div>
  <div role="menu"><div role="menuitem" tabindex="-1">Rename</div></div>
  <div role="switch" aria-checked="false" tabindex="0" aria-label="Email alerts" style="width:30px;height:16px;background:#ccc"></div>
  <div role="slider" aria-label="Volume" aria-valuemin="0" aria-valuemax="10" aria-valuenow="3" tabindex="0" style="width:100px;height:10px;background:#ddd"></div>
  <button><span>Save <b>now</b></span></button>
  <div contenteditable="true" aria-label="Comment" style="min-height:20px;border:1px solid #999"></div>
  <div id="card" draggable="true" style="width:120px;padding:8px;background:#eef">Card A</div>
  <div id="zone" aria-roledescription="drop zone" style="width:200px;height:60px;background:#efe">Done</div>
  <div style="cursor:pointer" onclick="this.textContent='More shown'">Show more</div>
</main>
<script>
  document.getElementById('card').addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'Card A'));
  const zone = document.getElementById('zone');
  zone.addEventListener('dragover', (e) => e.preventDefault());
  zone.addEventListener('drop', (e) => { e.preventDefault(); ${broken ? '/* broken build: drop is ignored */' : "zone.textContent = 'Done: ' + e.dataTransfer.getData('text/plain');"} });
</script>`);

const bookingForm = (action: string, novalidate: boolean, error = '') => html(`
<main><h1>Booking</h1>
<p>Book a table for up to 8 guests. Notes (max 20 characters).</p>
${error ? `<p role="alert" class="error">${error}</p>` : ''}
<form method="post" action="${action}" ${novalidate ? 'novalidate' : ''}>
  <label>Guest name <input name="guest" required minlength="2"></label>
  <label>Party size <input name="party" type="number" min="1" max="8" required></label>
  <label>Notes <textarea name="notes" maxlength="20"></textarea></label>
  <button>Save</button>
</form></main>`);

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status: number, body: string) => res.writeHead(status, { 'content-type': 'text/html' }).end(body);
    if (req.method === 'POST') {
      let raw = ''; req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const party = Number(new URLSearchParams(raw).get('party'));
        // The "strict" handler enforces the limit the page states; the "lax" handler trusts the client.
        if (url.pathname === '/strict' && !(party >= 1 && party <= 8)) return void send(422, bookingForm('/strict', true, 'Party size must be between 1 and 8.'));
        res.writeHead(303, { location: `/saved?party=${party}` }).end();
      });
      return;
    }
    switch (url.pathname) {
      case '/widgets': return void send(200, widgets(url.searchParams.has('broken')));
      case '/form': return void send(200, bookingForm('/strict', false));
      case '/lax': return void send(200, bookingForm('/lax', true));
      case '/strict-form': return void send(200, bookingForm('/strict', true));
      case '/saved': return void send(200, html(`<main><p role="status" class="notice">Saved: party ${url.searchParams.get('party')}</p></main>`));
      default: return void send(200, html('<main><h1>Home</h1></main>'));
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

describe('scout (real browser)', () => {
  it('lists ARIA widgets, editable and draggable elements and pointer-only targets, each once', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${origin}/widgets`);
    const o = await observe(page, 1);
    const by = (label: string) => o.elements.filter((e) => e.label === label);
    expect(by('Overview')[0]).toMatchObject({ kind: 'widget', role: 'tab', checked: true });
    expect(by('Details')[0]).toMatchObject({ kind: 'widget', role: 'tab', checked: false });
    expect(by('Rename')[0]).toMatchObject({ kind: 'widget', role: 'menuitem' });
    expect(by('Email alerts')[0]).toMatchObject({ kind: 'widget', role: 'switch', checked: false });
    expect(by('Volume')[0]).toMatchObject({ kind: 'widget', role: 'slider', min: '0', max: '10', value: '3' });
    expect(by('Save now')).toHaveLength(1); // the nested <span>/<b> is not a second control
    expect(by('Comment')[0]).toMatchObject({ kind: 'editable' });
    expect(by('Card A')[0]).toMatchObject({ kind: 'draggable', draggable: true });
    expect(by('Done')[0]).toMatchObject({ draggable: true });
    expect(by('Show more')[0]).toMatchObject({ kind: 'clickable' });
    expect(by('Home')[0]).toMatchObject({ kind: 'link', region: 'nav' });
    // Every listed element resolves to exactly one tagged node.
    for (const e of o.elements) expect(await page.locator(`[data-oh-ref~="${e.ref}@1"]`).count()).toBe(1);
    await ctx.close();
  });

  it('records the rules the page states about itself, including limits in its text', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${origin}/form`);
    const o = await observe(page, 1);
    const rules = statedRules(o).map((r) => `${r.field}:${r.rule}=${r.value}`);
    expect(rules).toEqual(expect.arrayContaining(['Guest name:required=true', 'Guest name:minlength=2', 'Party size:min=1', 'Party size:max=8', 'Party size:type=number', 'Notes:maxlength=20']));
    expect(o.statedLimits).toEqual(expect.arrayContaining(['up to 8 guests', 'max 20 characters']));
    await ctx.close();
  });

  it('types boundary values like a user: the browser keeps its own limits (no HTML is edited)', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${origin}/form`);
    const o = await observe(page, 1);
    const notes = o.elements.find((e) => e.label === 'Notes')!;
    const past = resolveBoundary('{past:maxlength}', notes);
    if ('error' in past) throw new Error(past.error);
    await page.getByLabel('Notes').fill(past.value);
    expect(past.value).toHaveLength(21);
    expect(await page.getByLabel('Notes').inputValue()).toHaveLength(20); // maxlength held
    // A value past the stated max is refused by the browser's own validation: the rule holds.
    const party = resolveBoundary('{past:max}', o.elements.find((e) => e.label === 'Party size')!);
    if ('error' in party) throw new Error(party.error);
    await page.getByLabel('Guest name').fill('Ann');
    await page.getByLabel('Party size').fill(party.value);
    const before = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(300);
    const v = judgeExpectation({ outcome: 'rejected' }, await pageFacts(page, before));
    expect(v.ok).toBe(true);
    expect(new URL(page.url()).pathname).toBe('/form');
    expect(await page.getAttribute('input[name=party]', 'max')).toBe('8'); // untouched
    await ctx.close();
  });
});

describe('scenario batch replay (fresh session, unchanged assertion)', () => {
  type Batch = Extract<Scenario, { kind: 'batch' }>;
  const pastMax = (start: string): Batch => ({
    kind: 'batch', device: 'desktop', start,
    steps: [
      { step: { op: 'fill', field: 'Guest name', value: 'Ann' } },
      { step: { op: 'fill', field: 'Party size', value: '9' } },
      { step: { op: 'click', target: 'Save', role: 'button' }, expect: { outcome: 'rejected' } },
    ],
    oracleStep: 3,
  });

  it('reproduces a stated limit the server does not enforce (B10) and passes where it is enforced', async () => {
    const lax = pastMax('/lax');
    const hash = scenarioHash(lax);
    const bug = await replayScenario(lax, env());
    expect(bug.outcome).toBe('failed');
    expect(bug.observed).toMatch(/Reproduced in a fresh session at step 3: expected a rejection/);
    expect(scenarioHash(lax)).toBe(hash); // replay never changes the saved assertion
    const ok = await replayScenario(pastMax('/strict-form'), env());
    expect(ok.outcome).toBe('passed');
    expect(ok.observed).toMatch(/rejected \(Party size must be between 1 and 8/);
  });

  it('a failed precondition is inconclusive, and a step it cannot perform is blocked, never passed', async () => {
    const pre: Batch = { ...pastMax('/lax'), steps: [{ step: { op: 'fill', field: 'Guest name', value: 'Ann' }, expect: { text_visible: 'Not on this page' } }, ...pastMax('/lax').steps.slice(1)] };
    expect((await replayScenario(pre, env())).outcome).toBe('inconclusive');
    const missing: Batch = { ...pastMax('/lax'), steps: [{ step: { op: 'click', target: 'No such button', role: 'button' }, expect: { outcome: 'accepted' } }], oracleStep: 1 };
    expect((await replayScenario(missing, env())).outcome).toBe('blocked');
  });

  it('replays drag and drop, and catches a drop that does nothing', async () => {
    const drag = (start: string): Scenario => ({ kind: 'batch', device: 'desktop', start, steps: [{ step: { op: 'drag', source: 'Card A', target: 'Done' }, expect: { text_visible: 'Done: Card A' } }], oracleStep: 1 });
    expect((await replayScenario(drag('/widgets'), env())).outcome).toBe('passed');
    expect((await replayScenario(drag('/widgets?broken=1'), env())).outcome).toBe('failed');
  });
});
