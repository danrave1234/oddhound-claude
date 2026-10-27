// Local stand-in for "one fresh Fly Machine per run": one fresh oddhound-browser container per run.
// Same image, same secret-free contract, same control protocol (random per-run wsPath, controller
// pre-generates it). The container gets NET_ADMIN only so its root entrypoint can install nftables
// before dropping to unprivileged users, and Playwright's seccomp profile so Chromium's own
// user-namespace sandbox can start (no --no-sandbox).

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { checkChromiumSandbox, type BrowserRuntime, type ProvisionOptions, type ProvisionedBrowser } from './runtime.ts';

const run = promisify(execFile);

export type DockerRuntimeOptions = {
  image: string;
  network: string;
  seccompProfile: string; // absolute path on the Docker host
  labEndpoints?: string;  // exact ip:port pairs the proxy may reach on the lab network
  startTimeoutMs?: number;
};

async function docker(args: string[]): Promise<string> {
  const { stdout } = await run('docker', args, { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

export class DockerBrowserRuntime implements BrowserRuntime {
  readonly kind = 'local' as const;
  readonly #o: DockerRuntimeOptions;
  constructor(o: DockerRuntimeOptions) { this.#o = o; }

  async provision(opts: ProvisionOptions): Promise<ProvisionedBrowser> {
    const wsPath = `/pw-${randomBytes(24).toString('base64url')}`;
    const name = `ohc-run-${opts.runId.slice(0, 8)}-${randomBytes(3).toString('hex')}`;
    const args = [
      'run', '-d', '--name', name, '--network', this.#o.network,
      '--cap-add', 'NET_ADMIN', '--security-opt', `seccomp=${this.#o.seccompProfile}`,
      '--memory', '2g', '--pids-limit', '512',
      '-p', '127.0.0.1::3000',
      '-e', `RUN_WS_PATH=${wsPath}`,
      '--label', `oddhound.run=${opts.runId}`,
    ];
    if (this.#o.labEndpoints) args.push('-e', 'ODDHOUND_LAB_MODE=1', '-e', `ODDHOUND_LAB_ENDPOINTS=${this.#o.labEndpoints}`);
    args.push(this.#o.image);
    const containerId = await docker(args);
    const destroy = async (): Promise<{ confirmed: boolean; detail: string }> => {
      await docker(['rm', '-f', containerId]).catch(() => '');
      const gone = await docker(['inspect', containerId]).then(() => false, () => true);
      return { confirmed: gone, detail: gone ? `container ${name} removed and confirmed absent` : `container ${name} still present after removal request` };
    };

    let logs: ChildProcess | null = null;
    let denied = 0;
    try {
      // Wait for both services, then stream egress decisions back as run events.
      const deadline = Date.now() + (this.#o.startTimeoutMs ?? 30_000);
      let ready = false;
      while (Date.now() < deadline) {
        const out = await docker(['logs', containerId]).catch(() => '');
        if (out.includes('"browserServer":"ready"')) { ready = true; break; }
        if (out.includes('"nftables":"failed"') || out.includes('"error"')) throw new Error(`browser container failed to start: ${out.slice(-400)}`);
        await new Promise((r) => setTimeout(r, 300));
      }
      if (!ready) throw new Error('browser container did not become ready in time');
      logs = spawn('docker', ['logs', '-f', '--since', '0s', containerId], { stdio: ['ignore', 'pipe', 'pipe'] });
      logs.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          try {
            const j = JSON.parse(line);
            if (j.egress === 'denied') { denied++; opts.onEgress?.({ at: new Date().toISOString(), kind: 'connect', host: j.host, port: j.port, allowed: false, reason: j.reason }); }
            if (j.egress === 'exhausted') opts.onEgressExhausted?.(j.reason);
          } catch { /* non-JSON log line */ }
        }
      });
      const port = (await docker(['port', containerId, '3000'])).split('\n')[0]!.split(':').pop();
      const browser = await chromium.connect(`ws://127.0.0.1:${port}${wsPath}`, { timeout: 15_000 });
      const sandboxVerdict = await checkChromiumSandbox(browser);
      return {
        ref: `docker:${name}`,
        runtime: 'local',
        browser,
        sandboxVerdict,
        egressStats: () => ({ requests: 0, bytes: 0, denied, exhausted: null }),
        destroy: async () => {
          await browser.close().catch(() => {});
          logs?.kill();
          return destroy();
        },
      };
    } catch (e) {
      logs?.kill();
      await destroy();
      throw e;
    }
  }
}

/** Independent reaper: removes run containers whose runs are no longer active (or are unknown). */
export async function reapOrphanContainers(isActive: (runId: string) => Promise<boolean>): Promise<string[]> {
  const out = await docker(['ps', '-a', '--filter', 'label=oddhound.run', '--format', '{{.ID}} {{.Label "oddhound.run"}}']).catch(() => '');
  const removed: string[] = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const [id, runId] = line.split(' ');
    if (id && runId && !(await isActive(runId))) { await docker(['rm', '-f', id]).catch(() => ''); removed.push(id); }
  }
  return removed;
}
