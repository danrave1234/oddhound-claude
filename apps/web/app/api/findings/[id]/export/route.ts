import { canViewRun, currentUser, db, json, loadRunForAccess } from '@/lib/server';
import { playwrightTest } from '@core/reports/playwright-export.ts';
import type { Scenario } from '@core/verifier/scenario.ts';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Not found' }, 404);
  const f = (await db().query<{ run_id: string; title: string; scenario_id: string | null }>('SELECT run_id, title, scenario_id FROM findings WHERE id = $1', [id])).rows[0];
  const run = f && (await loadRunForAccess(f.run_id));
  if (!run || !f?.scenario_id || !canViewRun(await currentUser(), run)) return json({ error: 'Not found' }, 404);
  const s = (await db().query<{ id: string; assertion: Scenario; assertion_hash: string }>('SELECT id, assertion, assertion_hash FROM scenarios WHERE id = $1', [f.scenario_id])).rows[0]!;
  const body = playwrightTest(s.assertion, { title: f.title, scenarioId: s.id, assertionHash: s.assertion_hash });
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="oddhound-${s.id.slice(0, 8)}.spec.ts"`, 'cache-control': 'no-store' } });
}
