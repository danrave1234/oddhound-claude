// The scout: a compact, model-friendly page observation built by trusted runner code, without
// clicking, typing or running model-supplied code (MVP §7 "Scout"). Fixed instrumentation tags each
// interactable element with a reference scoped to the snapshot version (e.g. "e7@12"); the model
// only ever refers to "e7". Besides elements it records the rules the page states about itself
// (required, length, range, step, pattern, input type, visible limit text): candidate rules, not
// proven business policy.
//
// Framework event delegation makes listener detection incomplete, so roles, focusability, cursor and
// drag hints are combined and misses are accepted. Unexercised elements are pending actions, never
// proven edges.

import type { Page } from 'playwright';

export type ElementKind =
  | 'link' | 'button' | 'input' | 'textarea' | 'select' | 'checkbox'
  /** ARIA widget (tab, menuitem, switch, slider, option, combobox…); see `role`. */
  | 'widget'
  /** contenteditable region. */
  | 'editable'
  /** Only known to be draggable (draggable="true" or a drag hint). */
  | 'draggable'
  /** Only known by its pointer cursor or tabindex (likely a scripted click target). */
  | 'clickable';

export type ObservedElement = {
  ref: string;
  kind: ElementKind;
  label: string;
  name?: string;
  type?: string;
  role?: string;
  required?: boolean;
  min?: string;
  max?: string;
  step?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  disabled?: boolean;
  checked?: boolean;
  draggable?: boolean;
  hasValue?: boolean;
  value?: string;
  href?: string;
  form?: number;
  /** Owning landmark when it is not the main content (nav, header, footer, aside, dialog). */
  region?: string;
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
  /** Error messages shown by the page (role=alert, .error…). */
  errors: string[];
  /** Success/status messages (role=status, .notice, .success, .toast). */
  notices: string[];
  /** Fields the browser marks invalid after the user interacted (:user-invalid), with its message. */
  invalid: { label: string; message: string }[];
  /** Visible text that states a limit ("up to 8 guests", "max 200 characters"). */
  statedLimits: string[];
  forms: { index: number; action: string; method: string; noValidate: boolean }[];
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
  const byIds = (ids: string | null) => (ids ?? '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
  const labelFor = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const by = byIds(el.getAttribute('aria-labelledby'));
    if (by.trim()) return clean(by);
    const id = el.getAttribute('id');
    if (id) { const l = document.querySelector(`label[for="${CSS.escape(id)}"]`); if (l) return clean(l.textContent); }
    const wrap = el.closest('label');
    if (wrap) {
      // The label's own words only: a wrapped textarea's text or a select's options are not its label.
      const copy = wrap.cloneNode(true) as Element;
      copy.querySelectorAll('textarea, select, input, button').forEach((c) => c.remove());
      return clean(copy.textContent);
    }
    return '';
  };
  const describeCover = (el: Element, r: DOMRect): string | undefined => {
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1), cy = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return undefined;
    const cls = typeof hit.className === 'string' && hit.className ? `.${hit.className.split(' ')[0]}` : '';
    return clean(`${hit.tagName.toLowerCase()}${cls}: ${hit.textContent}`).slice(0, 80);
  };
  const WIDGET_ROLES = ['tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'switch', 'slider', 'spinbutton', 'option', 'combobox', 'checkbox', 'radio', 'treeitem', 'gridcell', 'searchbox', 'textbox'];
  const CORE = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link]';
  const FOCUSABLE = '[tabindex]:not([tabindex^="-"])';
  const SEL = `${CORE}, ${WIDGET_ROLES.map((r) => `[role=${r}]`).join(', ')}, [contenteditable]:not([contenteditable=false]), [draggable=true], [aria-roledescription], [aria-grabbed], [aria-dropeffect], ${FOCUSABLE}`;
  const DRAG_HINT = /drag|drop|sortable|reorder|movable/i;
  const visible = (he: HTMLElement) => {
    const style = getComputedStyle(he);
    const r = he.getBoundingClientRect();
    return !(style.visibility === 'hidden' || style.display === 'none' || (r.width === 0 && r.height === 0));
  };
  const out: unknown[] = [];
  const included = new Set<Element>();
  let n = 0;
  const tag = (he: HTMLElement) => {
    const ref = `e${++n}`;
    // Tokens accumulate per snapshot version until the document changes, so refs from the observation
    // the model is acting on stay resolvable even after Oddhound re-observes mid-turn.
    he.setAttribute('data-oh-ref', `${he.getAttribute('data-oh-ref') ?? ''} ${ref}@${version}`.trim());
    return ref;
  };
  const regionOf = (el: Element): string | undefined => {
    const r = el.closest('nav, header, footer, aside, dialog, [role=dialog], [role=navigation], [role=banner], [role=contentinfo]');
    if (!r) return undefined;
    const role = r.getAttribute('role');
    return role === 'navigation' ? 'nav' : role === 'banner' ? 'header' : role === 'contentinfo' ? 'footer' : role === 'dialog' ? 'dialog' : r.tagName.toLowerCase();
  };
  const push = (el: Element, kind: string, label: string, extra: Record<string, unknown> = {}) => {
    const he = el as HTMLElement;
    const r = he.getBoundingClientRect();
    const inViewport = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    included.add(el);
    out.push({
      ref: tag(he), kind, label, inViewport, coveredBy: inViewport ? describeCover(el, r) : undefined,
      hasAccessibleName: Boolean(label), region: regionOf(el), ...extra,
    });
  };

  document.querySelectorAll(SEL).forEach((el) => {
    const he = el as HTMLElement;
    if (!visible(he)) return;
    const t = el.tagName.toLowerCase();
    const role = el.getAttribute('role') ?? undefined;
    const isField = t === 'input' || t === 'textarea' || t === 'select';
    const roleDesc = el.getAttribute('aria-roledescription') ?? '';
    const dragHint = el.getAttribute('draggable') === 'true' || el.hasAttribute('aria-grabbed') || el.hasAttribute('aria-dropeffect') || DRAG_HINT.test(roleDesc);
    // A bare [aria-roledescription] match is only interesting with a drag hint or another affordance.
    if (!el.matches(CORE) && !isField && !(role && WIDGET_ROLES.includes(role)) && !he.isContentEditable && !dragHint && !el.matches(FOCUSABLE)) return;
    // A focusable container (tabindex on a wrapper of other controls) is not itself a control.
    if (!el.matches(CORE) && !isField && !role && !he.isContentEditable && !dragHint && el.querySelector(CORE)) return;
    // Nested inside a link or button (an icon or span): the outer control is the affordance.
    if (!isField && !dragHint && el.parentElement?.closest('a[href], button, [role=button], [role=link]')) return;
    // Text inside an editable root is part of that root.
    if (he.isContentEditable && el.parentElement?.isContentEditable) return;
    const input = el as HTMLInputElement;
    const type = t === 'input' ? (input.type || 'text') : undefined;
    // An explicit ARIA widget role wins over the tag (e.g. <button role="tab"> is a tab).
    const kind = t === 'a' || role === 'link' ? 'link'
      : role && WIDGET_ROLES.includes(role) && !isField ? 'widget'
      : t === 'button' || t === 'summary' || role === 'button' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image' ? 'button'
      : t === 'textarea' ? 'textarea' : t === 'select' ? 'select'
      : type === 'checkbox' || type === 'radio' ? 'checkbox'
      : t === 'input' ? 'input'
      : role && WIDGET_ROLES.includes(role) ? 'widget'
      : he.isContentEditable ? 'editable'
      : dragHint ? 'draggable' : 'clickable';
    const textual = kind === 'link' || kind === 'button' || kind === 'widget' || kind === 'draggable' || kind === 'clickable';
    const label = textual
      ? clean(el.getAttribute('aria-label') || byIds(el.getAttribute('aria-labelledby')) || he.innerText || input.value || el.getAttribute('title'))
      : labelFor(el);
    const formIndex = input.form ? forms.indexOf(input.form) : undefined;
    const maxLength = isField && t !== 'select' && input.maxLength >= 0 ? input.maxLength : undefined;
    push(el, kind, label || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('name')), {
      name: el.getAttribute('name') ?? undefined, type,
      role: kind === 'widget' || (kind === 'link' && t !== 'a') ? role : undefined,
      required: (input.required || el.getAttribute('aria-required') === 'true') || undefined,
      min: el.getAttribute('min') ?? el.getAttribute('aria-valuemin') ?? undefined,
      max: el.getAttribute('max') ?? el.getAttribute('aria-valuemax') ?? undefined,
      step: el.getAttribute('step') ?? undefined,
      minLength: isField && input.minLength > 0 ? input.minLength : undefined,
      maxLength: maxLength !== undefined && maxLength > 0 && maxLength < 1_000_000 ? maxLength : undefined,
      pattern: el.getAttribute('pattern')?.slice(0, 80) ?? undefined,
      disabled: (input.disabled || el.getAttribute('aria-disabled') === 'true') || undefined,
      checked: kind === 'checkbox' ? input.checked
        : role === 'switch' || role === 'checkbox' || role === 'tab' ? (el.getAttribute('aria-checked') ?? el.getAttribute('aria-selected')) === 'true' : undefined,
      draggable: dragHint || undefined,
      hasValue: kind === 'input' || kind === 'textarea' ? Boolean(input.value) : undefined,
      value: (kind === 'input' || kind === 'textarea') && type !== 'password' ? clean(input.value).slice(0, 60) || undefined
        : role === 'slider' || role === 'spinbutton' ? el.getAttribute('aria-valuenow') ?? undefined : undefined,
      href: t === 'a' ? el.getAttribute('href') ?? undefined : undefined,
      form: formIndex !== undefined && formIndex >= 0 ? formIndex : undefined,
    });
  });

  // Pointer-cursor elements that are not otherwise interactive: likely click handlers on divs.
  let scanned = 0, extra = 0;
  for (const el of Array.from(document.querySelectorAll('div, span, li, img, svg, td, p, h2, h3, h4'))) {
    if (++scanned > 3000 || extra >= 25) break;
    if (included.has(el) || el.closest(SEL) || el.querySelector(SEL)) continue;
    const he = el as HTMLElement;
    if (getComputedStyle(he).cursor !== 'pointer') continue;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue;
    if (!visible(he)) continue;
    const label = clean(el.getAttribute('aria-label') || he.innerText || el.getAttribute('title') || el.getAttribute('alt'));
    if (!label) continue;
    push(el, 'clickable', label);
    extra++;
  }

  const textOf = (sel: string, limit = 5) => Array.from(document.querySelectorAll(sel)).filter((e) => visible(e as HTMLElement)).slice(0, limit).map((a) => clean(a.textContent)).filter(Boolean);
  const invalid: { label: string; message: string }[] = [];
  for (const el of Array.from(document.querySelectorAll('input, select, textarea'))) {
    let bad = false;
    try { bad = el.matches(':user-invalid'); } catch { bad = false; }
    if (bad) invalid.push({ label: labelFor(el) || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('name')), message: clean((el as HTMLInputElement).validationMessage) });
    if (invalid.length >= 6) break;
  }
  const mainText = (document.querySelector('main') ?? document.body)?.innerText ?? '';
  const limits = new Set<string>();
  const LIMIT_RES = [
    /\b(?:max(?:imum)?|at most|up to|no more than|limit(?:ed)? to|not exceed(?:ing)?)\s*(?:of\s+)?:?\s*\d[\d,.]*\s*[A-Za-z%]*/gi,
    /\b(?:min(?:imum)?|at least|no fewer than|no less than)\s*(?:of\s+)?:?\s*\d[\d,.]*\s*[A-Za-z%]*/gi,
    /\bbetween\s+\d[\d,.]*\s+and\s+\d[\d,.]*\s*[A-Za-z%]*/gi,
    /\b\d[\d,.]*\s*(?:characters?|chars|items?|files?|guests?|people|seats?|MB|KB|GB|words?)\s+(?:max(?:imum)?|min(?:imum)?|or (?:less|fewer|more))\b/gi,
  ];
  const sample = (document.body?.innerText ?? '').slice(0, 20_000);
  for (const re of LIMIT_RES) for (const m of sample.matchAll(re)) { if (limits.size < 8) limits.add(clean(m[0]).slice(0, 80)); }
  const tables = Array.from(document.querySelectorAll('table')).slice(0, 3).flatMap((tb) =>
    Array.from(tb.querySelectorAll('tr')).slice(0, 12).map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => clean(c.textContent))));
  return {
    title: document.title,
    headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 10).map((h) => clean(h.textContent)),
    alerts: textOf('[role=alert],[role=status],.error,.notice,.alert'),
    errors: textOf('[role=alert],.error,.alert-danger,.alert-error,.invalid-feedback,.field-error,.form-error'),
    notices: textOf('[role=status],.notice,.success,.alert-success,.toast'),
    invalid,
    statedLimits: [...limits],
    forms: forms.map((f, index) => ({ index, action: f.getAttribute('action') ?? '', method: (f.getAttribute('method') ?? 'get').toLowerCase(), noValidate: f.noValidate })),
    elements: out,
    tables,
    text: clean(mainText).slice(0, 1200),
    viewport: { width: vw, height: vh },
    scroll: { y: Math.round(window.scrollY), maxY: Math.max(0, document.documentElement.scrollHeight - vh) },
  };
}

export async function observe(page: Page, version: number): Promise<Observation> {
  const data = await page.evaluate(instrument, version);
  const url = new URL(page.url());
  return { version, url: page.url(), path: `${url.pathname}${url.search}`, ...(data as Omit<Observation, 'version' | 'url' | 'path'>) };
}

/** A rule the page states about one of its own inputs (or in visible text). Candidate rule, page-stated provenance. */
export type StatedRule = {
  /** The element the rule is attached to, or null for visible text. */
  ref: string | null;
  field: string;
  rule: 'required' | 'maxlength' | 'minlength' | 'min' | 'max' | 'step' | 'pattern' | 'type' | 'text';
  value: string;
  snapshot: number;
};

const TYPED_INPUTS = new Set(['email', 'url', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'tel', 'range']);

/** Every rule the page states in this snapshot, derived only from the observation (no browser access). */
export function statedRules(o: Observation): StatedRule[] {
  const out: StatedRule[] = [];
  for (const e of o.elements) {
    if (!(e.kind === 'input' || e.kind === 'textarea' || e.kind === 'select' || e.kind === 'widget' || e.kind === 'checkbox')) continue;
    const add = (rule: StatedRule['rule'], value: string) => out.push({ ref: e.ref, field: e.label || e.name || e.ref, rule, value, snapshot: o.version });
    if (e.required) add('required', 'true');
    if (e.maxLength !== undefined) add('maxlength', String(e.maxLength));
    if (e.minLength !== undefined) add('minlength', String(e.minLength));
    if (e.min !== undefined) add('min', e.min);
    if (e.max !== undefined) add('max', e.max);
    if (e.step !== undefined && e.step !== 'any') add('step', e.step);
    if (e.pattern) add('pattern', e.pattern);
    if (e.type && TYPED_INPUTS.has(e.type)) add('type', e.type);
  }
  for (const t of o.statedLimits ?? []) out.push({ ref: null, field: '(page text)', rule: 'text', value: t, snapshot: o.version });
  return out;
}

/** Render an observation as compact text for the model. Page text is untrusted and delimited. */
export function formatObservation(o: Observation): string {
  const lines: string[] = [];
  lines.push(`PAGE v${o.version}: ${o.path}  title="${o.title}"  viewport=${o.viewport.width}x${o.viewport.height} scrollY=${o.scroll.y}/${o.scroll.maxY}`);
  if (o.headings.length) lines.push(`headings: ${o.headings.map((h) => JSON.stringify(h)).join(' | ')}`);
  if (o.alerts.length) lines.push(`messages: ${o.alerts.map((h) => JSON.stringify(h)).join(' | ')}`);
  if (o.invalid?.length) lines.push(`browser marks invalid: ${o.invalid.map((i) => `${JSON.stringify(i.label)} (${i.message})`).join(' | ')}`);
  if (o.statedLimits?.length) lines.push(`limits stated in page text: ${o.statedLimits.map((t) => JSON.stringify(t)).join(' | ')}`);
  for (const f of o.forms) lines.push(`form#${f.index} ${f.method.toUpperCase()} ${f.action}${f.noValidate ? ' novalidate' : ''}`);
  for (const e of o.elements) {
    const attrs = [
      e.role && `role=${e.role}`, e.type && `type=${e.type}`, e.name && `name=${e.name}`, e.required && 'required',
      e.min !== undefined && `min=${e.min}`, e.max !== undefined && `max=${e.max}`, e.step !== undefined && `step=${e.step}`,
      e.minLength && `minlength=${e.minLength}`, e.maxLength && `maxlength=${e.maxLength}`, e.pattern && `pattern=${JSON.stringify(e.pattern)}`,
      e.disabled && 'disabled', e.checked !== undefined && (e.checked ? 'checked' : 'unchecked'), e.draggable && 'draggable',
      e.value && `value=${JSON.stringify(e.value)}`, e.href && `href=${e.href}`, e.form !== undefined && `form#${e.form}`,
      e.region && `in=${e.region}`, !e.inViewport && 'offscreen',
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

/** Path with numeric ids folded, e.g. /bookings/12/edit -> /bookings/:id/edit. */
export function routePattern(url: string): string {
  try { return new URL(url).pathname.replace(/\/\d+(?=\/|$)/g, '/:id'); } catch { return url; }
}

/** Stable state fingerprint: route pattern + actor + device + headings + form signature. No IDs, no values. */
export function stateFingerprint(o: Observation, actor: string, device: string): { fingerprint: string; route: string } {
  const route = routePattern(o.url);
  // Pointer-only "clickable" guesses are excluded so a re-render does not create a new state.
  const formSig = o.elements.filter((e) => e.kind !== 'link' && e.kind !== 'clickable').map((e) => `${e.kind}:${e.name ?? e.label}`).sort().join(',');
  const raw = `${route}|${actor}|${device}|${o.headings.map((h) => h.replace(/\d+/g, '#')).join('/')}|${formSig}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  return { fingerprint: `${route}#${(h >>> 0).toString(36)}`, route };
}
