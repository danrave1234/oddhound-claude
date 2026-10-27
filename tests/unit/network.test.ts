// SELF-01, SELF-02, SELF-08, SELF-21, SELF-22: address policy, safe fetch and the egress proxy.
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { classifyAddress, isDialAllowed, endpointKey } from '../../packages/core/net/ip-policy.ts';
import { safeFetch, SafeFetchError } from '../../packages/core/net/safe-fetch.ts';
import { startEgressProxy, type EgressProxy } from '../../packages/core/net/egress-proxy.ts';

describe('address policy (SELF-01)', () => {
  const blocked = [
    '127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fdaa:0:1::3', 'fd00:ec2::254', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2001:db8::1', 'ff02::1',
  ];
  it.each(blocked)('blocks %s', (ip) => expect(classifyAddress(ip).allowed).toBe(false));
  it.each(['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111'])('allows public %s', (ip) => expect(classifyAddress(ip).allowed).toBe(true));
  it('allows only web ports for public addresses', () => {
    expect(isDialAllowed('93.184.216.34', 443).allowed).toBe(true);
    expect(isDialAllowed('93.184.216.34', 22).allowed).toBe(false);
  });
  it('a lab profile allows exactly the listed endpoint and nothing next to it', () => {
    const lab = { allowedEndpoints: new Set([endpointKey('127.0.0.1', 4999)]) };
    expect(isDialAllowed('127.0.0.1', 4999, lab).allowed).toBe(true);
    expect(isDialAllowed('127.0.0.1', 5000, lab).allowed).toBe(false);
    expect(isDialAllowed('127.0.0.2', 4999, lab).allowed).toBe(false);
  });
});

describe('safe fetch for trusted helpers (SELF-14, SELF-21)', () => {
  it('refuses a public hostname that resolves to a private address (rebinding)', async () => {
    await expect(safeFetch('https://looks-public.example/', { resolver: async () => [{ address: '10.0.0.5', family: 4 }] }))
      .rejects.toMatchObject({ code: 'blocked_address' });
  });
  it('refuses when ANY answer is private (mixed A/AAAA)', async () => {
    await expect(safeFetch('https://mixed.example/', { resolver: async () => [{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }] }))
      .rejects.toMatchObject({ code: 'blocked_address' });
  });
  it('refuses credentials in the URL and plain HTTP outside the lab', async () => {
    await expect(safeFetch('https://user:pass@example.com/')).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch('http://example.com/')).rejects.toMatchObject({ code: 'https_required' });
  });
});

describe('egress proxy (SELF-01/02/22)', () => {
  let proxy: EgressProxy | undefined;
  let target: http.Server | undefined;
  afterEach(async () => { await proxy?.close(); proxy = undefined; await new Promise<void>((r) => (target ? target.close(() => r()) : r())); target = undefined; });

  const connect = (proxyPort: number, dest: string) => new Promise<number>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: dest });
    req.on('connect', (res, sock) => { sock.destroy(); resolve(res.statusCode ?? 0); });
    req.on('response', (res) => resolve(res.statusCode ?? 0));
    req.on('error', reject);
    req.end();
  });

  it('blocks loopback, metadata, private and its own control ports; allows the lab endpoint', async () => {
    target = http.createServer((_q, s) => s.end('ok')).listen(0, '127.0.0.1');
    await once(target, 'listening');
    const port = (target.address() as net.AddressInfo).port;
    const denied: string[] = [];
    proxy = await startEgressProxy({ lab: { allowedEndpoints: new Set([endpointKey('127.0.0.1', port)]) }, onDecision: (d) => { if (!d.allowed) denied.push(d.host); } });
    expect(await connect(proxy.port, `127.0.0.1:${port}`)).toBe(200);
    expect(await connect(proxy.port, '169.254.169.254:80')).toBe(403);
    expect(await connect(proxy.port, '10.0.0.1:443')).toBe(403);
    expect(await connect(proxy.port, `127.0.0.1:${proxy.port}`)).toBe(403);
    expect(await connect(proxy.port, '[::1]:443')).toBe(403);
    expect(denied.length).toBe(4);
  });

  it('re-resolves per connection and blocks a name that now points to a private address', async () => {
    proxy = await startEgressProxy({ resolver: async () => [{ address: '192.168.0.10', family: 4 }] });
    expect(await connect(proxy.port, 'rebind.example:443')).toBe(403);
  });

  it('stops the run at the byte cap (SELF-22)', async () => {
    const big = Buffer.alloc(64 * 1024, 120);
    target = http.createServer((_q, s) => s.end(big)).listen(0, '127.0.0.1');
    await once(target, 'listening');
    const port = (target.address() as net.AddressInfo).port;
    let exhausted: string | null = null;
    proxy = await startEgressProxy({ maxBytes: 16 * 1024, lab: { allowedEndpoints: new Set([endpointKey('127.0.0.1', port)]) }, onExhausted: (r) => { exhausted = r; } });
    await new Promise<void>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: proxy!.port, path: `http://127.0.0.1:${port}/`, headers: { host: `127.0.0.1:${port}` } }, (res) => { res.resume(); res.on('end', resolve); res.on('error', () => resolve()); res.on('close', resolve); });
      req.on('error', () => resolve());
      req.end();
    });
    expect(exhausted).toBe('bytes');
    expect(await connect(proxy.port, `127.0.0.1:${port}`)).toBe(429);
  });

  it('stops at the request cap', async () => {
    proxy = await startEgressProxy({ maxRequests: 2, resolver: async () => [{ address: '10.0.0.1', family: 4 }] });
    await connect(proxy.port, 'a.example:443'); await connect(proxy.port, 'b.example:443');
    expect(await connect(proxy.port, 'c.example:443')).toBe(429);
    expect(proxy.stats().exhausted).toBe('requests');
  });
});
