import { resolve } from 'node:path';
import type { BrowserRuntime } from './runtime.ts';
import { LocalBrowserRuntime } from './runtime.ts';
import { DockerBrowserRuntime } from './docker-runtime.ts';
import { FlyMachineRuntime } from './fly-runtime.ts';

/**
 * BROWSER_RUNTIME:
 *   docker (default) — fresh oddhound-browser container per run on an isolated lab network
 *   fly              — fresh Fly Machine per run (deployed; requires FLY_API_TOKEN, FLY_BROWSER_IMAGE)
 *   host             — Chromium directly on this machine (quick debugging only: host software such as
 *                      antivirus can inject content into pages, so its evidence is not trustworthy)
 */
export function runtimeFromEnv(env: NodeJS.ProcessEnv = process.env): BrowserRuntime {
  const kind = env.BROWSER_RUNTIME ?? 'docker';
  if (kind === 'fly') {
    if (!env.FLY_API_TOKEN || !env.FLY_BROWSER_IMAGE) throw new Error('BROWSER_RUNTIME=fly needs FLY_API_TOKEN and FLY_BROWSER_IMAGE');
    return new FlyMachineRuntime({ apiToken: env.FLY_API_TOKEN, app: env.FLY_BROWSER_APP ?? 'oddhound-browser', image: env.FLY_BROWSER_IMAGE, region: env.FLY_REGION ?? 'sin' });
  }
  if (kind === 'host') return new LocalBrowserRuntime();
  return new DockerBrowserRuntime({
    image: env.BROWSER_IMAGE ?? 'oddhound-claude-browser:dev',
    network: env.LAB_NETWORK ?? 'oddhound-claude-lab',
    seccompProfile: resolve(env.SECCOMP_PROFILE ?? 'infra/docker/playwright-seccomp-profile.json'),
    labEndpoints: env.ODDHOUND_LAB_MODE === '1' ? env.ODDHOUND_LAB_ENDPOINTS : undefined,
  });
}
