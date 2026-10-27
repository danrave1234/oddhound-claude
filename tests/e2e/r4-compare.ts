// R4 measurement (MVP §7 "Proof before adoption"): the same demo-target goals, rules and budget, run
// once per agent mode, with the REAL Meta model (costs credits). It records defects found, false
// findings, model turns, browser actions, spend, batches and surprises for docs/STATUS.md.
//
// Run: R4_MODES=per_step,batch node --env-file=.env tests/e2e/r4-compare.ts
//   R4_CAP_USD (default 0.5): exploration stops (verification still runs) once settled spend reaches it.
// Exits non-zero only on a harness error. Writes test-results/r4-<timestamp>.json.

import { mkdir, writeFile } from 'node:fs/promises';
import { getPool, closePool } from '../../packages/core/db/pool.ts';
import { migrate } from '../../packages/core/db/migrate.ts';
import { admitRun, reapStaleRuns } from '../../packages/core/ledger/runs.ts';
import { runSpend } from '../../packages/core/ledger/spend.ts';
import { demoTargetContract } from '../../packages/core/contracts/contract.ts';
import { executeRun } from '../../packages/core/agent/execute-run.ts';
import { runtimeFromEnv } from '../../packages/core/browser/select.ts';
import { labProfileFromEnv } from '../../packages/core/net/ip-policy.ts';
import { providersFromEnv } from '../../packages/core/providers/openai-compatible.ts';
import { AGENT_MODES, type AgentMode } from '../../packages/core/agent/tools.ts';

const SEEDED = ['R1', 'R2', 'R4', 'R5']; // labelled defects in apps/fixture (D1-D4); R3 is a control
const origin = process.env.DEMO_TARGET_ORIGIN ?? 'http://172.30.77.10:4310';
const admin = process.env.DEMO_TARGET_ADMIN_URL ?? 'http://127.0.0.1:4320';
const modes = (process.env.R4_MODES ?? 'per_step,batch').split(',').map((m) => m.trim()).filter((m): m is AgentMode => (AGENT_MODES as readonly string[]).includes(m));
const capMicros = Math.round(Number(process.env.R4_CAP_USD ?? '0.5') * 1_000_000);

const db = getPool();
const results: Record<string, unknown>[] = [];
let failed = false;
try {
  const providers = providersFromEnv();
  if (!providers.length || !providers[0]!.isMetaModel) throw new Error('R4 needs a real Meta provider (META_API_KEY)');
  const lab = labProfileFromEnv();
  if (!lab) throw new Error('ODDHOUND_LAB_MODE=1 is required for the local lab');
  await migrate(db);
  await db.query(`UPDATE settings SET value = 'false'::jsonb WHERE key = 'kill_switch'`);
  await reapStaleRuns(db, 0);
  for (const mode of modes) {
    const reset = await fetch(`${admin}/__lab/reset`, { method: 'POST', headers: { 'x-lab-reset-token': process.env.ODDHOUND_FIXTURE_RESET_TOKEN ?? 'local-lab-reset' } });
    if (!reset.ok) throw new Error(`fixture reset failed: ${reset.status}`);
    const admitted = await admitRun(db, { principal: `test:r4:${mode}:${Date.now()}`, ownerId: null, projectId: null, mode: 'demo_target', contract: demoTargetContract(origin), spendAccount: 'development' });
    if (!admitted.ok) throw new Error(`admission refused: ${admitted.reason}`);
    const started = Date.now();
    const status = await executeRun({ db, runtime: runtimeFromEnv(), providers, workerId: `r4-${mode}`, lab, agentMode: mode, explorationSpendCapMicros: capMicros }, admitted.runId);
    const runId = admitted.runId;
    const run = (await db.query('SELECT status, stop_reason, sandbox_verdict, provider, model FROM runs WHERE id = $1', [runId])).rows[0];
    const findings = (await db.query<{ rule_id: string; category: string; verification: string; title: string }>('SELECT rule_id, category, verification, title FROM findings WHERE run_id = $1', [runId])).rows;
    const ev = (await db.query<{ type: string; payload: any }>('SELECT type, payload FROM run_events WHERE run_id = $1 ORDER BY seq', [runId])).rows;
    const actions = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM actions WHERE run_id = $1', [runId])).rows[0]!.n;
    const spend = await runSpend(db, runId);
    const verified = findings.filter((f) => f.category === 'verified_issue' && f.verification === 'verified');
    const turns = ev.filter((e) => e.type === 'model.turn');
    const usage = turns.reduce((u, e) => ({ input: u.input + (e.payload.usage?.inputTokens ?? 0), cached: u.cached + (e.payload.usage?.cachedInputTokens ?? 0), output: u.output + (e.payload.usage?.outputTokens ?? 0) }), { input: 0, cached: 0, output: 0 });
    const batches = ev.filter((e) => e.type === 'batch.finished');
    const coverage = ev.filter((e) => e.type === 'coverage.updated').at(-1)?.payload ?? null;
    const r = {
      mode, runId, status, stopReason: run.stop_reason, provider: `${run.provider}/${run.model}`, sandbox: run.sandbox_verdict, seconds: Math.round((Date.now() - started) / 1000),
      seededFound: SEEDED.filter((id) => verified.some((f) => f.rule_id === id)),
      falseFindings: verified.filter((f) => f.rule_id === 'R3').map((f) => f.title),
      otherVerified: verified.filter((f) => !SEEDED.includes(f.rule_id) && f.rule_id !== 'R3').map((f) => `${f.rule_id}: ${f.title}`),
      inconclusiveOrDismissed: findings.filter((f) => f.category !== 'configuration_observation' && f.verification !== 'verified').map((f) => `${f.rule_id} ${f.verification}: ${f.title}`),
      turns: turns.length, actions, costUsd: spend.settled / 1_000_000, outstandingUsd: spend.outstanding / 1_000_000, usage,
      batches: batches.length, batchSteps: batches.reduce((n, e) => n + (e.payload.ran ?? 0), 0),
      surprises: batches.filter((e) => e.payload.surprise).map((e) => e.payload.surprise),
      coverage: coverage ? { exercised: coverage.exercised, total: coverage.total, blocked: coverage.blocked, pages: coverage.pages } : null,
    };
    results.push(r);
    console.log(JSON.stringify(r, null, 2));
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile(`test-results/r4-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify({ at: new Date().toISOString(), origin, capMicros, results }, null, 2));
  await closePool();
}
process.exit(failed ? 1 : 0);
