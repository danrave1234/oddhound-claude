import { z } from 'zod';
import { currentUser, db, json, mayScanVerifiedSites } from '@/lib/server';
import { canonicalOrigin, newVerificationToken, OriginError } from '@core/verification/ownership.ts';
import { labProfileFromEnv } from '@core/net/ip-policy.ts';

const Body = z.object({
  name: z.string().trim().min(2).max(80),
  origin: z.string().trim().min(8).max(300),
  environment: z.enum(['staging', 'production']),
  description: z.string().trim().max(1000).default(''),
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return json({ error: 'Sign in first.' }, 401);
  if (!mayScanVerifiedSites(user)) return json({ error: 'Verified-site scanning is invite-only until the public launch checks pass. Ask the operator to allowlist your account.' }, 403);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Check the form fields.', issues: parsed.error.issues }, 400);
  let origin: string;
  try { origin = canonicalOrigin(parsed.data.origin, { allowHttp: Boolean(labProfileFromEnv()) }); }
  catch (e) { return json({ error: e instanceof OriginError ? e.message : 'Invalid origin' }, 400); }
  const p = await db().query<{ id: string }>('INSERT INTO projects (owner_id, name, origin, environment, description) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [user.id, parsed.data.name, origin, parsed.data.environment, parsed.data.description]);
  const projectId = p.rows[0]!.id;
  await db().query('INSERT INTO site_verifications (project_id, owner_id, origin, revision, token) VALUES ($1,$2,$3,1,$4)', [projectId, user.id, origin, newVerificationToken()]);
  await db().query(`INSERT INTO audit_log (actor, action, origin, detail) VALUES ($1,'project_created',$2,$3)`, [`user:${user.id}`, origin, JSON.stringify({ projectId })]);
  return json({ projectId }, 201);
}
