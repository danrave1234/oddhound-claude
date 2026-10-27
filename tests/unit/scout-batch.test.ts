// Scout, scenario batches and surprise-driven inference: the pure parts (no browser, no database).
import { describe, it, expect } from 'vitest';
import { statedRules, routePattern, type Observation, type ObservedElement } from '../../packages/core/browser/snapshot.ts';
import { resolveBoundary, isBoundaryTemplate } from '../../packages/core/agent/boundary.ts';
import { judgeExpectation, pathMatches, ExpectSchema } from '../../packages/core/verifier/expect.ts';
import { CoverageTracker } from '../../packages/core/agent/coverage.ts';
import { ToolArgs, toolDefinitionsFor, toolOffered, agentModeFromEnv, DEFAULT_AGENT_MODE } from '../../packages/core/agent/tools.ts';
import { ScenarioSchema, scenarioHash, type Scenario } from '../../packages/core/verifier/scenario.ts';
import { BASELINE_RULES } from '../../packages/core/contracts/contract.ts';

const el = (over: Partial<ObservedElement>): ObservedElement => ({ ref: 'e1', kind: 'input', label: 'Field', inViewport: true, hasAccessibleName: true, ...over });
const obs = (over: Partial<Observation> = {}): Observation => ({
  version: 3, url: 'https://site.example/form', path: '/form', title: 'Form', headings: [], alerts: [], errors: [], notices: [], invalid: [],
  statedLimits: [], forms: [], elements: [], tables: [], text: '', viewport: { width: 1440, height: 900 }, scroll: { y: 0, maxY: 0 }, ...over,
});

describe('stated rules (scout)', () => {
  it('lists every rule a field states, with its source element and snapshot', () => {
    const o = obs({
      elements: [
        el({ ref: 'e1', label: 'Party size', type: 'number', required: true, min: '1', max: '8', step: '1' }),
        el({ ref: 'e2', kind: 'textarea', label: 'Notes', maxLength: 200 }),
        el({ ref: 'e3', label: 'Code', pattern: '[A-Z]{3}', minLength: 3 }),
        el({ ref: 'e4', label: 'Email', type: 'email' }),
        el({ ref: 'e5', kind: 'button', label: 'Save' }),
      ],
      statedLimits: ['up to 8 guests'],
    });
    const rules = statedRules(o).map((r) => `${r.ref}:${r.rule}=${r.value}`);
    expect(rules).toEqual(expect.arrayContaining([
      'e1:required=true', 'e1:min=1', 'e1:max=8', 'e1:step=1', 'e1:type=number',
      'e2:maxlength=200', 'e3:pattern=[A-Z]{3}', 'e3:minlength=3', 'e4:type=email', 'null:text=up to 8 guests',
    ]));
    expect(rules.some((r) => r.startsWith('e5'))).toBe(false); // buttons state no input rules
    expect(statedRules(o).every((r) => r.snapshot === 3)).toBe(true);
  });
  it('folds numeric ids out of routes', () => {
    expect(routePattern('https://a.example/bookings/12/edit?x=1')).toBe('/bookings/:id/edit');
  });
});

describe('boundary values come from the stated rule, not the model', () => {
  it('computes on/past values for length, range, step and dates', () => {
    expect(resolveBoundary('{past:maxlength}', el({ maxLength: 10 }))).toEqual({ value: 'x'.repeat(11), stated: 'maxlength=10' });
    expect(resolveBoundary('{on:maxlength}', el({ maxLength: 10 }))).toMatchObject({ value: 'x'.repeat(10) });
    expect(resolveBoundary('{past:minlength}', el({ minLength: 3 }))).toMatchObject({ value: 'xx', stated: 'minlength=3' });
    expect(resolveBoundary('{past:max}', el({ type: 'number', max: '8' }))).toEqual({ value: '9', stated: 'max=8' });
    expect(resolveBoundary('{past:min}', el({ type: 'number', min: '1' }))).toEqual({ value: '0', stated: 'min=1' });
    expect(resolveBoundary('{past:max}', el({ type: 'number', max: '2.5', step: '0.5' }))).toMatchObject({ value: '3.0' });
    expect(resolveBoundary('{past:max}', el({ type: 'date', max: '2026-12-31' }))).toMatchObject({ value: '2027-01-01' });
    expect(resolveBoundary('{past:min}', el({ type: 'date', min: '2026-03-01' }))).toMatchObject({ value: '2026-02-28' });
    expect(resolveBoundary('{spaces}', el({ required: true }))).toEqual({ value: '   ', stated: 'required' });
  });
  it('refuses a template for a rule the field does not state', () => {
    expect(resolveBoundary('{past:max}', el({ label: 'Notes' }))).toEqual({ error: '"Notes" states no max' });
    expect(isBoundaryTemplate('{past:max}')).toBe(true);
    expect(isBoundaryTemplate('{name}')).toBe(false);
    expect(isBoundaryTemplate('past:max')).toBe(false);
  });
});

describe('expectations are judged by trusted code', () => {
  const facts = (o: Partial<Observation>, bodyText = '', pathBefore = '/form') => ({ pathBefore, obs: obs(o), bodyText });
  it('rejected = an error message or a field the browser marks invalid', () => {
    expect(judgeExpectation({ outcome: 'rejected' }, facts({ errors: ['Party size must be at least 1.'] })).ok).toBe(true);
    expect(judgeExpectation({ outcome: 'rejected' }, facts({ invalid: [{ label: 'Party size', message: 'Value must be less than or equal to 8.' }] })).ok).toBe(true);
    const accepted = judgeExpectation({ outcome: 'rejected' }, facts({ url: 'https://site.example/bookings', notices: ['Booking #3 confirmed.'] }));
    expect(accepted).toMatchObject({ ok: false, unclear: false });
    expect(accepted.detail).toMatch(/moved to \/bookings/);
  });
  it('a step where nothing visible happened is undecided, not a pass or a bug', () => {
    expect(judgeExpectation({ outcome: 'rejected' }, facts({}))).toMatchObject({ ok: false, unclear: true });
    expect(judgeExpectation({ outcome: 'accepted' }, facts({}))).toMatchObject({ ok: false, unclear: true });
  });
  it('accepted, text and path checks', () => {
    expect(judgeExpectation({ outcome: 'accepted', text_visible: 'confirmed', path: '/bookings' }, facts({ url: 'https://site.example/bookings?created=1' }, 'Booking #1 confirmed.')).ok).toBe(true);
    expect(judgeExpectation({ text_absent: 'Secret' }, facts({}, 'A Secret note')).ok).toBe(false);
    expect(pathMatches('/bookings/:id', '/bookings/42')).toBe(true);
    expect(pathMatches('/bookings/:id', '/bookings/42/edit')).toBe(false);
    expect(pathMatches('/bookings*', '/bookings/42/edit')).toBe(true);
  });
  it('an empty expectation is refused at validation', () => {
    expect(ExpectSchema.safeParse({}).success).toBe(false);
    expect(ExpectSchema.safeParse({ outcome: 'maybe' }).success).toBe(false);
    expect(ExpectSchema.safeParse({ outcome: 'rejected', extra: 1 }).success).toBe(false);
  });
});

describe('coverage counts only what was exercised, with a stated denominator', () => {
  it('counts controls per observed page, exercised and blocked separately', () => {
    const cov = new CoverageTracker((e) => (e.href?.startsWith('https://other.example') ? 'off_site' : null));
    const page1 = obs({ url: 'https://site.example/bookings/7', elements: [
      el({ ref: 'e1', kind: 'link', label: 'Edit', href: '/bookings/7/edit' }),
      el({ ref: 'e2', kind: 'button', label: 'Cancel booking' }),
      el({ ref: 'e3', kind: 'link', label: 'Partner', href: 'https://other.example/' }),
      el({ ref: 'e4', kind: 'button', label: 'Disabled', disabled: true }),
    ] });
    cov.observe(page1);
    // The same page for another record is the same state: no double counting.
    cov.observe({ ...page1, url: 'https://site.example/bookings/8', version: 4 });
    expect(cov.summary()).toMatchObject({ total: 3, exercised: 0, blocked: 1, pages: 1 });
    expect(cov.exercise(page1, 'e2')).toBe(true);
    expect(cov.exercise(page1, 'e99')).toBe(false);
    const s = cov.summary();
    expect(s).toMatchObject({ total: 3, exercised: 1, blocked: 1 });
    expect(s.routes[0]).toEqual({ route: '/bookings/:id', total: 3, exercised: 1, blocked: 1 });
    expect(s.unexercised.map((u) => u.label)).toEqual(['Edit']);
  });
});

describe('tool contracts', () => {
  const batch = (steps: unknown[]) => ToolArgs.run_scenario_batch.safeParse({ goal: 'party size limits', steps });
  it('a batch holds 1-15 validated steps with optional expectations', () => {
    expect(batch([
      { tool: 'fill', ref: 'e3', value: '{past:max}' },
      { tool: 'click', ref: 'e7', expect: { outcome: 'rejected' } },
      { tool: 'drag', ref: 'e1', target: 'e2', expect: { text_visible: 'Done: Card A' } },
      { tool: 'press_key', key: 'ArrowRight' },
      { tool: 'navigate', path: '/bookings', expect: { path: '/bookings' } },
    ]).success).toBe(true);
    expect(batch(Array.from({ length: 16 }, () => ({ tool: 'scroll', to: 'down' }))).success).toBe(false);
    expect(batch([{ tool: 'set_device', device: 'mobile' }]).success).toBe(false); // context switches are not batch steps
    expect(batch([{ tool: 'run_scenario_batch', goal: 'x', steps: [] }]).success).toBe(false); // no nesting
    expect(batch([{ tool: 'click', ref: 'e1', expect: {} }]).success).toBe(false);
  });
  it('report_candidate accepts a batch reference', () => {
    expect(ToolArgs.report_candidate.safeParse({ title: 'Party size 9 accepted', rule_id: 'B10', impact: 'medium', observed: 'Saved with 9 guests', scenario: { kind: 'batch', batch: 2, step: 3 } }).success).toBe(true);
  });
  it('each agent mode offers exactly its tools', () => {
    const names = (m: Parameters<typeof toolDefinitionsFor>[0]) => toolDefinitionsFor(m).map((t) => t.function.name);
    expect(names('per_step')).not.toEqual(expect.arrayContaining(['do_steps']));
    expect(names('per_step').some((n) => n === 'run_scenario_batch' || n === 'fill_form' || n === 'do_steps')).toBe(false);
    expect(names('batch')).toContain('run_scenario_batch');
    expect(names('batch')).not.toContain('do_steps');
    expect(names('steps')).toContain('do_steps');
    for (const m of ['per_step', 'steps', 'batch'] as const) expect(names(m)).toEqual(expect.arrayContaining(['drag', 'observe', 'click', 'report_candidate', 'finish_run']));
    expect(toolOffered('per_step', 'run_scenario_batch')).toBe(false);
    expect(agentModeFromEnv({ ODDHOUND_AGENT_MODE: 'per_step' })).toBe('per_step');
    expect(agentModeFromEnv({ ODDHOUND_AGENT_MODE: 'nonsense' })).toBe(DEFAULT_AGENT_MODE);
  });
  it('B10 (page-stated rules) ships as a baseline rule', () => {
    expect(BASELINE_RULES.find((r) => r.id === 'B10')?.text).toMatch(/states about its own inputs/);
  });
});

describe('saved batch scenarios are fixed assertions', () => {
  const s: Scenario = {
    kind: 'batch', device: 'desktop', start: '/lax',
    steps: [
      { step: { op: 'fill', field: 'Party size', value: '9' } },
      { step: { op: 'click', target: 'Save', role: 'button' }, expect: { outcome: 'rejected' } },
    ],
    oracleStep: 2,
  };
  it('validates and hashes stably regardless of key order', () => {
    expect(ScenarioSchema.safeParse(s).success).toBe(true);
    const reordered = JSON.parse(JSON.stringify({ oracleStep: 2, steps: s.steps, start: '/lax', device: 'desktop', kind: 'batch' }));
    expect(scenarioHash(reordered)).toBe(scenarioHash(s));
    const changed: Scenario = { ...s, steps: [s.steps[0]!, { ...s.steps[1]!, expect: { outcome: 'accepted' } }] };
    expect(scenarioHash(changed)).not.toBe(scenarioHash(s));
  });
});
