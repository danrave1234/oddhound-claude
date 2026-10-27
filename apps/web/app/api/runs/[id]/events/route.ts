// Durable Server-Sent Events: events are persisted first, then streamed. Reconnect resumes after
// Last-Event-ID, so nothing is lost when the connection drops.
import { canViewRun, currentUser, db, loadRunForAccess } from '@/lib/server';
import { eventsAfter } from '@core/ledger/runs.ts';

export const dynamic = 'force-dynamic';
const TERMINAL = new Set(['completed', 'stopped', 'failed', 'blocked']);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await loadRunForAccess(id);
  if (!access || !canViewRun(await currentUser(), access)) return new Response('Not found', { status: 404 });
  let after = Number(req.headers.get('last-event-id') ?? new URL(req.url).searchParams.get('after') ?? 0) || 0;
  const enc = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => { if (!closed) controller.enqueue(enc.encode(s)); };
      send('retry: 2000\n\n');
      let idle = 0;
      while (!closed && !req.signal.aborted) {
        const rows = await eventsAfter(db(), id, after, 200).catch(() => []);
        for (const e of rows) {
          after = e.seq;
          send(`id: ${e.seq}\nevent: run\ndata: ${JSON.stringify({ seq: e.seq, at: e.at, type: e.type, payload: e.payload })}\n\n`);
        }
        if (!rows.length) {
          const st = (await db().query<{ status: string }>('SELECT status FROM runs WHERE id = $1', [id]).catch(() => ({ rows: [] }))).rows[0]?.status;
          if (st && TERMINAL.has(st) && ++idle > 3) { send('event: end\ndata: {}\n\n'); break; }
          send(': keep-alive\n\n');
        } else idle = 0;
        await new Promise((r) => setTimeout(r, 700));
      }
      closed = true;
      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
}
