// SELF-02, SELF-16, SELF-17: what the page may do inside the browser.
import { describe, it, expect } from 'vitest';
import { decide, policyFromContract } from '../../packages/core/browser/scope.ts';
import { demoTargetContract, DEFAULT_DENIED_PATH_KEYWORDS, pathHasDeniedKeyword } from '../../packages/core/contracts/contract.ts';

const active = policyFromContract(demoTargetContract('https://shop.example'));
const observe = policyFromContract({ ...demoTargetContract('https://shop.example'), testMode: 'observation_only' });
const prodNoAck = policyFromContract({ ...demoTargetContract('https://shop.example'), target: { ...demoTargetContract('https://shop.example').target, environment: 'production' } });
const req = (url: string, method = 'GET', extra: Partial<{ isNavigation: boolean; isMainFrame: boolean; resourceType: string }> = {}) =>
  ({ url, method, isNavigation: false, isMainFrame: true, resourceType: 'document', ...extra });

describe('scope decisions', () => {
  it('active runs may submit forms on the verified origin (positive control, SELF-17)', () => {
    expect(decide(active, req('https://shop.example/bookings', 'POST', { isNavigation: true })).allowed).toBe(true);
    expect(decide(active, req('https://shop.example/bookings/1/cancel', 'POST')).allowed).toBe(true);
  });
  it('main-frame navigation off the verified origin is blocked (SELF-16)', () => {
    expect(decide(active, req('https://evil.example/', 'GET', { isNavigation: true })).reason).toBe('navigation_outside_verified_origin');
    expect(decide(active, req('https://shop.example.evil.example/', 'GET', { isNavigation: true })).allowed).toBe(false);
    expect(decide(active, req('http://shop.example/', 'GET', { isNavigation: true })).allowed).toBe(false); // scheme is part of the origin
  });
  it('public resources load but gain no write or socket authority (SELF-02)', () => {
    expect(decide(active, req('https://cdn.example/app.js', 'GET', { resourceType: 'script' })).allowed).toBe(true);
    expect(decide(active, req('https://cdn.example/collect', 'POST', { resourceType: 'fetch' })).reason).toBe('write_to_unverified_origin');
    expect(decide(active, req('wss://cdn.example/ws', 'GET', { resourceType: 'websocket' })).allowed).toBe(false);
  });
  it('observation-only and unacknowledged production runs cannot write', () => {
    expect(decide(observe, req('https://shop.example/bookings', 'POST')).reason).toBe('writes_not_permitted');
    expect(decide(prodNoAck, req('https://shop.example/bookings', 'POST')).reason).toBe('writes_not_permitted');
    expect(decide(observe, req('https://shop.example/bookings')).allowed).toBe(true);
  });
  it('denied paths are blocked even for GET', () => {
    expect(decide(active, req('https://shop.example/__lab/reset')).reason).toBe('denied_path');
  });
  it('frames may not submit anywhere, and odd schemes are refused', () => {
    expect(decide(active, req('https://shop.example/x', 'POST', { isNavigation: true, isMainFrame: false })).reason).toBe('frame_write_blocked');
    expect(decide(active, req('file:///etc/passwd')).allowed).toBe(false);
    expect(decide(active, req('chrome://settings')).allowed).toBe(false);
  });
});

describe('safe default blocks (denied URL words)', () => {
  const kw = DEFAULT_DENIED_PATH_KEYWORDS;
  it('blocks money, admin, cron, domain and logout URLs as segments or dash parts', () => {
    for (const p of ['/api/paymongo/create-link', '/subscribe/123', '/api/vercel/add-domain', '/admin/codes', '/api/cron/renew', '/auth/signout', '/account/delete', '/api/codes/redeem', '/checkout', '/sign-out'])
      expect(pathHasDeniedKeyword(p, kw), p).not.toBeNull();
  });
  it('leaves ordinary pages alone', () => {
    for (const p of ['/', '/pricing', '/login', '/dashboard', '/dashboard/profile', '/contact', '/payday-tips', '/administrator-guide'])
      expect(pathHasDeniedKeyword(p, kw), p).toBeNull();
  });
  it('is enforced by the scope policy for every method on the verified origin', () => {
    const policy = { ...active, deniedPathKeywords: kw };
    expect(decide(policy, req('https://shop.example/api/paymongo/x', 'POST'))).toMatchObject({ allowed: false, reason: 'denied_path_keyword' });
    expect(decide(policy, req('https://shop.example/admin', 'GET', { isNavigation: true }))).toMatchObject({ allowed: false, reason: 'denied_path_keyword' });
    expect(decide(policy, req('https://shop.example/pricing', 'GET', { isNavigation: true }))).toMatchObject({ allowed: true });
  });
});

describe('owner sign-in handoff scope', () => {
  const handoff = { ...observe, deniedPathKeywords: DEFAULT_DENIED_PATH_KEYWORDS, handoffActive: true };
  it('lets the owner sign in through another provider and post the login form, even in observation mode', () => {
    expect(decide(handoff, req('https://accounts.idp.example/signin', 'GET', { isNavigation: true }))).toMatchObject({ allowed: true, reason: 'owner_handoff' });
    expect(decide(handoff, req('https://www.google.com/recaptcha/api2/reload', 'POST', { resourceType: 'xhr' }))).toMatchObject({ allowed: true });
    expect(decide(handoff, req('https://shop.example/login', 'POST'))).toMatchObject({ allowed: true });
  });
  it('still blocks denied URLs during the handoff', () => {
    expect(decide(handoff, req('https://shop.example/checkout', 'GET', { isNavigation: true }))).toMatchObject({ allowed: false, reason: 'denied_path_keyword' });
  });
  it('returns to the strict policy once the handoff ends', () => {
    const after = { ...handoff, handoffActive: false };
    expect(decide(after, req('https://accounts.idp.example/signin', 'GET', { isNavigation: true }))).toMatchObject({ allowed: false, reason: 'navigation_outside_verified_origin' });
    expect(decide(after, req('https://www.google.com/recaptcha/api2/reload', 'POST', { resourceType: 'xhr' }))).toMatchObject({ allowed: false, reason: 'write_to_unverified_origin' });
  });
});
