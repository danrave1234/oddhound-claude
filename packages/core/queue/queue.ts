// Run dispatch on BullMQ 6 with its PostgreSQL backend (same database as the app; no Redis).
// The queue only carries the stable run ID. The run row (status, lease, fence) is the source of
// truth: a redelivered job for a run that is no longer queued is a no-op in claimRun.

import { Queue, Worker, createPostgresBackend } from 'bullmq';
import { databaseUrl } from '../db/pool.ts';
import { wakeWorker } from './wake.ts';

// ODDHOUND_RUN_QUEUE lets two deployments share one database without taking each other's runs
// (Modal alongside Fly during the migration).
export const RUN_QUEUE = process.env.ODDHOUND_RUN_QUEUE || 'oddhound-runs';

const makeQueue = () => new Queue(RUN_QUEUE, { connection: databaseUrl() }, createPostgresBackend);
let queue: ReturnType<typeof makeQueue> | undefined;

export function runQueue() {
  queue ??= makeQueue();
  return queue;
}

/** Enqueue after admission. jobId = runId, so a duplicate enqueue cannot create a second job. */
export async function enqueueRun(runId: string): Promise<void> {
  await runQueue().add('run', { runId }, { jobId: runId, attempts: 1, removeOnComplete: 500, removeOnFail: 500 });
  await wakeWorker();
}

export function startRunWorker(processor: (runId: string) => Promise<unknown>, concurrency = 1) {
  return new Worker(RUN_QUEUE, async (job) => processor((job.data as { runId: string }).runId), {
    connection: databaseUrl(),
    concurrency,
    lockDuration: 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 0, // a stalled run is NOT re-executed blindly; the stale-run reaper fences it instead
  }, createPostgresBackend);
}

export async function closeQueue(): Promise<void> {
  const q = queue; queue = undefined;
  await q?.close();
}
