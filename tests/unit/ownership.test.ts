// B16 / SELF-14: ownership verification contract.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { canonicalOrigin, dnsVerificationNames, metaTokensInHead, newVerificationToken, suggestedDomainRecord, verifyByDns, verifyByFile, verifyByMeta, verifyOwnership } from '../../packages/core/verification/ownership.ts';
import { endpointKey } from '../../packages/core/net/ip-policy.ts';

describe('canonical origin', () => {
  it('normalises case, punycode and default ports', () => {
    expect(canonicalOrigin('HTTPS://Example.COM:443/')).toBe('https://example.com');
    expect(canonicalOrigin('https://bücher.example')).toBe('https://xn--bcher-kva.example');
  });
  it('rejects paths, queries, credentials and plain HTTP', () => {
    for (const bad of ['https://example.com/app', 'https://example.com/?a=1', 'https://u:p@example.com', 'http://example.com', 'ftp://example.com', 'example.com']) {
      expect(() => canonicalOrigin(bad)).toThrow();
    }
  });
  it('issues 256-bit tokens', () => {
    const t = newVerificationToken();
    expect(Buffer.from(t.slice(4), 'base64url').length).toBe(32);
    expect(t).not.toBe(newVerificationToken());
  });
});

describe('meta tag must be a real element in <head>', () => {
  const token = 'ohv_TOKEN';
  it('accepts a head meta tag', () => expect(metaTokensInHead(`<html><head><meta name="oddhound-verification" content="${token}"></head></html>`)).toContain(token));
  it('ignores the token in a comment, a script, or the body', () => {
    expect(metaTokensInHead(`<html><head><!-- <meta name="oddhound-verification" content="${token}"> --></head></html>`)).toEqual([]);
    expect(metaTokensInHead(`<html><head><script>"<meta name='oddhound-verification' content='${token}'>"</script></head></html>`)).toEqual([]);
    expect(metaTokensInHead(`<html><head></head><body><div><meta name="oddhound-verification" content="${token}"></div></body></html>`)).toEqual([]);
  });
});

describe('file and meta verification against a live server (lab profile)', () => {
  let server: http.Server; let origin: string; let lab: { allowedEndpoints: Set<string> };
  const routes = new Map<string, (res: http.ServerResponse) => void>();
  beforeAll(async () => {
    server = http.createServer((req, res) => (routes.get(req.url ?? '') ?? ((r) => { r.statusCode = 404; r.end(); }))(res)).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as net.AddressInfo).port;
    origin = `http://127.0.0.1:${port}`;
    lab = { allowedEndpoints: new Set([endpointKey('127.0.0.1', port)]) };
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('passes with the exact token and fails with a copied token for another origin/user', async () => {
    routes.set('/.well-known/oddhound-verify.txt', (r) => r.end('ohv_RIGHT\n'));
    expect((await verifyByFile(origin, 'ohv_RIGHT', { lab })).verified).toBe(true);
    expect((await verifyByFile(origin, 'ohv_OTHER', { lab })).reason).toBe('token_mismatch');
  });
  it('does not follow redirects', async () => {
    routes.set('/.well-known/oddhound-verify.txt', (r) => { r.statusCode = 302; r.setHeader('location', 'https://elsewhere.example/token'); r.end(); });
    expect((await verifyByFile(origin, 'ohv_RIGHT', { lab })).reason).toBe('http_302');
  });
  it('rejects oversized responses', async () => {
    routes.set('/.well-known/oddhound-verify.txt', (r) => r.end('x'.repeat(300 * 1024)));
    expect((await verifyByFile(origin, 'ohv_RIGHT', { lab })).reason).toBe('response_too_large');
  });
  it('rejects a non-200 file', async () => {
    routes.set('/.well-known/oddhound-verify.txt', (r) => { r.statusCode = 404; r.end('ohv_RIGHT'); });
    expect((await verifyByFile(origin, 'ohv_RIGHT', { lab })).verified).toBe(false);
  });
  it('meta method reads the home page head only', async () => {
    routes.set('/', (r) => r.end('<html><head><meta name="oddhound-verification" content="ohv_META"></head><body></body></html>'));
    expect((await verifyByMeta(origin, 'ohv_META', { lab })).verified).toBe(true);
    routes.set('/', (r) => r.end('<html><head></head><body>ohv_META</body></html>'));
    expect((await verifyByMeta(origin, 'ohv_META', { lab })).verified).toBe(false);
  });
  it('without the lab profile, a loopback origin is never fetched', async () => {
    expect((await verifyByFile(origin, 'ohv_RIGHT')).verified).toBe(false);
  });
});

describe('DNS verification', () => {
  it('requires the exact prefixed token at the exact hostname', async () => {
    const txt = async () => [['oddhound-verify=ohv_DNS'], ['v=spf1 -all']];
    expect((await verifyByDns('https://example.com', 'ohv_DNS', { txtResolver: txt })).verified).toBe(true);
    expect((await verifyByDns('https://example.com', 'ohv_OTHER', { txtResolver: txt })).verified).toBe(false);
    expect((await verifyByDns('https://example.com', 'ohv_DNS', { txtResolver: async () => [['ohv_DNS']] })).verified).toBe(false);
  });

  it('accepts the exact host or a parent domain, never a child or a sibling', async () => {
    const zone: Record<string, string[][]> = {
      '_oddhound-verify.www.example.com': [['oddhound-verify=ohv_WWW']],
      '_oddhound-verify.example.com': [['oddhound-verify=ohv_APEX']],
    };
    const asked: string[] = [];
    const txtResolver = async (name: string) => {
      asked.push(name);
      if (zone[name]) return zone[name];
      throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    };
    expect(await verifyByDns('https://www.example.com', 'ohv_WWW', { txtResolver })).toMatchObject({ verified: true, reason: 'token_found' });
    // One domain-wide record covers every host under it (parent DNS control implies child control).
    expect(await verifyByDns('https://www.example.com', 'ohv_APEX', { txtResolver })).toMatchObject({ verified: true });
    expect(await verifyByDns('https://preview.api.example.com', 'ohv_APEX', { txtResolver })).toMatchObject({ verified: true });
    // A child record never verifies its parent, and a sibling's record never verifies another host.
    expect(await verifyByDns('https://example.com', 'ohv_WWW', { txtResolver })).toMatchObject({ verified: false });
    expect(await verifyByDns('https://shop.example.com', 'ohv_WWW', { txtResolver })).toMatchObject({ verified: false });
    // The walk stops at two labels: no lookup ever reaches a bare top-level domain.
    expect(asked.some((n) => n === '_oddhound-verify.com')).toBe(false);
  });

  it('lists names from most to least specific and stops at two labels', () => {
    expect(dnsVerificationNames('preview.api.studyboost.com')).toEqual([
      '_oddhound-verify.preview.api.studyboost.com', 'preview.api.studyboost.com',
      '_oddhound-verify.api.studyboost.com', '_oddhound-verify.studyboost.com',
    ]);
    expect(dnsVerificationNames('example.com')).toEqual(['_oddhound-verify.example.com', 'example.com']);
    expect(dnsVerificationNames('203.0.113.5')).toEqual(['_oddhound-verify.203.0.113.5', '203.0.113.5']);
    expect(suggestedDomainRecord('preview.studyboost.com')).toBe('_oddhound-verify.studyboost.com');
    expect(suggestedDomainRecord('app.shop.co.uk')).toBe('_oddhound-verify.shop.co.uk');
  });

  it('accepts the project site token for an API host, but only by DNS', async () => {
    const txtResolver = async (name: string) => {
      if (name === '_oddhound-verify.studyboost.com') return [['oddhound-verify=ohv_SITE']];
      throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    };
    expect(await verifyOwnership('https://preview.api.studyboost.com', 'ohv_API', 'dns_txt', { txtResolver }, 'ohv_SITE')).toMatchObject({ verified: true });
    expect(await verifyOwnership('https://preview.api.studyboost.com', 'ohv_API', 'dns_txt', { txtResolver })).toMatchObject({ verified: false });
  });

  it('reports a DNS failure instead of a plain miss', async () => {
    const txtResolver = async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }); };
    expect(await verifyByDns('https://example.com', 'ohv_DNS', { txtResolver })).toMatchObject({ verified: false, reason: 'dns_error:ETIMEOUT' });
  });
});
