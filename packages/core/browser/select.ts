import { resolve } from 'node:path';
import type { BrowserRuntime } from './runtime.ts';
import { LocalBrowserRuntime } from './runtime.ts';
import { DockerBrowserRuntime } from './docker-runtime.ts';
import { FlyMachineRuntime } from './fly-runtime.ts';
import { ModalSandboxRuntime, publicIpv4Cidrs, type ModalRuntimeOptions } from './modal-runtime.ts';

/**
 * BROWSER_RUNTIME:
 *   docker (default) â€” fresh oddhound-browser container per run on an isolated lab network
 *   fly              â€” fresh Fly Machine per run (deployed; requires FLY_API_TOKEN, FLY_BROWSER_IMAGE)
 *   modal            — fresh Modal Sandbox per run (deployed; requires MODAL_BROWSER_IMAGE_ID and Modal
 *                      credentials MODAL_TOKEN_ID/MODAL_TOKEN_SECRET held by the worker only).
 *                      MODAL_SANDBOX_RUNTIME=gvisor|vm, MODAL_CONNECT=token|tunnel,
 *                      MODAL_OUTBOUND=public (provider-side public-IPv4-only allowlist) | open
 *   host             â€” Chromium directly on this machine (quick debugging only: host software such as
 *                      antivirus can inject content into pages, so its evidence is not trustworthy)
 */
export function runtimeFromEnv(env: NodeJS.ProcessEnv = process.env): BrowserRuntime {
  const kind = env.BROWSER_RUNTIME ?? 'docker';
  if (kind === 'fly') {
    if (!env.FLY_API_TOKEN || !env.FLY_BROWSER_IMAGE) throw new Error('BROWSER_RUNTIME=fly needs FLY_API_TOKEN and FLY_BROWSER_IMAGE');
    return new FlyMachineRuntime({ apiToken: env.FLY_API_TOKEN, app: env.FLY_BROWSER_APP ?? 'oddhound-browser', image: env.FLY_BROWSER_IMAGE, region: env.FLY_REGION ?? 'iad' });
  }
  if (kind === 'modal') {
    if (!env.MODAL_BROWSER_IMAGE_ID) throw new Error('BROWSER_RUNTIME=modal needs MODAL_BROWSER_IMAGE_ID (a pinned im-… image)');
    return new ModalSandboxRuntime(modalOptionsFromEnv(env));
  }
  if (kind === 'host') return new LocalBrowserRuntime();
  return new DockerBrowserRuntime({
    image: env.BROWSER_IMAGE ?? 'oddhound-claude-browser:dev',
    network: env.LAB_NETWORK ?? 'oddhound-claude-lab',
    seccompProfile: resolve(env.SECCOMP_PROFILE ?? 'infra/docker/playwright-seccomp-profile.json'),
    labEndpoints: env.ODDHOUND_LAB_MODE === '1' ? env.ODDHOUND_LAB_ENDPOINTS : undefined,
  });
}

export function modalOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): ModalRuntimeOptions {
  const rt = env.MODAL_SANDBOX_RUNTIME;
  return {
    appName: env.MODAL_BROWSER_APP ?? 'oddhound-browser',
    imageId: env.MODAL_BROWSER_IMAGE_ID ?? '',
    sandboxRuntime: rt === 'vm' || rt === 'gvisor' ? rt : undefined,
    connect: env.MODAL_CONNECT === 'tunnel' ? 'tunnel' as const : 'token' as const,
    region: env.MODAL_REGION || undefined,
    outboundCidrAllowlist: env.MODAL_OUTBOUND === 'public' ? publicIpv4Cidrs() : undefined,
    inboundCidrAllowlist: env.MODAL_INBOUND_CIDRS ? env.MODAL_INBOUND_CIDRS.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  };
}
