// Latest live frame of a run's browser during the owner sign-in handoff. Owner only; never cached.
import { currentUser, db, json, loadRunForAccess } from '@/lib/server';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = await loadRunForAccess(id);
  const user = await currentUser();
  if (!run || !user || run.mode !== 'verified_site' || !(user.isAdmin || run.owner_id === user.id)) return json({ error: 'Not found' }, 404);
  const f = (await db().query<{ seq: number; path: string; width: number; height: number; frame: Buffer }>(
    'SELECT seq, path, width, height, frame FROM run_live_frames WHERE run_id = $1', [id])).rows[0];
  if (!f) return json({ error: 'No live frame' }, 404);
  return new Response(new Uint8Array(f.frame), { headers: {
    'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-frame-seq': String(f.seq),
    'x-frame-width': String(f.width), 'x-frame-height': String(f.height), 'x-frame-path': encodeURIComponent(f.path),
  } });
}
