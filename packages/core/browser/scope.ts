// Action-scope enforcement inside a browser context (MVP plan §17 "API and resource scope").
// The network boundary (egress proxy / smokescreen) decides which IPs may be dialled; this layer
// decides what the page may *do*: navigate only within the verified UI origin, send state-changing
// requests only to verified origins and only when the contract permits writes, never touch denied
// paths, and treat every other origin as a public resource dependency.
//
// Owner sign-in handoff: while the OWNER drives the browser through the live view (the agent cannot
// act then), sign-in may need other origins (an identity provider, a bot-check service). During that
// phase only, top-level navigation and form posts to other public origins are allowed. Denied paths on
// the verified site stay blocked, and the egress proxy still refuses private and internal addresses.
// The flag is switched off before the agent's first action.
//
// Known limit (documented in the spec): route handlers are not re-invoked for redirect hops, so after
// every action the agent also checks that the main frame is still on the verified origin.

import type { BrowserContext, Route, Request } from 'playwright';
import type { RunContract } from '../contracts/contract.ts';
import { pathHasDeniedKeyword, writesPermitted } from '../contracts/contract.ts';

export type ScopeDecision = { allowed: boolean; reason: string; method: string; url: string; resourceType: string };

export type ScopePolicy = {
  primaryOrigin: string;
  apiOrigins: Set<string>;
  writes: boolean;
  deniedPathPrefixes: string[];
  deniedPathKeywords: string[];
  /** True only while the owner drives the browser during the sign-in handoff. */
  handoffActive: boolean;
};

export function policyFromContract(c: RunContract): ScopePolicy {
  return {
    primaryOrigin: new URL(c.target.origin).origin,
    apiOrigins: new Set(c.target.apiOrigins.map((a) => new URL(a.origin).origin)),
    writes: writesPermitted(c),
    deniedPathPrefixes: c.deniedPathPrefixes,
    deniedPathKeywords: c.deniedPathKeywords,
    handoffActive: false,
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function decide(policy: ScopePolicy, req: { url: string; method: string; isNavigation: boolean; isMainFrame: boolean; resourceType: string }): ScopeDecision {
  const base = { method: req.method, url: req.url, resourceType: req.resourceType };
  let url: URL;
  try { url = new URL(req.url); } catch { return { ...base, allowed: false, reason: 'invalid_url' }; }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return { ...base, allowed: true, reason: 'inline_resource' };
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ...base, allowed: false, reason: 'unsupported_scheme' };
  const origin = url.origin;
  const isPrimary = origin === policy.primaryOrigin;
  const isApi = policy.apiOrigins.has(origin);

  if ((isPrimary || isApi) && policy.deniedPathPrefixes.some((p) => url.pathname.startsWith(p))) {
    return { ...base, allowed: false, reason: 'denied_path' };
  }
  if ((isPrimary || isApi) && pathHasDeniedKeyword(url.pathname, policy.deniedPathKeywords)) {
    return { ...base, allowed: false, reason: 'denied_path_keyword' };
  }
  if (policy.handoffActive) {
    // Owner-driven sign-in: any public http(s) origin, reads and writes, top-level or framed.
    return { ...base, allowed: true, reason: isPrimary ? 'verified_origin' : 'owner_handoff' };
  }
  if (req.isNavigation) {
    if (req.isMainFrame && !isPrimary) return { ...base, allowed: false, reason: 'navigation_outside_verified_origin' };
    // Subframes may load public documents (e.g. an embedded map) but they gain no authority.
    if (!req.isMainFrame && !SAFE_METHODS.has(req.method)) return { ...base, allowed: false, reason: 'frame_write_blocked' };
  }
  if (!SAFE_METHODS.has(req.method)) {
    if (!isPrimary && !isApi) return { ...base, allowed: false, reason: 'write_to_unverified_origin' };
    if (!policy.writes) return { ...base, allowed: false, reason: 'writes_not_permitted' };
  }
  if (!isPrimary && !isApi && (req.resourceType === 'websocket' || req.resourceType === 'eventsource')) {
    return { ...base, allowed: false, reason: 'socket_to_unverified_origin' };
  }
  return { ...base, allowed: true, reason: isPrimary ? 'verified_origin' : isApi ? 'verified_api_origin' : 'public_resource' };
}

export async function attachScope(context: BrowserContext, policy: ScopePolicy, onDecision: (d: ScopeDecision) => void): Promise<void> {
  await context.route('**/*', async (route: Route, request: Request) => {
    const frame = request.frame();
    let isMainFrame = false;
    try { isMainFrame = frame.parentFrame() === null; } catch { isMainFrame = false; }
    const d = decide(policy, {
      url: request.url(), method: request.method(), isNavigation: request.isNavigationRequest(),
      isMainFrame, resourceType: request.resourceType(),
    });
    if (!d.allowed || (d.reason !== 'verified_origin' && d.reason !== 'owner_handoff')) onDecision(d);
    if (d.allowed) await route.continue();
    else await route.abort('blockedbyclient');
  });
  // Popups and new tabs carry no authority: close any page not opened by Oddhound itself.
  context.on('page', (page) => {
    void page.opener().then((opener) => { if (opener) return page.close(); }).catch(() => {});
  });
}
