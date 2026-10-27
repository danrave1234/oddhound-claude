// A run's browser session: actor/device contexts, scope policy, element references and the
// trusted execution of browser tools. The model only ever refers to element refs like "e7".

import type { Browser, BrowserContext, Page, Response } from 'playwright';
import { newScopedContext } from '../browser/runtime.ts';
import { attachScope, type ScopeDecision, type ScopePolicy } from '../browser/scope.ts';
import { observe, type Observation } from '../browser/snapshot.ts';
import type { DeviceProfileName } from '../contracts/limits.ts';

export type Actor = 'A' | 'B';

export type CookieObservation = { origin: string; name: string; httpOnly: boolean; secure: boolean; sameSite: string | null; path: string };
export type HeaderObservation = { path: string; csp: boolean; frameProtection: boolean; contentTypeOptions: boolean };

export class ScopeViolation extends Error {}

export class RunSession {
  readonly #browser: Browser;
  readonly #policy: ScopePolicy;
  readonly #onScope: (d: ScopeDecision) => void;
  readonly #contexts = new Map<string, { ctx: BrowserContext; page: Page }>();
  #actor: Actor = 'A';
  #device: DeviceProfileName = 'desktop';
  #version = 0;
  #lastInScopeUrl: string;
  lastObservation: Observation | null = null;
  readonly cookies = new Map<string, CookieObservation>();
  readonly headers = new Map<string, HeaderObservation>();

  constructor(browser: Browser, policy: ScopePolicy, onScope: (d: ScopeDecision) => void) {
    this.#browser = browser; this.#policy = policy; this.#onScope = onScope;
    this.#lastInScopeUrl = `${policy.primaryOrigin}/`;
  }

  get actor() { return this.#actor; }
  get device() { return this.#device; }
  get origin() { return this.#policy.primaryOrigin; }

  /** Owner sign-in handoff: relaxes scope for owner-driven sign-in only (see scope.ts). */
  setHandoff(active: boolean) { this.#policy.handoffActive = active; }
  get handoffActive() { return this.#policy.handoffActive; }

  /** Cookies and storage of the current actor/device context (kept in memory by the caller only). */
  async storageState() {
    const entry = this.#contexts.get(`${this.#actor}:${this.#device}`);
    return entry ? entry.ctx.storageState() : undefined;
  }

  async page(): Promise<Page> {
    const key = `${this.#actor}:${this.#device}`;
    let entry = this.#contexts.get(key);
    if (!entry) {
      // Carry the actor's session across devices by copying its storage state from the other device.
      const other = this.#contexts.get(`${this.#actor}:${this.#device === 'desktop' ? 'mobile' : 'desktop'}`);
      const state = other ? await other.ctx.storageState() : undefined;
      const ctx = await newScopedContext(this.#browser, this.#device, state);
      await attachScope(ctx, this.#policy, this.#onScope);
      ctx.on('response', (r) => { void this.#recordResponse(r); });
      const page = await ctx.newPage();
      page.setDefaultTimeout(10_000);
      entry = { ctx, page };
      this.#contexts.set(key, entry);
      const startUrl = other ? other.page.url() : `${this.#policy.primaryOrigin}/`;
      await page.goto(startUrl.startsWith(this.#policy.primaryOrigin) ? startUrl : `${this.#policy.primaryOrigin}/`, { waitUntil: 'domcontentloaded' });
    }
    return entry.page;
  }

  async #recordResponse(r: Response) {
    try {
      const url = new URL(r.url());
      if (url.origin !== this.#policy.primaryOrigin) return;
      const headers = await r.allHeaders(); // headers() omits cookie headers
      const setCookie = r.request().resourceType() === 'document' || r.request().resourceType() === 'fetch' || r.request().resourceType() === 'xhr' ? headers['set-cookie'] : undefined;
      if (setCookie) {
        for (const line of setCookie.split('\n')) {
          const [pair, ...attrs] = line.split(';').map((s) => s.trim());
          const name = pair?.split('=')[0];
          if (!name) continue;
          const lower = attrs.map((a) => a.toLowerCase());
          if (lower.some((a) => a.startsWith('max-age=0'))) continue; // a deletion, not a session cookie
          const sameSite = lower.find((a) => a.startsWith('samesite='))?.split('=')[1] ?? null;
          this.cookies.set(name, { origin: url.origin, name, httpOnly: lower.includes('httponly'), secure: lower.includes('secure'), sameSite, path: lower.find((a) => a.startsWith('path='))?.split('=')[1] ?? '/' });
        }
      }
      if (r.request().resourceType() === 'document' && (headers['content-type'] ?? '').includes('text/html')) {
        const route = url.pathname.replace(/\/\d+(?=\/|$)/g, '/:id');
        this.headers.set(route, {
          path: route,
          csp: Boolean(headers['content-security-policy']),
          frameProtection: Boolean(headers['x-frame-options']) || /frame-ancestors/i.test(headers['content-security-policy'] ?? ''),
          contentTypeOptions: (headers['x-content-type-options'] ?? '').toLowerCase() === 'nosniff',
        });
      }
    } catch { /* evidence collection must never break the run */ }
  }

  async observe(): Promise<Observation> {
    const page = await this.page();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    this.lastObservation = await observe(page, ++this.#version);
    return this.lastObservation;
  }

  /** Called when a model turn starts: refs in that turn resolve against the observation the model saw. */
  beginTurn() { this.#turnVersion = this.#version; this.#turnObservation = this.lastObservation; }
  #turnVersion = 0;
  #turnObservation: Observation | null = null;

  /** Resolve a model-supplied ref against the turn's snapshot version. Refs from older versions, or
   *  whose element left the document (navigation, re-render), are rejected rather than guessed. */
  async locate(ref: string) {
    const page = await this.page();
    const loc = page.locator(`[data-oh-ref~="${ref}@${this.#turnVersion}"]`);
    if (await loc.count() !== 1) throw new Error(`Element ${ref} from observation v${this.#turnVersion} is no longer on the page. Observe again.`);
    return loc;
  }

  /** The visible label of a ref in the observation the model acted on (for recording recipes). */
  labelOf(ref: string): string | null {
    return (this.#turnObservation ?? this.lastObservation)?.elements.find((e) => e.ref === ref)?.label ?? null;
  }

  describe(ref: string): string {
    const el = (this.#turnObservation ?? this.lastObservation)?.elements.find((e) => e.ref === ref);
    return el ? `${el.kind} "${el.label}"` : ref;
  }

  async useActor(actor: Actor) { this.#actor = actor; await this.page(); }
  async setDevice(device: DeviceProfileName) { this.#device = device; await this.page(); }

  /** After any action: the main frame must still be on the verified origin, else return to safety. */
  async enforceMainFrameOrigin(): Promise<string | null> {
    const page = await this.page();
    let origin = '';
    try { origin = new URL(page.url()).origin; } catch { origin = ''; }
    if (origin === this.#policy.primaryOrigin) { this.#lastInScopeUrl = page.url(); return null; }
    const left = page.url();
    await page.goto(this.#lastInScopeUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    return left;
  }

  async screenshot(): Promise<Buffer> {
    const page = await this.page();
    return page.screenshot({ type: 'jpeg', quality: 55, fullPage: false });
  }

  async close(): Promise<void> {
    await Promise.all([...this.#contexts.values()].map((e) => e.ctx.close().catch(() => {})));
    this.#contexts.clear();
  }
}
