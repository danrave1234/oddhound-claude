import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Shell } from '@/ui/shell';
import { Icon } from '@/ui/icons';
import { currentUser, db, mayScanVerifiedSites } from '@/lib/server';
import { LIMITS } from '@core/contracts/limits.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Projects' };

export default async function Projects() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/app');
  const projects = (await db().query(`SELECT p.id, p.name, p.origin, p.environment,
      (SELECT verified FROM site_verifications sv WHERE sv.project_id = p.id ORDER BY revision DESC LIMIT 1) AS verified,
      (SELECT max(created_at) FROM runs r WHERE r.project_id = p.id) AS last_run
    FROM projects p WHERE p.owner_id = $1 ORDER BY p.created_at DESC`, [user.id])).rows;
  const today = (await db().query(`SELECT count(*)::int AS n FROM runs WHERE owner_id = $1 AND day_bucket = (now() AT TIME ZONE 'utc')::date AND counted_against_quota`, [user.id])).rows[0].n as number;
  const allowed = mayScanVerifiedSites(user);
  return (
    <Shell active="/app" user={user} toolbar={<>
      <strong>Projects</strong>
      <span className="muted tabular" style={{ marginLeft: 'auto' }}>{Math.max(0, LIMITS.runsPerUserPerDay - today)} of {LIMITS.runsPerUserPerDay} runs left today (UTC)</span>
      {allowed && <Link className="btn btn-primary" href="/app/projects/new"><Icon name="globe" /> New project</Link>}
    </>}>
      {!allowed && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }} role="note">
          <strong>Verified-site scanning is invite-only for now.</strong>
          <p className="muted" style={{ margin: '6px 0 0' }}>It opens to everyone after Oddhound&apos;s public-launch safety checks pass. You can use the demo target today.</p>
        </div>
      )}
      {projects.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: 'center' }}>
          <h2 style={{ marginTop: 0 }}>No projects yet</h2>
          <p className="muted">Add a site you own, verify it, and start your first run.</p>
          {allowed && <Link className="btn btn-primary" href="/app/projects/new">Add a site</Link>}
        </div>
      ) : (
        <div className="card">
          <table className="grid">
            <thead><tr><th>Project</th><th>Origin</th><th>Environment</th><th>Ownership</th><th>Last run</th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/app/projects/${p.id}`}>{p.name}</Link></td>
                  <td className="mono">{p.origin}</td>
                  <td>{p.environment === 'production' ? 'Production' : 'Staging'}</td>
                  <td>{p.verified ? <span className="badge badge-ok"><Icon name="check" />Verified</span> : <span className="badge badge-warn"><Icon name="alert" />Not verified</span>}</td>
                  <td className="muted">{p.last_run ? new Date(p.last_run).toLocaleString() : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
