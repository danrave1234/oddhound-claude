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

describe('record setup for replays', () => {
  it('replaces the run\'s record number with a record the replay creates itself', async () => {
    const { withRecordSetup } = await import('../../packages/core/agent/execute-run.ts');
    const rec = recorded();
    rec.createdBy = new Map([['4', { path: '/bookings/new', fields: { 'Guest name': 'Ana', 'Party size': '2' }, submit: 'Book table' }]]);
    const r = withRecordSetup('/bookings/4/edit', [
      { step: { op: 'fill' as const, field: 'Party size', value: '0' } },
      { step: { op: 'click' as const, target: 'Save changes', role: 'button' as const }, expect: { outcome: 'rejected' as const, path: '/bookings/4/edit' } },
      { step: { op: 'goto' as const, path: '/bookings/4' } },
    ], rec);
    expect(r.setup?.path).toBe('/bookings/new');
    expect(r.start).toBe('/bookings/{id}/edit');
    expect(r.steps[1]!.expect?.path).toBe('/bookings/:id/edit');
    expect(r.steps[2]!.step).toEqual({ op: 'goto', path: '/bookings/{id}' });
  });

  it('leaves a scenario alone when the run did not create that record', async () => {
    const { withRecordSetup } = await import('../../packages/core/agent/execute-run.ts');
    const r = withRecordSetup('/bookings/7/edit', [{ step: { op: 'back' as const } }], recorded());
    expect(r.setup).toBeUndefined();
    expect(r.start).toBe('/bookings/7/edit');
  });
});

describe('recordIdsInUrl', () => {
  it('reads numbers from the path, then from query values', async () => {
    const { recordIdsInUrl } = await import('../../packages/core/verifier/scenario.ts');
    expect(recordIdsInUrl('https://x.test/bookings?created=4')).toEqual(['4']);
    expect(recordIdsInUrl('https://x.test/bookings/12/edit')).toEqual(['12']);
    expect(recordIdsInUrl('https://x.test/bookings/new')).toEqual([]);
  });
  it('ignores flags and paging in the query (the demo sign-up lands on ?welcome=1)', async () => {
    const { recordIdsInUrl } = await import('../../packages/core/verifier/scenario.ts');
    expect(recordIdsInUrl('https://x.test/bookings?welcome=1')).toEqual([]);
    expect(recordIdsInUrl('https://x.test/notes?page=2&id=7')).toEqual(['7']);
  });
});

describe('exports for a scenario with a setup record', () => {
  it('creates the record, keeps its number and opens the {id} path', async () => {
    const { playwrightTest } = await import('../../packages/core/reports/playwright-export.ts');
    const code = playwrightTest({
      kind: 'batch', device: 'desktop', start: '/bookings/{id}/edit',
      setup: { path: '/bookings/new', fields: { 'Guest name': 'Ana', 'Party size': '2' }, submit: 'Book table' },
      steps: [{ step: { op: 'fill', field: 'Party size', value: '0' } }, { step: { op: 'click', target: 'Save changes', role: 'button' }, expect: { outcome: 'rejected' } }],
      oracleStep: 2,
    }, { title: 'Edit accepts 0', scenarioId: 's1', assertionHash: 'h' });
    expect(code).toContain('await submitForm(page, "/bookings/new"');
    expect(code).toContain(String.raw`/^\d+$/.test(v)`);
    expect(code).toContain('new URL(fill("/bookings/{id}/edit", vars), BASE_URL)');
  });
});
