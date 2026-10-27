import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

let shared: pg.Pool | undefined;

export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

export function getPool(url = databaseUrl()): pg.Pool {
  shared ??= new pg.Pool({ connectionString: url, max: 10 });
  return shared;
}

export async function closePool(): Promise<void> {
  const p = shared; shared = undefined;
  await p?.end();
}

/** Runs fn inside a transaction; rolls back on error. */
export async function withTx<T>(db: pg.Pool, fn: (tx: pg.PoolClient) => Promise<T>, isolation: 'READ COMMITTED' | 'SERIALIZABLE' = 'READ COMMITTED'): Promise<T> {
  const client = await db.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
