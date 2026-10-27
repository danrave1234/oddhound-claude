import { z } from 'zod';
import { currentUser, db, json } from '@/lib/server';
import { setKillSwitch } from '@core/ledger/spend.ts';

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user?.isAdmin) return json({ error: 'Not found' }, 404);
  const parsed = z.object({ on: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Bad request' }, 400);
  await setKillSwitch(db(), parsed.data.on, `user:${user.id}`);
  if (parsed.data.on) await db().query(`UPDATE runs SET stop_requested_at = COALESCE(stop_requested_at, now()), stop_reason = COALESCE(stop_reason, 'kill_switch') WHERE status IN ('queued','provisioning','running','waiting_for_input')`);
  return json({ on: parsed.data.on });
}
