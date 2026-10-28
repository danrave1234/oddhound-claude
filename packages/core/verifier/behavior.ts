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

export type TwoTabFacts = {
  /** Values of the two fields when both tabs opened the record. */
  original: { first: string; second: string };
  wanted: { first: string; second: string };
  /** The first tab's save was refused (then nothing can be judged). */
  firstRejected: boolean;
  /** The out-of-date tab's save was refused with a visible message. */
  staleRejected: boolean;
  /** The record reopened afterwards. */
  final: { first: string; second: string };
};

/**
 * Family 2 (same actor, two tabs): two edits of different fields of one record. A save from the stale
 * tab may be refused or merged; it must not silently put back the value the other tab just changed.
 */
export function judgeTwoTabs(f: TwoTabFacts): { outcome: 'passed' | 'failed' | 'inconclusive'; detail: string } {
  const same = (a: string, b: string) => norm(a) === norm(b);
  if (same(f.original.first, f.wanted.first) || same(f.original.second, f.wanted.second)) return { outcome: 'inconclusive', detail: 'a new value equals the old one, so a lost change could not be seen' };
  if (f.firstRejected) return { outcome: 'inconclusive', detail: 'the first tab\'s save was refused, so there was no change to lose' };
  if (f.staleRejected) {
    return same(f.final.first, f.wanted.first)
      ? { outcome: 'passed', detail: 'the out-of-date tab\'s save was refused with a message, and the first tab\'s change was kept' }
      : { outcome: 'inconclusive', detail: 'the out-of-date tab\'s save was refused, but the first tab\'s change is not there either' };
  }
  if (same(f.final.first, f.wanted.first) && same(f.final.second, f.wanted.second)) return { outcome: 'passed', detail: 'both tabs\' changes were kept' };
  if (same(f.final.second, f.wanted.second) && same(f.final.first, f.original.first)) {
    return { outcome: 'failed', detail: `the change saved in the first tab was silently undone: the save from the out-of-date tab put back ${JSON.stringify(f.original.first.slice(0, 60))} with no message` };
  }
  return { outcome: 'inconclusive', detail: `the record ended in an unexpected state (${JSON.stringify(f.final.first.slice(0, 40))}, ${JSON.stringify(f.final.second.slice(0, 40))})` };
}

/** Whether a page shows that the last submit was refused: an error message or a field marked invalid. */
export async function rejectionShown(page: Page): Promise<boolean> {
  return (await page.locator('[role=alert]:visible, .error:visible, .invalid-feedback:visible, :user-invalid').count().catch(() => 0)) > 0;
}

// ---- Family 3: invariants. Numbers are parsed here, never by the model.

/** How numbers are read; recorded with every invariant finding. */
export const NUMBER_ASSUMPTIONS = 'Numbers read with "." as the decimal point and "," as a thousands separator; currency symbols and units ignored; amounts compared to within 0.005 (2-decimal rounding).';

/** The single number in a piece of text ("$1,234.50" -> 1234.5, "7 guests" -> 7), or null when there is none or more than one. */
export function parseNumber(text: string): number | null {
  const found = text.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/[-−]?\d+(?:\.\d+)?/g);
  if (!found || found.length !== 1) return null;
  return Number(found[0]!.replace('−', '-'));
}

/** The number written right after a label in the page text ("Total guests: 7"), or null. */
export function labelledNumber(text: string, label: string): number | null {
  const esc = label.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const m = new RegExp(`${esc}\\s*[:=]?\\s*([^\\s\\d\\-−]{0,3}\\s?[-−]?[\\d.,]+)`, 'i').exec(text);
  return m ? parseNumber(m[1]!) : null;
}

export type Table = { headers: string[]; rows: string[][] };

/** Every table on the page: header cells and body rows (trusted code). */
export async function readTables(page: Page): Promise<Table[]> {
  return page.locator('table').evaluateAll((tables) => tables.slice(0, 6).map((t) => {
    const cells = (tr: Element) => Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim());
    const trs = Array.from(t.querySelectorAll('tr'));
    const headRow = t.querySelector('thead tr') ?? trs.find((tr) => tr.querySelector('th') && !tr.querySelector('td')) ?? null;
    return { headers: headRow ? cells(headRow) : [], rows: trs.filter((tr) => tr !== headRow).slice(0, 200).map(cells) };
  })).catch(() => []);
}

export type Invariant =
  | { kind: 'sum'; total: string; column: string }
  | { kind: 'count'; total: string; column?: string };

export type InvariantVerdict = { outcome: 'passed' | 'failed' | 'inconclusive'; detail: string; values: { total: number | null; parts: number[]; computed: number | null } };

/**
 * Family 3: check a numeric invariant on what a page shows. sum: the number after `total` equals the sum
 * of the `column` cells. count: the number after `total` equals the number of rows of the table.
 */
export function judgeInvariant(inv: Invariant, page: { text: string; tables: Table[] }): InvariantVerdict {
  const none = { total: null, parts: [], computed: null };
  const want = norm(inv.column ?? '');
  const table = inv.column ? page.tables.find((t) => t.headers.some((h) => norm(h) === want || norm(h).includes(want))) : page.tables.find((t) => t.rows.length);
  if (!table) return { outcome: 'inconclusive', detail: inv.column ? `no table with a "${inv.column}" column on the page` : 'no table on the page', values: none };
  const isTotalRow = (r: string[]) => r.some((c) => norm(c).includes(norm(inv.total)));
  const body = table.rows.filter((r) => r.length && !isTotalRow(r));
  let total = labelledNumber(page.text, inv.total);
  const col = inv.column ? table.headers.findIndex((h) => norm(h) === want || norm(h).includes(want)) : -1;
  if (total === null && col >= 0) { const row = table.rows.find(isTotalRow); if (row?.[col] !== undefined) total = parseNumber(row[col]!); }
  if (total === null) return { outcome: 'inconclusive', detail: `no single number found after "${inv.total}"`, values: none };
  if (inv.kind === 'count') {
    const computed = body.length;
    return computed === total
      ? { outcome: 'passed', detail: `"${inv.total}" shows ${total} and the table has ${computed} row(s)`, values: { total, parts: [], computed } }
      : { outcome: 'failed', detail: `"${inv.total}" shows ${total}, but the table has ${computed} row(s)`, values: { total, parts: [], computed } };
  }
  const parts = body.map((r) => (r[col] === undefined ? null : parseNumber(r[col]!)));
  if (!parts.length) return { outcome: 'inconclusive', detail: 'the table has no rows to add up', values: { total, parts: [], computed: null } };
  if (parts.some((p) => p === null)) return { outcome: 'inconclusive', detail: `some "${inv.column}" cells hold no single number`, values: { total, parts: [], computed: null } };
  const nums = parts as number[];
  const computed = Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
  return Math.abs(computed - total) < 0.005
    ? { outcome: 'passed', detail: `"${inv.total}" ${total} equals the sum of ${nums.length} "${inv.column}" value(s)`, values: { total, parts: nums, computed } }
    : { outcome: 'failed', detail: `"${inv.total}" shows ${total}, but the ${nums.length} "${inv.column}" value(s) (${nums.join(' + ')}) add up to ${computed}`, values: { total, parts: nums, computed } };
}

// ---- Family 5: differential comparison between contexts that should agree.

/** A control as compared across contexts: digits folded (ids, counts, times) so they are not differences. */
export const controlKey = (label: string) => norm(label).replace(/\d+/g, '#');

export type ContextControls = { context: string; controls: { label: string; role: 'button' | 'link'; covered?: boolean }[]; errors: string[] };

export type DifferentialVerdict = {
  outcome: 'passed' | 'failed' | 'inconclusive';
  detail: string;
  /** Controls usable in the first context but missing (or covered) in the second. */
  missing: { label: string; role: 'button' | 'link'; why: 'absent' | 'covered' }[];
  errorsOnlyIn: string[];
};

/**
 * Family 5: the page's own actions (main content only: navigation menus legitimately collapse on phones)
 * and its error messages, compared between a reference context and another one. `focus` limits the
 * comparison to the controls the model named.
 */
export function judgeDifferential(ref: ContextControls, other: ContextControls, focus?: string[]): DifferentialVerdict {
  const want = focus?.length ? new Set(focus.map(controlKey)) : null;
  const pick = (c: ContextControls) => c.controls.filter((x) => !want || want.has(controlKey(x.label)));
  const refControls = pick(ref).filter((x) => !x.covered);
  if (!refControls.length) return { outcome: 'inconclusive', detail: `no ${want ? 'named ' : ''}control is usable in ${ref.context}, so there is nothing to compare`, missing: [], errorsOnlyIn: [] };
  const otherByKey = new Map(pick(other).map((x) => [controlKey(x.label), x]));
  const missing: DifferentialVerdict['missing'] = [];
  for (const c of refControls) {
    const o = otherByKey.get(controlKey(c.label));
    if (!o) missing.push({ label: c.label, role: c.role, why: 'absent' });
    else if (o.covered) missing.push({ label: c.label, role: c.role, why: 'covered' });
  }
  const refErrors = new Set(ref.errors.map(controlKey));
  const errorsOnlyIn = other.errors.filter((e) => !refErrors.has(controlKey(e)));
  if (!missing.length && !errorsOnlyIn.length) return { outcome: 'passed', detail: `the ${refControls.length} control(s) usable in ${ref.context} are usable in ${other.context} too`, missing, errorsOnlyIn };
  const parts = [
    ...missing.map((m) => `${m.role} "${m.label}" is ${m.why === 'absent' ? 'missing' : 'covered by another element'} in ${other.context} but usable in ${ref.context}`),
    ...errorsOnlyIn.map((e) => `only ${other.context} shows the error ${JSON.stringify(e.slice(0, 80))}`),
  ];
  return { outcome: 'failed', detail: parts.join('; '), missing, errorsOnlyIn };
}

// ---- Family 4: interruption.

export const INTERRUPTIONS = ['double_submit', 'offline_submit', 'reload_after_submit'] as const;
export type Interruption = (typeof INTERRUPTIONS)[number] | 'none';

/** How long an interrupted submit is given to land before the list is read again. */
export const INTERRUPTION_SETTLE_MS = 1_500;
/** The gap between the two presses of a double submit: the first request is already on its way. */
export const DOUBLE_PRESS_GAP_MS = 250;

/** How often a (distinctive) value appears in a page's text. */
export function occurrences(text: string, value: string): number {
  const t = norm(text), v = norm(value);
  if (!v) return 0;
  let n = 0;
  for (let i = t.indexOf(v); i !== -1; i = t.indexOf(v, i + v.length)) n++;
  return n;
}

export type InterruptionFacts = {
  kind: Interruption;
  /** Occurrences of the submitted value on the list before, right after the interruption, and after one normal retry (when nothing was saved). */
  before: number; afterInterruption: number; afterRetry?: number;
  /** The page showed a success message while the browser was offline. */
  claimedWhileOffline: boolean;
};

/**
 * Family 4: one user's interrupted submit (plus at most one normal retry when nothing was saved) must
 * create exactly one record, and the page must not report success for a save that did not happen.
 */
export function judgeInterruption(f: InterruptionFacts): { outcome: 'passed' | 'failed' | 'inconclusive'; detail: string; created: number } {
  const after = f.afterRetry ?? f.afterInterruption;
  const created = after - f.before;
  const what = f.kind === 'double_submit' ? 'pressing submit again 0.25 s after the first press' : f.kind === 'offline_submit' ? 'submitting while offline, then coming back online' : f.kind === 'reload_after_submit' ? 'reloading while the submit was in flight' : 'a normal submit';
  const retried = f.afterRetry !== undefined ? ' and one normal retry' : '';
  if (f.claimedWhileOffline && f.afterInterruption === f.before) return { outcome: 'failed', created, detail: `the page reported success while offline, but nothing was saved (${what})` };
  if (created > 1) return { outcome: 'failed', created, detail: `${what}${retried} created ${created} records instead of one` };
  if (created === 1) return { outcome: 'passed', created, detail: `${what}${retried} created exactly one record` };
  return { outcome: 'inconclusive', created, detail: `nothing was saved after ${what}${retried}, so duplication cannot be judged` };
}

/** Swap one record number in a path for a template variable. */
export function swapId(path: string, id: string, to: string): string {
  const [p, q] = path.split('?', 2) as [string, string | undefined];
  const swappedPath = p.replace(new RegExp(`/${id}(?=/|$)`, 'g'), `/${to}`);
  if (q === undefined) return swappedPath;
  return `${swappedPath}?${q.split('&').map((kv) => { const [k, v] = kv.split('='); return v === id ? `${k}=${to}` : kv; }).join('&')}`;
}
