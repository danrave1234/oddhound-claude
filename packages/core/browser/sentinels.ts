// Automatic bug detectors ("sentinels"). Trusted code, no model involvement and no model cost.
//
// They watch every page the run opens and report signals that map to Oddhound's baseline rules:
//   B1 server error (HTTP 5xx from the verified site or a verified API host)
//   B2 uncaught JavaScript error in the page
//   B3 the markup probe typed into a field came back rendered as an element
//   B4 stack traces / internal error details in the page text
//   B5 the page is wider than a phone screen (sideways scrolling)
//   B6 an in-scope page that does not exist (document request answered 404)
// The same functions judge a replay, so "it happened during exploration" and "it reproduced in a
// fresh session" are decided by identical code.

import type { Page, Response } from 'playwright';

/** Harmless markup typed into text fields. If it is ever rendered as an element, input is not escaped. */
export const MARKUP_PROBE = '<i data-oh-probe="1">OHPROBE</i>';
export const MARKUP_PROBE_SELECTOR = '[data-oh-probe]';

export type Signal =
  | { kind: 'http_5xx'; rule: 'B1'; method: string; url: string; route: string; status: number; resource: string }
  | { kind: 'page_error'; rule: 'B2'; message: string }
  | { kind: 'markup_rendered'; rule: 'B3'; path: string }
  | { kind: 'error_text'; rule: 'B4'; path: string; pattern: string; excerpt: string }
  | { kind: 'mobile_overflow'; rule: 'B5'; path: string; scrollWidth: number; viewport: number }
  | { kind: 'http_404'; rule: 'B6'; url: string; route: string; status: 404; from: string | null };

/** Patterns that mean internal details leaked (framework traces, SQL errors), not just "an error". */
export const INTERNAL_ERROR_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'python_traceback', re: /Traceback \(most recent call last\)/ },
  { name: 'js_stack_frame', re: /\n\s+at [\w$.<>[\] ]+ \((?:\/|[A-Za-z]:\\|file:|webpack|node:)[^)]*:\d+:\d+\)/ },
  { name: 'prisma_error', re: /Prisma\w*(?:Known|Unknown)?Request\w*Error|Invalid `prisma\.\w+\.\w+\(\)` invocation/ },
  { name: 'sql_error', re: /SQLSTATE\[\w+\]|ORA-\d{5}|syntax error at or near "|You have an error in your SQL syntax|duplicate key value violates unique constraint/ },
  { name: 'java_exception', re: /Exception in thread "|java\.lang\.\w+Exception|NullPointerException\s+at / },
  { name: 'php_fatal', re: /(?:Fatal error|Parse error|Warning): .{3,200} on line \d+/ },
  { name: 'rails_django_debug', re: /ActiveRecord::\w+Error|django\.(?:db|core)\.\w+|Request Method:\s+\w+\s+Request URL:/ },
  { name: 'next_dev_overlay', re: /Unhandled Runtime Error|Server Error\s+Error: [\s\S]{0,200}This error happened while generating the page/ },
];

export function internalErrorIn(text: string): { name: string; excerpt: string } | null {
  for (const p of INTERNAL_ERROR_PATTERNS) {
    const m = p.re.exec(text);
    if (m) return { name: p.name, excerpt: text.slice(Math.max(0, m.index - 40), m.index + 160).replace(/\s+/g, ' ').trim() };
  }
  return null;
}

/** Route pattern without IDs, so the same bug on /notes/12 and /notes/13 is one signal. */
export function routeOf(url: string): string {
  try {
    return new URL(url).pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
      .replace(/\/\d+(?=\/|$)/g, '/:id')
      .replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:id');
  } catch { return url; }
}

export function signalKey(s: Signal): string {
  switch (s.kind) {
    case 'http_5xx': return `B1|${s.method}|${s.route}`;
    case 'page_error': return `B2|${s.message.slice(0, 80)}`;
    case 'markup_rendered': return `B3|${routeOf(`https://x${s.path}`)}`;
    case 'error_text': return `B4|${s.pattern}|${routeOf(`https://x${s.path}`)}`;
    case 'mobile_overflow': return `B5|${routeOf(`https://x${s.path}`)}`;
    case 'http_404': return `B6|${s.route}`;
  }
}

/**
 * Listen for response and page-error signals on one page. `inScope` decides which origins count
 * (the verified site and verified API hosts); third-party failures are not the site's bug.
 */
export function attachSentinels(page: Page, inScope: (origin: string) => boolean, onSignal: (s: Signal) => void): void {
  page.on('response', (r: Response) => {
    let u: URL;
    try { u = new URL(r.url()); } catch { return; }
    if (!inScope(u.origin)) return;
    const status = r.status();
    const req = r.request();
    const resource = req.resourceType();
    if (status >= 500) onSignal({ kind: 'http_5xx', rule: 'B1', method: req.method(), url: r.url(), route: routeOf(r.url()), status, resource });
    else if (status === 404 && resource === 'document' && req.method() === 'GET') {
      onSignal({ kind: 'http_404', rule: 'B6', url: r.url(), route: routeOf(r.url()), status: 404, from: req.headers()['referer'] ?? null });
    }
  });
  page.on('pageerror', (e: Error) => {
    onSignal({ kind: 'page_error', rule: 'B2', message: `${e.name}: ${e.message}`.replace(/\s+/g, ' ').slice(0, 300) });
  });
}

/** In-page checks after an action settles: rendered probe, leaked internals, phone overflow. */
export async function checkPage(page: Page, mobile: boolean): Promise<Signal[]> {
  const out: Signal[] = [];
  let path = '/';
  try { const u = new URL(page.url()); path = `${u.pathname}${u.search}`; } catch { /* keep "/" */ }
  const facts = await page.evaluate((sel) => ({
    probe: document.querySelector(sel) !== null,
    text: (document.body?.innerText ?? '').slice(0, 20_000),
    scrollWidth: document.documentElement.scrollWidth,
  }), MARKUP_PROBE_SELECTOR).catch(() => null);
  if (!facts) return out;
  // Mobile emulation widens the layout viewport to fit wide content, so judge against the device width.
  const viewport = page.viewportSize()?.width ?? 390;
  if (facts.probe) out.push({ kind: 'markup_rendered', rule: 'B3', path });
  const leak = internalErrorIn(facts.text);
  if (leak) out.push({ kind: 'error_text', rule: 'B4', path, pattern: leak.name, excerpt: leak.excerpt });
  if (mobile && facts.scrollWidth > viewport + 4) out.push({ kind: 'mobile_overflow', rule: 'B5', path, scrollWidth: facts.scrollWidth, viewport });
  return out;
}

export function describeSignal(s: Signal): string {
  switch (s.kind) {
    case 'http_5xx': return `server error HTTP ${s.status} on ${s.method} ${s.route} (${s.resource})`;
    case 'page_error': return `uncaught JavaScript error: ${s.message}`;
    case 'markup_rendered': return `the markup probe was rendered as an element on ${s.path} (input not escaped)`;
    case 'error_text': return `internal error details shown on ${s.path} (${s.pattern}): "${s.excerpt.slice(0, 120)}"`;
    case 'mobile_overflow': return `page ${s.path} is ${s.scrollWidth}px wide on a ${s.viewport}px phone (sideways scrolling)`;
    case 'http_404': return `in-site page ${s.route} does not exist (HTTP 404)`;
  }
}
