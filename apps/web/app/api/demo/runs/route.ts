// Sign-in-free "Try the demo target": fixed scope (Oddhound's own seeded app), no user-entered URL.
// Uses the public spend ledger and admission limits; it can never select a billing account or the
// judging reserve (SELF-18).
import { anonymousPrincipal, currentUser, json, db } from '@/lib/server';
import { admitRun } from '@core/ledger/runs.ts';
import { demoTargetContract } from '@core/contracts/contract.ts';
import { enqueueRun } from '@core/queue/queue.ts';

const MESSAGES: Record<string, string> = {
  kill_switch: 'Live runs are paused by the operator. You can still watch the demo replay.',
  principal_pending: 'You already have a run waiting in the queue.',
  queue_full: 'The queue is full right now. Please try again in a few minutes, or watch the demo replay.',
  demo_hourly_limit: 'You can start one live demo run per hour. Watch the replay meanwhile.',
  demo_busy: 'A live demo run is already in progress. Please wait for it to finish, or watch the replay.',
  site_busy: 'A live demo run is already in progress. Please wait for it to finish, or watch the replay.',
};

export async function POST() {
  const origin = process.env.DEMO_TARGET_ORIGIN;
  if (!origin) return json({ error: 'The demo target is not configured on this deployment.' }, 503);
  const user = await currentUser();
  const principal = user ? `user:${user.id}` : await anonymousPrincipal();
  // Every public demo run is billed to the public account. Only an admin grant elsewhere may use 'judging'.
  const result = await admitRun(db(), { principal, ownerId: null, projectId: null, mode: 'demo_target', contract: demoTargetContract(origin), spendAccount: 'public' });
  if (!result.ok) return json({ error: MESSAGES[result.reason] ?? `Not admitted (${result.reason}).`, reason: result.reason }, 429);
  await enqueueRun(result.runId);
  return json({ runId: result.runId }, 201);
}
