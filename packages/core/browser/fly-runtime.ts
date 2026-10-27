// Deployed runtime: one fresh Fly Machine per run in the separate, secret-free oddhound-browser app.
//
// STATUS: implemented against the documented Fly Machines REST API but NOT yet exercised against a
// real Fly account (no FLY_API_TOKEN was available while building). Treat as unverified until the
// R2 gate (create → connect over 6PN → sandbox verdict → destroy → confirm destroyed) passes.
//
// The worker must itself run on Fly in the same organisation so it can reach the Machine's private
// 6PN address. The browser Machine has no public service; no platform credentials are passed to it.

import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { checkChromiumSandbox, type BrowserRuntime, type ProvisionOptions, type ProvisionedBrowser } from './runtime.ts';

export type FlyRuntimeOptions = {
  apiToken: string;   // held by the worker only
  app: string;        // e.g. oddhound-browser
  image: string;      // pinned digest, e.g. registry.fly.io/oddhound-browser@sha256:…
  region: string;
  apiBase?: string;   // default https://api.machines.dev
};

type Machine = { id: string; private_ip?: string; state?: string; instance_id?: string };

export class FlyMachineRuntime implements BrowserRuntime {
  readonly kind = 'fly' as const;
  readonly #o: FlyRuntimeOptions;
  constructor(o: FlyRuntimeOptions) { this.#o = o; }

  async #api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.#o.apiBase ?? 'https://api.machines.dev'}/v1/apps/${this.#o.app}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.#o.apiToken}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`Fly API ${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`), { status: res.status });
    return (text ? JSON.parse(text) : {}) as T;
  }

  async provision(opts: ProvisionOptions): Promise<ProvisionedBrowser> {
    const wsPath = `/pw-${randomBytes(24).toString('base64url')}`;
    const machine = await this.#api<Machine>('POST', '/machines', {
      region: this.#o.region,
      config: {
        image: this.#o.image,
        env: { RUN_WS_PATH: wsPath }, // the only runtime input; never platform secrets
        guest: { cpu_kind: 'shared', cpus: 2, memory_mb: 2048 },
        auto_destroy: true,
        restart: { policy: 'no' },
        metadata: { 'oddhound-run': opts.runId },
      },
    });
    const destroy = async (): Promise<{ confirmed: boolean; detail: string }> => {
      try { await this.#api('DELETE', `/machines/${machine.id}?force=true`); } catch { /* confirm below */ }
      try {
        const m = await this.#api<Machine>('GET', `/machines/${machine.id}`);
        return { confirmed: m.state === 'destroyed', detail: `machine ${machine.id} state=${m.state}` };
      } catch (e) {
        const status = (e as { status?: number }).status;
        return { confirmed: status === 404, detail: status === 404 ? `machine ${machine.id} gone (404)` : `could not confirm destruction of ${machine.id}` };
      }
    };
    try {
      await this.#api('GET', `/machines/${machine.id}/wait?state=started&timeout=60`);
      if (!machine.private_ip) throw new Error('Fly did not return a private 6PN address');
      // The browser server needs ~20 s after boot (firewall, proxy, Chromium). Connect over the private
      // network only, retrying until a deadline rather than a fixed count (refusals return instantly).
      let browser = null;
      const deadline = Date.now() + 120_000;
      while (!browser && Date.now() < deadline) {
        browser = await chromium.connect(`ws://[${machine.private_ip}]:3000${wsPath}`, { timeout: 10_000 }).catch(() => null);
        if (!browser) await new Promise((r) => setTimeout(r, 1_000));
      }
      if (!browser) throw new Error('could not connect to the browser Machine over 6PN');
      const sandboxVerdict = await checkChromiumSandbox(browser);
      return {
        ref: `fly:${machine.id}`,
        runtime: 'fly',
        browser,
        sandboxVerdict,
        egressStats: () => ({ requests: 0, bytes: 0, denied: 0, exhausted: null }),
        destroy: async () => { await browser!.close().catch(() => {}); return destroy(); },
      };
    } catch (e) {
      await destroy();
      throw e;
    }
  }
}

/** Independent reaper for Fly: destroy Machines whose run is no longer active. */
export async function reapFlyMachines(o: FlyRuntimeOptions, isActive: (runId: string) => Promise<boolean>): Promise<string[]> {
  const res = await fetch(`${o.apiBase ?? 'https://api.machines.dev'}/v1/apps/${o.app}/machines`, { headers: { authorization: `Bearer ${o.apiToken}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Fly API list machines: HTTP ${res.status}`);
  const list = (await res.json()) as (Machine & { config?: { metadata?: Record<string, string> } })[];
  const removed: string[] = [];
  for (const m of list) {
    const runId = m.config?.metadata?.['oddhound-run'];
    if (m.state === 'destroyed' || (runId && await isActive(runId))) continue;
    await fetch(`${o.apiBase ?? 'https://api.machines.dev'}/v1/apps/${o.app}/machines/${m.id}?force=true`, { method: 'DELETE', headers: { authorization: `Bearer ${o.apiToken}` } });
    removed.push(m.id);
  }
  return removed;
}
