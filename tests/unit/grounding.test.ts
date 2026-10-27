// Grounding a model's report in what Oddhound observed, so a misremembered button label or a missing
// valid example does not cost the run extra model turns (seen in demo run 3b7bb863).
import { describe, expect, it } from 'vitest';
import { groundCandidate, scenarioProblems, type Recorded } from '../../packages/core/agent/execute-run.ts';

const recorded = (): Recorded => ({
  auth: null,
  labelsByPath: new Map([['/bookings/new', new Set(['Guest name', 'Party size', 'Date'])]]),
  controlsByPath: new Map([['/bookings/new', new Set(['My bookings', 'Log out', 'Book table'])]]),
  submitByPath: new Map([['/bookings/new', 'Book table']]),
  acceptedByPath: new Map([['/bookings/new', new Map([['Party size', new Set(['0', '4'])], ['Guest name', new Set(['Ana'])]])]]),
});

const report = (controlValues?: Record<string, string>) => ({
  title: 'Party size 0 accepted', ruleId: 'R1', impact: 'medium' as const, observed: 'Booking with 0 guests was saved',
  actor: 'A', device: 'desktop',
  controlValues,
  scenario: {
    kind: 'form_rule' as const, device: 'desktop' as const,
    form: { path: '/bookings/new', fields: { 'Guest name': '{marker}', 'Party size': '0', Date: '2026-12-01' }, submit: 'Create booking' },
    testedField: 'Party size', expectation: 'rejected' as const, listPath: '/bookings',
  },
});

describe('report grounding', () => {
  it('uses the submit button Oddhound saw clicked and a value the form accepted', () => {
    const g = groundCandidate(report(), recorded());
    expect(g.scenario.kind === 'form_rule' && g.scenario.form.submit).toBe('Book table');
    expect(g.controlValues).toEqual({ 'Party size': '4' }); // never the tested bad value '0'
    expect(scenarioProblems(g, recorded())).toEqual([]);
  });

  it('keeps the model\'s own control value and a submit label that was seen', () => {
    const r = report({ 'Party size': '2' });
    r.scenario.form.submit = 'Book';
    const g = groundCandidate(r, recorded());
    expect(g.scenario.kind === 'form_rule' && g.scenario.form.submit).toBe('Book');
    expect(g.controlValues).toEqual({ 'Party size': '2' });
  });

  it('still asks for a valid value when the form never accepted one', () => {
    const rec = recorded(); rec.acceptedByPath = new Map();
    const g = groundCandidate(report(), rec);
    expect(g.controlValues).toBeUndefined();
    expect(scenarioProblems(g, rec).join(' ')).toMatch(/control_values/);
  });
});
