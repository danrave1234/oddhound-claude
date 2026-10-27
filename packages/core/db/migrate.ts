// Explicit migrations: application schema plus the BullMQ PostgreSQL queue schema.
// Run with: node --env-file=.env packages/core/db/migrate.ts

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runMigrations } from 'bullmq';
import { getPool, closePool, type Db } from './pool.ts';

const dir = fileURLToPath(new URL('./migrations/', import.meta.url));

export async function migrate(db: Db): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(424242)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      await client.query(await readFile(`${dir}${file}`, 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    }
    await runMigrations(client); // BullMQ queue schema (idempotent)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    client.release();
  }
  return applied;
}

if (import.meta.main) {
  const applied = await migrate(getPool());
  console.log(JSON.stringify({ migrated: applied }));
  await closePool();
}
