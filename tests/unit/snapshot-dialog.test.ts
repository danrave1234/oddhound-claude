import { describe, it, expect } from 'vitest';
import { formatObservation, type Observation, type ObservedElement } from '../../packages/core/browser/snapshot.ts';

const el = (ref: string, label: string, extra: Partial<ObservedElement> = {}): ObservedElement =>
  ({ ref, kind: 'button', label, inViewport: true, hasAccessibleName: true, ...extra }) as ObservedElement;

const obs = (elements: ObservedElement[]): Observation => ({
  version: 1, url: 'https://a.test/room', path: '/room', title: 'Room', headings: [], alerts: [], errors: [], notices: [],
  invalid: [], statedLimits: [], forms: [], elements, tables: [], text: '', viewport: { width: 1440, height: 900 }, scroll: { y: 0, maxY: 0 },
});

describe('observation with a dialog open', () => {
  it('lists the dialog first, names its close button and folds the covered controls behind it', () => {
    const text = formatObservation(obs([
      el('e1', 'Pin note', { coveredBy: 'a dialog "Your library"' }),
      el('e2', 'New shelf', { coveredBy: 'a dialog "Your library"' }),
      el('e3', 'Notes', { region: 'nav' }),
      el('e4', 'Open note', { region: 'dialog' }),
      el('e5', 'Close', { region: 'dialog' }),
    ]));
    expect(text).toMatch(/DIALOG OPEN: 2 control\(s\) inside it are listed first\. 2 control\(s\) behind it are covered and left out\. Act inside the dialog, or close it with \[e5\] "Close"/);
    const lines = text.split('\n');
    expect(lines.findIndex((l) => l.startsWith('[e4]'))).toBeLessThan(lines.findIndex((l) => l.startsWith('[e3]')));
    expect(text).not.toMatch(/\[e1\]|\[e2\]/);
    expect(text).toMatch(/\[e3\] button "Notes"/); // not covered: still listed
  });
  it('changes nothing when no dialog is open', () => {
    const text = formatObservation(obs([el('e1', 'Save'), el('e2', 'Pin', { coveredBy: 'a <div>' })]));
    expect(text).not.toMatch(/DIALOG OPEN/);
    expect(text).toMatch(/\[e2\] button "Pin" COVERED_BY/);
  });
});
