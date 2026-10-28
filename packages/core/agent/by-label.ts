// Find the control a batch step names by its visible label, on the page as it is when the step runs.
// Only an unambiguous match is used; anything else stops the batch with the labels that are there.
import type { ElementKind, ObservedElement } from '../browser/snapshot.ts';

/** Which element kinds each tool can act on. */
const KINDS: Record<string, ElementKind[]> = {
  click: ['button', 'link', 'checkbox', 'widget', 'clickable', 'draggable'],
  fill: ['input', 'textarea', 'editable', 'widget'],
  fill_credential: ['input'],
  select_option: ['select', 'widget'],
};

const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[\s*:]+$/, '').trim().toLowerCase();

export function findByLabel(elements: ObservedElement[], tool: string, label: string): { ref: string } | { error: string } {
  const kinds = KINDS[tool];
  if (!kinds) return { error: `${tool} cannot target a control` };
  const usable = elements.filter((e) => kinds.includes(e.kind));
  const want = norm(label);
  const tiers: ((e: ObservedElement) => boolean)[] = [
    (e) => e.label.trim() === label.trim(), // exact text
    (e) => norm(e.label) === want, // same text ignoring case, spacing and a trailing "*" or ":"
    (e) => !!e.name && e.name.toLowerCase() === want, // the field's name attribute
    (e) => want.length >= 3 && norm(e.label).includes(want), // a longer label containing it ("Party size (1-8)")
  ];
  for (const tier of tiers) {
    let hits = usable.filter(tier);
    // A button and a link with the same text: a click means the button (the form's own control).
    if (hits.length > 1 && tool === 'click') { const buttons = hits.filter((e) => e.kind === 'button'); if (buttons.length === 1) hits = buttons; }
    if (hits.length === 1) return { ref: hits[0]!.ref };
    if (hits.length > 1) return { error: `${hits.length} controls are labelled "${label}" on this page; use a ref from the observation` };
  }
  const seen = [...new Set(usable.map((e) => e.label).filter(Boolean))].slice(0, 12).map((l) => JSON.stringify(l)).join(', ');
  return { error: `no control labelled "${label}" on this page${seen ? ` (labels here: ${seen})` : ''}` };
}

/** True when a batch step points at a control by ref (planned on the page the batch started from). */
export function usesRef(step: Record<string, unknown>): boolean {
  return typeof step.ref === 'string' || typeof step.target === 'string';
}
