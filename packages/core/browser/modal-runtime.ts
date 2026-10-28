// Deployed runtime on Modal: one fresh Modal Sandbox per run, from the pinned oddhound-browser image.
//
// Same contract as fly-runtime.ts, mapped onto Modal primitives:
//   * fresh Sandbox per run, never reused; no volumes; hard lifetime via Modal `timeoutMs`;
//   * NO platform secrets: the only input is the random per-run RUN_WS_PATH (no DATABASE_URL, Meta key,
//     Modal token or reset token; `secrets` is never passed);
//   * control: Modal has no private network between Functions and Sandboxes, so the worker reaches the
//     Playwright server through Modal's authenticated proxy. Default `connect: 'token'` uses a Sandbox
//     Connect Token (bearer header, checked by Modal before forwarding) AND the random wsPath; no public
//     tunnel is opened. `connect: 'tunnel'` (fallback) opens an encrypted public tunnel protected only by
//     the wsPath and the optional inbound CIDR allowlist;
//   * egress: the image's own proxy + nftables (fails closed if nftables cannot be applied), optionally
//     with Modal's outbound CIDR allowlist restricted to public IPv4 as a second, provider-side layer;
//   * terminate at run end and confirm the Sandbox has exited; tags let the independent reaper find
//     orphans even after a worker crash.

import { randomBytes } from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import { ModalClient, type Sandbox, type SandboxCreateParams } from 'modal';
import { checkChromiumSandbox, type BrowserRuntime, type ProvisionOptions, type ProvisionedBrowser } from './runtime.ts';
import { LIMITS } from '../contracts/limits.ts';
import { HANDOFF_LIMIT_MS } from '../agent/handoff.ts';

export const MODAL_RUN_TAG = 'oddhound-run';
export const MODAL_ROLE_TAG = 'oddhound-role';
const CONTROL_PORT = 3000;

/** Owner sign-in wait + run clock + provisioning/finalization headroom. The guest is killed by Modal after this. */
export const MODAL_SANDBOX_TIMEOUT_MS = HANDOFF_LIMIT_MS + LIMITS.runWallClockMs + 5 * 60_000;

export type ModalRuntimeOptions = {
  appName: string;              // Modal app that owns browser Sandboxes, e.g. oddhound-browser
  imageId: string;              // pinned built image, im-…
  sandboxRuntime?: 'gvisor' | 'vm';
  connect?: 'token' | 'tunnel';
  inboundCidrAllowlist?: string[];
  outboundCidrAllowlist?: string[];
  region?: string;
  cpu?: number;
  memoryMiB?: number;
  timeoutMs?: number;
  readyTimeoutMs?: number;
  client?: ModalClient;         // injectable for tests
};

type Line = Record<string, unknown>;

/** Reads the Sandbox's stdout line by line: readiness, startup failures and egress decisions. */
function watchStdout(sb: Sandbox, onLine: (j: Line) => void): { ready: Promise<void>; stop: () => void } {
  let resolveReady!: () => void; let rejectReady!: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej; });
  const reader = sb.stdout.getReader();
  let stopped = false;
  void (async () => {
    let buf = '';
    let tail = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        tail = (tail + value).slice(-600);
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          let j: Line | null = null;
          try { j = JSON.parse(line) as Line; } catch { /* non-JSON line */ }
          if (!j) continue;
          if (j.browserServer === 'ready') resolveReady();
          else if (j.nftables === 'failed' || typeof j.error === 'string') rejectReady(new Error(`browser Sandbox failed to start: ${tail}`));
          onLine(j);
        }
      }
      if (!stopped) rejectReady(new Error(`browser Sandbox exited before it was ready: ${tail}`));
    } catch (e) {
      if (!stopped) rejectReady(e as Error);
    }
  })();
  return { ready, stop: () => { stopped = true; reader.cancel().catch(() => {}); } };
}

/** Confirm the Sandbox has finished: poll() returns its exit code once Modal reports it stopped. */
async function confirmExited(sb: Sandbox, waitMs = 30_000): Promise<{ confirmed: boolean; code: number | null }> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const code = await sb.poll().catch(() => null);
    if (code !== null) return { confirmed: true, code };
    if (Date.now() > deadline) return { confirmed: false, code: null };
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

export class ModalSandboxRuntime implements BrowserRuntime {
  readonly kind = 'modal' as const;
  readonly #o: ModalRuntimeOptions;
  readonly #client: ModalClient;
  constructor(o: ModalRuntimeOptions) { this.#o = o; this.#client = o.client ?? new ModalClient(); }

  /** Sandbox creation parameters. Exported shape is tested: it must never carry secrets. */
  createParams(runId: string, wsPath: string): SandboxCreateParams {
    const o = this.#o;
    const p: SandboxCreateParams = {
      command: ['/usr/bin/tini', '--', '/usr/local/bin/oddhound-entrypoint'],
      env: { RUN_WS_PATH: wsPath }, // the only runtime input; never platform secrets
      cpu: o.cpu ?? 1,
      memoryMiB: o.memoryMiB ?? 2048,
      timeoutMs: o.timeoutMs ?? MODAL_SANDBOX_TIMEOUT_MS,
      tags: { [MODAL_RUN_TAG]: runId, [MODAL_ROLE_TAG]: 'browser' },
    };
    if (o.sandboxRuntime) p.runtime = o.sandboxRuntime;
    if (o.region) p.regions = [o.region];
    if ((o.connect ?? 'token') === 'tunnel') p.encryptedPorts = [CONTROL_PORT];
    if (o.inboundCidrAllowlist?.length) p.inboundCidrAllowlist = o.inboundCidrAllowlist;
    if (o.outboundCidrAllowlist?.length) p.outboundCidrAllowlist = o.outboundCidrAllowlist;
    return p;
  }

  async provision(opts: ProvisionOptions): Promise<ProvisionedBrowser> {
    return (await this.provisionDetailed(opts)).provisioned;
  }

  /** As provision(), also returning the Sandbox handle and control URL (canary/diagnostics only). */
  async provisionDetailed(opts: ProvisionOptions): Promise<{ provisioned: ProvisionedBrowser; sandbox: Sandbox; controlUrl: string; startupMs: number }> {
    const t0 = Date.now();
    const wsPath = `/pw-${randomBytes(24).toString('base64url')}`;
    const app = await this.#client.apps.fromName(this.#o.appName, { createIfMissing: true });
    const image = await this.#client.images.fromId(this.#o.imageId);
    const sb = await this.#client.sandboxes.create(app, image, this.createParams(opts.runId, wsPath));

    let denied = 0;
    const watch = watchStdout(sb, (j) => {
      if (j.egress === 'denied') { denied++; opts.onEgress?.({ at: new Date().toISOString(), kind: 'connect', host: String(j.host ?? ''), port: Number(j.port ?? 0), allowed: false, reason: String(j.reason ?? '') }); }
      if (j.egress === 'exhausted') opts.onEgressExhausted?.(String(j.reason ?? 'exhausted'));
    });
    let browser: Browser | null = null;
    const destroy = async (): Promise<{ confirmed: boolean; detail: string }> => {
      await browser?.close().catch(() => {});
      watch.stop();
      await sb.terminate().catch(() => {});
      const r = await confirmExited(sb);
      return { confirmed: r.confirmed, detail: r.confirmed ? `sandbox ${sb.sandboxId} terminated (exit ${r.code})` : `could not confirm termination of sandbox ${sb.sandboxId}` };
    };
    try {
      const readyTimeout = this.#o.readyTimeoutMs ?? 120_000;
      await Promise.race([
        watch.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('browser Sandbox did not become ready in time')), readyTimeout)),
      ]);
      const { url, headers } = await this.#controlEndpoint(sb, wsPath);
      const deadline = Date.now() + 60_000;
      let lastErr: unknown;
      while (!browser && Date.now() < deadline) {
        browser = await chromium.connect(url, { timeout: 15_000, headers }).catch((e) => { lastErr = e; return null; });
        if (!browser) await new Promise((r) => setTimeout(r, 1_000));
      }
      if (!browser) throw new Error(`could not connect to the browser Sandbox: ${(lastErr as Error)?.message?.slice(0, 160) ?? 'timeout'}`);
      const sandboxVerdict = await checkChromiumSandbox(browser);
      const connected = browser;
      const provisioned: ProvisionedBrowser = {
        ref: `modal:${sb.sandboxId}`,
        runtime: 'modal',
        browser: connected,
        sandboxVerdict,
        egressStats: () => ({ requests: 0, bytes: 0, denied, exhausted: null }),
        destroy,
      };
      return { provisioned, sandbox: sb, controlUrl: url, startupMs: Date.now() - t0 };
    } catch (e) {
      await destroy();
      throw e;
    }
  }

  async #controlEndpoint(sb: Sandbox, wsPath: string): Promise<{ url: string; headers?: Record<string, string> }> {
    if ((this.#o.connect ?? 'token') === 'tunnel') {
      const t = (await sb.tunnels(30_000))[CONTROL_PORT];
      if (!t) throw new Error('Modal returned no tunnel for the control port');
      return { url: `wss://${t.host}${t.port === 443 ? '' : `:${t.port}`}${wsPath}` };
    }
    const cred = await sb.createConnectToken({ port: CONTROL_PORT });
    const base = cred.url.replace(/^http/, 'ws').replace(/\/$/, '');
    return { url: `${base}${wsPath}`, headers: { authorization: `Bearer ${cred.token}` } };
  }
}

/** Independent reaper: terminate browser Sandboxes whose run is no longer active, or that carry no run tag. */
export async function reapModalSandboxes(o: { appName: string; client?: ModalClient }, isActive: (runId: string) => Promise<boolean>): Promise<string[]> {
  const client = o.client ?? new ModalClient();
  const app = await client.apps.fromName(o.appName, { createIfMissing: true });
  const removed: string[] = [];
  for await (const sb of client.sandboxes.list({ appId: app.appId, tags: { [MODAL_ROLE_TAG]: 'browser' } })) {
    const tags = await sb.getTags().catch(() => ({} as Record<string, string>));
    const runId = tags[MODAL_RUN_TAG];
    if (runId && await isActive(runId)) continue;
    await sb.terminate().catch(() => {});
    removed.push(sb.sandboxId);
  }
  return removed;
}

// Public IPv4 only: every special-purpose/non-global range from the IANA registry removed. Used as
// Modal's provider-side outbound allowlist (Modal accepts allowlists, not denylists).
const NON_PUBLIC_V4 = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15',
  '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
];

const toInt = (ip: string) => ip.split('.').reduce((a, o) => a * 256 + Number(o), 0);
const toIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');

/** Minimal CIDR list covering exactly the IPv4 space minus NON_PUBLIC_V4. */
export function publicIpv4Cidrs(exclude: string[] = NON_PUBLIC_V4): string[] {
  const ex = exclude.map((c) => { const [ip, len] = c.split('/'); return { start: toInt(ip!), size: 2 ** (32 - Number(len)) }; });
  const out: string[] = [];
  const walk = (start: number, len: number) => {
    const size = 2 ** (32 - len);
    const end = start + size;
    const overlaps = ex.filter((e) => e.start < end && e.start + e.size > start);
    if (!overlaps.length) { out.push(`${toIp(start)}/${len}`); return; }
    if (overlaps.some((e) => e.start <= start && e.start + e.size >= end)) return;
    walk(start, len + 1); walk(start + size / 2, len + 1);
  };
  walk(0, 0);
  return out;
}
