// Compact, model-friendly page observation. Fixed trusted instrumentation runs in the page to tag
// interactive elements with versioned references (e.g. "e7"); the model never runs page JavaScript.

import type { Page } from 'playwright';

export type ObservedElement = {
  ref: string;
  kind: 'link' | 'button' | 'input' | 'textarea' | 'select' | 'checkbox';
  label: string;
  name?: string;
  type?: string;
  required?: boolean;
  min?: string;
  max?: string;
  minLength?: number;
  hasValue?: boolean;
  value?: string;
  href?: string;
  form?: number;
  inViewport: boolean;
  coveredBy?: string;
  hasAccessibleName: boolean;
};

export type Observation = {
  version: number;
  url: string;
  path: string;
  title: string;
  headings: string[];
  alerts: string[];
  forms: { index: number; action: string; method: string }[];
  elements: ObservedElement[];
  tables: string[][];
  text: string;
  viewport: { width: number; height: number };
  scroll: { y: number; maxY: number };
};

/** Trusted instrumentation. Serialised by Playwright and executed in the page; never model-authored. */
function instrument(version: number) {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const vw = window.innerWidth, vh = window.innerHeight;
  const forms = Array.from(document.forms);
  const labelFor = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const id = el.getAttribute('id');
    if (id) { const l = document.querySelector(`label[for="${CSS.escape(id)}"]`); if (l) return clean(l.textContent); }
    const wrap = el.closest('label');
    if (wrap) return clean(wrap.textContent);
    return '';
  };
  const describeCover = (el: Element, r: DOMRect): string | undefined => {
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1), cy = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return undefined;
    return clean(`${hit.tagName.toLowerCase()}${hit.className ? '.' + String(hit.className).split(' ')[0] : ''}: ${hit.textContent}`).slice(0, 80);
  };
  const out: unknown[] = [];
  let n = 0;
  const nodes = document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button]');
  nodes.forEach((el) => {
    const he = el as HTMLElement;
    const style = getComputedStyle(he);
    const r = he.getBoundingClientRect();
    if (style.visibility === 'hidden' || style.display === 'none' || (r.width === 0 && r.height === 0)) return;
    const ref = `e${++n}`;
    // Tokens accumulate per snapshot version until the document changes, so refs from the observation
    // the model is acting on stay resolvable even after Oddhound re-observes mid-turn.
    he.setAttribute('data-oh-ref', `${he.getAttribute('data-oh-ref') ?? ''} ${ref}@${version}`.trim());
    const tag = el.tagName.toLowerCase();
    const input = el as HTMLInputElement;
    const type = tag === 'input' ? (input.type || 'text') : undefined;
    const kind = tag === 'a' ? 'link' : tag === 'button' || el.getAttribute('role') === 'button' || type === 'submit' ? 'button'
      : tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : type === 'checkbox' || type === 'radio' ? 'checkbox' : 'input';
    const label = kind === 'link' || kind === 'button' ? clean(he.innerText || input.value || el.getAttribute('aria-label')) : labelFor(el);
    const inViewport = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    const formIndex = (el as HTMLInputElement).form ? forms.indexOf((el as HTMLInputElement).form!) : undefined;
    out.push({
      ref, kind, label: label || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('name')),
      name: el.getAttribute('name') ?? undefined, type,
      required: (el as HTMLInputElement).required || undefined,
      min: el.getAttribute('min') ?? undefined, max: el.getAttribute('max') ?? undefined,
      minLength: (el as HTMLInputElement).minLength > 0 ? (el as HTMLInputElement).minLength : undefined,
      hasValue: kind === 'input' || kind === 'textarea' ? Boolean((el as HTMLInputElement).value) : undefined,
      value: (kind === 'input' || kind === 'textarea') && type !== 'password' ? clean((el as HTMLInputElement).value).slice(0, 60) || undefined : undefined,
      href: tag === 'a' ? (el as HTMLAnchorElement).getAttribute('href') ?? undefined : undefined,
      form: formIndex !== undefined && formIndex >= 0 ? formIndex : undefined,
      inViewport,
      coveredBy: inViewport ? describeCover(el, r) : undefined,
      hasAccessibleName: Boolean(label),
    });
  });
  const tables = Array.from(document.querySelectorAll('table')).slice(0, 3).flatMap((t) =>
    Array.from(t.querySelectorAll('tr')).slice(0, 12).map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => clean(c.textContent))));
  return {
    title: document.title,
    headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 10).map((h) => clean(h.textContent)),
    alerts: Array.from(document.querySelectorAll('[role=alert],[role=status],.error,.notice,.alert')).slice(0, 5).map((a) => clean(a.textContent)),
    forms: forms.map((f, index) => ({ index, action: f.getAttribute('action') ?? '', method: (f.getAttribute('method') ?? 'get').toLowerCase() })),
    elements: out,
    tables,
    text: clean((document.querySelector('main') ?? document.body).innerText).slice(0, 1200),
    viewport: { width: vw, height: vh },
    scroll: { y: Math.round(window.scrollY), maxY: Math.max(0, document.documentElement.scrollHeight - vh) },
  };
}

export async function observe(page: Page, version: number): Promise<Observation> {
  const data = await page.evaluate(instrument, version);
  const url = new URL(page.url());
  return { version, url: page.url(), path: `${url.pathname}${url.search}`, ...(data as Omit<Observation, 'version' | 'url' | 'path'>) };
}

/** Render an observation as compact text for the model. Page text is untrusted and delimited. */
export function formatObservation(o: Observation): string {
  const lines: string[] = [];
  lines.push(`PAGE v${o.version}: ${o.path}  title="${o.title}"  viewport=${o.viewport.width}x${o.viewport.height} scrollY=${o.scroll.y}/${o.scroll.maxY}`);
  if (o.headings.length) lines.push(`headings: ${o.headings.map((h) => JSON.stringify(h)).join(' | ')}`);
  if (o.alerts.length) lines.push(`messages: ${o.alerts.map((h) => JSON.stringify(h)).join(' | ')}`);
  for (const f of o.forms) lines.push(`form#${f.index} ${f.method.toUpperCase()} ${f.action}`);
  for (const e of o.elements) {
    const attrs = [
      e.type && `type=${e.type}`, e.name && `name=${e.name}`, e.required && 'required', e.min !== undefined && `min=${e.min}`,
      e.max !== undefined && `max=${e.max}`, e.minLength && `minlength=${e.minLength}`, e.value && `value=${JSON.stringify(e.value)}`,
      e.href && `href=${e.href}`, e.form !== undefined && `form#${e.form}`, !e.inViewport && 'offscreen',
      e.coveredBy && `COVERED_BY=${JSON.stringify(e.coveredBy)}`, !e.hasAccessibleName && 'NO_ACCESSIBLE_NAME',
    ].filter(Boolean).join(' ');
    lines.push(`[${e.ref}] ${e.kind} ${JSON.stringify(e.label)} ${attrs}`.trim());
  }
  for (const row of o.tables) lines.push(`row: ${row.join(' | ')}`);
  lines.push('<<<UNTRUSTED_PAGE_TEXT');
  lines.push(o.text);
  lines.push('UNTRUSTED_PAGE_TEXT>>>');
  return lines.join('\n');
}

/** Stable state fingerprint: route pattern + actor + device + headings + form signature. No IDs, no values. */
export function stateFingerprint(o: Observation, actor: string, device: string): { fingerprint: string; route: string } {
  const route = new URL(o.url).pathname.replace(/\/\d+(?=\/|$)/g, '/:id');
  const formSig = o.elements.filter((e) => e.kind !== 'link').map((e) => `${e.kind}:${e.name ?? e.label}`).sort().join(',');
  const raw = `${route}|${actor}|${device}|${o.headings.map((h) => h.replace(/\d+/g, '#')).join('/')}|${formSig}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  return { fingerprint: `${route}#${(h >>> 0).toString(36)}`, route };
}
