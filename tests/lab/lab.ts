// Local lab control: node tests/lab/lab.ts up|down|status
//   up:     build images, create the isolated lab network, start Postgres and both demo-target builds
//   down:   remove the demo-target containers and any leftover per-run browser containers
//   status: show what is running
import { execFileSync } from 'node:child_process';

const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const sh = (args: string[], opts: { quiet?: boolean; allowFail?: boolean } = {}) => {
  try { return execFileSync('docker', args, { env, stdio: opts.quiet ? 'pipe' : 'inherit' })?.toString().trim() ?? ''; }
  catch (e) { if (opts.allowFail) return ''; throw e; }
};
const exists = (kind: 'network' | 'container', name: string) => sh([kind, 'inspect', name], { quiet: true, allowFail: true }) !== '';

const cmd = process.argv[2] ?? 'status';
if (cmd === 'up') {
  sh(['build', '-q', '-f', 'apps/browser/Dockerfile', '-t', 'oddhound-claude-browser:dev', '.']);
  sh(['build', '-q', '-f', 'apps/fixture/Dockerfile', '-t', 'oddhound-claude-fixture:dev', '.']);
  if (!exists('network', 'oddhound-claude-lab')) sh(['network', 'create', '--subnet', '172.30.77.0/24', 'oddhound-claude-lab']);
  if (!exists('container', 'oddhound-claude-pg')) {
    sh(['run', '-d', '--name', 'oddhound-claude-pg', '-e', 'POSTGRES_USER=oddhound', '-e', 'POSTGRES_PASSWORD=oddhound_local_dev', '-e', 'POSTGRES_DB=oddhound', '-p', '127.0.0.1:55433:5432', 'postgres:17-bookworm']);
  } else sh(['start', 'oddhound-claude-pg'], { quiet: true });
  for (const [name, ip, port, hostPort, fixed] of [['ohc-harbor-vulnerable', '172.30.77.10', '4310', '4320', false], ['ohc-harbor-fixed', '172.30.77.11', '4311', '4321', true]] as const) {
    sh(['rm', '-f', name], { quiet: true, allowFail: true });
    sh(['run', '-d', '--name', name, '--network', 'oddhound-claude-lab', '--ip', ip, '-p', `127.0.0.1:${hostPort}:${port}`, '-e', `FIXTURE_PORT=${port}`, 'oddhound-claude-fixture:dev', ...(fixed ? ['--fixed'] : [])], { quiet: true });
  }
  console.log('lab up: demo target http://172.30.77.10:4310 (fixed: :4311), admin 127.0.0.1:4320/4321, postgres 127.0.0.1:55433');
} else if (cmd === 'down') {
  sh(['rm', '-f', 'ohc-harbor-vulnerable', 'ohc-harbor-fixed'], { quiet: true, allowFail: true });
  const runs = sh(['ps', '-aq', '--filter', 'label=oddhound.run'], { quiet: true, allowFail: true });
  if (runs) sh(['rm', '-f', ...runs.split('\n')], { quiet: true, allowFail: true });
  console.log('lab down (Postgres left running; remove with: docker rm -f oddhound-claude-pg)');
} else {
  sh(['ps', '--filter', 'name=ohc-', '--filter', 'name=oddhound-claude', '--format', 'table {{.Names}}\t{{.Status}}\t{{.Ports}}']);
}
