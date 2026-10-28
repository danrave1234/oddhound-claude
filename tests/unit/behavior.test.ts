// Behavioral test families: the deciding code (no browser, no database). Exploration, replay and retest
// all call these functions, so each verdict below is the one a real run would reach.
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { CLAIM_WINDOW_MS, NUMBER_ASSUMPTIONS, claimVisible, controlKey, distinctiveValues, judgeCrossActor, judgeDifferential, judgeInterruption, judgeInvariant, occurrences, judgePersistence, judgeTwoTabs, labelledNumber, parseNumber, swapId, valueShown, type PageView } from '../../packages/core/verifier/behavior.ts';
import { claimDelays, controlFor, ScenarioSchema, scenarioHash } from '../../packages/core/verifier/scenario.ts';
import { ToolArgs, toolDefinitionsFor } from '../../packages/core/agent/tools.ts';
import { BASELINE_RULES } from '../../packages/core/contracts/contract.ts';
import { familyCandidateKey } from '../../packages/core/agent/execute-run.ts';
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

describe('family 3: invariants (numbers parsed by code)', () => {
  it('reads exactly one number, with thousands separators, currency and units', () => {
    expect(parseNumber('$1,234.50')).toBe(1234.5);
    expect(parseNumber('7 guests')).toBe(7);
    expect(parseNumber('−3')).toBe(-3);
    expect(parseNumber('2 of 8')).toBeNull(); // ambiguous
    expect(parseNumber('none')).toBeNull();
    expect(labelledNumber('Bookings: 3 · Total guests: 7', 'Total guests')).toBe(7);
    expect(labelledNumber('Order total = €12.40', 'order total')).toBe(12.4);
    expect(labelledNumber('Total guests', 'Total guests')).toBeNull();
  });
  const tables = [{ headers: ['Booking', 'Guest', 'Party'], rows: [['#1', 'Ann', '2'], ['#2', 'Bo', '3']] }];
  it('a total that is not the sum of its column fails; the right total passes', () => {
    const bad = judgeInvariant({ kind: 'sum', total: 'Total guests', column: 'Party' }, { text: 'Bookings: 2 · Total guests: 3', tables });
    expect(bad).toMatchObject({ outcome: 'failed', values: { total: 3, parts: [2, 3], computed: 5 } });
    expect(bad.detail).toMatch(/\(2 \+ 3\) add up to 5/);
    expect(judgeInvariant({ kind: 'sum', total: 'Total guests', column: 'Party' }, { text: 'Total guests: 5', tables }).outcome).toBe('passed');
  });
  it('a count compares with the rows; a total row in the table is not a part', () => {
    expect(judgeInvariant({ kind: 'count', total: 'Bookings' }, { text: 'Bookings: 2', tables }).outcome).toBe('passed');
    expect(judgeInvariant({ kind: 'count', total: 'Bookings' }, { text: 'Bookings: 3', tables }).outcome).toBe('failed');
    const withTotalRow = [{ headers: ['Item', 'Amount'], rows: [['Tea', '$2.10'], ['Cake', '$3.25'], ['Total', '$5.35']] }];
    expect(judgeInvariant({ kind: 'sum', total: 'Total', column: 'Amount' }, { text: '', tables: withTotalRow }).outcome).toBe('passed');
  });
  it('cannot judge without the column, the total, or numeric cells', () => {
    expect(judgeInvariant({ kind: 'sum', total: 'Total guests', column: 'Price' }, { text: 'Total guests: 5', tables }).outcome).toBe('inconclusive');
    expect(judgeInvariant({ kind: 'sum', total: 'Grand total', column: 'Party' }, { text: 'Total guests: 5', tables }).outcome).toBe('inconclusive');
    expect(judgeInvariant({ kind: 'sum', total: 'Total', column: 'Guest' }, { text: 'Total: 5', tables }).outcome).toBe('inconclusive');
    expect(NUMBER_ASSUMPTIONS).toMatch(/0\.005/);
  });
});

describe('family 4: interruption', () => {
  it('counts a distinctive value on the list page', () => {
    expect(occurrences('Retry K4 · retry   k4 · Other', 'Retry K4')).toBe(2);
    expect(occurrences('nothing', 'Retry K4')).toBe(0);
  });
  it('two records from one interrupted submit is a duplicate; one is fine', () => {
    expect(judgeInterruption({ kind: 'double_submit', before: 0, afterInterruption: 2, claimedWhileOffline: false })).toMatchObject({ outcome: 'failed', created: 2 });
    expect(judgeInterruption({ kind: 'double_submit', before: 1, afterInterruption: 2, claimedWhileOffline: false })).toMatchObject({ outcome: 'passed', created: 1 });
  });
  it('offline: nothing sent, then one normal retry saves one, passes; a success message with nothing saved fails', () => {
    expect(judgeInterruption({ kind: 'offline_submit', before: 0, afterInterruption: 0, afterRetry: 1, claimedWhileOffline: false }).outcome).toBe('passed');
    const claimed = judgeInterruption({ kind: 'offline_submit', before: 0, afterInterruption: 0, afterRetry: 1, claimedWhileOffline: true });
    expect(claimed.outcome).toBe('failed');
    expect(claimed.detail).toMatch(/reported success while offline, but nothing was saved/);
    expect(judgeInterruption({ kind: 'offline_submit', before: 0, afterInterruption: 0, afterRetry: 2, claimedWhileOffline: false }).outcome).toBe('failed');
  });
  it('nothing saved even after a retry cannot be judged; the control is a normal submit', () => {
    expect(judgeInterruption({ kind: 'reload_after_submit', before: 0, afterInterruption: 0, afterRetry: 0, claimedWhileOffline: false }).outcome).toBe('inconclusive');
    const s = ScenarioSchema.parse({ kind: 'interruption', device: 'desktop', form: { path: '/b/new', fields: { Name: 'Retry K4' }, submit: 'Save' }, listPath: '/b', value: 'Retry K4', interruption: 'double_submit' });
    expect(controlFor(s)).toMatchObject({ interruption: 'none' });
    expect(ToolArgs.check_interruption.safeParse({ kind: 'double_submit', submit: 'Save', field: 'Name', list_path: '/b' }).success).toBe(true);
    expect(ToolArgs.check_interruption.safeParse({ kind: 'none', submit: 'Save', field: 'Name', list_path: '/b' }).success).toBe(false);
  });
});

describe('family 5: differential comparison', () => {
  const desk = { context: 'desktop', errors: [], controls: [{ label: 'Edit booking', role: 'link' as const }, { label: 'Cancel booking', role: 'button' as const }, { label: 'Booking #12', role: 'link' as const }] };
  it('a control usable on desktop but absent or covered on the phone is a difference', () => {
    const phone = { context: 'a phone', errors: [], controls: [{ label: 'Cancel booking', role: 'button' as const, covered: true }, { label: 'Booking #13', role: 'link' as const }] };
    const v = judgeDifferential(desk, phone);
    expect(v.outcome).toBe('failed');
    expect(v.missing).toEqual([{ label: 'Edit booking', role: 'link', why: 'absent' }, { label: 'Cancel booking', role: 'button', why: 'covered' }]);
  });
  it('ids and counts in labels are noise, not differences; a named focus limits the comparison', () => {
    const phone = { context: 'a phone', errors: [], controls: [{ label: 'Cancel booking', role: 'button' as const }, { label: 'Booking #99', role: 'link' as const }] };
    expect(judgeDifferential(desk, phone, ['Cancel booking', 'Booking #12']).outcome).toBe('passed');
    expect(controlKey('Booking #12')).toBe(controlKey('booking  #7'));
  });
  it('an error shown in one context only is a difference; nothing to compare is undecided', () => {
    const phone = { context: 'a phone', errors: ['Something went wrong'], controls: desk.controls };
    expect(judgeDifferential(desk, phone).errorsOnlyIn).toEqual(['Something went wrong']);
    expect(judgeDifferential({ ...desk, controls: [] }, phone).outcome).toBe('inconclusive');
  });
});

describe('repeated family problems are merged', () => {
  const tab = (path: string, field: string) => ScenarioSchema.parse({ kind: 'two_tab', device: 'desktop', setup: { path: '/b/new', fields: { Name: 'x' }, submit: 'Save' }, path, first: { field, value: 'v' }, second: { field: 'Size', value: '5' }, sequential: false, expectation: 'no_lost_update' });
  it('same family, rule, check and page (record numbers folded) is one problem', () => {
    const a = familyCandidateKey({ family: 'two_actors', ruleId: 'R6', scenario: tab('/b/{id}/edit', 'Name') });
    expect(familyCandidateKey({ family: 'two_actors', ruleId: 'R6', scenario: tab('/b/{id}/edit', 'Size') })).toBe(a);
    expect(familyCandidateKey({ family: 'two_actors', ruleId: 'R6', scenario: tab('/b/12/edit?x=1', 'Name') })).toBe(a);
  });
  it('another rule, another page or another family stays separate', () => {
    const a = familyCandidateKey({ family: 'two_actors', ruleId: 'R6', scenario: tab('/b/{id}/edit', 'Name') });
    expect(familyCandidateKey({ family: 'two_actors', ruleId: 'lost_update', scenario: tab('/b/{id}/edit', 'Name') })).not.toBe(a);
    expect(familyCandidateKey({ family: 'two_actors', ruleId: 'R6', scenario: tab('/c/{id}/edit', 'Name') })).not.toBe(a);
    expect(familyCandidateKey({ family: 'invariant', ruleId: 'R6', scenario: tab('/b/{id}/edit', 'Name') })).not.toBe(a);
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
  it('every family export is valid TypeScript', () => {
    const scenarios = [claim, cross,
      ScenarioSchema.parse({ kind: 'two_tab', device: 'desktop', auth, setup, path: '/bookings/{id}/edit', first: { field: 'Guest name', value: 'Bea' }, second: { field: 'Party size', value: '5' }, sequential: false, expectation: 'no_lost_update' }),
      ScenarioSchema.parse({ kind: 'invariant', device: 'desktop', auth, setups: [setup], path: '/bookings', invariant: { kind: 'sum', total: 'Total guests', column: 'Party' } }),
      ScenarioSchema.parse({ kind: 'invariant', device: 'desktop', auth, setups: [setup], path: '/bookings', invariant: { kind: 'count', total: 'Bookings' } }),
      ScenarioSchema.parse({ kind: 'differential', device: 'desktop', auth, setup, path: '/bookings/{id}', compare: 'desktop_vs_mobile', controls: [{ label: 'Edit booking', role: 'link' }] }),
      ...(['double_submit', 'offline_submit', 'reload_after_submit', 'none'] as const).map((interruption) => ScenarioSchema.parse({ kind: 'interruption', device: 'desktop', auth, form: { path: '/bookings/new', fields: setup.fields, submit: 'Book table' }, listPath: '/bookings', value: 'Harbor Guest Q7', interruption })),
    ];
    for (const s of scenarios) {
      const code = playwrightTest(s, { title: s.kind, scenarioId: '00000000-0000-0000-0000-000000000000', assertionHash: scenarioHash(s) });
      const out = ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
      expect(out.diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')) ?? [], s.kind).toEqual([]);
    }
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
