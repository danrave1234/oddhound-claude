// Server-side fetch for trusted helpers (ownership verification, previews).
// Resolves DNS once, rejects the request if ANY resolved address is non-public, then dials the
// validated address directly so a second DNS answer cannot redirect the connection (rebinding).
// No redirects, no cookies, no auth, bounded size and time, TLS verification stays on.

import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { isDialAllowed, type LabProfile } from './ip-policy.ts';

export type SafeFetchResult = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  address: string;
};

export class SafeFetchError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) { super(message ?? code); this.code = code; }
}

export type SafeFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  lab?: LabProfile;
  resolver?: (host: string) => Promise<{ address: string; family: number }[]>;
};

const defaultResolver = (host: string) => lookup(host, { all: true, verbatim: true });

export async function resolvePublicAddress(hostname: string, port: number, opts: SafeFetchOptions = {}): Promise<string> {
  const host = hostname.replace(/^\[|\]$/g, '');
  const answers = isIP(host) ? [{ address: host, family: isIP(host) }] : await (opts.resolver ?? defaultResolver)(host);
  if (answers.length === 0) throw new SafeFetchError('dns_no_answer');
  for (const answer of answers) {
    const verdict = isDialAllowed(answer.address, port, opts.lab);
    if (!verdict.allowed) throw new SafeFetchError('blocked_address', `${answer.address}: ${verdict.reason}`);
  }
  return answers[0]!.address;
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const url = new URL(rawUrl);
  if (url.username || url.password) throw new SafeFetchError('credentials_in_url');
  const isHttps = url.protocol === 'https:';
  if (!isHttps && !(url.protocol === 'http:' && opts.lab)) throw new SafeFetchError('https_required');
  const port = Number(url.port || (isHttps ? 443 : 80));
  const address = await resolvePublicAddress(url.hostname, port, opts);
  const maxBytes = opts.maxBytes ?? 256 * 1024;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return await new Promise<SafeFetchResult>((resolve, reject) => {
    const deadline = setTimeout(() => { req.destroy(new SafeFetchError('timeout')); }, timeoutMs);
    const mod = isHttps ? https : http;
    const req = mod.request({
      host: address,
      port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: isHttps && !isIP(url.hostname) ? url.hostname : undefined,
      headers: { host: url.host, 'user-agent': 'Oddhound/1.0 (+verification)', accept: 'text/html,text/plain;q=0.9', 'accept-encoding': 'identity' },
      agent: false,
    }, (res) => {
      let size = 0;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(new SafeFetchError('response_too_large')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        clearTimeout(deadline);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), address });
      });
      res.on('error', (e) => { clearTimeout(deadline); reject(e); });
    });
    req.on('error', (e) => { clearTimeout(deadline); reject(e instanceof SafeFetchError ? e : new SafeFetchError('network_error', e.message)); });
    req.end();
  });
}
