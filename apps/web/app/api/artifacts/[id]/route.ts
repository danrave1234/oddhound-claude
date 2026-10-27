// Artifacts are private: served only after the same run-access check as the run itself (SELF-04).
// Authorisation happens on metadata BEFORE storage is touched, so errors cannot reveal existence.
import { canViewRun, currentUser, db, loadRunForAccess } from '@/lib/server';
import { artifactMeta, readArtifact } from '@core/artifacts/store.ts';

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return notFound();
  const meta = await artifactMeta(db(), id);
  const run = meta && (await loadRunForAccess(meta.runId));
  if (!meta || !run || !canViewRun(await currentUser(), run)) return notFound();
  if (meta.contentType !== 'image/jpeg' && meta.contentType !== 'image/png') return notFound();
  const a = await readArtifact(db(), id).catch(() => null);
  if (!a) return notFound();
  return new Response(new Uint8Array(a.data), { headers: { 'content-type': a.contentType, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } });
}
