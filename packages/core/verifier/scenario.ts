// Scenarios: self-contained, replayable checks with a fixed, typed assertion.
//
// The agent proposes a candidate by describing what it observed in these terms (learned from the
// live site: form paths, field labels, button text). The verifier then replays the scenario in
// fresh contexts with fresh synthetic identities and evaluates the assertion with trusted code.
// The saved scenario (and its hash) is immutable: a retest replays exactly the same JSON.

import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import { canonicalJson, sha256 } from '../ledger/runs.ts';
import { attachSentinels, checkPage, describeSignal, routeOf, type Signal } from '../browser/sentinels.ts';
import { ExpectSchema, judgeExpectation, pageFacts } from './expect.ts';

const Template = z.string().max(200);
const FieldMap = z.record(z.string().min(1).max(80), Template).refine((m) => Object.keys(m).length > 0 && Object.keys(m).length <= 12, 'between 1 and 12 fields');

export const FormAuthRecipeSchema = z.object({
  kind: z.enum(['register', 'login']),
  path: z.string().startsWith('/').max(200),
  fields: FieldMap,
  submit: z.string().min(1).max(80),
  successText: z.string().min(1).max(120),
});
/** The owner signed in through the live handoff; replays reuse that run's in-memory session. */
export const HandoffAuthRecipeSchema = z.object({ kind: z.literal('handoff') });
export const AuthRecipeSchema = z.union([FormAuthRecipeSchema, HandoffAuthRecipeSchema]);
export type AuthRecipe = z.infer<typeof AuthRecipeSchema>;
export type FormAuthRecipe = z.infer<typeof FormAuthRecipeSchema>;

const FormSchema = z.object({ path: z.string().startsWith('/').max(200), fields: FieldMap, submit: z.string().min(1).max(80) });

/** A record a scenario needs first, created through the same form the run used. Its number, read from the
 *  URL the form lands on, replaces {id} in the scenario's paths, so the replay never opens the original
 *  run's record (which a fresh account cannot see). */
const SetupSchema = z.object({ path: z.string().startsWith('/').max(200), fields: z.record(z.string().max(80), z.string().max(500)), submit: z.string().min(1).max(80) });
export type Setup = z.infer<typeof SetupSchema>;

export const ScenarioSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('form_rule'),
    device: z.enum(['desktop', 'mobile']),
    auth: AuthRecipeSchema.optional(),
    form: FormSchema,
    // The field whose value breaks the rule. The persistence marker must never be placed in it,
    // because adding the marker would change the very input being tested.
    testedField: z.string().min(1).max(80),
    // What the owner's rule requires for this input.
    expectation: z.enum(['rejected', 'accepted']),
    // Where accepted records are listed; the verifier looks for the scenario's unique marker there.
    listPath: z.string().startsWith('/').max(200),
  }),
  z.object({
    kind: z.literal('cross_account_read'),
    device: z.enum(['desktop', 'mobile']),
    auth: AuthRecipeSchema,
    create: FormSchema,
    listPath: z.string().startsWith('/').max(200),
    expectation: z.literal('denied'),
  }),
  z.object({
    kind: z.literal('mobile_reachability'),
    device: z.literal('mobile'),
    auth: AuthRecipeSchema.optional(),
    path: z.string().startsWith('/').max(200),
    control: z.string().min(1).max(80), // visible text of the button/link that must be usable
    expectation: z.literal('reachable'),
  }),
  // A trace: the exact steps Oddhound recorded in its own action ledger (never model-authored),
  // replayed in a fresh session and judged by a fixed oracle from trusted code.
  z.object({
    kind: z.literal('trace'),
    device: z.enum(['desktop', 'mobile']),
    auth: AuthRecipeSchema.optional(),
    setup: SetupSchema.optional(),
    start: z.string().startsWith('/').max(300),
    steps: z.array(z.lazy(() => TraceStepSchema)).max(14),
    oracle: z.lazy(() => OracleSchema),
  }),
  // A scenario batch: steps Oddhound recorded while running a model-planned batch, each with the
  // model's expectation, judged by trusted code. `oracleStep` (1-based) is the step whose expectation
  // is the rule check; earlier expectations are preconditions. Replayed unchanged on retest.
  z.object({
    kind: z.literal('batch'),
    device: z.enum(['desktop', 'mobile']),
    auth: AuthRecipeSchema.optional(),
    setup: SetupSchema.optional(),
    start: z.string().startsWith('/').max(300),
    steps: z.array(z.object({ step: z.lazy(() => TraceStepSchema), expect: ExpectSchema.optional() })).min(1).max(15),
    oracleStep: z.number().int().min(1).max(15),
  }),
]);
export type Scenario = z.infer<typeof ScenarioSchema>;

/** Keys a user can press. Shared by the agent's tools and the replayed steps. */
export const KEYS = ['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Space'] as const;
/** Roles a replayed click can target (ARIA widgets included). */
export const CLICK_ROLES = ['button', 'link', 'other', 'tab', 'menuitem', 'switch', 'checkbox', 'radio', 'option', 'slider', 'combobox', 'treeitem'] as const;

export const TraceStepSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('goto'), path: z.string().startsWith('/').max(300) }),
  z.object({ op: z.literal('click'), target: z.string().min(1).max(120), role: z.enum(CLICK_ROLES) }),
  z.object({ op: z.literal('fill'), field: z.string().min(1).max(80), value: z.string().max(5200) }),
  z.object({ op: z.literal('select'), field: z.string().min(1).max(80), value: z.string().max(200) }),
  z.object({ op: z.literal('press'), key: z.enum(KEYS) }),
  z.object({ op: z.literal('back') }),
  // Drag one element onto another, both named by visible text (HTML5 drag and drop or pointer drag).
  z.object({ op: z.literal('drag'), source: z.string().min(1).max(120), target: z.string().min(1).max(120) }),
]);
export type TraceStep = z.infer<typeof TraceStepSchema>;

/** What "the bug reproduced" means for a trace. Each is evaluated by trusted code only. */
export const OracleSchema = z.discriminatedUnion('type', [
  // B1/B6: a response from an in-scope origin with this status range on this route.
  z.object({ type: z.literal('http_status'), min: z.number().int().min(400).max(599), max: z.number().int().min(400).max(599), method: z.string().max(10).optional(), route: z.string().max(300) }),
  z.object({ type: z.literal('page_error'), contains: z.string().max(120).optional() }), // B2
  z.object({ type: z.literal('markup_rendered') }), // B3
  z.object({ type: z.literal('error_text'), pattern: z.string().max(40) }), // B4
  z.object({ type: z.literal('mobile_overflow') }), // B5
  // Model-reported traces: text that must NOT be visible at the end (e.g. account data after sign-out).
  z.object({ type: z.literal('text_present'), text: z.string().min(2).max(120) }),
]);
export type Oracle = z.infer<typeof OracleSchema>;

/** Structural soundness checks the schema cannot express. Returns a reason when the scenario is malformed. */
export function scenarioDefect(s: Scenario): string | null {
  if (s.kind !== 'form_rule') return null;
  const tested = s.form.fields[s.testedField];
  if (tested === undefined) return `testedField "${s.testedField}" is not one of the form fields`;
  if (tested.includes('{marker}')) return `the marker was placed in the field under test ("${s.testedField}"), which changes the tested input`;
  return null;
}

export function scenarioHash(s: Scenario): string {
  return sha256(canonicalJson(s));
}

export type ReplayOutcome = 'passed' | 'failed' | 'inconclusive' | 'blocked';
export type ReplayResult = {
  outcome: ReplayOutcome;
  observed: string;
  details: Record<string, unknown>;
  screenshots: { label: string; data: Buffer }[];
};

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export type ReplayEnv = {
  origin: string;
  newContext: (device: 'desktop' | 'mobile', storageState?: StorageState) => Promise<BrowserContext>;
  identity: () => { name: string; email: string; password: string };
  /** Signed-in sessions per replay role, so a verification batch registers at most two accounts. */
  sessions: Map<string, StorageState>;
  onIdentityCreated?: (role: string) => void;
  /** The owner's signed-in session from this run's handoff (memory only; absent in later runs). */
  handoffState?: StorageState;
  /** Origins whose failures count as the site's own (the verified site and verified API hosts). */
  inScope?: (origin: string) => boolean;
};

export function newReplaySessions(): Map<string, StorageState> { return new Map(); }

class ReplayBlocked extends Error {}

function expand(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)(?:([+-])(\d+))?\}/g, (whole, name: string, sign?: string, n?: string) => {
    if (name === 'date' || name === 'today') {
      const d = new Date();
      if (sign && n) d.setUTCDate(d.getUTCDate() + (sign === '+' ? 1 : -1) * Number(n));
      return d.toISOString().slice(0, 10);
    }
    return vars[name] ?? whole;
  });
}

async function fieldLocator(page: Page, key: string) {
  const byLabel = page.getByLabel(key, { exact: false });
  if (await byLabel.count() > 0) return byLabel.first();
  const byName = page.locator(`[name="${key.replace(/"/g, '')}"]`);
  if (await byName.count() > 0) return byName.first();
  const byPlaceholder = page.getByPlaceholder(key, { exact: false });
  if (await byPlaceholder.count() > 0) return byPlaceholder.first();
  throw new ReplayBlocked(`field not found: ${key}`);
}

async function fillAndSubmit(page: Page, origin: string, form: { path: string; fields: Record<string, string>; submit: string }, vars: Record<string, string>) {
  await page.goto(new URL(form.path, origin).toString(), { waitUntil: 'domcontentloaded' });
  for (const [key, template] of Object.entries(form.fields)) {
    const loc = await fieldLocator(page, key);
    await loc.fill(expand(template, vars), { timeout: 5_000 });
  }
  const button = page.getByRole('button', { name: form.submit, exact: false });
  if (await button.count() === 0) throw new ReplayBlocked(`submit not found: ${form.submit}`);
  await button.first().click({ timeout: 5_000 }); // waits for the navigation it triggers to commit
  await page.waitForLoadState('domcontentloaded');
}

async function authenticate(page: Page, origin: string, auth: FormAuthRecipe, ident: { name: string; email: string; password: string }): Promise<void> {
  // Login recipes need an account first: register with the same identity is not known, so a login
  // recipe can only be replayed when the scenario was recorded with a supplied account (blocked otherwise).
  if (auth.kind === 'login') throw new ReplayBlocked('login recipe requires a supplied account; replay uses fresh registrations');
  await fillAndSubmit(page, origin, auth, ident);
  const body = await page.locator('body').innerText();
  if (!body.includes(auth.successText)) throw new ReplayBlocked(`authentication did not reach success text "${auth.successText}"`);
}

const shot = async (page: Page, label: string) => ({ label, data: await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false }) });

export async function replayScenario(s: Scenario, env: ReplayEnv): Promise<ReplayResult> {
  const screenshots: ReplayResult['screenshots'] = [];
  const contexts: BrowserContext[] = [];
  /** Open a page for a replay role, signed in through the scenario's own auth recipe (cached per role). */
  const open = async (device: 'desktop' | 'mobile', role?: string, auth?: AuthRecipe) => {
    if (auth?.kind === 'handoff') {
      // Only the owner's own account exists; it is never registered or signed in by the verifier.
      if (role !== 'A') throw new ReplayBlocked('a second account is not available: this run used the owner\'s own sign-in');
      if (!env.handoffState) throw new ReplayBlocked('this check needs the owner to sign in again (the earlier session is not kept after its run)');
      const ctx = await env.newContext(device, env.handoffState);
      contexts.push(ctx);
      return ctx.newPage();
    }
    const key = role && auth ? `${role}:${sha256(canonicalJson(auth))}` : undefined;
    const cached = key ? env.sessions.get(key) : undefined;
    const ctx = await env.newContext(device, cached);
    contexts.push(ctx);
    const page = await ctx.newPage();
    if (key && auth && !cached) {
      const ident = env.identity();
      await authenticate(page, env.origin, auth, ident);
      env.onIdentityCreated?.(role!);
      env.sessions.set(key, await ctx.storageState());
    }
    return page;
  };
  try {
    if (s.kind === 'form_rule') {
      const marker = `OH${randomBytes(4).toString('hex').toUpperCase()}`;
      const defect = scenarioDefect(s);
      if (defect) throw new ReplayBlocked(`malformed scenario: ${defect}`);
      const ident = env.identity();
      const page = await open(s.device, s.auth ? 'A' : undefined, s.auth);
      // Persistence is detected two ways: the unique marker appears on the list page, or the list
      // gains a record (rows/items) — the list may not display the field that carries the marker.
      const listUrl = new URL(s.listPath, env.origin).toString();
      const countRecords = () => page.locator('main tr, main li, main article, table tr').count();
      await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
      const before = await countRecords();
      await fillAndSubmit(page, env.origin, s.form, { ...ident, marker });
      screenshots.push(await shot(page, 'after submit'));
      await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
      const listed = (await page.locator('body').innerText()).includes(marker);
      const after = await countRecords();
      screenshots.push(await shot(page, 'record list'));
      const accepted = listed || after > before;
      const signal = listed ? `marker ${marker} appears on ${s.listPath}` : after > before ? `${s.listPath} gained a record (${before} → ${after} rows)` : `no new record on ${s.listPath} (${before} → ${after} rows, marker absent)`;
      const pass = s.expectation === 'rejected' ? !accepted : accepted;
      return {
        outcome: pass ? 'passed' : 'failed',
        observed: accepted ? `The submission was accepted and saved: ${signal}.` : `The submission was not saved: ${signal}.`,
        details: { marker, accepted, listed, rowsBefore: before, rowsAfter: after, expectation: s.expectation },
        screenshots,
      };
    }

    if (s.kind === 'cross_account_read') {
      const marker = `OH${randomBytes(4).toString('hex').toUpperCase()}`;
      const pageA = await open(s.device, 'A', s.auth);
      // Record links on the list before creating, so the new record can be found even when the list
      // does not display the field that carries the marker.
      const listUrl = new URL(s.listPath, env.origin).toString();
      const recordLinks = async () => new Set(await pageA.locator('main a[href], table a[href]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href)));
      await pageA.goto(listUrl, { waitUntil: 'domcontentloaded' });
      const before = await recordLinks();
      await fillAndSubmit(pageA, env.origin, s.create, { ...env.identity(), marker });
      await pageA.goto(listUrl, { waitUntil: 'domcontentloaded' });
      const row = pageA.locator('tr', { hasText: marker });
      let href: string | null = null;
      if (await row.count()) href = await row.first().locator('a[href]').first().getAttribute('href');
      if (!href) {
        const added = [...(await recordLinks())].filter((h) => !before.has(h));
        if (added.length === 1) href = added[0]!;
      }
      if (!href) throw new ReplayBlocked('could not find a link to the created record');
      const recordUrl = new URL(href, env.origin);
      if (recordUrl.origin !== new URL(env.origin).origin) throw new ReplayBlocked('record link leaves the verified origin');
      await pageA.goto(recordUrl.toString(), { waitUntil: 'domcontentloaded' });
      const ownerSees = (await pageA.locator('body').innerText()).includes(marker);
      if (!ownerSees) return { outcome: 'inconclusive', observed: 'The owner could not read their own record, so the boundary cannot be judged (positive control failed).', details: { marker }, screenshots };
      const pageB = await open(s.device, 'B', s.auth);
      const resp = await pageB.goto(recordUrl.toString(), { waitUntil: 'domcontentloaded' });
      const otherSees = (await pageB.locator('body').innerText()).includes(marker);
      screenshots.push(await shot(pageB, 'second account opens the first account\'s record'));
      return {
        outcome: otherSees ? 'failed' : 'passed',
        observed: otherSees
          ? `A second, unrelated account opened ${recordUrl.pathname} and saw the first account's private record (HTTP ${resp?.status()}, marker ${marker} present).`
          : `The second account could not see the first account's record at ${recordUrl.pathname} (HTTP ${resp?.status()}, marker absent).`,
        details: { marker, recordPath: recordUrl.pathname, status: resp?.status(), ownerSees, otherSees },
        screenshots,
      };
    }

    if (s.kind === 'trace') return await replayTrace(s, open, env, screenshots);
    if (s.kind === 'batch') return await replayBatch(s, open, env, screenshots);

    // mobile_reachability
    const page = await open('mobile', s.auth ? 'A' : undefined, s.auth);
    await page.goto(new URL(s.path, env.origin).toString(), { waitUntil: 'domcontentloaded' });
    const control = page.getByRole('button', { name: s.control, exact: false }).or(page.getByRole('link', { name: s.control, exact: false })).first();
    if (await control.count() === 0) throw new ReplayBlocked(`control not found: ${s.control}`);
    const positions: Record<string, boolean> = {};
    for (const block of ['center', 'start', 'end'] as const) {
      await control.evaluate((el, b) => el.scrollIntoView({ block: b }), block);
      // Trial click runs Playwright's actionability checks (visible, stable, receives events) without clicking.
      positions[block] = await control.click({ trial: true, timeout: 2_000 }).then(() => true, () => false);
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    positions.bottom = await control.click({ trial: true, timeout: 2_000 }).then(() => true, () => false);
    screenshots.push(await shot(page, 'mobile view at the end of the page'));
    const reachable = Object.values(positions).some(Boolean);
    const coveredBy = reachable ? null : await control.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, window.innerHeight - 1));
      return hit && hit !== el && !el.contains(hit) ? `${hit.tagName.toLowerCase()} "${(hit.textContent ?? '').trim().slice(0, 60)}"` : null;
    });
    return {
      outcome: reachable ? 'passed' : 'failed',
      observed: reachable
        ? `"${s.control}" can be reached and pressed at 390x844.`
        : `"${s.control}" cannot be pressed at 390x844 at any scroll position${coveredBy ? `; it is covered by ${coveredBy}` : ''}.`,
      details: { positions, coveredBy },
      screenshots,
    };
  } catch (e) {
    if (e instanceof ReplayBlocked) return { outcome: 'blocked', observed: e.message, details: {}, screenshots };
    return { outcome: 'inconclusive', observed: `Replay error: ${(e as Error).message.slice(0, 200)}`, details: {}, screenshots };
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
  }
}

type TraceScenario = Extract<Scenario, { kind: 'trace' }>;

/** Create the record a scenario needs and return its number from the URL the form lands on. */
async function runSetup(page: Page, origin: string, setup: Setup, vars: Record<string, string>): Promise<string> {
  await page.goto(new URL(setup.path, origin).toString(), { waitUntil: 'domcontentloaded' });
  try {
    for (const [field, value] of Object.entries(setup.fields)) await (await fieldLocator(page, field)).fill(expand(value, vars), { timeout: 5_000 });
    await (await targetLocator(page, setup.submit, 'button')).click({ timeout: 5_000 });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  } catch (e) {
    throw new ReplayBlocked(`setup (create the record at ${setup.path}) failed: ${(e as Error).message.split('\n')[0]!.slice(0, 160)}`);
  }
  const id = recordIdsInUrl(page.url())[0];
  if (!id) throw new ReplayBlocked(`setup at ${setup.path} did not show which record it created (no number in ${new URL(page.url()).pathname})`);
  return id;
}

/** Record numbers a URL carries: numeric path segments, then numeric query values (e.g. ?created=4). */
export function recordIdsInUrl(url: string): string[] {
  const u = new URL(url);
  const fromPath = u.pathname.split('/').filter((p) => /^\d{1,12}$/.test(p));
  const fromQuery = [...u.searchParams.values()].filter((v) => /^\d{1,12}$/.test(v));
  return [...fromPath, ...fromQuery];
}

async function runStep(page: Page, origin: string, step: TraceStep, vars: Record<string, string>): Promise<void> {
  switch (step.op) {
    case 'goto': await page.goto(new URL(expand(step.path, vars), origin).toString(), { waitUntil: 'domcontentloaded' }); return;
    case 'back': await page.goBack({ waitUntil: 'domcontentloaded' }); return;
    case 'press': await page.keyboard.press(step.key === 'Space' ? ' ' : step.key); return;
    case 'fill': await (await fieldLocator(page, step.field)).fill(expand(step.value, vars), { timeout: 5_000 }); return;
    case 'select': await (await fieldLocator(page, step.field)).selectOption(expand(step.value, vars), { timeout: 5_000 }); return;
    case 'click': {
      const loc = await targetLocator(page, step.target, step.role);
      await loc.click({ timeout: 5_000 });
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return;
    }
    case 'drag': {
      const from = await targetLocator(page, step.source, 'other');
      const to = await targetLocator(page, step.target, 'other');
      await from.dragTo(to, { timeout: 5_000 });
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
  }
}

/** Find a visible control by its text: by role first, then by exact and partial text. */
async function targetLocator(page: Page, text: string, role: (typeof CLICK_ROLES)[number]) {
  const byRole = role === 'other'
    ? page.getByText(text, { exact: true }).or(page.getByLabel(text, { exact: true }))
    : page.getByRole(role, { name: text, exact: true }).or(page.getByRole(role, { name: text }));
  const loc = (await byRole.count()) ? byRole.first() : page.getByText(text).first();
  if (!(await loc.count())) throw new ReplayBlocked(`could not find "${text}"`);
  return loc;
}

function routeMatches(pattern: string, url: string): boolean {
  return routeOf(url) === pattern;
}

async function replayTrace(
  s: TraceScenario,
  open: (device: 'desktop' | 'mobile', role?: string, auth?: AuthRecipe) => Promise<Page>,
  env: ReplayEnv,
  screenshots: ReplayResult['screenshots'],
): Promise<ReplayResult> {
  const marker = `OH${randomBytes(4).toString('hex').toUpperCase()}`;
  const page = await open(s.device, s.auth ? 'A' : undefined, s.auth);
  const inScope = env.inScope ?? ((o: string) => o === new URL(env.origin).origin);
  const signals: Signal[] = [];
  attachSentinels(page, inScope, (sig) => signals.push(sig));
  const vars: Record<string, string> = { ...env.identity(), marker };
  if (s.setup) vars.id = await runSetup(page, env.origin, s.setup, vars);
  await page.goto(new URL(expand(s.start, vars), env.origin).toString(), { waitUntil: 'domcontentloaded' });
  for (const [i, step] of s.steps.entries()) {
    try { await runStep(page, env.origin, step, vars); }
    catch (e) {
      if (e instanceof ReplayBlocked) throw new ReplayBlocked(`step ${i + 1} (${step.op}): ${e.message}`);
      throw new ReplayBlocked(`step ${i + 1} (${step.op}) failed: ${(e as Error).message.split('\n')[0]!.slice(0, 160)}`);
    }
    await page.waitForTimeout(300);
  }
  // Let requests started by the last step finish before judging.
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});
  signals.push(...await checkPage(page, s.device === 'mobile'));
  screenshots.push(await shot(page, 'end of replayed steps'));
  const o = s.oracle;
  let hit: string | null = null;
  if (o.type === 'http_status') {
    const r = signals.find((x) => (x.kind === 'http_5xx' || x.kind === 'http_404') && x.status >= o.min && x.status <= o.max
      && (!o.method || (x.kind === 'http_5xx' ? x.method : 'GET') === o.method) && routeMatches(o.route, x.url));
    if (r) hit = describeSignal(r);
  } else if (o.type === 'page_error') {
    const r = signals.find((x) => x.kind === 'page_error' && (!o.contains || x.message.includes(o.contains)));
    if (r) hit = describeSignal(r);
  } else if (o.type === 'markup_rendered') {
    const r = signals.find((x) => x.kind === 'markup_rendered'); if (r) hit = describeSignal(r);
  } else if (o.type === 'error_text') {
    const r = signals.find((x) => x.kind === 'error_text' && x.pattern === o.pattern); if (r) hit = describeSignal(r);
  } else if (o.type === 'mobile_overflow') {
    const r = signals.find((x) => x.kind === 'mobile_overflow'); if (r) hit = describeSignal(r);
  } else {
    const body = await page.locator('body').innerText().catch(() => '');
    if (body.includes(o.text)) hit = `"${o.text}" is still visible at ${new URL(page.url()).pathname}`;
  }
  return {
    outcome: hit ? 'failed' : 'passed',
    observed: hit ? `Reproduced in a fresh session: ${hit}.` : `Not reproduced in a fresh session after ${s.steps.length} step(s).`,
    details: { oracle: o, steps: s.steps.length, signals: signals.map(describeSignal).slice(0, 10) },
    screenshots,
  };
}

type BatchScenario = Extract<Scenario, { kind: 'batch' }>;

async function replayBatch(
  s: BatchScenario,
  open: (device: 'desktop' | 'mobile', role?: string, auth?: AuthRecipe) => Promise<Page>,
  env: ReplayEnv,
  screenshots: ReplayResult['screenshots'],
): Promise<ReplayResult> {
  const marker = `OH${randomBytes(4).toString('hex').toUpperCase()}`;
  const page = await open(s.device, s.auth ? 'A' : undefined, s.auth);
  const vars: Record<string, string> = { ...env.identity(), marker };
  if (s.setup) vars.id = await runSetup(page, env.origin, s.setup, vars);
  await page.goto(new URL(expand(s.start, vars), env.origin).toString(), { waitUntil: 'domcontentloaded' });
  const last = Math.min(s.oracleStep, s.steps.length);
  const checks: { step: number; ok: boolean; detail: string }[] = [];
  for (let i = 0; i < last; i++) {
    const { step, expect } = s.steps[i]!;
    const pathBefore = new URL(page.url()).pathname;
    try { await runStep(page, env.origin, step, vars); }
    catch (e) {
      if (e instanceof ReplayBlocked) throw new ReplayBlocked(`step ${i + 1} (${step.op}): ${e.message}`);
      throw new ReplayBlocked(`step ${i + 1} (${step.op}) failed: ${(e as Error).message.split('\n')[0]!.slice(0, 160)}`);
    }
    await page.waitForTimeout(300);
    if (!expect) continue;
    const v = judgeExpectation(expect, await pageFacts(page, pathBefore));
    checks.push({ step: i + 1, ok: v.ok, detail: v.detail });
    if (i + 1 === last) {
      screenshots.push(await shot(page, `after step ${i + 1}`));
      return {
        outcome: v.ok ? 'passed' : v.unclear ? 'inconclusive' : 'failed',
        observed: v.ok ? `The expectation held in a fresh session: ${v.detail}.`
          : v.unclear ? `Could not judge step ${i + 1} in a fresh session: ${v.detail}.`
            : `Reproduced in a fresh session at step ${i + 1}: ${v.detail}.`,
        details: { checks, oracleStep: last },
        screenshots,
      };
    }
    if (!v.ok) {
      screenshots.push(await shot(page, `precondition step ${i + 1}`));
      return { outcome: 'inconclusive', observed: `A precondition did not hold at step ${i + 1}: ${v.detail}.`, details: { checks }, screenshots };
    }
  }
  return { outcome: 'blocked', observed: `Step ${last} has no expectation to judge.`, details: { checks }, screenshots };
}

/** A valid neighbouring case that must keep working (the control for a form_rule finding). */
export function controlFor(s: Scenario, validValues: Record<string, string>): Scenario | null {
  if (s.kind !== 'form_rule' || s.expectation !== 'rejected') return null;
  return { ...s, form: { ...s.form, fields: { ...s.form.fields, ...validValues } }, expectation: 'accepted' };
}
