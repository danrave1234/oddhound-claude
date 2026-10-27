// Private artifact storage: local files (default, development) or PostgreSQL (ARTIFACT_STORE=db, used
// when the web app and worker run on different machines). Artifacts are served only through the
// authenticated API after a run-ownership check, never from a public path.

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.ts';
import { LIMITS } from '../contracts/limits.ts';

const RETENTION_DAYS = 7;
const inDb = () => process.env.ARTIFACT_STORE === 'db';

export function artifactRoot(): string {
  return resolve(/*turbopackIgnore: true*/ process.env.ARTIFACT_DIR ?? '.data/artifacts');
}

export class ArtifactBudgetError extends Error {}

export async function saveArtifact(db: Db, runId: string, kind: string, contentType: string, data: Buffer, label = ''): Promise<string> {
  const used = await db.query('SELECT COALESCE(SUM(bytes),0)::bigint AS n FROM artifacts WHERE run_id = $1', [runId]);
  if (Number(used.rows[0].n) + data.length > LIMITS.artifactBytesPerRun) throw new ArtifactBudgetError('artifact budget exhausted');
  const id = randomUUID();
  const key = inDb() ? `db:${id}` : join(runId, `${id}`);
  if (!inDb()) {
    await mkdir(join(/*turbopackIgnore: true*/ artifactRoot(), runId), { recursive: true });
    await writeFile(join(/*turbopackIgnore: true*/ artifactRoot(), key), data);
  }
  await db.query(
    `INSERT INTO artifacts (id, run_id, kind, storage_key, content_type, bytes, label, expires_at, data) VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '${RETENTION_DAYS} days', $8)`,
    [id, runId, kind, key, contentType, data.length, label.slice(0, 200), inDb() ? data : null]);
  return id;
}

/** Metadata only, so callers can authorise BEFORE touching storage (no existence oracle via errors). */
export async function artifactMeta(db: Db, id: string): Promise<{ runId: string; contentType: string } | null> {
  const r = await db.query<{ content_type: string; run_id: string; expires_at: Date }>('SELECT content_type, run_id, expires_at FROM artifacts WHERE id = $1', [id]);
  const row = r.rows[0];
  return row && row.expires_at.getTime() >= Date.now() ? { runId: row.run_id, contentType: row.content_type } : null;
}

export async function readArtifact(db: Db, id: string): Promise<{ data: Buffer; contentType: string; runId: string } | null> {
  const r = await db.query<{ storage_key: string; content_type: string; run_id: string; expires_at: Date; data: Buffer | null }>('SELECT storage_key, content_type, run_id, expires_at, data FROM artifacts WHERE id = $1', [id]);
  const row = r.rows[0];
  if (!row || row.expires_at.getTime() < Date.now()) return null;
  const data = row.data ?? await readFile(join(/*turbopackIgnore: true*/ artifactRoot(), row.storage_key));
  return { data, contentType: row.content_type, runId: row.run_id };
}

/** Deletes expired artifacts (files and rows). Run periodically by the worker. */
export async function purgeExpiredArtifacts(db: Db): Promise<number> {
  const r = await db.query<{ id: string; storage_key: string }>('DELETE FROM artifacts WHERE expires_at < now() RETURNING id, storage_key');
  for (const row of r.rows) if (!row.storage_key.startsWith('db:')) await rm(join(/*turbopackIgnore: true*/ artifactRoot(), row.storage_key), { force: true });
  return r.rowCount ?? 0;
}
