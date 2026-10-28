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
import { DOUBLE_PRESS_GAP_MS, INTERRUPTION_SETTLE_MS, claimVisible, judgeCrossActor, judgeInterruption, judgeInvariant, judgePersistence, judgeTwoTabs, occurrences, readTables, readView, rejectionShown, type Interruption, type PageView } from './behavior.ts';

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
  // Family 1, claim vs. truth: the recorded save (ending at its submit), the success message the page
  // showed, and the saved values that must be visible again after reloading the page the save landed
  // on and reopening the record. A missing value is only reported after the bounded window.
  z.object({
    kind: z.literal('claim_check'),
    device: z.enum(['desktop', 'mobile']),
    auth: AuthRecipeSchema.optional(),
    setup: SetupSchema.optional(),
    start: z.string().startsWith('/').max(300),
    steps: z.array(z.lazy(() => TraceStepSchema)).min(1).max(14),
    /** The success text the page showed after the save (null: it showed none; never verified then). */
    claim: z.string().min(2).max(120).nullable(),
    checks: z.array(z.object({ field: z.string().min(1).max(80), value: z.string().min(1).max(500) })).min(1).max(6),
    /** Pages reopened besides reloading where the save landed. {id}: setup record; {landed_id}: the number in the landed URL. */
    revisit: z.array(z.string().startsWith('/').max(300)).max(2),
    windowMs: z.number().int().min(0).max(10_000),
  }),
  // Family 2, cross-actor access: actor A creates the record through the recorded form, actor B (a
  // separate fresh account) opens exactly that record's URL and presses the controls it can see.
  z.object({
    kind: z.literal('cross_actor'),
    device: z.enum(['desktop', 'mobile']),
    auth: FormAuthRecipeSchema,
    setup: SetupSchema,
    path: z.string().startsWith('/').max(300),
    /** A's list of its own records (where the app shows what belongs to A); B's copy must not list it. */
    listPath: z.string().startsWith('/').max(300).optional(),
    /** Setup fields whose values are A's own content. */
    protect: z.array(z.string().min(1).max(80)).min(1).max(4),
    controls: z.array(z.object({ target: z.string().min(1).max(120), role: z.enum(['button', 'link']) })).max(2),
    expectation: z.literal('denied'),
  }),
  // Family 2, same actor in two tabs: both tabs open the record's edit form, the first saves a change
  // to one field, then the out-of-date second tab saves a change to another. `sequential` is the
  // neighbouring control: the same two edits one after the other in one tab.
  z.object({
    kind: z.literal('two_tab'),
    device: z.enum(['desktop', 'mobile']),
    auth: AuthRecipeSchema.optional(),
    setup: SetupSchema,
    path: z.string().startsWith('/').max(300),
    first: z.object({ field: z.string().min(1).max(80), value: z.string().min(1).max(200) }),
    second: z.object({ field: z.string().min(1).max(80), value: z.string().min(1).max(200) }),
    sequential: z.boolean(),
    expectation: z.literal('no_lost_update'),
  }),
  // Family 3, invariant: recreate the records the page summarises (the run's own create forms), open the
  // page and check the invariant with numbers parsed by code.
  z.object({
    kind: z.literal('invariant'),
    device: z.enum(['desktop', 'mobile']),
    auth: AuthRecipeSchema.optional(),
    setups: z.array(SetupSchema).max(4),
    path: z.string().startsWith('/').max(300),
    invariant: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('sum'), total: z.string().min(1).max(80), column: z.string().min(1).max(80) }),
      z.object({ kind: z.literal('count'), total: z.string().min(1).max(80), column: z.string().min(1).max(80).optional() }),
    ]),
  }),
  // Family 5, differential: the same page for the same account on desktop and on a phone; each control
  // that is visible on desktop must be visible on the phone too.
  z.object({
    kind: z.literal('differential'),
    device: z.literal('desktop'),
    auth: AuthRecipeSchema.optional(),
    setup: SetupSchema.optional(),
    path: z.string().startsWith('/').max(300),
    compare: z.literal('desktop_vs_mobile'),
    controls: z.array(z.object({ label: z.string().min(1).max(120), role: z.enum(['button', 'link']) })).min(1).max(6),
  }),
  // Family 4, interruption: the recorded create form submitted with an ordinary interruption; the list
  // must gain exactly one record carrying `value`. `none` is the neighbouring control (a normal submit).
  z.object({
    kind: z.literal('interruption'),
    device: z.enum(['desktop', 'mobile']),
    auth: AuthRecipeSchema.optional(),
    form: FormSchema,
    listPath: z.string().startsWith('/').max(300),
    value: z.string().min(4).max(200),
    interruption: z.enum(['none', 'double_submit', 'offline_submit', 'reload_after_submit']),
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

export function expand(template: string, vars: Record<string, string>): string {
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

export async function fillAndSubmit(page: Page, origin: string, form: { path: string; fields: Record<string, string>; submit: string }, vars: Record<string, string>) {
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
    if (s.kind === 'claim_check') return await replayClaim(s, open, env, screenshots);
    if (s.kind === 'cross_actor') return await replayCrossActor(s, open, env, screenshots);
    if (s.kind === 'two_tab') return await replayTwoTabs(s, open, env, screenshots);
    if (s.kind === 'interruption') return await replayInterruption(s, open, env, screenshots);
    if (s.kind === 'differential') {
      // Same account on both devices: the role A session is reused for the phone context.
      const desk = await open('desktop', s.auth ? 'A' : undefined, s.auth);
      const vars: Record<string, string> = { ...env.identity(), marker: `OH${randomBytes(4).toString('hex').toUpperCase()}` };
      if (s.setup) vars.id = await runSetup(desk, env.origin, s.setup, vars);
      const url = new URL(expand(s.path, vars), env.origin).toString();
      const visibleIn = async (page: Page) => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        return Promise.all(s.controls.map(async (c) => page.getByRole(c.role, { name: c.label, exact: true }).first().isVisible().catch(() => false)));
      };
      const onDesktop = await visibleIn(desk);
      const phone = await open('mobile', s.auth ? 'A' : undefined, s.auth);
      const onPhone = await visibleIn(phone);
      screenshots.push(await shot(phone, 'the same page on a 390x844 phone'));
      if (onDesktop.some((v) => !v)) return { outcome: 'inconclusive', observed: `Not every control was visible on desktop in a fresh session (${s.controls.filter((_, i) => !onDesktop[i]).map((c) => `"${c.label}"`).join(', ')}), so the comparison cannot be made.`, details: { onDesktop, onPhone }, screenshots };
      const gone = s.controls.filter((_, i) => !onPhone[i]);
      return {
        outcome: gone.length ? 'failed' : 'passed',
        observed: gone.length ? `Reproduced in a fresh session: ${gone.map((c) => `${c.role} "${c.label}"`).join(', ')} ${gone.length === 1 ? 'is' : 'are'} visible on desktop but not on a 390x844 phone.` : 'Every compared control is visible on both desktop and a 390x844 phone.',
        details: { controls: s.controls, onDesktop, onPhone },
        screenshots,
      };
    }
    if (s.kind === 'invariant') {
      const page = await open(s.device, s.auth ? 'A' : undefined, s.auth);
      const vars: Record<string, string> = { ...env.identity(), marker: `OH${randomBytes(4).toString('hex').toUpperCase()}` };
      for (const st of s.setups) await runSetup(page, env.origin, st, vars);
      await page.goto(new URL(expand(s.path, vars), env.origin).toString(), { waitUntil: 'domcontentloaded' });
      const v = judgeInvariant(s.invariant, { text: (await readView(page)).text, tables: await readTables(page) });
      screenshots.push(await shot(page, 'page the invariant was checked on'));
      return { outcome: v.outcome, observed: `${v.outcome === 'inconclusive' ? 'Cannot judge' : v.outcome === 'failed' ? 'Reproduced in a fresh session' : 'Held in a fresh session'}: ${v.detail}.`, details: { invariant: s.invariant, values: v.values, setups: s.setups.length }, screenshots };
    }

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
  // Query flags and paging (?welcome=1, ?page=2) are not record numbers.
  const flag = /^(welcome|new|page|p|step|tab|sort|limit|offset|count|v|ver|version|success|ok|status|ref|utm_\w+)$/i;
  const fromQuery = [...u.searchParams.entries()].filter(([k, v]) => !flag.test(k) && /^\d{1,12}$/.test(v)).map(([, v]) => v);
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

type ClaimScenario = Extract<Scenario, { kind: 'claim_check' }>;
type Opener = (device: 'desktop' | 'mobile', role?: string, auth?: AuthRecipe) => Promise<Page>;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pathAndQuery = (url: string) => { const u = new URL(url); return `${u.pathname}${u.search}`; };

/** The pauses of family 1's bounded window: one look now, two more later, summing to the window. */
export function claimDelays(windowMs: number): number[] {
  if (windowMs <= 0) return [0];
  const first = Math.round(windowMs / 3);
  return [0, first, windowMs - first];
}

/** Family 1 replay: run the save, confirm the claim appeared, then look for the saved values (bounded window). */
async function replayClaim(s: ClaimScenario, open: Opener, env: ReplayEnv, screenshots: ReplayResult['screenshots']): Promise<ReplayResult> {
  const marker = `OH${randomBytes(4).toString('hex').toUpperCase()}`;
  const page = await open(s.device, s.auth ? 'A' : undefined, s.auth);
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
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});
  const afterSave = await readView(page);
  screenshots.push(await shot(page, 'after the save'));
  if (s.claim !== null && !claimVisible(s.claim, afterSave.text)) {
    return { outcome: 'inconclusive', observed: `The success message "${s.claim}" did not appear after the save in a fresh session, so the claim cannot be compared.`, details: { claim: s.claim }, screenshots };
  }
  vars.landed_id = recordIdsInUrl(page.url())[0] ?? '';
  const paths = [pathAndQuery(page.url()), ...s.revisit.map((p) => expand(p, vars))];
  const checks = s.checks.map((c) => ({ field: c.field, value: expand(c.value, vars) }));
  const started = Date.now();
  let verdict = judgePersistence(checks, []);
  let looks = 0;
  for (const delay of claimDelays(s.windowMs)) {
    await pause(delay);
    looks++;
    const views: PageView[] = [];
    for (const p of paths) {
      await page.goto(new URL(p, env.origin).toString(), { waitUntil: 'domcontentloaded' });
      views.push(await readView(page));
    }
    verdict = judgePersistence(checks, views);
    if (!verdict.missing.length) break;
  }
  const windowUsedMs = Date.now() - started;
  screenshots.push(await shot(page, 'record reopened'));
  const where = paths.join(' and ');
  return {
    outcome: verdict.missing.length ? 'failed' : 'passed',
    observed: verdict.missing.length
      ? `${s.claim ? `The page said "${s.claim}", but after` : 'After'} reloading and reopening (${where}) over ${(windowUsedMs / 1000).toFixed(1)} s, ${verdict.missing.map((m) => `"${m.field}" = ${JSON.stringify(m.value.slice(0, 60))}`).join(', ')} ${verdict.missing.length === 1 ? 'was' : 'were'} not there.`
      : `Every saved value was there again after reloading and reopening (${where}).`,
    details: { claim: s.claim, found: verdict.found, missing: verdict.missing, paths, looks, windowUsedMs, windowMs: s.windowMs },
    screenshots,
  };
}

type CrossScenario = Extract<Scenario, { kind: 'cross_actor' }>;

/** Family 2 replay: A creates the record; B opens exactly its URL and presses the controls it can see. */
async function replayCrossActor(s: CrossScenario, open: Opener, env: ReplayEnv, screenshots: ReplayResult['screenshots']): Promise<ReplayResult> {
  const marker = `OH${randomBytes(4).toString('hex').toUpperCase()}`;
  const pageA = await open(s.device, 'A', s.auth);
  const vars: Record<string, string> = { ...env.identity(), marker };
  vars.id = await runSetup(pageA, env.origin, s.setup, vars);
  const url = new URL(expand(s.path, vars), env.origin);
  if (url.origin !== new URL(env.origin).origin) throw new ReplayBlocked('record path leaves the verified origin');
  const protect = s.protect.flatMap((f) => (s.setup.fields[f] !== undefined ? [{ field: f, value: expand(s.setup.fields[f]!, vars) }] : []));
  await pageA.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  const ownerView = await readView(pageA);
  const pageB = await open(s.device, 'B', s.auth);
  if (pageB.url() === 'about:blank') await pageB.goto(new URL(s.listPath ?? '/', env.origin).toString(), { waitUntil: 'domcontentloaded' });
  const otherHome = await readView(pageB);
  let otherList: PageView | undefined;
  if (s.listPath) { await pageB.goto(new URL(expand(s.listPath, vars), env.origin).toString(), { waitUntil: 'domcontentloaded' }); otherList = await readView(pageB); }
  const resp = await pageB.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  const otherView = await readView(pageB);
  screenshots.push(await shot(pageB, 'second account opens the first account\'s record'));
  const afterControls: { control: string; clicked: boolean; ownerAfter: PageView }[] = [];
  for (const c of s.controls) {
    await pageB.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    const loc = pageB.getByRole(c.role, { name: c.target, exact: true });
    let clicked = false;
    if (await loc.count()) {
      await loc.first().click({ timeout: 5_000 }).then(() => { clicked = true; }, () => {});
      await pageB.waitForLoadState('domcontentloaded').catch(() => {});
    }
    await pageA.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    afterControls.push({ control: c.target, clicked, ownerAfter: await readView(pageA) });
  }
  const v = judgeCrossActor(protect, { ownerView, otherHome, otherList, otherView, afterControls });
  return {
    outcome: v.outcome,
    observed: v.outcome === 'inconclusive' ? `Cannot judge: ${v.detail}.` : `${v.detail} (HTTP ${resp?.status()}).`,
    details: { recordPath: url.pathname, status: resp?.status(), privacyEstablished: v.privacyEstablished, leaked: v.leaked, changedBy: v.changedBy, controls: afterControls.map((c) => ({ control: c.control, clicked: c.clicked })) },
    screenshots,
  };
}

/**
 * Fill a form and submit it with an ordinary user interruption (shared by exploration and replay).
 * Offline is a client condition (context.setOffline), not proof of server behaviour under real network loss.
 */
export async function submitWithInterruption(page: Page, form: { fields: Record<string, string>; submit: string }, vars: Record<string, string>, kind: Interruption): Promise<{ claimedWhileOffline: boolean }> {
  for (const [key, template] of Object.entries(form.fields)) await (await fieldLocator(page, key)).fill(expand(template, vars), { timeout: 5_000 });
  const button = page.getByRole('button', { name: form.submit, exact: false }).first();
  if (!(await button.count())) throw new ReplayBlocked(`submit not found: ${form.submit}`);
  let claimedWhileOffline = false;
  if (kind === 'double_submit') {
    // An impatient second press while the first save is still in flight (a dblclick's second press
    // would only cancel a submission the browser had not sent yet).
    // Real mouse input at the button: Playwright's own click would wait for the first navigation.
    await button.scrollIntoViewIfNeeded({ timeout: 5_000 });
    const box = await button.boundingBox();
    if (!box) throw new ReplayBlocked(`submit "${form.submit}" has no position on the page`);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.click(x, y);
    await page.waitForTimeout(DOUBLE_PRESS_GAP_MS);
    await page.mouse.click(x, y); // lands on the same button unless the page has already moved on
  } else if (kind === 'offline_submit') {
    await page.context().setOffline(true);
    try {
      await button.click({ timeout: 5_000, noWaitAfter: true }).catch(() => {});
      await page.waitForTimeout(INTERRUPTION_SETTLE_MS);
      claimedWhileOffline = (await page.locator('[role=status]:visible, .notice:visible, .success:visible, .toast:visible').count().catch(() => 0)) > 0 && !(await rejectionShown(page));
    } finally { await page.context().setOffline(false); }
  } else if (kind === 'reload_after_submit') {
    await button.click({ timeout: 5_000, noWaitAfter: true });
    await page.waitForTimeout(150);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  } else {
    await button.click({ timeout: 5_000 });
  }
  await page.waitForTimeout(INTERRUPTION_SETTLE_MS);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return { claimedWhileOffline };
}

type InterruptScenario = Extract<Scenario, { kind: 'interruption' }>;

/** Family 4 replay: count the records the interrupted submit (plus at most one normal retry) created. */
async function replayInterruption(s: InterruptScenario, open: Opener, env: ReplayEnv, screenshots: ReplayResult['screenshots']): Promise<ReplayResult> {
  const page = await open(s.device, s.auth ? 'A' : undefined, s.auth);
  const vars: Record<string, string> = { ...env.identity(), marker: `OH${randomBytes(4).toString('hex').toUpperCase()}` };
  const value = expand(s.value, vars);
  const list = new URL(expand(s.listPath, vars), env.origin).toString();
  const count = async () => { await page.goto(list, { waitUntil: 'domcontentloaded' }); return occurrences((await readView(page)).text, value); };
  const before = await count();
  await page.goto(new URL(expand(s.form.path, vars), env.origin).toString(), { waitUntil: 'domcontentloaded' });
  const { claimedWhileOffline } = await submitWithInterruption(page, s.form, vars, s.interruption);
  screenshots.push(await shot(page, `after the ${s.interruption.replace(/_/g, ' ')}`));
  const afterInterruption = await count();
  let afterRetry: number | undefined;
  if (afterInterruption === before && s.interruption !== 'none') {
    await page.goto(new URL(expand(s.form.path, vars), env.origin).toString(), { waitUntil: 'domcontentloaded' });
    await submitWithInterruption(page, s.form, vars, 'none');
    afterRetry = await count();
  }
  screenshots.push(await shot(page, 'record list'));
  const v = judgeInterruption({ kind: s.interruption, before, afterInterruption, afterRetry, claimedWhileOffline });
  return { outcome: v.outcome, observed: `${v.outcome === 'failed' ? 'Reproduced in a fresh session' : v.outcome === 'passed' ? 'Held in a fresh session' : 'Cannot judge'}: ${v.detail}.`, details: { before, afterInterruption, afterRetry, claimedWhileOffline, created: v.created }, screenshots };
}

/** The submit button of the form a field belongs to. */
async function submitOf(page: Page, field: string) {
  const form = (await fieldLocator(page, field)).locator('xpath=ancestor::form[1]');
  const button = form.locator('button[type=submit], input[type=submit], button:not([type])').first();
  if (!(await button.count())) throw new ReplayBlocked(`no submit button in the form of "${field}"`);
  return button;
}

/** One tab's edit: change one field and submit its form. Returns whether the page refused it. */
export async function saveField(page: Page, field: string, value: string): Promise<boolean> {
  await (await fieldLocator(page, field)).fill(value, { timeout: 5_000 });
  await (await submitOf(page, field)).click({ timeout: 5_000 });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return rejectionShown(page);
}

export async function fieldValue(page: Page, field: string): Promise<string> {
  return (await fieldLocator(page, field)).inputValue({ timeout: 5_000 });
}

type TwoTabScenario = Extract<Scenario, { kind: 'two_tab' }>;

/** Family 2 replay (two tabs): the second tab saves from an out-of-date page; nothing may be silently undone. */
async function replayTwoTabs(s: TwoTabScenario, open: Opener, env: ReplayEnv, screenshots: ReplayResult['screenshots']): Promise<ReplayResult> {
  const marker = `OH${randomBytes(4).toString('hex').toUpperCase()}`;
  const tab1 = await open(s.device, s.auth ? 'A' : undefined, s.auth);
  const vars: Record<string, string> = { ...env.identity(), marker };
  vars.id = await runSetup(tab1, env.origin, s.setup, vars);
  const url = new URL(expand(s.path, vars), env.origin).toString();
  await tab1.goto(url, { waitUntil: 'domcontentloaded' });
  const original = { first: await fieldValue(tab1, s.first.field), second: await fieldValue(tab1, s.second.field) };
  const wanted = { first: expand(s.first.value, vars), second: expand(s.second.value, vars) };
  let firstRejected: boolean, staleRejected: boolean;
  if (s.sequential) {
    firstRejected = await saveField(tab1, s.first.field, wanted.first);
    await tab1.goto(url, { waitUntil: 'domcontentloaded' });
    staleRejected = await saveField(tab1, s.second.field, wanted.second);
  } else {
    const tab2 = await tab1.context().newPage();
    await tab2.goto(url, { waitUntil: 'domcontentloaded' });
    firstRejected = await saveField(tab1, s.first.field, wanted.first);
    staleRejected = await saveField(tab2, s.second.field, wanted.second);
    screenshots.push(await shot(tab2, 'out-of-date tab after its save'));
  }
  await tab1.goto(url, { waitUntil: 'domcontentloaded' });
  const final = { first: await fieldValue(tab1, s.first.field), second: await fieldValue(tab1, s.second.field) };
  screenshots.push(await shot(tab1, 'record reopened'));
  const v = judgeTwoTabs({ original, wanted, firstRejected, staleRejected, final });
  return {
    outcome: v.outcome,
    observed: `${s.sequential ? 'One tab, one save after the other' : 'Two tabs on the same record'}: ${v.detail}.`,
    details: { original, wanted, final, firstRejected, staleRejected, sequential: s.sequential },
    screenshots,
  };
}

/** A valid neighbouring case that must keep working (the control for a form_rule or two_tab finding). */
export function controlFor(s: Scenario, validValues?: Record<string, string>): Scenario | null {
  if (s.kind === 'two_tab' && !s.sequential) return { ...s, sequential: true };
  if (s.kind === 'interruption' && s.interruption !== 'none') return { ...s, interruption: 'none' };
  if (s.kind !== 'form_rule' || s.expectation !== 'rejected' || !validValues) return null;
  return { ...s, form: { ...s.form, fields: { ...s.form.fields, ...validValues } }, expectation: 'accepted' };
}
