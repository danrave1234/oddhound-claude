// R2-style canary for BROWSER_RUNTIME=modal. Creates real Modal Sandboxes (costs a few cents) and records
// every check, pass or fail, to docs/evidence/modal-canary-<runtime>-<outbound>.json.
//
//   node --env-file-if-exists=.env tests/lab/modal-canary.ts --runtime gvisor|vm [--outbound open|public] [--connect token|tunnel]
//
// Needs Modal credentials (~/.modal.toml or MODAL_TOKEN_ID/SECRET) and MODAL_BROWSER_IMAGE_ID.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { ModalClient } from 'modal';
import { ModalSandboxRuntime, MODAL_RUN_TAG, publicIpv4Cidrs, reapModalSandboxes } from '../../packages/core/browser/modal-runtime.ts';
import { newScopedContext } from '../../packages/core/browser/runtime.ts';

const arg = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1]! : def; };
const sandboxRuntime = arg('runtime', 'gvisor') as 'gvisor' | 'vm';
const outbound = arg('outbound', 'open');
const connect = arg('connect', 'token') as 'token' | 'tunnel';
const imageId = process.env.MODAL_BROWSER_IMAGE_ID;
if (!imageId) { console.error('MODAL_BROWSER_IMAGE_ID is required'); process.exit(2); }
const appName = process.env.MODAL_BROWSER_APP ?? 'oddhound-browser';

type Check = { check: string; expected: string; actual: string; pass: boolean };
const checks: Check[] = [];
const record = (check: string, expected: string, actual: string, pass: boolean) => { checks.push({ check, expected, actual, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${check}: ${actual}`); };

const client = new ModalClient();
const rt = new ModalSandboxRuntime({ appName, imageId, sandboxRuntime, connect, client, outboundCidrAllowlist: outbound === 'public' ? publicIpv4Cidrs() : undefined });
const runId = `canary-${randomBytes(6).toString('hex')}`;
const out: Record<string, unknown> = { at: new Date().toISOString(), sandboxRuntime, outbound, connect, imageId, runId };

let startupError: string | null = null;
const deniedHosts = new Set<string>();
let detailed: Awaited<ReturnType<ModalSandboxRuntime['provisionDetailed']>> | null = null;
try {
  detailed = await rt.provisionDetailed({ runId, onEgress: (d) => { deniedHosts.add(d.host.replace(/^\[|\]$/g, '')); console.log('egress.denied', d.host, d.port, d.reason); } });
} catch (e) {
  startupError = (e as Error).message;
}

if (!detailed) {
  // Diagnose a startup failure in a throwaway Sandbox from the same image (no secrets, 2-minute timeout).
  const app = await client.apps.fromName(appName, { createIfMissing: true });
  const probe = await client.sandboxes.create(app, await client.images.fromId(imageId), { runtime: sandboxRuntime, timeoutMs: 120_000, tags: { 'oddhound-role': 'browser' } });
  const x = await probe.exec(['/bin/sh', '-c', 'id; nft --version; echo "table inet t { chain o { type filter hook output priority 0; policy accept; meta skuid 1000 drop; } }" > /tmp/t.nft; nft -f /tmp/t.nft; echo nft_exit=$?; command -v iptables && iptables -A OUTPUT -m owner --uid-owner 1000 -j DROP; echo iptables_exit=$?; unshare -Ur true; echo userns_exit=$?']);
  const [xo, xe] = await Promise.all([x.stdout.readText(), x.stderr.readText(), x.wait()]);
  out.startupDiagnosis = { stdout: xo.trim(), stderr: xe.trim().slice(0, 1500) };
  console.log(xo, xe);
  await probe.terminate();
  record('browser Sandbox starts (nftables applied, browser server ready, connected)', 'started', `failed: ${startupError?.slice(0, 500)}`, false);
  // Make sure nothing was left behind.
  const left = await reapModalSandboxes({ appName, client }, async () => false);
  out.leftoversReaped = left;
} else {
  const { provisioned, sandbox, controlUrl, startupMs } = detailed;
  out.sandboxId = sandbox.sandboxId;
  out.startupMs = startupMs;
  record('browser Sandbox starts (nftables applied, browser server ready, connected)', 'started', `started in ${startupMs} ms`, true);
  record('Chromium sandbox verdict (chromiumSandbox: true, non-root)', 'sandbox_on', provisioned.sandboxVerdict, provisioned.sandboxVerdict === 'sandbox_on');

  const sh = async (cmd: string) => {
    const p = await sandbox.exec(['/bin/sh', '-c', cmd]);
    const [o, e, code] = await Promise.all([p.stdout.readText(), p.stderr.readText(), p.wait()]);
    return { out: o.trim(), err: e.trim(), code };
  };

  // Which user runs Chromium and the browser server.
  const ps = await sh("ps -eo user:12,comm | grep -Ei 'chrom|node' | sort | uniq -c");
  out.processes = ps.out;
  const chromeUsers = [...ps.out.matchAll(/^\s*\d+\s+(\S+)\s+chrom/gim)].map((m) => m[1]);
  record('Chromium processes run as the unprivileged browser user', 'pwuser only', chromeUsers.join(',') || 'none found', chromeUsers.length > 0 && chromeUsers.every((u) => u === 'pwuser'));

  // No platform secrets in the guest environment (names only are recorded, never values).
  const envNames = await sh("for p in /proc/[0-9]*; do tr '\\0' '\\n' < $p/environ 2>/dev/null | cut -d= -f1; done | sort -u");
  out.guestEnvNames = envNames.out.split('\n').filter(Boolean);
  const secretish = (out.guestEnvNames as string[]).filter((n) => /DATABASE|META_|MODAL_TOKEN|TOKEN_SECRET|AUTH_SECRET|GITHUB|FLY_API|RESET_TOKEN|CREDENTIAL|API_KEY|IDENTITY_TOKEN/i.test(n));
  record('no platform secrets in any guest process environment', 'none', secretish.join(',') || 'none', secretish.length === 0);

  // Firewall state.
  const nft = await sh('nft list table inet oddhound 2>&1 | head -20');
  out.nftables = nft.out;
  record('nftables rules for the browser user are installed', 'table inet oddhound present', nft.code === 0 ? 'present' : `nft exit ${nft.code}: ${nft.out.slice(0, 200)}`, nft.code === 0 && /skuid/.test(nft.out));

  // In-guest network self-test as the browser user (SELF-01/02/08). example.com:443 is the positive control.
  const nc = await sh('setpriv --reuid=pwuser --regid=pwuser --init-groups /usr/local/bin/node26 /opt/oddhound/netcheck.ts example.com 443');
  let netcheck: { results: { check: string; expected: string; actual: string; detail: string }[] } | null = null;
  try { netcheck = JSON.parse(nc.out); } catch { /* recorded below */ }
  out.netcheck = netcheck ?? { raw: nc.out.slice(0, 2000), err: nc.err.slice(0, 1000), code: nc.code };
  if (!netcheck) record('in-guest netcheck ran', 'JSON results', `exit ${nc.code}: ${(nc.err || nc.out).slice(0, 300)}`, false);
  for (const r of netcheck?.results ?? []) record(`[browser uid] ${r.check}`, r.expected, `${r.actual} (${r.detail})`, r.expected === r.actual);

  // Provider-side layer: the proxy user may dial out at the firewall level (its address policy is in the
  // proxy code). With MODAL_OUTBOUND=public, Modal itself must also drop private/metadata destinations.
  const probe = "const n=require('net');const t=(h,p)=>new Promise(r=>{const s=n.connect({host:h,port:p,timeout:3000});s.on('connect',()=>{s.destroy();r('connected')});s.on('timeout',()=>{s.destroy();r('timeout')});s.on('error',e=>r('error:'+e.code))});(async()=>{console.log(JSON.stringify({metadata:await t('169.254.169.254',80),private:await t('10.0.0.1',443),public:await t('1.1.1.1',443)}))})()";
  const pr = await sh(`setpriv --reuid=oddproxy --regid=oddproxy --clear-groups /usr/local/bin/node26 -e "${probe.replace(/"/g, '\\"')}"`);
  let pj: Record<string, string> = {};
  try { pj = JSON.parse(pr.out); } catch { /* recorded below */ }
  out.proxyUidDirect = pj;
  if (outbound === 'public') {
    record('[proxy uid, Modal allowlist] direct TCP to cloud metadata', 'blocked', pj.metadata ?? pr.err.slice(0, 120), !!pj.metadata && pj.metadata !== 'connected');
    record('[proxy uid, Modal allowlist] direct TCP to a private address', 'blocked', pj.private ?? pr.err.slice(0, 120), !!pj.private && pj.private !== 'connected');
    record('[proxy uid, Modal allowlist] direct TCP to a public address', 'allowed', pj.public ?? pr.err.slice(0, 120), pj.public === 'connected');
  } else {
    console.log('info  proxy uid direct (no provider allowlist):', JSON.stringify(pj));
  }

  // Browser-level egress through the proxy.
  const ctx = await newScopedContext(provisioned.browser, 'desktop');
  const page = await ctx.newPage();
  const nav = async (url: string) => page.goto(url, { timeout: 15_000 }).then(async (resp) => `status ${resp?.status()} ${((await resp?.text().catch(() => '')) ?? '').slice(0, 40)}`.trim(), (e: Error) => `error ${e.message.split('\n')[0]!.slice(0, 120)}`);
  let r = await nav('https://example.com/'); record('browser loads a public HTTPS page via the proxy', 'status 200', r, r.startsWith('status 200'));
  // A refusal is either a browser network error or the proxy's own 403 page, and the proxy must have
  // logged a denial for that host (so the 403 cannot have come from the target).
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://192.168.0.1/', 'http://127.0.0.1:3000/', 'http://[fd00::1]/', 'http://metadata.google.internal/']) {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    r = await nav(url);
    const refused = r.startsWith('error') || (r.startsWith('status 403 Blocked by Oddhound egress policy') && deniedHosts.has(host));
    record(`browser refused ${url}`, 'proxy refusal', `${r}; proxy logged denial: ${deniedHosts.has(host)}`, refused);
  }
  await ctx.close();

  // Control endpoint protection: without the connect token, and with the token but a wrong path.
  const noToken = await chromium.connect(controlUrl, { timeout: 10_000 }).then((b) => { void b.close(); return 'connected'; }, (e: Error) => `refused: ${e.message.split('\n')[0]!.slice(0, 120)}`);
  record('control endpoint refuses a client without the connect token', 'refused', noToken, noToken.startsWith('refused') || connect === 'tunnel');
  const httpNoToken = await fetch(controlUrl.replace(/^ws/, 'http')).then((x) => `HTTP ${x.status}`, (e: Error) => `error ${e.message}`);
  out.httpWithoutToken = httpNoToken;
  record('plain HTTP request without the token is rejected', 'not 2xx', httpNoToken, !/^HTTP 2/.test(httpNoToken));
  const tunnels = await sandbox.tunnels(5_000).then((t) => Object.keys(t), () => []);
  record('no public tunnel is opened (token mode)', 'none', tunnels.join(',') || 'none', connect === 'tunnel' || tunnels.length === 0);

  // Destroy and confirm.
  const d = await provisioned.destroy();
  record('Sandbox terminated and confirmed after the run', 'confirmed', d.detail, d.confirmed);
  const stillListed: string[] = [];
  for await (const s of client.sandboxes.list({ tags: { [MODAL_RUN_TAG]: runId } })) stillListed.push(s.sandboxId);
  record('terminated Sandbox no longer listed as running', 'none', stillListed.join(',') || 'none', stillListed.length === 0);

  // Orphan reaper: a second Sandbox whose worker "crashed" (never destroyed) must be found and terminated.
  const orphanRun = `canary-orphan-${randomBytes(4).toString('hex')}`;
  const orphan = await rt.provisionDetailed({ runId: orphanRun }).catch((e: Error) => e);
  if (orphan instanceof Error) {
    record('orphan Sandbox created for the reaper test', 'created', orphan.message.slice(0, 200), false);
  } else {
    await orphan.provisioned.browser.close().catch(() => {}); // the worker disappears without terminating
    const removed = await reapModalSandboxes({ appName, client }, async (id) => id !== orphanRun && !id.startsWith('canary-'));
    const exited = await (async () => { for (let i = 0; i < 30; i++) { const c = await orphan.sandbox.poll(); if (c !== null) return `exit ${c}`; await new Promise((res) => setTimeout(res, 1000)); } return 'still running'; })();
    record('independent reaper terminates an orphaned Sandbox', 'terminated', `reaped [${removed.join(',')}], ${exited}`, removed.includes(orphan.sandbox.sandboxId) && exited.startsWith('exit'));
  }
}

out.checks = checks;
out.passed = checks.filter((c) => c.pass).length;
out.failed = checks.filter((c) => !c.pass).length;
mkdirSync('docs/evidence', { recursive: true });
const file = `docs/evidence/modal-canary-${sandboxRuntime}-${outbound}-${connect}.json`;
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`\n${out.passed} passed, ${out.failed} failed -> ${file}`);
process.exit(out.failed ? 1 : 0);
