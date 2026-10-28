// Scale-to-zero worker on Modal: after a run is enqueued, the web app asks Modal to start the worker
// Function (WORKER_WAKE=modal). The worker drains the Postgres queue and exits when idle. If the wake
// call fails, the scheduled tick in infra/modal/app.py starts the worker within its period anyway, so a
// failed wake delays a run; it never loses one (the queue row is the source of truth).
export async function wakeWorker(env: NodeJS.ProcessEnv = process.env): Promise<'spawned' | 'skipped' | 'failed'> {
  if (env.WORKER_WAKE !== 'modal') return 'skipped';
  try {
    const { ModalClient } = await import('modal');
    const client = new ModalClient();
    const fn = await client.functions.fromName(env.MODAL_APP ?? 'oddhound', env.MODAL_WORKER_FUNCTION ?? 'worker');
    await fn.spawn([]);
    return 'spawned';
  } catch (e) {
    console.error(JSON.stringify({ event: 'worker.wake_failed', message: (e as Error).message.slice(0, 200) }));
    return 'failed';
  }
}
