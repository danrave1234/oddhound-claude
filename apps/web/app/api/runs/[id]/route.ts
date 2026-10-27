import { canViewRun, currentUser, json, loadRunForAccess } from '@/lib/server';
import { loadRunSnapshot } from '@/lib/run-data';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await loadRunForAccess(id);
  if (!access || !canViewRun(await currentUser(), access)) return json({ error: 'Not found' }, 404);
  return json(await loadRunSnapshot(id));
}
