import { z } from 'zod';
import { currentUser, db, json } from '@/lib/server';
import { verifyOwnership } from '@core/verification/ownership.ts';
import { labProfileFromEnv } from '@core/net/ip-policy.ts';

// `origin` picks one of the project's API origins; without it the site's own origin is checked.
const Body = z.object({ method: z.enum(['dns_txt', 'well_known_file', 'meta_tag']), origin: z.string().max(300).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user || !/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Not found' }, 404);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Choose a verification method.' }, 400);
  const sv = (await db().query<{ id: string; origin: string; token: string; site_origin: string; site_token: string }>(
    `SELECT sv.id, sv.origin, sv.token, p.origin AS site_origin,
       (SELECT s.token FROM site_verifications s WHERE s.project_id = p.id AND s.origin = p.origin ORDER BY s.revision DESC LIMIT 1) AS site_token
     FROM site_verifications sv JOIN projects p ON p.id = sv.project_id
     WHERE sv.project_id = $1 AND p.owner_id = $2 AND sv.origin = coalesce($3, p.origin) ORDER BY sv.revision DESC LIMIT 1`,
    [id, user.id, parsed.data.origin ?? null])).rows[0];
  if (!sv) return json({ error: 'Not found' }, 404);
  const isApi = sv.origin !== sv.site_origin;
  const result = await verifyOwnership(sv.origin, sv.token, parsed.data.method, { lab: labProfileFromEnv() }, isApi ? sv.site_token : undefined);
  await db().query('UPDATE site_verifications SET verified = $2, method = $3, last_reason = $4, last_checked_at = now() WHERE id = $1',
    [sv.id, result.verified, parsed.data.method, result.reason]);
  await db().query(`INSERT INTO audit_log (actor, action, origin, detail) VALUES ($1,'verification_checked',$2,$3)`,
    [`user:${user.id}`, sv.origin, JSON.stringify({ method: parsed.data.method, verified: result.verified, reason: result.reason })]);
  return json(result);
}
