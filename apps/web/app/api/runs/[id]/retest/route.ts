// Retest: replay the saved, unchanged assertions of a run's verified findings against the target.
// For a verified site the target is the same origin (after the owner deploys a fix). The demo target
// cannot redeploy itself, so its retest runs against the separately hosted corrected build.
import { canControlRun, currentUser, json, loadRunForAccess, db, anonymousPrincipal } from '@/lib/server';
import { admitRun } from '@core/ledger/runs.ts';
import { RunContractSchema, demoTargetContract } from '@core/contracts/contract.ts';
import { enqueueRun } from '@core/queue/queue.ts';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = await loadRunForAccess(id);
  const user = await currentUser();
  if (!run || run.mode === 'retest' || !(await canControlRun(user, run))) return json({ error: 'Not found' }, 404);
  const verified = await db().query(`SELECT count(*)::int AS n FROM findings WHERE run_id = $1 AND verification = 'verified' AND category = 'verified_issue'`, [id]);
  if (!verified.rows[0].n) return json({ error: 'This run has no verified findings to retest.' }, 409);
  const parent = (await db().query('SELECT contract, project_id FROM runs WHERE id = $1', [id])).rows[0];
  let contract = RunContractSchema.parse(parent.contract);
  if (run.mode === 'demo_target') {
    const fixedOrigin = process.env.DEMO_TARGET_FIXED_ORIGIN;
    if (!fixedOrigin) return json({ error: 'The corrected demo build is not configured.' }, 503);
    contract = demoTargetContract(fixedOrigin);
  } else {
    contract = { ...contract, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() };
  }
  const principal = user ? `user:${user.id}` : await anonymousPrincipal();
  const result = await admitRun(db(), {
    principal: `${principal}:retest`, ownerId: run.owner_id, projectId: parent.project_id, mode: 'retest', contract,
    spendAccount: 'public', parentRunId: id,
  });
  if (!result.ok) return json({ error: `Retest not admitted (${result.reason}).`, reason: result.reason }, 429);
  await enqueueRun(result.runId);
  return json({ runId: result.runId }, 201);
}
