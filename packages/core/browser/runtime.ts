// Browser runtimes. A runtime provisions an isolated browser for exactly one run and destroys it.
//
//   local: Playwright Chromium on this machine (sandbox on, non-root on Linux), all traffic through the
//          run-scoped egress proxy. Used for development, tests and the local lab.
//   fly:   one fresh Fly Machine per run in the secret-free oddhound-browser app (see fly-runtime.ts).
//   modal: one fresh Modal Sandbox per run from the pinned browser image (see modal-runtime.ts).

import { chromium, type Browser, type BrowserContext } from 'playwright';
import { startEgressProxy, type EgressDecision, type EgressProxy } from '../net/egress-proxy.ts';
import { labProfileFromEnv, type LabProfile } from '../net/ip-policy.ts';
import { DEVICE_PROFILES, USER_AGENT_SUFFIX, type DeviceProfileName } from '../contracts/limits.ts';

export type ProvisionedBrowser = {
  ref: string;
  runtime: 'local' | 'fly' | 'modal';
  browser: Browser;
  sandboxVerdict: string;
  egressStats: () => { requests: number; bytes: number; denied: number; exhausted: string | null };
  /** Close/destroy. Resolves with confirmed=true only when destruction is confirmed. */
  destroy: () => Promise<{ confirmed: boolean; detail: string }>;
};

export type ProvisionOptions = {
  runId: string;
  onEgress?: (d: EgressDecision) => void;
  onEgressExhausted?: (reason: string) => void;
  lab?: LabProfile;
};

export interface BrowserRuntime {
  readonly kind: 'local' | 'fly' | 'modal';
  provision(opts: ProvisionOptions): Promise<ProvisionedBrowser>;
}

export async function checkChromiumSandbox(browser: Browser): Promise<string> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto('chrome://sandbox', { timeout: 10_000 });
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    // Linux: "You are adequately sandboxed." Windows: a table of processes; renderers must run at
    // Lockdown with an Untrusted integrity level.
    if (/not adequately sandboxed/i.test(text)) return 'sandbox_not_adequate';
    if (/You are adequately sandboxed/i.test(text)) return 'sandbox_on';
    const renderer = /Renderer\s+Renderer\s+(\S+)\s+\S+\s+(\S+)/.exec(text);
    if (renderer) return renderer[1] === 'Lockdown' && renderer[2] === 'Untrusted' ? 'sandbox_on' : `sandbox_weak:${renderer[1]}/${renderer[2]}`;
    return `sandbox_unknown:${text.slice(0, 80)}`;
  } catch (e) {
    return `sandbox_check_failed:${(e as Error).message.slice(0, 80)}`;
  } finally {
    await ctx.close().catch(() => {});
  }
}

export class LocalBrowserRuntime implements BrowserRuntime {
  readonly kind = 'local' as const;
  async provision(opts: ProvisionOptions): Promise<ProvisionedBrowser> {
    const lab = opts.lab ?? labProfileFromEnv();
    const proxy: EgressProxy = await startEgressProxy({ lab, onDecision: opts.onEgress, onExhausted: (r) => opts.onEgressExhausted?.(r) });
    let browser: Browser;
    try {
      browser = await chromium.launch({
        channel: 'chromium', // full Chromium in new headless mode (the headless shell has no chrome://sandbox)
        headless: true,
        chromiumSandbox: true,
        proxy: { server: proxy.url, bypass: '<-loopback>' },
        args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
      });
    } catch (e) {
      await proxy.close();
      throw e;
    }
    const sandboxVerdict = await checkChromiumSandbox(browser);
    return {
      ref: `local:${opts.runId.slice(0, 8)}:${browser.version()}`,
      runtime: 'local',
      browser,
      sandboxVerdict,
      egressStats: proxy.stats,
      destroy: async () => {
        await browser.close().catch(() => {});
        await proxy.close().catch(() => {});
        return { confirmed: !browser.isConnected(), detail: 'local browser process closed and egress proxy stopped' };
      },
    };
  }
}

export async function newScopedContext(browser: Browser, device: DeviceProfileName, storageState?: Awaited<ReturnType<BrowserContext['storageState']>>): Promise<BrowserContext> {
  const profile = DEVICE_PROFILES[device];
  const base = device === 'mobile'
    ? 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
    : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  return browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    userAgent: `${base} ${USER_AGENT_SUFFIX} (+https://oddhound.online/bot)`,
    serviceWorkers: 'block',
    acceptDownloads: false,
    ignoreHTTPSErrors: false,
    storageState,
  });
}
