// Batch steps that name a control by its label (demo run 83c5e186 lost 4 of 19 batches to refs that
// no longer existed after the page changed).
import { describe, expect, it } from 'vitest';
import { findByLabel } from '../../packages/core/agent/by-label.ts';
import { BatchStepSchema } from '../../packages/core/agent/tools.ts';
import type { ObservedElement } from '../../packages/core/browser/snapshot.ts';

const el = (e: Omit<ObservedElement, 'inViewport' | 'hasAccessibleName'>): ObservedElement => ({ inViewport: true, hasAccessibleName: true, ...e });
const page: ObservedElement[] = [
  el({ ref: 'e1', kind: 'link', label: 'My bookings' }),
  el({ ref: 'e2', kind: 'link', label: 'Book table' }),
  el({ ref: 'e3', kind: 'input', label: 'Guest name', name: 'guest_name' }),
  el({ ref: 'e4', kind: 'input', label: 'Party size *', name: 'party_size', type: 'number' }),
  el({ ref: 'e5', kind: 'input', label: 'Date', name: 'date', type: 'date' }),
  el({ ref: 'e6', kind: 'button', label: 'Book table' }),
  el({ ref: 'e7', kind: 'button', label: 'Cancel' }),
  el({ ref: 'e8', kind: 'button', label: 'Cancel' }),
];

describe('findByLabel', () => {
  it('finds a field by its visible label, ignoring a trailing asterisk and case', () => {
    expect(findByLabel(page, 'fill', 'Party size')).toEqual({ ref: 'e4' });
    expect(findByLabel(page, 'fill', 'guest NAME')).toEqual({ ref: 'e3' });
  });
  it('falls back to the name attribute', () => {
    expect(findByLabel(page, 'fill', 'party_size')).toEqual({ ref: 'e4' });
  });
  it('prefers the form button over a link with the same text when clicking', () => {
    expect(findByLabel(page, 'click', 'Book table')).toEqual({ ref: 'e6' });
  });
  it('never fills a button and never clicks a text field', () => {
    expect('error' in findByLabel(page, 'fill', 'Cancel')).toBe(true);
    expect('error' in findByLabel(page, 'click', 'Guest name')).toBe(true);
  });
  it('refuses an ambiguous label instead of guessing', () => {
    expect(findByLabel(page, 'click', 'Cancel')).toEqual({ error: expect.stringMatching(/2 controls/) });
  });
  it('lists the labels that are there when nothing matches', () => {
    const r = findByLabel(page, 'fill', 'Email');
    expect('error' in r && r.error).toMatch(/Guest name/);
  });
});

describe('batch step schema', () => {
  it('accepts a label in place of a ref', () => {
    expect(BatchStepSchema.safeParse({ tool: 'fill', label: 'Party size', value: '0' }).success).toBe(true);
    expect(BatchStepSchema.safeParse({ tool: 'click', label: 'Book table', expect: { outcome: 'rejected' } }).success).toBe(true);
    expect(BatchStepSchema.safeParse({ tool: 'click', ref: 'e6' }).success).toBe(true);
  });
});

describe('usesRef', () => {
  it('only steps that point at a control by ref need the model to look at a new page first', async () => {
    const { usesRef } = await import('../../packages/core/agent/by-label.ts');
    expect(usesRef({ tool: 'fill', ref: 'e4', value: '0' })).toBe(true);
    expect(usesRef({ tool: 'drag', ref: 'e1', target: 'e2' })).toBe(true);
    expect(usesRef({ tool: 'fill', label: 'Party size', value: '0' })).toBe(false);
    expect(usesRef({ tool: 'navigate', path: '/bookings' })).toBe(false);
  });
});
