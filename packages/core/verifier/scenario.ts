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

const Template = z.string().max(200);
const FieldMap = z.record(z.string().min(1).max(80), Template).refine((m) => Object.keys(m).length > 0 && Object.keys(m).length <= 12, 'between 1 and 12 fields');

export const AuthRecipeSchema = z.object({
  kind: z.enum(['register', 'login']),
  path: z.string().startsWith('/').max(200),
  fields: FieldMap,
  submit: z.string().min(1).max(80),
  successText: z.string().min(1).max(120),
});
export type AuthRecipe = z.infer<typeof AuthRecipeSchema>;

const FormSchema = z.object({ path: z.string().startsWith('/').max(200), fields: FieldMap, submit: z.string().min(1).max(80) });

export const ScenarioSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('form_rule'),
    device: z.enum(['desktop', 'mobile']),
    auth: AuthRecipeSchema.optional(),
    form: FormSchema,
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
]);
export type Scenario = z.infer<typeof ScenarioSchema>;

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

async function authenticate(page: Page, origin: string, auth: AuthRecipe, ident: { name: string; email: string; password: string }): Promise<void> {
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
      if (!Object.values(s.form.fields).some((v) => v.includes('{marker}'))) throw new ReplayBlocked('scenario has no {marker} field to detect persistence');
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
      await fillAndSubmit(pageA, env.origin, s.create, { ...env.identity(), marker });
      await pageA.goto(new URL(s.listPath, env.origin).toString(), { waitUntil: 'domcontentloaded' });
      const row = pageA.locator('tr', { hasText: marker });
      const link = (await row.count()) ? row.first().locator('a[href]').first() : pageA.locator('a[href]', { hasText: marker }).first();
      if (await link.count() === 0) throw new ReplayBlocked('could not find a link to the created record');
      const recordUrl = new URL((await link.getAttribute('href'))!, env.origin);
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

/** A valid neighbouring case that must keep working (the control for a form_rule finding). */
export function controlFor(s: Scenario, validValues: Record<string, string>): Scenario | null {
  if (s.kind !== 'form_rule' || s.expectation !== 'rejected') return null;
  return { ...s, form: { ...s.form, fields: { ...s.form.fields, ...validValues } }, expectation: 'accepted' };
}
