// Boundary values generated in code from the rule a page states for a field (MVP §8 item 6).
// The model only chooses the family, e.g. fill value "{past:max}"; Oddhound computes the value
// from the field's own min/max/minlength/maxlength in the observation the model acted on.
// Values are typed like a user would type them: nothing edits the page's HTML or removes its
// constraints, so a value the browser refuses is the stated rule holding.

import type { ObservedElement } from '../browser/snapshot.ts';

export const BOUNDARY_TEMPLATE = /^\{(?:(on|past):(maxlength|minlength|max|min)|(blank|spaces))\}$/;

export type BoundaryResolution = { value: string; stated: string | null } | { error: string };

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function decimals(n: string): number { return n.includes('.') ? n.split('.')[1]!.length : 0; }

export function isBoundaryTemplate(value: string): boolean { return BOUNDARY_TEMPLATE.test(value); }

export function resolveBoundary(template: string, el: ObservedElement): BoundaryResolution {
  const m = BOUNDARY_TEMPLATE.exec(template);
  if (!m) return { error: `not a boundary template: ${template}` };
  if (m[3] === 'blank') return { value: '', stated: el.required ? 'required' : null };
  if (m[3] === 'spaces') return { value: '   ', stated: el.required ? 'required' : null };
  const side = m[1] as 'on' | 'past';
  const rule = m[2] as 'maxlength' | 'minlength' | 'max' | 'min';
  const field = JSON.stringify(el.label || el.name || el.ref);
  if (rule === 'maxlength' || rule === 'minlength') {
    const n = rule === 'maxlength' ? el.maxLength : el.minLength;
    if (n === undefined) return { error: `${field} states no ${rule}` };
    const len = side === 'on' ? n : rule === 'maxlength' ? n + 1 : Math.max(0, n - 1);
    return { value: 'x'.repeat(Math.min(len, 5000)), stated: `${rule}=${n}` };
  }
  const bound = rule === 'max' ? el.max : el.min;
  if (bound === undefined || bound === '') return { error: `${field} states no ${rule}` };
  const outward = rule === 'max' ? 1 : -1;
  if (el.type === 'date') {
    const v = side === 'on' ? bound : addDays(bound, outward);
    return v ? { value: v, stated: `${rule}=${bound}` } : { error: `${field} has a ${rule} that is not a date (${bound})` };
  }
  const b = Number(bound);
  if (!Number.isFinite(b)) return { error: `${field} has a non-numeric ${rule} (${bound})` };
  const step = el.step && el.step !== 'any' && Number(el.step) > 0 ? Number(el.step) : 1;
  const v = side === 'on' ? b : b + outward * step;
  const places = Math.max(decimals(bound), el.step ? decimals(el.step) : 0);
  return { value: v.toFixed(places), stated: `${rule}=${bound}` };
}
