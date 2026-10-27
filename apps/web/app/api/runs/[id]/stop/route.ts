// Stop: the fence is persisted BEFORE the acknowledgement (SELF-07). The worker sees it before its
// next action and aborts in-flight inference; it cannot undo actions the site already committed.
import { canControlRun, currentUser, json, loadRunForAccess, db } from '@/lib/server';
import { requestStop } from '@core/ledger/runs.ts';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = await loadRunForAccess(id);
  const user = await currentUser();
  if (!run || !(await canControlRun(user, run))) return json({ error: 'Not found' }, 404);
  const accepted = await requestStop(db(), id, user ? `user:${user.id}` : 'anonymous-demo-owner');
  return json({ accepted, note: 'New actions are blocked now. Actions the site already completed cannot be undone.' });
}
