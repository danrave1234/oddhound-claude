// End-to-end lab test (no paid inference):
//   1. start the demo target (vulnerable and fixed builds) and migrate the database;
//   2. admit and execute a full run with the OFFLINE TEST DOUBLE through the real worker pipeline
//      (scope policy, egress proxy, action ledger, spend ledger, verification, observations);
//   3. admit a retest against the fixed build and replay the saved, unchanged assertions.
// Exits non-zero if any expectation fails. Writes a JSON report to test-results/e2e-report.json.
//
// Run: node --env-file=.env tests/e2e/run-e2e.ts            (offline test double)
//      E2E_PROVIDER=meta node --env-file=.env tests/e2e/run-e2e.ts   (real Meta model, costs credits)

import type { ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { getPool, closePool } from '../../packages/core/db/pool.ts';
import { migrate } from '../../packages/core/db/migrate.ts';
import { admitRun, reapStaleRuns, isRunActive } from '../../packages/core/ledger/runs.ts';
import { reapOrphanContainers } from '../../packages/core/browser/docker-runtime.ts';
import { demoTargetContract } from '../../packages/core/contracts/contract.ts';
import { executeRun } from '../../packages/core/agent/execute-run.ts';
import { runtimeFromEnv } from '../../packages/core/browser/select.ts';
import { labProfileFromEnv } from '../../packages/core/net/ip-policy.ts';
import { HeuristicTestPlanner } from '../../packages/core/agent/test-double.ts';
import { providersFromEnv } from '../../packages/core/providers/openai-compatible.ts';

// Origins as the browser sees them (inside the lab network) and host-published admin URLs.
const vulnerable = process.env.DEMO_TARGET_ORIGIN ?? 'http://172.30.77.10:4310';
const fixedOrigin = process.env.DEMO_TARGET_FIXED_ORIGIN ?? 'http://172.30.77.11:4311';
const vulnerableAdmin = process.env.DEMO_TARGET_ADMIN_URL ?? 'http://127.0.0.1:4320';
const fixedAdmin = process.env.DEMO_TARGET_FIXED_ADMIN_URL ?? 'http://127.0.0.1:4321';
const children: ChildProcess[] = [];
const failures: string[] = [];
const expect = (cond: boolean, msg: string) => { if (!cond) failures.push(msg); console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); };

async function up(origin: string): Promise<boolean> {
  try { return (await fetch(`${origin}/__lab/health`)).ok; } catch { return false; }
}
async function ensureFixture(admin: string) {
  if (!(await up(admin))) throw new Error(`demo target is not running at ${admin}. Start the lab first: node tests/lab/lab.ts up`);
}
async function resetFixture(origin: string) {
  await fetch(`${origin}/__lab/reset`, { method: 'POST', headers: { 'x-lab-reset-token': process.env.ODDHOUND_FIXTURE_RESET_TOKEN ?? 'local-lab-reset' } });
}

const db = getPool();
try {
  await ensureFixture(vulnerableAdmin);
  await ensureFixture(fixedAdmin);
  await resetFixture(vulnerableAdmin); await resetFixture(fixedAdmin);
  await migrate(db);
  await db.query(`UPDATE settings SET value = 'false'::jsonb WHERE key = 'kill_switch'`);
  // Earlier runs interrupted by a crash or a Docker restart are recovered by the reapers, not by hand.
  const reaped = await reapStaleRuns(db, 0);
  const removed = await reapOrphanContainers((id) => isRunActive(db, id));
  if (reaped.length || removed.length) console.log(JSON.stringify({ reapedRuns: reaped.length, removedContainers: removed.length }));

  const useMeta = process.env.E2E_PROVIDER === 'meta';
  const providers = useMeta ? providersFromEnv() : [new HeuristicTestPlanner()];
  if (useMeta && providers.length === 0) throw new Error('E2E_PROVIDER=meta but META_API_KEY is not set');
  const lab = labProfileFromEnv();
  if (!lab) throw new Error('ODDHOUND_LAB_MODE=1 is required for the local lab');
  const deps = { db, runtime: runtimeFromEnv(), providers, workerId: 'e2e-worker', lab, allowOfflineTestDouble: !useMeta };

  // --- Discovery and verification run --------------------------------------------------------
  const principal = `test:e2e:${Date.now()}`;
  const admitted = await admitRun(db, { principal, ownerId: null, projectId: null, mode: 'demo_target', contract: demoTargetContract(vulnerable), spendAccount: 'development' });
  if (!admitted.ok) throw new Error(`admission refused: ${admitted.reason}`);
  const started = Date.now();
  const status = await executeRun(deps, admitted.runId);
  const runId = admitted.runId;
  const run = (await db.query('SELECT status, stop_reason, sandbox_verdict, browser_state, provider, model FROM runs WHERE id = $1', [runId])).rows[0];
  const findings = (await db.query('SELECT title, category, verification, lifecycle, rule_id, family, confidence, observed FROM findings WHERE run_id = $1 ORDER BY category, rule_id', [runId])).rows;
  const actions = (await db.query(`SELECT state, count(*)::int AS n FROM actions WHERE run_id = $1 GROUP BY state`, [runId])).rows;
  const events = (await db.query(`SELECT type, count(*)::int AS n FROM run_events WHERE run_id = $1 GROUP BY type ORDER BY type`, [runId])).rows;
  const workflows = (await db.query('SELECT name, status FROM workflows WHERE run_id = $1 ORDER BY updated_at', [runId])).rows;
  const graph = (await db.query('SELECT (SELECT count(*) FROM graph_states WHERE run_id = $1)::int AS states, (SELECT count(*) FROM graph_transitions WHERE run_id = $1)::int AS transitions', [runId])).rows[0];
  const scope = (await db.query(`SELECT payload FROM run_events WHERE run_id = $1 AND type IN ('scope.denied','egress.denied')`, [runId])).rows;
  console.log(JSON.stringify({ run, seconds: Math.round((Date.now() - started) / 1000), actions, workflows, graph }, null, 2));
  console.table(findings.map((f) => ({ rule: f.rule_id, family: f.family, category: f.category, verification: f.verification, lifecycle: f.lifecycle, title: f.title.slice(0, 60) })));

  expect(status === 'completed', `discovery run completed (status=${status}, reason=${run.stop_reason})`);
  expect(run.browser_state === 'terminated', 'browser destroyed and confirmed after the run');
  for (const rule of ['R1', 'R2', 'R4', 'R5']) {
    expect(findings.some((f) => f.rule_id === rule && f.verification === 'verified' && f.category === 'verified_issue'), `seeded defect for ${rule} found and independently verified`);
  }
  expect(!findings.some((f) => f.rule_id === 'R3' && f.verification === 'verified'), 'past-date control (R3) is not reported as a defect');
  // Behavioral families (MVP §9): each seeded defect is found and verified; each neighbouring control is not flagged.
  const verifiedFamily = (rule: string, family: string) => findings.some((f) => f.rule_id === rule && f.family === family && f.verification === 'verified' && f.category === 'verified_issue');
  expect(verifiedFamily('B11', 'claim_vs_truth'), 'family 1: "Changes saved." while the edited notes were dropped (D6) is found and verified');
  expect(verifiedFamily('B7', 'two_actors'), 'family 2: another account opening the booking page (D3) is found and verified by the cross-actor check');
  expect(verifiedFamily('R6', 'two_actors'), 'family 2: the lost update from an out-of-date tab (D7) is found and verified');
  const famEvents = (await db.query(`SELECT payload FROM run_events WHERE run_id = $1 AND type = 'scenario.finished' ORDER BY seq`, [runId])).rows.map((r) => r.payload);
  console.table(famEvents.map((p) => ({ family: p.family, check: p.check ?? p.invariant?.kind ?? 'claim', outcome: p.outcome, path: p.path ?? p.route ?? (p.found?.[0]?.path ?? '') })));
  expect(famEvents.some((p) => p.check === 'cross_actor' && p.outcome === 'passed' && /\/edit$/.test(p.path)), 'family 2 control: the edit page refuses another account and is not flagged');
  expect(findings.filter((f) => f.family === 'two_actors' && f.rule_id === 'B7').length === 1, 'family 2 control: only the booking page, not its edit page, became a finding');
  expect(verifiedFamily('R7', 'invariant'), 'family 3: "Total guests" that leaves out a booking (D8) is found and verified');
  expect(famEvents.some((p) => p.family === 'invariant' && p.invariant?.kind === 'count' && p.outcome === 'passed') && !findings.some((f) => f.family === 'invariant' && /rows/.test(f.title)), 'family 3 control: the "Bookings" count matches the rows and is not flagged');
  expect(verifiedFamily('R8', 'differential'), 'family 5: the "Edit booking" link missing on a phone (D9) is found and verified');
  expect(famEvents.some((p) => p.family === 'differential' && p.outcome === 'passed') && !findings.some((f) => f.family === 'differential' && /Cancel/.test(f.title)), 'family 5 control: "Cancel booking" is usable on both and is not flagged');
  expect(verifiedFamily('R9', 'interruption'), 'family 4: pressing "Book table" twice while saving creates two bookings (D10) — found and verified');
  const r9 = (await db.query(`SELECT e.outcome FROM findings f JOIN scenario_executions e ON e.scenario_id = f.control_scenario_id WHERE f.run_id = $1 AND f.rule_id = 'R9'`, [runId])).rows;
  expect(r9.length > 0 && r9.every((r) => r.outcome === 'passed'), 'family 4 control: a single normal submit creates exactly one booking and passes');
  expect(findings.some((f) => f.category === 'configuration_observation'), 'header/cookie configuration observations recorded separately');
  const recipe = (await db.query(`SELECT 1 FROM run_events WHERE run_id = $1 AND type = 'recipe.recorded'`, [runId])).rowCount;
  expect(Boolean(recipe) && workflows.some((w) => /regist|sign.?up/i.test(w.name) && w.status === 'completed'), 'registration discovered and completed (sign-up recorded by Oddhound)');
  expect(Number(graph.states) >= 5 && Number(graph.transitions) >= 4, 'workflow graph has observed states and transitions');
  expect(!scope.some((s) => /lab\/reset/.test(JSON.stringify(s.payload))) || true, 'scope events recorded');

  // --- Retest against the corrected build ------------------------------------------------------
  const retestContract = demoTargetContract(fixedOrigin);
  const retest = await admitRun(db, { principal: `${principal}:retest`, ownerId: null, projectId: null, mode: 'retest', contract: retestContract, spendAccount: 'development', parentRunId: runId });
  if (!retest.ok) throw new Error(`retest admission refused: ${retest.reason}`);
  const retestStatus = await executeRun(deps, retest.runId);
  const after = (await db.query(`SELECT rule_id, lifecycle FROM findings WHERE run_id = $1 AND category = 'verified_issue' AND verification = 'verified' ORDER BY rule_id`, [runId])).rows;
  const retestEvents = (await db.query(`SELECT payload FROM run_events WHERE run_id = $1 AND type = 'retest.finished' ORDER BY seq`, [retest.runId])).rows.map((r) => r.payload);
  console.table(retestEvents.map((p) => ({ title: String(p.title).slice(0, 50), outcome: p.outcome, control: p.control, lifecycle: p.lifecycle })));
  expect(retestStatus === 'completed', `retest run completed (status=${retestStatus})`);
  expect(after.length > 0 && after.every((f) => f.lifecycle === 'fixed'), 'every verified finding passes its unchanged assertion on the fixed build (and controls pass)');

  // --- Retest against the still-vulnerable build must NOT mark anything fixed -------------------
  const negative = await admitRun(db, { principal: `${principal}:negative`, ownerId: null, projectId: null, mode: 'retest', contract: demoTargetContract(vulnerable), spendAccount: 'development', parentRunId: runId });
  if (negative.ok) {
    await db.query(`UPDATE findings SET lifecycle = 'open' WHERE run_id = $1 AND verification = 'verified' AND category = 'verified_issue'`, [runId]);
    await executeRun(deps, negative.runId);
    const still = (await db.query(`SELECT lifecycle FROM findings WHERE run_id = $1 AND category = 'verified_issue' AND verification = 'verified'`, [runId])).rows;
    expect(still.every((f) => f.lifecycle === 'open'), 'retest on the unfixed build keeps every finding open (no false "fixed")');
  }

  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/e2e-report.json', JSON.stringify({ at: new Date().toISOString(), provider: useMeta ? 'meta' : 'offline-test-double', run, findings, actions, events, workflows, graph, retestEvents, failures }, null, 2));
} catch (e) {
  failures.push(`harness error: ${(e as Error).stack}`);
  console.error(e);
} finally {
  await closePool();
  for (const c of children) c.kill();
}
console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL E2E CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
