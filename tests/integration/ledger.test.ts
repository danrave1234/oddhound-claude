// Ledgers under concurrency, against a real PostgreSQL (the oddhound_test database).
// SELF-06/07/15/18/19/23.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getPool, closePool } from '../../packages/core/db/pool.ts';
import { migrate } from '../../packages/core/db/migrate.ts';
import { admitRun, assertLease, claimRun, FencedError, requestStop, reapStaleRuns, appendEvent, eventsAfter } from '../../packages/core/ledger/runs.ts';
import { reserveSpend, settleSpend, markSpendUnknown, runSpend, setKillSwitch } from '../../packages/core/ledger/spend.ts';
import { demoTargetContract } from '../../packages/core/contracts/contract.ts';
import { USD } from '../../packages/core/contracts/limits.ts';

const db = getPool();
let n = 0;
const contract = (origin = `https://site${++n}.example`) => demoTargetContract(origin);

async function newRun(opts: Partial<Parameters<typeof admitRun>[1]> = {}) {
  const r = await admitRun(db, { principal: `test:${++n}`, ownerId: null, projectId: null, mode: 'verified_site', contract: contract(), spendAccount: 'development', ...opts });
  if (!r.ok) throw new Error(r.reason);
  return r.runId;
}

beforeAll(async () => { await migrate(db); });
beforeEach(async () => {
  await db.query('TRUNCATE runs, spend_reservations, audit_log, "user" CASCADE');
  await db.query(`UPDATE settings SET value = 'false'::jsonb WHERE key = 'kill_switch'`);
});
afterAll(async () => { await closePool(); });

describe('spend ledger (SELF-19)', () => {
  it('concurrent reservations never exceed the $2 per-run cap', async () => {
    const runId = await newRun();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      reserveSpend(db, { runId, account: 'development', requestKey: `${runId}:${i}`, micros: 0.3 * USD, provider: 'meta-direct', model: 'muse-spark-1.3' })));
    expect(results.filter((r) => r.ok).length).toBe(6); // 6 x $0.30 = $1.80; a 7th would exceed $2.00
    const s = await runSpend(db, runId);
    expect(s.settled + s.outstanding).toBeLessThanOrEqual(2 * USD);
  });
  it('the public daily ceiling holds across many runs racing at once (SELF-18)', async () => {
    const runs = await Promise.all(Array.from({ length: 6 }, () => newRun({ spendAccount: 'public' })));
    const results = await Promise.all(runs.flatMap((runId) => Array.from({ length: 4 }, (_, i) =>
      reserveSpend(db, { runId, account: 'public', requestKey: `${runId}:${i}`, micros: 0.5 * USD, provider: 'meta-direct', model: 'muse-spark-1.3' }))));
    const total = results.filter((r) => r.ok).length * 0.5 * USD;
    expect(total).toBeLessThanOrEqual(7 * USD);
    expect(results.some((r) => !r.ok && r.reason === 'daily_cap')).toBe(true);
  });
  it('unknown usage stays reserved; the same request key cannot reserve twice', async () => {
    const runId = await newRun();
    const a = await reserveSpend(db, { runId, account: 'development', requestKey: 'k1', micros: 1.5 * USD, provider: 'p', model: 'm' });
    const again = await reserveSpend(db, { runId, account: 'development', requestKey: 'k1', micros: 1.5 * USD, provider: 'p', model: 'm' });
    expect(a.ok && again.ok && a.reservationId === again.reservationId).toBe(true);
    await markSpendUnknown(db, 'k1');
    const b = await reserveSpend(db, { runId, account: 'development', requestKey: 'k2', micros: 0.6 * USD, provider: 'p', model: 'm' });
    expect(b).toEqual({ ok: false, reason: 'run_cap' }); // the unknown $1.50 still counts
    await settleSpend(db, 'k1', 0.2 * USD, { inputTokens: 1 });
    const c = await reserveSpend(db, { runId, account: 'development', requestKey: 'k3', micros: 0.6 * USD, provider: 'p', model: 'm' });
    expect(c.ok).toBe(true);
  });
  it('the kill switch blocks new model calls and new runs', async () => {
    const runId = await newRun();
    await setKillSwitch(db, true, 'test');
    expect(await reserveSpend(db, { runId, account: 'development', requestKey: 'kx', micros: 1000, provider: 'p', model: 'm' })).toEqual({ ok: false, reason: 'kill_switch' });
    expect(await admitRun(db, { principal: 'test:k', ownerId: null, projectId: null, mode: 'verified_site', contract: contract(), spendAccount: 'public' })).toEqual({ ok: false, reason: 'kill_switch' });
  });
});

describe('admission (SELF-15/18)', () => {
  it('one active run per origin across every project and user', async () => {
    const c = contract('https://busy.example');
    expect((await admitRun(db, { principal: 'a', ownerId: null, projectId: null, mode: 'verified_site', contract: c, spendAccount: 'public' })).ok).toBe(true);
    expect(await admitRun(db, { principal: 'b', ownerId: null, projectId: null, mode: 'verified_site', contract: c, spendAccount: 'public' })).toEqual({ ok: false, reason: 'site_busy' });
  });
  it('one pending run per principal, and 3 runs per user per day', async () => {
    await db.query(`INSERT INTO "user" (id, name, email) VALUES ('u1','U','u1@example.test')`);
    const admit = () => admitRun(db, { principal: 'user:u1', ownerId: 'u1', projectId: null, mode: 'verified_site', contract: contract(), spendAccount: 'public' });
    const first = await admit();
    expect(first.ok).toBe(true);
    expect(await admit()).toEqual({ ok: false, reason: 'principal_pending' });
    for (let i = 0; i < 2; i++) { await db.query(`UPDATE runs SET status = 'completed' WHERE principal = 'user:u1'`); expect((await admit()).ok).toBe(true); }
    await db.query(`UPDATE runs SET status = 'completed' WHERE principal = 'user:u1'`);
    expect(await admit()).toEqual({ ok: false, reason: 'daily_quota' });
  });
  it('anonymous demo: one per session per hour and one live demo globally, however many sessions race', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      admitRun(db, { principal: `anon:s${i}:1.2.3.4`, ownerId: null, projectId: null, mode: 'demo_target', contract: contract('https://demo.example'), spendAccount: 'public' })));
    expect(results.filter((r) => r.ok).length).toBe(1);
    await db.query(`UPDATE runs SET status = 'completed'`);
    expect(await admitRun(db, { principal: 'anon:s0:1.2.3.4', ownerId: null, projectId: null, mode: 'demo_target', contract: contract('https://demo.example'), spendAccount: 'public' }))
      .toEqual(results[0]!.ok ? { ok: false, reason: 'demo_hourly_limit' } : expect.anything());
  });
});

describe('fences and leases (SELF-06/07/23)', () => {
  it('stop is persisted before acknowledgement and blocks the next action', async () => {
    const runId = await newRun();
    const gen = (await claimRun(db, runId, 'w1'))!;
    await assertLease(db, runId, gen);
    expect(await requestStop(db, runId, 'test')).toBe(true);
    await expect(assertLease(db, runId, gen)).rejects.toBeInstanceOf(FencedError);
  });
  it('a stale or competing worker loses its lease; a queued run cannot be claimed twice', async () => {
    const runId = await newRun();
    const gen = (await claimRun(db, runId, 'w1'))!;
    expect(await claimRun(db, runId, 'w2')).toBeNull();
    await db.query(`UPDATE runs SET heartbeat_at = now() - interval '10 minutes' WHERE id = $1`, [runId]);
    expect(await reapStaleRuns(db)).toContain(runId);
    await expect(assertLease(db, runId, gen)).rejects.toMatchObject({ reason: 'lease_lost' });
    const row = (await db.query('SELECT status, stop_reason FROM runs WHERE id = $1', [runId])).rows[0];
    expect(row).toMatchObject({ status: 'failed', stop_reason: 'worker_lost_or_expired' });
  });
  it('a stopped queued run never starts', async () => {
    const runId = await newRun();
    await requestStop(db, runId, 'test');
    expect(await claimRun(db, runId, 'w1')).toBeNull();
  });
  it('events are durable, ordered and resumable after a sequence number', async () => {
    const runId = await newRun();
    await Promise.all(Array.from({ length: 25 }, (_, i) => appendEvent(db, runId, 'test.event', { i })));
    const all = await eventsAfter(db, runId, 0);
    expect(all.map((e) => e.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect((await eventsAfter(db, runId, 20)).length).toBe(5);
  });
});
