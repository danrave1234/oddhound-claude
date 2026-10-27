// Transactional spend ledger (MVP plan §8 "Admission and spend accounting", SELF-15/18/19).
// Every model attempt reserves a conservative upper bound BEFORE the call. Totals compare
// settled + outstanding reservations (including unknown outcomes) against the per-run cap,
// the account's daily ceiling and its lifetime allocation. Integer microdollars throughout.

import type { Db, Tx } from '../db/pool.ts';
import { withTx } from '../db/pool.ts';
import { LIMITS } from '../contracts/limits.ts';

export type SpendAccount = 'public' | 'judging' | 'development';

export type ReserveRequest = {
  runId: string;
  account: SpendAccount;
  requestKey: string; // stable per attempt; retries of the same attempt reuse it
  micros: number;
  provider: string;
  model: string;
};

export type ReserveResult = { ok: true; reservationId: string } | { ok: false; reason: 'kill_switch' | 'run_cap' | 'daily_cap' | 'lifetime_cap' | 'invalid_amount' };

const utcDay = () => new Date().toISOString().slice(0, 10);

async function killSwitchOn(tx: Tx): Promise<boolean> {
  const r = await tx.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'kill_switch'`);
  return r.rows[0]?.value === true;
}

/** Committed + outstanding micros (settled actuals, plus reserved/unknown upper bounds). */
const EXPOSURE = `COALESCE(SUM(CASE WHEN state = 'settled' THEN actual_micros WHEN state IN ('reserved','unknown') THEN reserved_micros ELSE 0 END), 0)::bigint`;

export async function reserveSpend(db: Db, req: ReserveRequest): Promise<ReserveResult> {
  if (!Number.isSafeInteger(req.micros) || req.micros <= 0) return { ok: false, reason: 'invalid_amount' };
  return withTx(db, async (tx) => {
    // Serialize all reservations for this account (and the run) so concurrent callers cannot overshoot.
    await tx.query('SELECT id FROM spend_accounts WHERE id = $1 FOR UPDATE', [req.account]);
    await tx.query('SELECT id FROM runs WHERE id = $1 FOR UPDATE', [req.runId]);
    const existing = await tx.query<{ id: string }>('SELECT id FROM spend_reservations WHERE request_key = $1', [req.requestKey]);
    if (existing.rows[0]) return { ok: true, reservationId: existing.rows[0].id };
    if (await killSwitchOn(tx)) return { ok: false, reason: 'kill_switch' };

    const acct = (await tx.query<{ lifetime_limit_micros: string; daily_limit_micros: string | null }>(
      'SELECT lifetime_limit_micros, daily_limit_micros FROM spend_accounts WHERE id = $1', [req.account])).rows[0]!;
    const runExposure = Number((await tx.query(`SELECT ${EXPOSURE} AS v FROM spend_reservations WHERE run_id = $1`, [req.runId])).rows[0].v);
    if (runExposure + req.micros > LIMITS.modelSpendPerRunMicros) return { ok: false, reason: 'run_cap' };
    const day = utcDay();
    if (acct.daily_limit_micros !== null) {
      const dayExposure = Number((await tx.query(`SELECT ${EXPOSURE} AS v FROM spend_reservations WHERE account = $1 AND day_bucket = $2`, [req.account, day])).rows[0].v);
      if (dayExposure + req.micros > Number(acct.daily_limit_micros)) return { ok: false, reason: 'daily_cap' };
    }
    const lifeExposure = Number((await tx.query(`SELECT ${EXPOSURE} AS v FROM spend_reservations WHERE account = $1`, [req.account])).rows[0].v);
    if (lifeExposure + req.micros > Number(acct.lifetime_limit_micros)) return { ok: false, reason: 'lifetime_cap' };

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO spend_reservations (request_key, run_id, account, day_bucket, reserved_micros, state, provider, model)
       VALUES ($1, $2, $3, $4, $5, 'reserved', $6, $7) RETURNING id`,
      [req.requestKey, req.runId, req.account, day, req.micros, req.provider, req.model]);
    return { ok: true, reservationId: inserted.rows[0]!.id };
  });
}

/** Records actual usage. Actual cost is capped at the reservation: a provider over-run is flagged, not hidden. */
export async function settleSpend(db: Db, requestKey: string, actualMicros: number, usage: unknown): Promise<void> {
  await db.query(
    `UPDATE spend_reservations SET state = 'settled', actual_micros = $2, usage = $3, settled_at = now()
     WHERE request_key = $1 AND state IN ('reserved','unknown')`,
    [requestKey, Math.max(0, Math.round(actualMicros)), JSON.stringify(usage ?? null)]);
}

/** The call never reached the provider (e.g. rejected locally): release the reservation. */
export async function releaseSpend(db: Db, requestKey: string): Promise<void> {
  await db.query(`UPDATE spend_reservations SET state = 'released', actual_micros = 0, settled_at = now() WHERE request_key = $1 AND state = 'reserved'`, [requestKey]);
}

/** Timeout/disconnect: the provider may have billed us. Keep the full reservation counted until reconciled. */
export async function markSpendUnknown(db: Db, requestKey: string): Promise<void> {
  await db.query(`UPDATE spend_reservations SET state = 'unknown' WHERE request_key = $1 AND state = 'reserved'`, [requestKey]);
}

export async function runSpend(db: Db, runId: string): Promise<{ settled: number; outstanding: number }> {
  const r = await db.query(`SELECT
      COALESCE(SUM(actual_micros) FILTER (WHERE state = 'settled'), 0)::bigint AS settled,
      COALESCE(SUM(reserved_micros) FILTER (WHERE state IN ('reserved','unknown')), 0)::bigint AS outstanding
    FROM spend_reservations WHERE run_id = $1`, [runId]);
  return { settled: Number(r.rows[0].settled), outstanding: Number(r.rows[0].outstanding) };
}

export async function accountExposure(db: Db, account: SpendAccount): Promise<{ today: number; lifetime: number }> {
  const exposureCase = `CASE WHEN state = 'settled' THEN actual_micros WHEN state IN ('reserved','unknown') THEN reserved_micros ELSE 0 END`;
  const r = await db.query(`SELECT
      COALESCE(SUM(${exposureCase}) FILTER (WHERE day_bucket = $2), 0)::bigint AS today,
      COALESCE(SUM(${exposureCase}), 0)::bigint AS lifetime
    FROM spend_reservations WHERE account = $1`, [account, utcDay()]);
  return { today: Number(r.rows[0].today), lifetime: Number(r.rows[0].lifetime) };
}

export async function setKillSwitch(db: Db, on: boolean, actor: string): Promise<void> {
  await db.query(`UPDATE settings SET value = $1::jsonb, updated_at = now() WHERE key = 'kill_switch'`, [JSON.stringify(on)]);
  await db.query(`INSERT INTO audit_log (actor, action, detail) VALUES ($1, 'kill_switch', $2)`, [actor, JSON.stringify({ on })]);
}

export async function isKillSwitchOn(db: Db): Promise<boolean> {
  const r = await db.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'kill_switch'`);
  return r.rows[0]?.value === true;
}
