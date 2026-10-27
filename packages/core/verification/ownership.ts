// Site-ownership verification (MVP plan §17, verification contract B16).
// A token is issued per user/project/canonical origin/revision. The owner proves control by
// a DNS TXT record, a /.well-known file, or a <meta> tag in the home page <head>.
// Verification is exact-origin, follows no redirects, and is re-checked before every run.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { isIP } from 'node:net';
import { parse } from 'parse5';
import { safeFetch, SafeFetchError, type SafeFetchOptions } from '../net/safe-fetch.ts';

export const VERIFICATION_METHODS = ['dns_txt', 'well_known_file', 'meta_tag'] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export type VerificationResult = {
  verified: boolean;
  method: VerificationMethod;
  reason: string;
  checkedAt: string;
};

export class OriginError extends Error {}

/** Normalise user input to a canonical origin, rejecting anything ambiguous. */
export function canonicalOrigin(input: string, opts: { allowHttp?: boolean } = {}): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new OriginError('Enter a full URL such as https://example.com'); }
  if (url.username || url.password) throw new OriginError('URLs with credentials are not allowed');
  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) throw new OriginError('Only HTTPS sites can be verified');
  // Accept a bare origin or a trailing slash only; a path, query or fragment means a page, not an origin.
  if (url.pathname !== '/' || url.search || url.hash) throw new OriginError('Enter the site origin only, without a path');
  if (!url.hostname || url.hostname.endsWith('.')) throw new OriginError('Hostname is not valid');
  return url.origin; // lowercased, punycoded, default port removed
}

export function newVerificationToken(): string {
  return `ohv_${randomBytes(32).toString('base64url')}`; // 256 random bits
}

function sameToken(found: string, expected: string): boolean {
  const a = Buffer.from(found), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type VerifyDeps = SafeFetchOptions & {
  txtResolver?: (hostname: string) => Promise<string[][]>;
};

/**
 * The TXT record lives on its own name, `_oddhound-verify.<host>`, because a TXT record on the web
 * hostname itself is impossible when that name is a CNAME. A record on the bare hostname is still
 * accepted. Caution (observed on Vercel DNS, Oct 27, 2026): when the provider creates address
 * records automatically, ANY explicit record at or under the hostname switches them off and the
 * site stops resolving. The UI steers those owners to the file or meta tag method.
 */
export const dnsVerificationName = (host: string) => `_oddhound-verify.${host}`;

/**
 * Names checked for a DNS proof, most specific first. One record on a parent domain covers every host
 * under it (`_oddhound-verify.example.com` covers app.example.com and api.app.example.com): whoever
 * controls a parent's DNS already controls its subdomains, so this grants nothing extra. The walk
 * stops at two labels, and IP literals have no parents.
 */
export function dnsVerificationNames(host: string): string[] {
  const names = [dnsVerificationName(host), host];
  if (isIP(host.replace(/^\[|\]$/g, ''))) return names;
  const labels = host.split('.');
  for (let i = 1; labels.length - i >= 2; i++) names.push(dnsVerificationName(labels.slice(i).join('.')));
  return names;
}

/** A suggested domain-wide record name (eTLD+1 by a simple heuristic; display only, never trusted). */
export function suggestedDomainRecord(host: string): string {
  const labels = host.split('.');
  const twoPartSuffix = labels.length >= 3 && labels.at(-1)!.length === 2 && /^(co|com|org|net|ac|gov|edu)$/.test(labels.at(-2)!);
  return dnsVerificationName(labels.slice(twoPartSuffix ? -3 : -2).join('.'));
}

/** `tokens`: the origin's own token, plus (for an API host) its project's site token. */
export async function verifyByDns(origin: string, tokens: string | string[], deps: VerifyDeps = {}): Promise<VerificationResult> {
  const checkedAt = new Date().toISOString();
  const host = new URL(origin).hostname;
  const accepted = Array.isArray(tokens) ? tokens : [tokens];
  const resolver = deps.txtResolver ?? resolveTxt;
  let lastError: string | null = null;
  for (const name of dnsVerificationNames(host)) {
    try {
      const values = (await resolver(name)).map((parts) => parts.join(''));
      if (values.some((v) => v.startsWith('oddhound-verify=') && accepted.some((t) => sameToken(v.slice('oddhound-verify='.length), t)))) {
        return { verified: true, method: 'dns_txt', reason: 'token_found', checkedAt };
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? 'unknown';
      if (code !== 'ENOTFOUND' && code !== 'ENODATA') lastError = code; // a missing name is just "not found"
    }
  }
  return lastError
    ? { verified: false, method: 'dns_txt', reason: `dns_error:${lastError}`, checkedAt }
    : { verified: false, method: 'dns_txt', reason: 'token_not_found', checkedAt };
}

export async function verifyByFile(origin: string, token: string, deps: VerifyDeps = {}): Promise<VerificationResult> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await safeFetch(`${origin}/.well-known/oddhound-verify.txt`, { ...deps, maxBytes: 256 * 1024, timeoutMs: 10_000 });
    if (res.status !== 200) return { verified: false, method: 'well_known_file', reason: `http_${res.status}`, checkedAt };
    const ok = sameToken(res.body.trim(), token);
    return { verified: ok, method: 'well_known_file', reason: ok ? 'token_found' : 'token_mismatch', checkedAt };
  } catch (e) {
    return { verified: false, method: 'well_known_file', reason: e instanceof SafeFetchError ? e.code : 'fetch_failed', checkedAt };
  }
}

type P5Node = { nodeName: string; tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: P5Node[] };

/** Finds <meta name="oddhound-verification" content="…"> only as a real element inside <head>. */
export function metaTokensInHead(html: string): string[] {
  const doc = parse(html) as unknown as P5Node;
  const htmlEl = doc.childNodes?.find((n) => n.tagName === 'html');
  const head = htmlEl?.childNodes?.find((n) => n.tagName === 'head');
  const tokens: string[] = [];
  for (const node of head?.childNodes ?? []) {
    if (node.tagName !== 'meta') continue;
    const attr = (name: string) => node.attrs?.find((a) => a.name === name)?.value;
    if (attr('name')?.toLowerCase() === 'oddhound-verification' && attr('content')) tokens.push(attr('content')!);
  }
  return tokens;
}

export async function verifyByMeta(origin: string, token: string, deps: VerifyDeps = {}): Promise<VerificationResult> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await safeFetch(`${origin}/`, { ...deps, maxBytes: 256 * 1024, timeoutMs: 10_000 });
    if (res.status !== 200) return { verified: false, method: 'meta_tag', reason: `http_${res.status}`, checkedAt };
    const ok = metaTokensInHead(res.body).some((t) => sameToken(t, token));
    return { verified: ok, method: 'meta_tag', reason: ok ? 'token_found' : 'token_not_in_head', checkedAt };
  } catch (e) {
    return { verified: false, method: 'meta_tag', reason: e instanceof SafeFetchError ? e.code : 'fetch_failed', checkedAt };
  }
}

/**
 * `siteToken` (API hosts only): the project's own site token, also accepted for DNS, so one
 * domain-wide record proves the site and its API hosts. File and meta proofs stay per-origin.
 */
export async function verifyOwnership(origin: string, token: string, method: VerificationMethod, deps: VerifyDeps = {}, siteToken?: string): Promise<VerificationResult> {
  if (method === 'dns_txt') return verifyByDns(origin, siteToken ? [token, siteToken] : token, deps);
  if (method === 'well_known_file') return verifyByFile(origin, token, deps);
  return verifyByMeta(origin, token, deps);
}
