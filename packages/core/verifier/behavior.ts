// Behavioral test families (MVP §9): the deciding code shared by exploration and replay.
//
// The model proposes (which claim, which fields, which record); everything here decides from what
// the browser actually showed. The same functions judge a check during exploration, its independent
// replay and its retest, so "it happened" and "it reproduced" are decided by identical code.

import type { Page } from 'playwright';

/** Behavioral families. A finding from a family records it; other findings have none. */
export const FAMILIES = ['claim_vs_truth', 'two_actors', 'invariant', 'interruption', 'differential'] as const;
export type Family = (typeof FAMILIES)[number];

/**
 * Family 1 waits this long in total for a save to show up before calling it missing, so eventual
 * consistency is not reported as data loss. Each entry is the pause before one more look.
 */
export const CLAIM_RETRY_DELAYS_MS: readonly number[] = [0, 1_500, 3_000];
export const CLAIM_WINDOW_MS = CLAIM_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);

/** Text as compared: whitespace collapsed, case folded. */
export function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** What one page showed: its visible text and the current values of its form controls. */
export type PageView = { path: string; text: string; values: string[] };

/** Read a page's visible text and form-control values (trusted code; nothing the model wrote runs). */
export async function readView(page: Page): Promise<PageView> {
  let path = '/';
  try { const u = new URL(page.url()); path = `${u.pathname}${u.search}`; } catch { /* keep "/" */ }
  const text = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  const values = await page.locator('input:not([type=password]):not([type=hidden]), textarea, select').evaluateAll((els) =>
    els.map((e) => (e as HTMLInputElement).value ?? '').filter((v) => v !== '')).catch(() => [] as string[]);
  return { path, text, values };
}

/** True when the claimed success text is visible on the page (the model may not invent a claim). */
export function claimVisible(claim: string, text: string): boolean {
  const c = norm(claim);
  return c.length >= 2 && norm(text).includes(c);
}

/** Whether a saved value is shown on a page: in its text, or as the value of one of its form controls. */
export function valueShown(value: string, view: PageView): boolean {
  const v = norm(value);
  if (!v) return true; // an empty value cannot be looked for; never reported as missing
  return norm(view.text).includes(v) || view.values.some((x) => norm(x) === v || norm(x).includes(v));
}

export type PersistCheck = { field: string; value: string };
export type PersistVerdict = {
  /** Fields whose saved value appears on at least one of the pages looked at. */
  found: { field: string; path: string }[];
  missing: PersistCheck[];
};

/** Family 1: which saved values are visible on any of the reopened pages. */
export function judgePersistence(checks: PersistCheck[], views: PageView[]): PersistVerdict {
  const found: PersistVerdict['found'] = [];
  const missing: PersistCheck[] = [];
  for (const c of checks) {
    const where = views.find((v) => valueShown(c.value, v));
    if (where) found.push({ field: c.field, path: where.path }); else missing.push(c);
  }
  return { found, missing };
}

/** Values usable as "this record's own content": long enough to be distinctive, not a bare number or date. */
export function distinctiveValues(fields: Record<string, string>): PersistCheck[] {
  return Object.entries(fields)
    .filter(([, v]) => {
      const t = v.trim();
      return t.length >= 4 && !/^[-+]?\d+([.,]\d+)?$/.test(t) && !/^\d{4}-\d{2}-\d{2}/.test(t) && !/\{\w+([+-]\d+)?\}/.test(t) && !/@/.test(t);
    })
    .map(([field, value]) => ({ field, value: value.trim() }));
}

export type CrossActorFacts = {
  /** Actor A's own view of the record: shows A's values (positive control). */
  ownerView: PageView;
  /** Actor B's list page equivalent (where A's records are listed for A); absent when not known. */
  otherList?: PageView;
  /** Actor B's landing page right after signing in (coincidence guard). */
  otherHome: PageView;
  /** Actor B opening exactly A's record URL. */
  otherView: PageView;
  /** A's view of the record again after B tried a visible control, with the control tried. */
  afterControls?: { control: string; clicked: boolean; ownerAfter: PageView }[];
};

export type CrossActorVerdict = {
  outcome: 'passed' | 'failed' | 'inconclusive';
  /** Whether the app itself treats the record as private (B's list does not show it). */
  privacyEstablished: boolean;
  detail: string;
  leaked: string[];
  changedBy: string[];
};

/** Normalised text with digits and times removed, for "did A's record change" comparisons. */
function stable(text: string): string {
  return norm(text).replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '').replace(/\d+/g, '#');
}

/**
 * Family 2 (cross-actor): actor B must not see A's protected values, and B's visible controls must not
 * change A's record. A must see its own values first, and the values must not be on B's own pages
 * anyway (else the boundary cannot be judged). Privacy is established by the app itself: the record is
 * not on B's list of records.
 */
export function judgeCrossActor(protect: PersistCheck[], f: CrossActorFacts): CrossActorVerdict {
  const base = { leaked: [] as string[], changedBy: [] as string[] };
  if (!protect.length) return { ...base, outcome: 'inconclusive', privacyEstablished: false, detail: 'the record has no distinctive text to look for' };
  const ownerSees = protect.filter((p) => valueShown(p.value, f.ownerView));
  if (!ownerSees.length) return { ...base, outcome: 'inconclusive', privacyEstablished: false, detail: `actor A cannot see its own record at ${f.ownerView.path}, so the boundary cannot be judged` };
  const coincidental = ownerSees.filter((p) => valueShown(p.value, f.otherHome));
  const usable = ownerSees.filter((p) => !coincidental.includes(p));
  if (!usable.length) return { ...base, outcome: 'inconclusive', privacyEstablished: false, detail: 'actor B already sees these values on its own pages, so they cannot show a leak' };
  const privacyEstablished = f.otherList ? !usable.some((p) => valueShown(p.value, f.otherList!)) : false;
  const leaked = usable.filter((p) => valueShown(p.value, f.otherView)).map((p) => p.field);
  const before = stable(f.ownerView.text);
  const changedBy = (f.afterControls ?? []).filter((c) => c.clicked && stable(c.ownerAfter.text) !== before).map((c) => c.control);
  if (!leaked.length && !changedBy.length) {
    return { outcome: 'passed', privacyEstablished, leaked, changedBy, detail: `actor B opened ${f.otherView.path} and saw none of actor A's record (${usable.map((p) => p.field).join(', ')})${(f.afterControls ?? []).length ? '; no control B could press changed it' : ''}` };
  }
  const parts: string[] = [];
  if (leaked.length) parts.push(`actor B opened ${f.otherView.path} and saw actor A's ${leaked.join(', ')}`);
  if (changedBy.length) parts.push(`pressing ${changedBy.map((c) => `"${c}"`).join(', ')} as actor B changed actor A's record`);
  return { outcome: 'failed', privacyEstablished, leaked, changedBy, detail: parts.join('; ') };
}

/** Swap one record number in a path for a template variable. */
export function swapId(path: string, id: string, to: string): string {
  const [p, q] = path.split('?', 2) as [string, string | undefined];
  const swappedPath = p.replace(new RegExp(`/${id}(?=/|$)`, 'g'), `/${to}`);
  if (q === undefined) return swappedPath;
  return `${swappedPath}?${q.split('&').map((kv) => { const [k, v] = kv.split('='); return v === id ? `${k}=${to}` : kv; }).join('&')}`;
}
