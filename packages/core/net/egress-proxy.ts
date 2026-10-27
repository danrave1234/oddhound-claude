// Run-scoped egress proxy for the browser. It is the network boundary for local runs and mirrors
// what smokescreen + nftables do in the deployed browser image:
//   * resolves DNS itself and checks every answer, then dials the validated address (no rebinding);
//   * refuses private, loopback, link-local, CGNAT, metadata, ULA/6PN and non-web ports;
//   * counts requests and bytes in both directions and stops the run at the canonical caps.
// It does not decide which public origins a page may load; action scope is enforced separately.

import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { resolvePublicAddress, SafeFetchError, type SafeFetchOptions } from './safe-fetch.ts';
import { LIMITS } from '../contracts/limits.ts';

export type EgressDecision = {
  at: string;
  kind: 'connect' | 'http';
  host: string;
  port: number;
  allowed: boolean;
  address?: string;
  reason?: string;
};

export type EgressProxyOptions = SafeFetchOptions & {
  listenPort?: number; // default: ephemeral
  maxRequests?: number;
  maxBytes?: number;
  onDecision?: (d: EgressDecision) => void;
  onExhausted?: (reason: 'requests' | 'bytes') => void;
};

export type EgressProxy = {
  url: string;
  port: number;
  stats: () => { requests: number; bytes: number; denied: number; exhausted: string | null };
  close: () => Promise<void>;
};

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection']);

export async function startEgressProxy(opts: EgressProxyOptions = {}): Promise<EgressProxy> {
  const maxRequests = opts.maxRequests ?? LIMITS.targetRequestsPerRun;
  const maxBytes = opts.maxBytes ?? LIMITS.targetBytesPerRun;
  let requests = 0, bytes = 0, denied = 0;
  let exhausted: 'requests' | 'bytes' | null = null;
  const sockets = new Set<net.Socket>();

  const decide = (d: Omit<EgressDecision, 'at'>) => opts.onDecision?.({ at: new Date().toISOString(), ...d });
  const count = (n: number) => {
    bytes += n;
    if (bytes > maxBytes && !exhausted) { exhausted = 'bytes'; opts.onExhausted?.('bytes'); for (const s of sockets) s.destroy(); }
  };
  const admit = (): string | null => {
    if (exhausted) return `cap_exhausted_${exhausted}`;
    requests += 1;
    if (requests > maxRequests) { exhausted = 'requests'; opts.onExhausted?.('requests'); return 'cap_exhausted_requests'; }
    return null;
  };

  const server = http.createServer(async (req, res) => {
    // Plain-HTTP forward proxying (absolute-form request target).
    let target: URL;
    try { target = new URL(req.url ?? ''); } catch { res.writeHead(400).end(); return; }
    if (target.protocol !== 'http:') { res.writeHead(400).end(); return; }
    const port = Number(target.port || 80);
    const capReason = admit();
    if (capReason) { denied++; decide({ kind: 'http', host: target.hostname, port, allowed: false, reason: capReason }); res.writeHead(429).end(); return; }
    let address: string;
    try { address = await resolvePublicAddress(target.hostname, port, opts); }
    catch (e) {
      denied++;
      decide({ kind: 'http', host: target.hostname, port, allowed: false, reason: e instanceof SafeFetchError ? e.message : 'resolve_failed' });
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Blocked by Oddhound egress policy');
      return;
    }
    decide({ kind: 'http', host: target.hostname, port, allowed: true, address });
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
    headers.host = target.host;
    const upstream = http.request({ host: address, port, method: req.method, path: `${target.pathname}${target.search}`, headers, agent: false }, (up) => {
      const outHeaders: http.OutgoingHttpHeaders = {};
      for (const [k, v] of Object.entries(up.headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders[k] = v;
      res.writeHead(up.statusCode ?? 502, outHeaders);
      up.on('data', (c: Buffer) => { count(c.length); if (!exhausted) res.write(c); });
      up.on('end', () => res.end());
      up.on('error', () => res.destroy());
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('data', (c: Buffer) => count(c.length));
    req.pipe(upstream);
  });

  server.on('connect', async (req, client: net.Socket, head: Buffer) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => {});
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? '');
    if (!m) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const host = m[1]!, port = Number(m[2]);
    const capReason = admit();
    if (capReason) { denied++; decide({ kind: 'connect', host, port, allowed: false, reason: capReason }); client.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
    let address: string;
    try { address = await resolvePublicAddress(host, port, opts); }
    catch (e) {
      denied++;
      decide({ kind: 'connect', host, port, allowed: false, reason: e instanceof SafeFetchError ? e.message : 'resolve_failed' });
      client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    decide({ kind: 'connect', host, port, allowed: true, address });
    const upstream = net.connect({ host: address, port });
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => client.destroy());
    upstream.on('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) { count(head.length); upstream.write(head); }
      client.on('data', (c: Buffer) => { count(c.length); if (!exhausted) upstream.write(c); });
      upstream.on('data', (c: Buffer) => { count(c.length); if (!exhausted) client.write(c); });
      client.on('end', () => upstream.end());
      upstream.on('end', () => client.end());
    });
  });

  server.listen(opts.listenPort ?? 0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    stats: () => ({ requests, bytes, denied, exhausted }),
    close: async () => {
      for (const s of sockets) s.destroy();
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
