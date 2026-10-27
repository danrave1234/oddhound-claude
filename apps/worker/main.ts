// Oddhound worker: consumes runs from the Postgres-backed queue and executes them, plus the
// independent reapers (stale runs, orphan browser containers/Machines, expired artifacts).
// Holds the platform secrets (DB, model keys, Fly token); the browser runtime never does.
//
// Run: node --env-file=.env apps/worker/main.ts

import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { getPool } from '../../packages/core/db/pool.ts';
import { migrate } from '../../packages/core/db/migrate.ts';
import { startRunWorker } from '../../packages/core/queue/queue.ts';
import { executeRun } from '../../packages/core/agent/execute-run.ts';
import { runtimeFromEnv } from '../../packages/core/browser/select.ts';
import { reapOrphanContainers } from '../../packages/core/browser/docker-runtime.ts';
import { reapFlyMachines } from '../../packages/core/browser/fly-runtime.ts';
import { reapStaleRuns, isRunActive } from '../../packages/core/ledger/runs.ts';
import { purgeExpiredArtifacts } from '../../packages/core/artifacts/store.ts';
import { labProfileFromEnv } from '../../packages/core/net/ip-policy.ts';
import { providersFromEnv } from '../../packages/core/providers/openai-compatible.ts';
import { HeuristicTestPlanner } from '../../packages/core/agent/test-double.ts';
import type { ChatProvider } from '../../packages/core/providers/types.ts';

const env = process.env;
const hosted = env.NODE_ENV === 'production';
const db = getPool();
await migrate(db);

const workerId = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
const runtime = runtimeFromEnv();
const lab = labProfileFromEnv();
const offline = !hosted && env.ODDHOUND_OFFLINE_TEST_DOUBLE === '1';

function providers(): ChatProvider[] {
  const real = providersFromEnv();
  if (real.length) return real;
  // Local development only: with no Meta key, runs use the clearly-labelled offline test double.
  return offline ? [new HeuristicTestPlanner()] : [];
}

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), worker: workerId, ...o }));

const worker = startRunWorker(async (runId) => {
  log({ event: 'run.start', runId });
  const status = await executeRun({ db, runtime, providers: providers(), workerId, lab, hosted, allowOfflineTestDouble: offline }, runId);
  log({ event: 'run.end', runId, status });
  return status;
});
worker.on('error', (e) => log({ event: 'worker.error', message: e.message }));

async function reap() {
  try {
    const runs = await reapStaleRuns(db);
    const browsers = env.BROWSER_RUNTIME === 'fly' && env.FLY_API_TOKEN
      ? await reapFlyMachines({ apiToken: env.FLY_API_TOKEN, app: env.FLY_BROWSER_APP ?? 'oddhound-browser', image: env.FLY_BROWSER_IMAGE ?? '', region: env.FLY_REGION ?? 'iad' }, (id) => isRunActive(db, id))
      : env.BROWSER_RUNTIME === 'host' ? [] : await reapOrphanContainers((id) => isRunActive(db, id));
    const artifacts = await purgeExpiredArtifacts(db);
    if (runs.length || browsers.length || artifacts) log({ event: 'reaper', runs: runs.length, browsers: browsers.length, artifacts });
  } catch (e) { log({ event: 'reaper.error', message: (e as Error).message }); }
}
await reap();
const timer = setInterval(reap, 30_000);

log({ event: 'worker.ready', runtime: runtime.kind, providers: providers().map((p) => `${p.id}/${p.model}`), offlineTestDouble: offline, hosted });

const shutdown = async () => {
  clearInterval(timer);
  await worker.close();
  await db.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
