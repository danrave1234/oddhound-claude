// Run admission, leases, fencing and the durable event log.

import { createHash } from 'node:crypto';
import type { Db } from '../db/pool.ts';
import { withTx } from '../db/pool.ts';
import { LIMITS } from '../contracts/limits.ts';
import type { RunStatus } from '../contracts/status.ts';
import type { RunContract } from '../contracts/contract.ts';

export type AdmissionInput = {
  principal: string; // 'user:<id>' or 'anon:<session>'
  ownerId: string | null;
  projectId: string | null;
  mode: 'verified_site' | 'demo_target' | 'retest';
  contract: RunContract;
  spendAccount: 'public' | 'judging' | 'development';
  parentRunId?: string;
};

export type AdmissionResult =
  | { ok: true; runId: string }
  | { ok: false; reason: 'kill_switch' | 'user_revoked' | 'principal_pending' | 'queue_full' | 'daily_quota' | 'site_busy' | 'demo_hourly_limit' | 'demo_busy' };

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const ACTIVE = `('queued','provisioning','running','waiting_for_input','stopping','finalizing')`;

export async function admitRun(db: Db, input: AdmissionInput): Promise<AdmissionResult> {
  return withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(777001)'); // one admission decision at a time
    const kill = await tx.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'kill_switch'`);
    if (kill.rows[0]?.value === true) return { ok: false, reason: 'kill_switch' };
    if (input.ownerId) {
      const u = await tx.query<{ revoked: boolean }>('SELECT revoked FROM "user" WHERE id = $1', [input.ownerId]);
      if (u.rows[0]?.revoked) return { ok: false, reason: 'user_revoked' };
    }
    const pendingMine = await tx.query(`SELECT count(*)::int AS n FROM runs WHERE principal = $1 AND status = 'queued'`, [input.principal]);
    if (pendingMine.rows[0].n >= LIMITS.pendingRunsPerPrincipal) return { ok: false, reason: 'principal_pending' };
    const pendingAll = await tx.query(`SELECT count(*)::int AS n FROM runs WHERE status = 'queued'`);
    if (pendingAll.rows[0].n >= LIMITS.pendingRunsGlobal) return { ok: false, reason: 'queue_full' };

    if (input.mode === 'demo_target') {
      const recent = await tx.query(`SELECT count(*)::int AS n FROM runs WHERE principal = $1 AND mode = 'demo_target' AND created_at > now() - interval '1 hour'`, [input.principal]);
      if (recent.rows[0].n >= 1) return { ok: false, reason: 'demo_hourly_limit' };
      const activeDemo = await tx.query(`SELECT count(*)::int AS n FROM runs WHERE mode = 'demo_target' AND status IN ${ACTIVE}`);
      if (activeDemo.rows[0].n >= 1) return { ok: false, reason: 'demo_busy' };
    } else if (input.ownerId && input.spendAccount === 'public') {
      // The per-user daily quota protects the public budget; development-budget runs are operator-only.
      const today = await tx.query(`SELECT count(*)::int AS n FROM runs WHERE owner_id = $1 AND day_bucket = (now() AT TIME ZONE 'utc')::date AND counted_against_quota`, [input.ownerId]);
      if (today.rows[0].n >= LIMITS.runsPerUserPerDay) return { ok: false, reason: 'daily_quota' };
    }
    // One active run per origin, across every project and user (the lock is the origin, not the project).
    const origins = [input.contract.target.origin, ...input.contract.target.apiOrigins.map((a) => a.origin)];
    const busy = await tx.query(`SELECT count(*)::int AS n FROM runs WHERE status IN ${ACTIVE} AND active_origins && $1::text[]`, [origins]);
    if (busy.rows[0].n > 0) return { ok: false, reason: 'site_busy' };

    const contractJson = canonicalJson(input.contract);
    const r = await tx.query<{ id: string }>(
      `INSERT INTO runs (project_id, owner_id, principal, mode, origin, active_origins, environment, test_mode, contract, contract_hash, status, spend_account, parent_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12) RETURNING id`,
      [input.projectId, input.ownerId, input.principal, input.mode, input.contract.target.origin, origins, input.contract.target.environment,
        input.contract.testMode, contractJson, sha256(contractJson), input.spendAccount, input.parentRunId ?? null]);
    const runId = r.rows[0]!.id;
    await tx.query(`INSERT INTO audit_log (actor, action, origin, run_id, detail) VALUES ($1,'run_admitted',$2,$3,$4)`,
      [input.principal, input.contract.target.origin, runId, JSON.stringify({ mode: input.mode, spendAccount: input.spendAccount })]);
    return { ok: true, runId };
  });
}

export class FencedError extends Error {
  readonly reason: string;
  constructor(reason: string) { super(`run fenced: ${reason}`); this.reason = reason; }
}

/** Take the lease for a queued run. Returns the new generation, or null if it is no longer runnable. */
export async function claimRun(db: Db, runId: string, workerId: string): Promise<number | null> {
  const r = await db.query<{ lease_generation: number }>(
    `UPDATE runs SET status = 'provisioning', lease_owner = $2, lease_generation = lease_generation + 1, heartbeat_at = now(),
       started_at = COALESCE(started_at, now()), expires_at = now() + ($3::int * interval '1 millisecond')
     WHERE id = $1 AND status = 'queued' AND stop_requested_at IS NULL RETURNING lease_generation`,
    [runId, workerId, LIMITS.runWallClockMs]);
  return r.rows[0]?.lease_generation ?? null;
}

/** Called before every action: proves this worker still holds the lease and no stop/expiry fence exists. */
export async function assertLease(db: Db, runId: string, generation: number): Promise<void> {
  const r = await db.query<{ lease_generation: number; stop_requested_at: Date | null; expires_at: Date | null; status: RunStatus }>(
    'SELECT lease_generation, stop_requested_at, expires_at, status FROM runs WHERE id = $1', [runId]);
  const run = r.rows[0];
  if (!run) throw new FencedError('run_missing');
  if (run.lease_generation !== generation) throw new FencedError('lease_lost');
  if (run.stop_requested_at) throw new FencedError('stop_requested');
  if (run.expires_at && run.expires_at.getTime() < Date.now()) throw new FencedError('expired');
  if (['completed', 'stopped', 'failed', 'blocked'].includes(run.status)) throw new FencedError('terminal');
  await db.query('UPDATE runs SET heartbeat_at = now() WHERE id = $1 AND lease_generation = $2', [runId, generation]);
}

/** Persist the stop fence first; the caller acknowledges only after this resolves. */
export async function requestStop(db: Db, runId: string, actor: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE runs SET stop_requested_at = COALESCE(stop_requested_at, now()),
       status = CASE WHEN status = 'queued' THEN 'stopped' ELSE 'stopping' END,
       stop_reason = COALESCE(stop_reason, 'user_stop'),
       finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END
     WHERE id = $1 AND status IN ${ACTIVE} RETURNING id`, [runId]);
  if (r.rowCount) await db.query(`INSERT INTO audit_log (actor, action, run_id) VALUES ($1,'run_stop_requested',$2)`, [actor, runId]);
  return (r.rowCount ?? 0) > 0;
}

export async function setRunStatus(db: Db, runId: string, generation: number | null, status: RunStatus, extra: { stopReason?: string; browserState?: string; browserRef?: string; sandboxVerdict?: string; provider?: string; model?: string } = {}): Promise<void> {
  const terminal = ['completed', 'stopped', 'failed', 'blocked'].includes(status);
  await db.query(
    `UPDATE runs SET status = $3,
       stop_reason = COALESCE($4, stop_reason), browser_state = COALESCE($5, browser_state), browser_ref = COALESCE($6, browser_ref),
       sandbox_verdict = COALESCE($7, sandbox_verdict), provider = COALESCE($8, provider), model = COALESCE($9, model),
       finished_at = CASE WHEN $10 THEN now() ELSE finished_at END
     WHERE id = $1 AND ($2::int IS NULL OR lease_generation = $2)`,
    [runId, generation, status, extra.stopReason ?? null, extra.browserState ?? null, extra.browserRef ?? null,
      extra.sandboxVerdict ?? null, extra.provider ?? null, extra.model ?? null, terminal]);
}

/**
 * Independent recovery for runs whose worker died (crash, host restart): an active run whose lease
 * heartbeat is stale, or whose expiry passed, is fenced and marked failed with a truthful reason.
 * Bumping the lease generation guarantees the lost worker can dispatch nothing further.
 * A queued run whose queue entry outlived its TTL is stopped without counting against quota.
 */
export async function reapStaleRuns(db: Db, staleAfterMs = 3 * 60_000): Promise<string[]> {
  const r = await db.query<{ id: string }>(
    `UPDATE runs SET status = 'failed', stop_reason = COALESCE(stop_reason, 'worker_lost_or_expired'),
       lease_generation = lease_generation + 1, stop_requested_at = COALESCE(stop_requested_at, now()), finished_at = now(),
       browser_state = CASE WHEN browser_state IN ('ready','active','provisioning','terminating') THEN 'terminating' ELSE browser_state END
     WHERE status IN ('provisioning','running','waiting_for_input','stopping','finalizing')
       AND (heartbeat_at < now() - ($1::int * interval '1 millisecond') OR expires_at < now() - interval '1 minute')
     RETURNING id`, [staleAfterMs]);
  const q = await db.query<{ id: string }>(
    `UPDATE runs SET status = 'stopped', stop_reason = 'queue_entry_expired', counted_against_quota = false, finished_at = now()
     WHERE status = 'queued' AND queued_at < now() - ($1::int * interval '1 millisecond') RETURNING id`, [LIMITS.queueEntryTtlMs]);
  for (const row of [...r.rows, ...q.rows]) await db.query(`INSERT INTO audit_log (actor, action, run_id) VALUES ('reaper','run_reaped',$1)`, [row.id]);
  return [...r.rows, ...q.rows].map((x) => x.id);
}

export async function isRunActive(db: Db, runId: string): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM runs WHERE id = $1 AND status IN ${ACTIVE}`, [runId]);
  return (r.rowCount ?? 0) > 0;
}

/** A run that never began provisioning does not count against the user's daily quota. */
export async function refundIfNeverStarted(db: Db, runId: string): Promise<void> {
  await db.query(`UPDATE runs SET counted_against_quota = false WHERE id = $1 AND started_at IS NULL`, [runId]);
}

/** Durable, gap-free, per-run ordered events. The sequence comes from an atomic counter on the run row. */
export async function appendEvent(db: Db, runId: string, type: string, payload: Record<string, unknown> = {}): Promise<number> {
  const r = await db.query<{ seq: number }>(
    `WITH next AS (UPDATE runs SET event_seq = event_seq + 1 WHERE id = $1 RETURNING event_seq)
     INSERT INTO run_events (run_id, seq, type, payload) SELECT $1, event_seq, $2, $3 FROM next RETURNING seq`,
    [runId, type, JSON.stringify(payload)]);
  const seq = r.rows[0]?.seq;
  if (seq === undefined) throw new Error('run not found for event');
  await db.query('SELECT pg_notify($1, $2)', ['run_events', JSON.stringify({ runId, seq })]);
  return seq;
}

export async function eventsAfter(db: Db, runId: string, afterSeq: number, limit = 500) {
  const r = await db.query<{ seq: number; at: Date; type: string; payload: Record<string, unknown> }>(
    'SELECT seq, at, type, payload FROM run_events WHERE run_id = $1 AND seq > $2 ORDER BY seq LIMIT $3', [runId, afterSeq, limit]);
  return r.rows;
}
