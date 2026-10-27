// A project's other first-party API origins (MVP §17 "API and resource scope"). The UI often calls
// its API on another host; writes there are allowed only after that origin is verified on its own.
import { z } from 'zod';
import { isIP } from 'node:net';
import { currentUser, db, json, mayScanVerifiedSites } from '@/lib/server';
import { canonicalOrigin, newVerificationToken, OriginError } from '@core/verification/ownership.ts';
import { labProfileFromEnv, isDialAllowed } from '@core/net/ip-policy.ts';

const MAX_API_ORIGINS = 4; // matches RunContractSchema.target.apiOrigins
const Body = z.object({ origin: z.string().trim().min(8).max(300) });

async function ownedProject(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return (await db().query<{ id: string; origin: string }>('SELECT id, origin FROM projects WHERE id = $1 AND owner_id = $2', [id, userId])).rows[0] ?? null;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return json({ error: 'Not found' }, 404);
  if (!mayScanVerifiedSites(user)) return json({ error: 'Verified-site scanning is invite-only for now.' }, 403);
  const project = await ownedProject(id, user.id);
  if (!project) return json({ error: 'Not found' }, 404);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Enter an origin such as https://api.example.com.' }, 400);
  const lab = labProfileFromEnv();
  let origin: string;
  try { origin = canonicalOrigin(parsed.data.origin, { allowHttp: Boolean(lab) }); }
  catch (e) { return json({ error: e instanceof OriginError ? e.message : 'Invalid origin' }, 400); }
  if (origin === project.origin) return json({ error: 'That is the site itself; it is already in scope.' }, 400);
  const u = new URL(origin);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isDialAllowed(host, Number(u.port || (u.protocol === 'https:' ? 443 : 80)), lab).allowed) {
    return json({ error: 'Private or internal addresses cannot be scanned.' }, 400);
  }
  const existing = (await db().query<{ origin: string }>('SELECT DISTINCT origin FROM site_verifications WHERE project_id = $1 AND origin <> $2', [id, project.origin])).rows;
  if (existing.some((r) => r.origin === origin)) return json({ ok: true, origin });
  if (existing.length >= MAX_API_ORIGINS) return json({ error: `A project can have at most ${MAX_API_ORIGINS} API origins.` }, 400);
  await db().query('INSERT INTO site_verifications (project_id, owner_id, origin, revision, token) VALUES ($1,$2,$3,1,$4)', [id, user.id, origin, newVerificationToken()]);
  await db().query(`INSERT INTO audit_log (actor, action, origin, detail) VALUES ($1,'api_origin_added',$2,$3)`, [`user:${user.id}`, origin, JSON.stringify({ projectId: id })]);
  return json({ ok: true, origin }, 201);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return json({ error: 'Not found' }, 404);
  const project = await ownedProject(id, user.id);
  if (!project) return json({ error: 'Not found' }, 404);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.origin === project.origin) return json({ error: 'Not found' }, 404);
  await db().query('DELETE FROM site_verifications WHERE project_id = $1 AND origin = $2', [id, parsed.data.origin]);
  await db().query(`INSERT INTO audit_log (actor, action, origin, detail) VALUES ($1,'api_origin_removed',$2,$3)`, [`user:${user.id}`, parsed.data.origin, JSON.stringify({ projectId: id })]);
  return json({ ok: true });
}
