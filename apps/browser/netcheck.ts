// In-container network self-test (SELF-01/02/08), run as the browser user:
//   docker exec -u pwuser <container> /usr/local/bin/node26 /opt/oddhound/netcheck.ts <labIp> <labPort>
// Every "must fail" case must fail and every "must pass" case must pass, from the browser's identity.
import net from 'node:net';
import dgram from 'node:dgram';
import http from 'node:http';

const [labIp = '', labPort = '0'] = process.argv.slice(2);
const results: { check: string; expected: 'blocked' | 'allowed'; actual: 'blocked' | 'allowed'; detail: string }[] = [];

const tcp = (host: string, port: number) => new Promise<string>((resolve) => {
  const s = net.connect({ host, port, timeout: 3000 });
  s.on('connect', () => { s.destroy(); resolve('connected'); });
  s.on('timeout', () => { s.destroy(); resolve('timeout'); });
  s.on('error', (e) => resolve(`error:${(e as NodeJS.ErrnoException).code}`));
});
const viaProxy = (target: string) => new Promise<string>((resolve) => {
  const req = http.request({ host: '127.0.0.1', port: 3128, method: 'CONNECT', path: target, timeout: 5000 });
  req.on('connect', (res, sock) => { sock.destroy(); resolve(`status:${res.statusCode}`); });
  req.on('timeout', () => { req.destroy(); resolve('timeout'); });
  req.on('error', (e) => resolve(`error:${(e as NodeJS.ErrnoException).code}`));
  req.end();
});
const udp = () => new Promise<string>((resolve) => {
  const s = dgram.createSocket('udp4');
  s.send(Buffer.from('x'), 53, '1.1.1.1', (err) => { s.close(); resolve(err ? `error:${(err as NodeJS.ErrnoException).code}` : 'sent'); });
});
const record = (check: string, expected: 'blocked' | 'allowed', detail: string, ok: boolean) =>
  results.push({ check, expected, actual: ok ? 'allowed' : 'blocked', detail });

let r = await tcp('1.1.1.1', 443); record('direct TCP to a public IP (bypassing the proxy)', 'blocked', r, r === 'connected');
r = await tcp('169.254.169.254', 80); record('direct TCP to cloud metadata', 'blocked', r, r === 'connected');
if (labIp) { r = await tcp(labIp, Number(labPort)); record('direct TCP to the lab target (bypassing the proxy)', 'blocked', r, r === 'connected'); }
r = await udp(); record('UDP datagram (WebRTC/QUIC/DNS path)', 'blocked', r, r === 'sent');
r = await viaProxy('169.254.169.254:80'); record('proxy CONNECT to cloud metadata', 'blocked', r, r === 'status:200');
r = await viaProxy('127.0.0.1:3000'); record('proxy CONNECT to the local browser control port', 'blocked', r, r === 'status:200');
r = await viaProxy('10.0.0.1:443'); record('proxy CONNECT to a private address', 'blocked', r, r === 'status:200');
r = await viaProxy('[fdaa::3]:53'); record('proxy CONNECT to a 6PN/ULA address', 'blocked', r, r === 'status:200');
r = await viaProxy('example.com:22'); record('proxy CONNECT to a non-web port', 'blocked', r, r === 'status:200');
if (labIp) { r = await viaProxy(`${labIp}:${labPort}`); record('proxy CONNECT to the approved lab target', 'allowed', r, r === 'status:200'); }

const failures = results.filter((x) => x.expected !== x.actual);
console.log(JSON.stringify({ uid: process.getuid?.(), results, passed: failures.length === 0 }, null, 2));
process.exit(failures.length ? 1 : 0);
