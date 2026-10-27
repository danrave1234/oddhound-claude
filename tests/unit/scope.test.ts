// SELF-02, SELF-16, SELF-17: what the page may do inside the browser.
import { describe, it, expect } from 'vitest';
import { decide, policyFromContract } from '../../packages/core/browser/scope.ts';
import { demoTargetContract } from '../../packages/core/contracts/contract.ts';

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
