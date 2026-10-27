// Owner input for the sign-in handoff (click, typing, keys, scroll, done, cancel). Owner only, and
// only while the run is waiting for the owner. Typed text is encrypted before it is queued.
import { currentUser, db, json, loadRunForAccess } from '@/lib/server';
import { HandoffInputSchema, queueHandoffInput } from '@core/agent/handoff.ts';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = await loadRunForAccess(id);
  const user = await currentUser();
  if (!run || !user || run.mode !== 'verified_site' || !(user.isAdmin || run.owner_id === user.id)) return json({ error: 'Not found' }, 404);
  if (run.status !== 'waiting_for_input') return json({ error: 'This run is not waiting for your sign-in.' }, 409);
  const parsed = HandoffInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Invalid input.' }, 400);
  const pending = (await db().query<{ n: number }>('SELECT count(*)::int AS n FROM run_handoff_inputs WHERE run_id = $1', [id])).rows[0]!.n;
  if (pending > 100) return json({ error: 'Too many pending inputs; wait a moment.' }, 429);
  await queueHandoffInput(db(), id, parsed.data);
  return json({ queued: true });
}
