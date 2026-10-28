// Behavioral test families: the deciding code (no browser, no database). Exploration, replay and retest
// all call these functions, so each verdict below is the one a real run would reach.
import { describe, it, expect } from 'vitest';
import { CLAIM_WINDOW_MS, claimVisible, distinctiveValues, judgeCrossActor, judgePersistence, judgeTwoTabs, swapId, valueShown, type PageView } from '../../packages/core/verifier/behavior.ts';
import { claimDelays, controlFor, ScenarioSchema, scenarioHash } from '../../packages/core/verifier/scenario.ts';
import { ToolArgs, toolDefinitionsFor } from '../../packages/core/agent/tools.ts';
import { BASELINE_RULES } from '../../packages/core/contracts/contract.ts';
import { fixBriefMarkdown } from '../../packages/core/reports/fix-brief.ts';
import { playwrightTest } from '../../packages/core/reports/playwright-export.ts';

const v = (text: string, values: string[] = [], path = '/x'): PageView => ({ path, text, values });

describe('family 1: claim vs. truth', () => {
  it('a claim counts only when it is on the page', () => {
    expect(claimVisible('Changes saved.', 'Booking #3\nChanges  saved.\nGuest')).toBe(true);
    expect(claimVisible('Profile updated', 'Booking #3 Guest')).toBe(false);
    expect(claimVisible('x', 'x')).toBe(false); // too short to mean anything
  });
  it('a saved value may be shown as text or as a form value, case and spacing aside', () => {
    expect(valueShown('Window seat', v('Notes: window   SEAT'))).toBe(true);
    expect(valueShown('Window seat', v('', ['Window seat']))).toBe(true);
    expect(valueShown('Window seat', v('Notes: aisle', ['aisle']))).toBe(false);
  });
  it('a value missing from every reopened page is missing; one found anywhere is found', () => {
    const checks = [{ field: 'Notes', value: 'Edited note Z9' }, { field: 'Guest name', value: 'Ann Q7' }];
    const r = judgePersistence(checks, [v('Guest Ann Q7 Notes Old note', [], '/bookings/1?saved=1'), v('', ['Ann Q7', 'Old note'], '/bookings/1/edit')]);
    expect(r.missing).toEqual([{ field: 'Notes', value: 'Edited note Z9' }]);
    expect(r.found).toEqual([{ field: 'Guest name', path: '/bookings/1?saved=1' }]);
    expect(judgePersistence(checks, [v('Ann Q7 Edited note Z9')]).missing).toEqual([]);
  });
  it('the bounded window is fixed and recorded with the scenario', () => {
    expect(CLAIM_WINDOW_MS).toBe(4_500);
    expect(claimDelays(4_500)).toEqual([0, 1_500, 3_000]);
    expect(claimDelays(0)).toEqual([0]);
  });
  it('B11 is a published baseline rule; the model cannot write a claim_check itself', () => {
    expect(BASELINE_RULES.find((r) => r.id === 'B11')?.text).toMatch(/says a change was saved/);
    expect(ToolArgs.check_claim.safeParse({ claim: 'Saved', fields: ['Bio'] }).success).toBe(true);
    expect(ToolArgs.check_claim.safeParse({ fields: [] }).success).toBe(false);
    expect(ToolArgs.check_claim.safeParse({ fields: ['Bio'], revisit_path: 'https://evil.example/' }).success).toBe(false);
    expect(toolDefinitionsFor('batch').map((t) => t.function.name)).toEqual(expect.arrayContaining(['check_claim', 'check_cross_actor']));
  });
});

describe('family 2: cross-actor access', () => {
  const protect = [{ field: 'Guest name', value: 'Harbor Guest Q7' }];
  const owner = v('Booking #1 Guest Harbor Guest Q7 Cancel booking', [], '/bookings/1');
  const home = v('Harbor Table Log in', [], '/');
  const list = v('My bookings You have no bookings yet.', [], '/bookings');
  it('B seeing A\'s own text on A\'s record, while B\'s list does not show it, is a failure with privacy established', () => {
    const r = judgeCrossActor(protect, { ownerView: owner, otherHome: home, otherList: list, otherView: v('Booking #1 Guest Harbor Guest Q7', [], '/bookings/1') });
    expect(r).toMatchObject({ outcome: 'failed', privacyEstablished: true, leaked: ['Guest name'] });
  });
  it('a 404 for B passes (the control)', () => {
    expect(judgeCrossActor(protect, { ownerView: owner, otherHome: home, otherList: list, otherView: v('Booking not found', [], '/bookings/1/edit') }).outcome).toBe('passed');
  });
  it('cannot judge when A cannot see its own record, or B sees the text anyway', () => {
    expect(judgeCrossActor(protect, { ownerView: v('Booking not found'), otherHome: home, otherView: v('Harbor Guest Q7') }).outcome).toBe('inconclusive');
    expect(judgeCrossActor(protect, { ownerView: owner, otherHome: v('Welcome Harbor Guest Q7'), otherView: v('Harbor Guest Q7') }).outcome).toBe('inconclusive');
    expect(judgeCrossActor([], { ownerView: owner, otherHome: home, otherView: owner }).outcome).toBe('inconclusive');
  });
  it('a record B\'s own list also shows is not established as private', () => {
    const r = judgeCrossActor(protect, { ownerView: owner, otherHome: home, otherList: v('All bookings: Harbor Guest Q7'), otherView: owner });
    expect(r).toMatchObject({ outcome: 'failed', privacyEstablished: false });
  });
  it('a control B pressed that changed A\'s record is a failure; numbers and times are not a change', () => {
    const after = v('Booking #1 Guest Harbor Guest Q7 Status cancelled');
    const r = judgeCrossActor(protect, { ownerView: owner, otherHome: home, otherList: list, otherView: v('nothing here'), afterControls: [{ control: 'Cancel booking', clicked: true, ownerAfter: after }] });
    expect(r).toMatchObject({ outcome: 'failed', changedBy: ['Cancel booking'], leaked: [] });
    const same = judgeCrossActor(protect, { ownerView: owner, otherHome: home, otherList: list, otherView: v('nothing'), afterControls: [{ control: 'Refresh', clicked: true, ownerAfter: v('Booking #2 Guest Harbor Guest Q7 Cancel booking') }] });
    expect(same.outcome).toBe('passed');
  });
  it('only distinctive free text counts as A\'s content', () => {
    expect(distinctiveValues({ 'Guest name': 'Harbor Guest Q7', 'Party size': '2', Date: '2026-11-04', Email: 'a@b.test', Notes: 'ok', Tpl: '{name}' }))
      .toEqual([{ field: 'Guest name', value: 'Harbor Guest Q7' }]);
  });
  it('record numbers become template variables in paths and queries', () => {
    expect(swapId('/bookings/12/edit', '12', '{id}')).toBe('/bookings/{id}/edit');
    expect(swapId('/bookings?created=12&x=120', '12', '{id}')).toBe('/bookings?created={id}&x=120');
    expect(swapId('/bookings/120', '12', '{id}')).toBe('/bookings/120');
  });
  it('check_cross_actor takes a path and at most two controls', () => {
    expect(ToolArgs.check_cross_actor.safeParse({ path: '/bookings/1', try_controls: ['Cancel booking'] }).success).toBe(true);
    expect(ToolArgs.check_cross_actor.safeParse({ path: '/bookings/1', try_controls: ['a', 'b', 'c'] }).success).toBe(false);
  });
});

describe('family 2: same actor, two tabs', () => {
  const base = { original: { first: 'Ann', second: '2' }, wanted: { first: 'Bea', second: '5' }, firstRejected: false, staleRejected: false };
  it('a stale save that puts back the old value with no message is a lost update', () => {
    const r = judgeTwoTabs({ ...base, final: { first: 'Ann', second: '5' } });
    expect(r.outcome).toBe('failed');
    expect(r.detail).toMatch(/put back "Ann" with no message/);
  });
  it('refusing the stale save, or keeping both changes, passes', () => {
    expect(judgeTwoTabs({ ...base, staleRejected: true, final: { first: 'Bea', second: '2' } }).outcome).toBe('passed');
    expect(judgeTwoTabs({ ...base, final: { first: 'Bea', second: '5' } }).outcome).toBe('passed');
  });
  it('cannot judge when nothing could be lost or the end state is unexplained', () => {
    expect(judgeTwoTabs({ ...base, wanted: { first: 'Ann', second: '5' }, final: { first: 'Ann', second: '5' } }).outcome).toBe('inconclusive');
    expect(judgeTwoTabs({ ...base, firstRejected: true, final: { first: 'Ann', second: '5' } }).outcome).toBe('inconclusive');
    expect(judgeTwoTabs({ ...base, final: { first: 'Zed', second: '9' } }).outcome).toBe('inconclusive');
  });
  it('the control is the same two edits in one tab, and the tool takes two fields', () => {
    const s = ScenarioSchema.parse({ kind: 'two_tab', device: 'desktop', setup: { path: '/b/new', fields: { Name: 'x' }, submit: 'Save' }, path: '/b/{id}/edit', first: { field: 'Name', value: 'Bea' }, second: { field: 'Size', value: '5' }, sequential: false, expectation: 'no_lost_update' });
    expect(controlFor(s)).toMatchObject({ kind: 'two_tab', sequential: true });
    expect(controlFor({ ...s, sequential: true } as typeof s)).toBeNull();
    expect(ToolArgs.check_two_tabs.safeParse({ path: '/b/1/edit', first: { field: 'Name', value: 'Bea' }, second: { field: 'Size', value: '5' } }).success).toBe(true);
  });
});

describe('family scenarios are fixed records with reports from trusted templates', () => {
  const setup = { path: '/bookings/new', fields: { 'Guest name': 'Harbor Guest Q7', Notes: 'Window seat Q7' }, submit: 'Book table' };
  const auth = { kind: 'register' as const, path: '/register', fields: { 'Full name': '{name}', Email: '{email}', Password: '{password}' }, submit: 'Create account', successText: 'Log out' };
  const claim = ScenarioSchema.parse({
    kind: 'claim_check', device: 'desktop', auth, setup, start: '/bookings/{id}/edit',
    steps: [{ op: 'fill', field: 'Notes', value: 'Edited Z9' }, { op: 'click', target: 'Save changes', role: 'button' }],
    claim: 'Changes saved.', checks: [{ field: 'Notes', value: 'Edited Z9' }], revisit: ['/bookings/{id}/edit'], windowMs: 4_500,
  });
  const cross = ScenarioSchema.parse({ kind: 'cross_actor', device: 'desktop', auth, setup, path: '/bookings/{id}', listPath: '/bookings', protect: ['Guest name'], controls: [], expectation: 'denied' });
  it('hashes are stable', () => {
    expect(scenarioHash(claim)).toBe(scenarioHash(structuredClone(claim)));
    expect(scenarioHash(cross)).not.toBe(scenarioHash(claim));
  });
  it('the exported test embeds values as JSON and checks the claim and the leak', () => {
    const t1 = playwrightTest(claim, { title: 'claim', scenarioId: '00000000-0000-0000-0000-000000000000', assertionHash: scenarioHash(claim) });
    expect(t1).toContain('toContainText("Changes saved.")');
    expect(t1).toContain('toPass({ timeout: 9500 })');
    const t2 = playwrightTest(cross, { title: 'cross', scenarioId: '00000000-0000-0000-0000-000000000000', assertionHash: scenarioHash(cross) });
    expect(t2).toContain('async ({ page, browser })');
    expect(t2).toContain('not.toContainText(v)');
  });
  it('the fix brief separates observation from hypothesis for both kinds', () => {
    const brief = (s: typeof claim) => fixBriefMarkdown({
      finding: { id: 'f', title: 't', category: 'verified_issue', verification: 'verified', lifecycle: 'open', impact: 'high', confidence: 'reproduced 2/2', ruleId: 'B11', ruleSource: 'Oddhound baseline rule B11', expected: 'x', observed: 'y', device: 'desktop', actor: 'A', limitations: '' },
      target: { origin: 'https://site.example', environment: 'staging' }, scenario: { id: 's', assertion: s, assertionHash: scenarioHash(s) }, control: null, executions: [], evidenceCount: 0,
    });
    expect(brief(claim)).toMatch(/Check that the page says "Changes saved\."/);
    expect(brief(claim)).toMatch(/hypotheses, not verified root causes/);
    expect(brief(cross)).toMatch(/open exactly `\/bookings\/\{id\}`/);
  });
});
