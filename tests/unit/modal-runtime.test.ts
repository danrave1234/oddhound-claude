import { describe, expect, it } from 'vitest';
import { ModalSandboxRuntime, MODAL_SANDBOX_TIMEOUT_MS, publicIpv4Cidrs, reapModalSandboxes } from '../../packages/core/browser/modal-runtime.ts';
import { modalOptionsFromEnv, runtimeFromEnv } from '../../packages/core/browser/select.ts';

const toInt = (ip: string) => ip.split('.').reduce((a, o) => a * 256 + Number(o), 0);
const covered = (cidrs: string[], ip: string) => cidrs.some((c) => {
  const [base, len] = c.split('/');
  const size = 2 ** (32 - Number(len));
  const start = toInt(base!);
  return toInt(ip) >= start && toInt(ip) < start + size;
});

describe('Modal browser Sandbox parameters', () => {
  const rt = new ModalSandboxRuntime({ appName: 'oddhound-browser', imageId: 'im-test', client: {} as never });
  const p = rt.createParams('run-123', '/pw-abcdefghijklmnopqrstuvwxyz012345');

  it('passes only the per-run wsPath: no secrets, volumes or platform env', () => {
    expect(p.env).toEqual({ RUN_WS_PATH: '/pw-abcdefghijklmnopqrstuvwxyz012345' });
    expect(p.secrets).toBeUndefined();
    expect(p.volumes).toBeUndefined();
    expect(p.cloudBucketMounts).toBeUndefined();
    expect(p.includeOidcIdentityToken).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(/DATABASE_URL|META_API_KEY|MODAL_TOKEN|RESET_TOKEN|AUTH_SECRET/);
  });

  it('opens no public tunnel by default (control goes through a connect token)', () => {
    expect(p.encryptedPorts).toBeUndefined();
    expect(p.unencryptedPorts).toBeUndefined();
    expect(p.h2Ports).toBeUndefined();
  });

  it('bounds the lifetime by sign-in wait + run clock + finalization, and tags the run for the reaper', () => {
    expect(p.timeoutMs).toBe(MODAL_SANDBOX_TIMEOUT_MS);
    expect(MODAL_SANDBOX_TIMEOUT_MS).toBe(95 * 60_000); // 30 sign-in + 60 run backstop + 5
    expect(p.tags).toEqual({ 'oddhound-run': 'run-123', 'oddhound-role': 'browser' });
  });

  it('tunnel mode is opt-in', () => {
    const t = new ModalSandboxRuntime({ appName: 'a', imageId: 'im-x', connect: 'tunnel', client: {} as never }).createParams('r', '/pw-x');
    expect(t.encryptedPorts).toEqual([3000]);
  });
});

describe('public IPv4 allowlist', () => {
  const cidrs = publicIpv4Cidrs();
  it('excludes private, loopback, link-local/metadata, CGNAT and multicast ranges', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1']) {
      expect(covered(cidrs, ip), ip).toBe(false);
    }
  });
  it('includes ordinary public addresses', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '11.0.0.1', '192.169.0.1']) expect(covered(cidrs, ip), ip).toBe(true);
  });
  it('is a compact list', () => { expect(cidrs.length).toBeLessThan(150); });
});

describe('runtime selection', () => {
  it('BROWSER_RUNTIME=modal requires a pinned image id', () => {
    expect(() => runtimeFromEnv({ BROWSER_RUNTIME: 'modal' })).toThrow(/MODAL_BROWSER_IMAGE_ID/);
    expect(runtimeFromEnv({ BROWSER_RUNTIME: 'modal', MODAL_BROWSER_IMAGE_ID: 'im-1' }).kind).toBe('modal');
  });
  it('reads runtime, connect and outbound options', () => {
    const o = modalOptionsFromEnv({ MODAL_BROWSER_IMAGE_ID: 'im-1', MODAL_SANDBOX_RUNTIME: 'vm', MODAL_CONNECT: 'tunnel', MODAL_OUTBOUND: 'public' });
    expect(o.sandboxRuntime).toBe('vm');
    expect(o.connect).toBe('tunnel');
    expect(o.outboundCidrAllowlist?.length).toBeGreaterThan(10);
    expect(modalOptionsFromEnv({ MODAL_SANDBOX_RUNTIME: 'runc' }).sandboxRuntime).toBeUndefined();
  });
});

describe('Modal reaper', () => {
  it('terminates Sandboxes of inactive or untagged runs and keeps active ones', async () => {
    const terminated: string[] = [];
    const sb = (id: string, tags: Record<string, string>) => ({ sandboxId: id, getTags: async () => tags, terminate: async () => { terminated.push(id); } });
    const client = {
      apps: { fromName: async () => ({ appId: 'ap-1' }) },
      sandboxes: { list: async function* () { yield sb('sb-active', { 'oddhound-run': 'r1', 'oddhound-role': 'browser' }); yield sb('sb-old', { 'oddhound-run': 'r2', 'oddhound-role': 'browser' }); yield sb('sb-untagged', { 'oddhound-role': 'browser' }); } },
    };
    const removed = await reapModalSandboxes({ appName: 'oddhound-browser', client: client as never }, async (id) => id === 'r1');
    expect(removed).toEqual(['sb-old', 'sb-untagged']);
    expect(terminated).toEqual(['sb-old', 'sb-untagged']);
  });
});
